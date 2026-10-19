/**
 * Open Design IS the upstream engine (maintainer sign-off 2026-10-18: 全过,
 * 不回退、不旧兼容). The pinned @magpie-community/opencode-opendesign-auth
 * drives the CLI device sign-in and the control-plane usage read; the hop's
 * wire facts (base URL, runtime key, the package's own UA) come from its
 * loader. The TS device poll and the three-read quota it replaced are
 * deleted.
 *
 * Division that survives the engine:
 * - the vault: session shape, the pasted-key sign-in (a vault-domain input —
 *   the package's own method[1] is magpie's key prompt, not ours), identity
 *   write-back. The two keys never expire and there is no refresh endpoint —
 *   refreshOpendesign stays a no-op;
 * - the closed-set catalog (catalog.ts keeps the /models read at the runtime
 *   key; the engine's provider.models speaks magpie's row shape);
 * - the cache strip (cache.ts) and the DSH dialect rewrites — none needed on
 *   this native Completions wire.
 *
 * The package's egress (device start/poll, the control-plane reads) speaks
 * the bare global fetch: both endpoint hosts ride the URL-scoped bridge.
 */
import { OAuthEndpointError } from '../errors.js';
import { opendesignControlKeyOf, opendesignRuntimeKeyOf, opendesignSession } from './index.js';
import { assertEnginePlugin, loadUpstreamEngine, upstreamEngineConfiguredFor } from '../../upstream-engine/engine.js';
import { ENGINE_SEEDS } from '../../upstream-engine/packages.js';
import { registerEngineHosts } from '../../upstream-engine/bridge.js';
import { outboundFetch } from '../../utils/outbound.js';
const OPENDESIGN_ENGINE_NPM = '@magpie-community/opencode-opendesign-auth';
/** The engine's auth shape for one of our stored sessions. */
export function engineAuthOf(session) {
    return {
        type: 'oauth',
        access: opendesignRuntimeKeyOf(session),
        control: opendesignControlKeyOf(session),
    };
}
let cachedVersion;
/**
 * The UA the package's own api() sends — `opencode-opendesign-auth/<v>` with
 * the loaded package's version, so a dist-tag bump moves the UA with it. The
 * audited seed answers before the first load.
 */
export function opendesignEngineUserAgent() {
    return `opencode-opendesign-auth/${cachedVersion ?? ENGINE_SEEDS.opendesign.version}`;
}
let pendingPlugin;
/** The engine plugin, built once per data dir (the factory takes no host surface at all). */
export function opendesignEnginePlugin({ fetchFn = outboundFetch } = {}) {
    const authPath = upstreamEngineConfiguredFor();
    if (!authPath)
        return Promise.reject(new Error('opendesign engine needs the plugin data dir'));
    registerEngineHosts('opendesign', ['amr-api.open-design.ai', 'amr-link.open-design.ai']);
    if (!pendingPlugin) {
        pendingPlugin = (async () => {
            const engine = await loadUpstreamEngine('opendesign', { authPath, fetchFn, entry: (module) => module?.OpenDesignAuthPlugin });
            const plugin = await engine.module.OpenDesignAuthPlugin();
            assertEnginePlugin('opendesign', plugin);
            cachedVersion = engine.version;
            return { plugin, version: engine.version };
        })();
        pendingPlugin.catch(() => { pendingPlugin = undefined; });
    }
    return pendingPlugin;
}
/** Test seam: drop the cached plugin (production never resets). */
export function resetOpendesignEnginePlugin() {
    pendingPlugin = undefined;
    cachedVersion = undefined;
}
/**
 * The device sign-in: the engine's authorize mints the activation page and
 * its callback is the poll. The flow slot, the save/discover completion and
 * the catalog notification stay ours (accounts.ts completeOpendesignDevice).
 */
export async function opendesignEngineAuthorize({ fetchFn = outboundFetch } = {}) {
    const { plugin } = await opendesignEnginePlugin({ fetchFn });
    const method = plugin.auth.methods.find((m) => m?.type === 'oauth') ?? plugin.auth.methods[0];
    const started = await method.authorize();
    if (!started?.url)
        throw new Error('Open Design gave no activation page');
    const userCode = typeof started.userCode === 'string' && started.userCode ? started.userCode : undefined;
    const callback = started.callback;
    const settle = async () => {
        const result = await callback();
        if (result?.type !== 'success' || !result?.access) {
            throw new Error(result?.error ?? 'Open Design sign-in failed');
        }
        return opendesignSession({
            runtimeKey: result.access,
            controlKey: result.control,
            account: result.accountId ?? result.email,
            uid: result.uid,
            source: 'oauth',
        });
    };
    return { authorizeUrl: started.url, userCode, mode: 'device', settle };
}
/**
 * The hop's wire facts from the engine loader: the link base URL, the runtime
 * key it accepts and the package's own UA. Our forward() posts Completions
 * there — the loader has no fetch of its own (the host client owns the wire).
 */
export async function opendesignEngineHop({ session, fetchFn = outboundFetch } = {}) {
    const { plugin } = await opendesignEnginePlugin({ fetchFn });
    const loader = await plugin.auth.loader(() => Promise.resolve(engineAuthOf(session)));
    const apiKey = typeof loader?.apiKey === 'string' && loader.apiKey ? loader.apiKey : opendesignRuntimeKeyOf(session);
    if (!apiKey)
        throw new OAuthEndpointError('Open Design session needs a runtime key', 401, 'invalid_grant');
    return {
        baseURL: typeof loader?.baseURL === 'string' && loader.baseURL ? loader.baseURL : 'https://amr-link.open-design.ai/v1',
        apiKey,
        userAgent: opendesignEngineUserAgent(),
    };
}
/**
 * fetchQuota: the engine's usage read (workspace → preflight → summary) with
 * its windows already computed — {name, used (%, one decimal), span (s),
 * resetsAt, display}, shortest first. A pasted-key session has no control
 * key: empty rows, not an error (the control plane takes no API key). The
 * engine's signIn:"expired" (the key was revoked) reads as a permanent 401.
 */
export async function fetchOpendesignQuotaEngine(session, fetchFn = outboundFetch) {
    if (!opendesignControlKeyOf(session)) {
        return { account: session?.account, rows: [] };
    }
    const { plugin } = await opendesignEnginePlugin({ fetchFn });
    const usage = await plugin.auth.usage(() => Promise.resolve(engineAuthOf(session)));
    if (usage?.signIn === 'expired' || usage?.error && !Array.isArray(usage?.windows)) {
        throw new OAuthEndpointError(String(usage?.error ?? "Open Design refused the account's sign-in — sign in again"), 401, 'invalid_grant');
    }
    if (usage?.error) {
        // A read the account can answer (no Design Plan allowance) keeps its card.
        if (/no Design Plan allowance/i.test(String(usage.error))) {
            return { planType: typeof usage?.plan === 'string' ? usage.plan : undefined, rows: walletRowOf(usage) };
        }
        throw new Error(String(usage.error));
    }
    const HOUR = 3600;
    const WEEK = 7 * 24 * HOUR;
    const rows = (Array.isArray(usage?.windows) ? usage.windows : [])
        .filter((w) => w && typeof w.used === 'number' && Number.isFinite(w.used))
        .map((w) => {
        const span = Math.max(0, Number(w.span) || 0);
        const weekly = span >= WEEK && span % WEEK === 0;
        const resetAt = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN;
        return {
            key: weekly ? '7d' : 'window',
            kind: weekly ? 'weekly' : 'primary',
            ...(weekly ? {} : { windowMinutes: Math.round(span / 60) }),
            usedPercent: Math.max(0, Math.min(100, w.used)),
            remainingPercent: Math.round((100 - Math.max(0, Math.min(100, w.used))) * 10) / 10,
            ...(Number.isFinite(resetAt) && resetAt > 0 ? { resetAt } : {}),
        };
    });
    rows.push(...walletRowOf(usage));
    return {
        planType: typeof usage?.plan === 'string' && usage.plan.trim() ? usage.plan.trim() : undefined,
        rows,
    };
}
/** The wallet row: the engine formats the balance as "$x.xx". */
function walletRowOf(usage) {
    // The engine's money() answers "" when no read gave a balanceUsd
    // (non-finite in, "" out) — that is "no wallet", not $0.00: Number("") === 0
    // must not reach the numeric arm below and mint a prepaid row.
    if (typeof usage?.balance === 'string' && !usage.balance.trim())
        return [];
    const balance = typeof usage?.balance === 'string' && /^\$\d+(\.\d+)?$/.test(usage.balance.trim())
        ? Number(usage.balance.trim().slice(1))
        : Number.isFinite(Number(usage?.balance)) ? Number(usage.balance) : NaN;
    if (!Number.isFinite(balance))
        return [];
    return [{
            key: 'wallet',
            kind: 'prepaid',
            remaining: Math.round(balance * 100) / 100,
            unit: 'usd',
        }];
}
