/**
 * Kimi Work IS the upstream engine (maintainer ruling 2026-10-18: 全过签核,
 * 不回退、不旧兼容). The pinned @magpie-community package drives the login
 * probe, the chat hop and the usage read; the TS implementation it replaced
 * is deleted. A load/contract/download failure fails the operation with the
 * engine's error — there is no fallback lane anymore.
 *
 * What stays ours regardless: session shape and vault, catalog rows and
 * closed sets, cache/session affinity (kimi-work/cache.ts — the engine
 * rewrites neither bodies nor ids), and the login/import lifecycle wiring.
 */
import { OAuthEndpointError } from '../errors.js';
import { UpstreamFailure } from '../upstream.js';
import { readKimiWorkDesktop } from './index.js';
import { assertEnginePlugin, loadUpstreamEngine, upstreamEngineConfiguredFor } from '../../upstream-engine/engine.js';
import { outboundFetch } from '../../utils/outbound.js';
/** The membership window's own name (upstream usage window, index.mjs:132-134). */
export const KIMI_WORK_ALLOWANCE_LABEL = '会员共享额度';
/** The stored session as the engine's getAuth sees it (upstream current() checks source + uid). */
function engineAuthOf(session) {
    return { source: 'kimi-work-desktop', uid: typeof session?.uid === 'string' ? session.uid : '' };
}
/** readSession for createPlugin: our reader with the vault's 401 semantics (never a raw undefined). */
function readSessionOrRefuse() {
    const read = readKimiWorkDesktop();
    if (!read) {
        throw new OAuthEndpointError("Kimi Work desktop isn't signed in; open Kimi and sign in to Work, then reconnect", 401, 'invalid_grant');
    }
    return read;
}
const pluginByDataDir = new Map();
/** The engine plugin for one data dir, built once with our fetch/session injection and contract-checked. */
export function kimiWorkEnginePlugin({ fetchFn = outboundFetch } = {}) {
    const authPath = upstreamEngineConfiguredFor();
    if (!authPath)
        return Promise.reject(new Error('kimi-work engine needs the plugin data dir'));
    let pending = pluginByDataDir.get(authPath);
    if (!pending) {
        pending = (async () => {
            const engine = await loadUpstreamEngine('kimi-work', { fetchFn, entry: (module) => module?._internal?.createPlugin });
            const plugin = engine.module._internal.createPlugin({ readSession: readSessionOrRefuse, fetchImpl: fetchFn });
            assertEnginePlugin('kimi-work', plugin);
            return { plugin, version: engine.version };
        })();
        pluginByDataDir.set(authPath, pending);
        pending.catch(() => pluginByDataDir.delete(authPath));
    }
    return pending;
}
/** Test seam: drop the cached plugin instances (production never resets). */
export function resetKimiWorkEnginePlugin() {
    pluginByDataDir.clear();
}
/**
 * The engine's thrown errors carry host-shaped codes (kimi-work/index.mjs:11-12); keep the proxy's auth/transport semantics.
 * A dead desktop sign-in — the engine's expired mark or our own readSession 401
 * (file gone) — must leave as the hop's `http` 401, never a bare
 * OAuthEndpointError: upstream.ts's refresh gate only engages on that shape
 * (forcedRefresh re-reads the file, and a permanent failure reaps the row into
 * a reconnect), and once unsaved it is forwarded once to the client instead of
 * being retried as a transport fault into a 502 after ~4s.
 */
function translateEngineError(error) {
    if (error instanceof UpstreamFailure)
        return error;
    const code = error?.code;
    if (code === 'kimi_work_login_expired' || error?.signIn === 'expired' || (error instanceof OAuthEndpointError && error.status === 401)) {
        const message = error instanceof Error && error.message
            ? error.message
            : 'Kimi Work desktop sign-in expired; reconnect the Kimi Work provider';
        return new UpstreamFailure(401, message, { code: 'http', payload: { error: { message } } });
    }
    if (code === 'kimi_work_connection_failed') {
        return new UpstreamFailure(502, error instanceof Error ? error.message : 'kimi-work engine connection failed', { code: 'transport' });
    }
    return error;
}
/** The hop's headersOf: the engine sets its own auth surface; ours is the accept line only. */
export function kimiWorkEngineHeaders() {
    return { accept: 'application/json' };
}
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` call shape is exactly
 * the engine loader's string-input path (kimi-work index.mjs:103-118) — it
 * strips the caller's auth headers, re-reads the desktop file and posts to
 * the one Work-gateway endpoint; anything it throws is translated so
 * 401-refresh / transport-retry semantics stay the proxy's.
 */
export async function kimiWorkEngineFetch({ session, fetchFn = outboundFetch } = {}) {
    const { plugin } = await kimiWorkEnginePlugin({ fetchFn });
    const loader = await plugin.auth.loader(() => Promise.resolve(engineAuthOf(session)));
    return async (url, init = {}) => {
        try {
            return await loader.fetch(url, init);
        }
        catch (error) {
            throw translateEngineError(error);
        }
    };
}
/**
 * The login probe: the upstream authorize callback reads the desktop file
 * and proves the Work credential against /models (kimi-work
 * index.mjs:89-100), returning the account reference the save tail stores.
 */
export async function kimiWorkEngineAuthorize({ fetchFn = outboundFetch } = {}) {
    const { plugin } = await kimiWorkEnginePlugin({ fetchFn });
    const method = plugin.auth.methods[0];
    const started = await method.authorize();
    const result = await started.callback();
    if (result?.type !== 'success' || typeof result?.uid !== 'string' || !result.uid) {
        throw new Error(result?.error ?? 'no usable local Kimi Work sign-in; open the Kimi desktop app and sign in to Work first');
    }
    return { uid: result.uid };
}
/**
 * fetchQuota: the engine's membership parse (kimi-work index.mjs:128-135)
 * mapped onto this repo's quota-card row — one shared-allowance window,
 * used 0-100, no invented reset time.
 */
export async function fetchKimiWorkQuota(session, fetchFn = outboundFetch) {
    const { plugin } = await kimiWorkEnginePlugin({ fetchFn });
    const usage = await plugin.auth.usage(() => Promise.resolve(engineAuthOf(session)));
    const window = Array.isArray(usage?.windows)
        ? usage.windows.find((row) => row?.name === KIMI_WORK_ALLOWANCE_LABEL && typeof row.used === 'number')
        : undefined;
    const usedPercent = window ? Math.max(0, Math.min(100, window.used)) : undefined;
    return {
        rows: usedPercent === undefined ? [] : [{
                key: 'membership',
                kind: 'cycle',
                product: KIMI_WORK_ALLOWANCE_LABEL,
                usedPercent,
                remainingPercent: 100 - usedPercent,
            }],
    };
}
