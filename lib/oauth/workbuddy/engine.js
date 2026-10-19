/**
 * WorkBuddy IS the upstream engine (maintainer sign-off 2026-10-18: 全过,
 * 不回退、不旧兼容). The pinned @magpie-community/opencode-workbuddy-auth
 * drives the browser sign-in, the desktop reference import, the token
 * refresh, the chat hop and the usage read for BOTH builds — one package,
 * two named exports (WorkBuddyAuthPlugin / WorkBuddyAIAuthPlugin). The TS
 * wire paths it replaced are deleted; a load/contract/download failure
 * fails the operation with the engine's error.
 *
 * Division that survives the engine (rules.md):
 * - the vault's session shape and lifecycle (accounts.ts saves what the
 *   engine's authorize callbacks hand back; desktop sign-ins store a
 *   REFERENCE — source + uid + placeholder tokens — because the engine
 *   re-reads the desktop file itself on every hop, never a copy);
 * - the closed-set catalog (catalog.ts keeps the /v3/config read; the
 *   engine's provider.models speaks magpie's row shape, which we don't
 *   adopt — rows are the curator's domain, docs/models.md);
 * - the DSH→OpenAI dialect rewrites (request.ts) and the cache strip +
 *   system-prefix parking (cache.ts): the engine's loader then applies its
 *   own fit (tools, unflag, leading system) on top;
 * - the conversation ids: ours to NAME (the session header carries the
 *   cacheSessionId), the engine's to derive (attend()'s four heads —
 *   salted per process now, the sign-off's approved reversal).
 *
 * The package takes no fetchImpl: every egress speaks the bare global
 * fetch, so the adapter registers both sites' endpoint hosts with the
 * URL-scoped engine bridge (upstream-engine/bridge.ts) — engine traffic
 * rides outboundFetch, everything else keeps the original global fetch.
 */
import { OAuthEndpointError } from '../errors.js';
import { listStoredSessions, updateAccountSession } from '../store.js';
import { WORKBUDDY_SITES, readWorkbuddyDesktop, workbuddyDesktopReason } from './index.js';
import { isWorkbuddyFallback } from './cache.js';
import { assertEnginePlugin, loadUpstreamEngine, upstreamEngineConfiguredFor } from '../../upstream-engine/engine.js';
import { registerEngineHosts } from '../../upstream-engine/bridge.js';
import { outboundFetch } from '../../utils/outbound.js';
/** The engine's own session header (index.mjs SESSION): how we name the chat. */
export const WORKBUDDY_SESSION_HEADER = 'x-magpie-workbuddy-session';
/** A desktop reference row carries no credential; the vault wants strings. */
export const WORKBUDDY_PLACEHOLDER = 'workbuddy-desktop-reference';
/** The named export each build enters the package by. */
function engineEntryOf(site) {
    return site.id === 'workbuddy'
        ? (module) => module?.WorkBuddyAuthPlugin
        : (module) => module?.WorkBuddyAIAuthPlugin;
}
/** The engine's auth shape for one of our stored sessions. */
export function engineAuthOf(site, session) {
    const auth = {
        type: 'oauth',
        access: typeof session?.accessToken === 'string' ? session.accessToken : '',
        refresh: typeof session?.refreshToken === 'string' ? session.refreshToken : '',
        expires: Number(session?.expiresAt) || 0,
        uid: typeof session?.uid === 'string' ? session.uid : '',
        plan: typeof session?.planType === 'string' ? session.planType : '',
    };
    if (session?.source === 'desktop')
        auth.source = 'desktop';
    for (const key of ['refreshExpiresAt', 'domain', 'tokenType', 'enterpriseId']) {
        if (typeof session?.[key] === 'string' && session[key])
            auth[key] = session[key];
    }
    return auth;
}
/** A successful authorize/refresh result merged onto a stored session. */
export function sessionFromEngineLogin(site, result, base = {}) {
    const out = {
        ...base,
        source: result?.source === 'desktop' ? 'desktop' : 'oauth',
        accessToken: typeof result?.access === 'string' && result.access ? result.access : WORKBUDDY_PLACEHOLDER,
        refreshToken: typeof result?.refresh === 'string' && result.refresh ? result.refresh : WORKBUDDY_PLACEHOLDER,
        expiresAt: Number(result?.expires) > 0 ? Math.trunc(Number(result.expires)) : (Number(base?.expiresAt) > 0 ? base.expiresAt : 0),
        uid: typeof result?.uid === 'string' ? result.uid : (base?.uid ?? ''),
        account: typeof result?.accountId === 'string' && result.accountId.trim() ? result.accountId.trim() : (base?.account ?? site.name),
    };
    for (const key of ['domain', 'tokenType', 'enterpriseId', 'refreshExpiresAt']) {
        if (typeof result?.[key] === 'string' && result[key])
            out[key] = result[key];
        else if (key in base)
            out[key] = base[key];
    }
    return out;
}
/**
 * The host surface the package's factory touches: client.auth.set persists a
 * renewal. Our vault is multi-account, so the write-back finds the row by uid
 * and merges the engine's token fields — the engine's own renew() map already
 * de-dupes the one-time refresh rotation.
 */
function engineClientFor(site) {
    return {
        auth: {
            set: async ({ body } = {}) => {
                const authPath = upstreamEngineConfiguredFor();
                if (!authPath || !body || typeof body !== 'object')
                    return;
                try {
                    const rows = await listStoredSessions(site.id, authPath);
                    const uid = typeof body.uid === 'string' ? body.uid : '';
                    const hit = rows.find((row) => row.session?.uid === uid) ?? rows.find((row) => row.active);
                    if (!hit)
                        return;
                    const next = sessionFromEngineLogin(site, body, hit.session);
                    await updateAccountSession(site.id, hit, next, authPath);
                }
                catch { /* a failed write-back leaves the engine's in-memory copy serving */ }
            },
        },
    };
}
const pluginBySite = new Map();
/** One build's engine plugin, built once per data dir with our host seams. */
export function workbuddyEnginePlugin(site, { fetchFn = outboundFetch } = {}) {
    const authPath = upstreamEngineConfiguredFor();
    if (!authPath)
        return Promise.reject(new Error('workbuddy engine needs the plugin data dir'));
    registerEngineHosts(site.id, [new URL(site.endpoint).hostname]);
    const key = `${site.id}@${authPath}`;
    let pending = pluginBySite.get(key);
    if (!pending) {
        pending = (async () => {
            const engine = await loadUpstreamEngine(site.id, { authPath, fetchFn, entry: engineEntryOf(site) });
            const factory = engineEntryOf(site)(engine.module);
            const plugin = await factory({ client: engineClientFor(site) });
            assertEnginePlugin(site.id, plugin);
            return { plugin, version: engine.version };
        })();
        pluginBySite.set(key, pending);
        pending.catch(() => pluginBySite.delete(key));
    }
    return pending;
}
/** Test seam: drop the cached plugin instances (production never resets). */
export function resetWorkbuddyEnginePlugin() {
    pluginBySite.clear();
}
/**
 * The engine throws plain Errors with host-shaped wording; keep the proxy's
 * 401-refresh semantics for the dead-grant ones. A structured 401 — the
 * package's WBError carries the HTTP status of the answer it got — is a dead
 * grant the same way. The wrapped refresh failure ('WorkBuddy token refresh:
 * …') has lost its status by then (index.mjs refreshed() re-wraps every
 * non-bare error), so nothing tells a dead grant from a network blip in it:
 * it stays itself unless its wording names the dead grant, because reaping a
 * login over a blip is the worse failure (errors.ts's own rule).
 */
function translateEngineError(error) {
    if (error instanceof OAuthEndpointError)
        return error;
    if (error?.status === 401 || /isn't signed in|is signed out|gave no refreshed token/i.test(String(error?.message ?? ''))) {
        return new OAuthEndpointError(error instanceof Error ? error.message : String(error), 401, 'invalid_grant');
    }
    return error;
}
/**
 * The hop's headersOf: the session header names the chat for the engine's
 * attend() derivation. A fallback id is not a conversation — it is omitted,
 * and the engine then derives from the first user message, as before.
 */
export function workbuddyEngineHeaders(site, cacheSessionId) {
    const headers = { accept: 'application/json' };
    if (typeof cacheSessionId === 'string' && cacheSessionId && !isWorkbuddyFallback(site, cacheSessionId)) {
        headers[WORKBUDDY_SESSION_HEADER] = cacheSessionId;
    }
    return headers;
}
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape is the engine
 * loader's string-input path — it strips the caller's auth headers, keeps the
 * session header for its id derivation, sets the full WorkBuddy sign group,
 * fits the body (tools, unflag, leading system) and wraps the answer.
 */
export async function workbuddyEngineFetch(site, { session, fetchFn = outboundFetch } = {}) {
    const { plugin } = await workbuddyEnginePlugin(site, { fetchFn });
    const loader = await plugin.auth.loader(() => Promise.resolve(engineAuthOf(site, session)));
    if (typeof loader?.fetch !== 'function')
        throw new Error(`the workbuddy engine loader returned no fetch function (${site.id})`);
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
 * TokenManager refresh. A browser session asks the engine's auth.refresh
 * (one-time rotation held engine-side; a changed-fields answer merges onto
 * the stored row) — its failures run through translateEngineError, so the
 * dead-grant wordings (a plainly signed-out account, a bare no-token answer,
 * a structured 401) land as a permanent failure that reaps the row instead
 * of replaying the dead exchange on every request. A desktop reference
 * never refreshes over the wire: the engine re-reads the file per hop, so
 * this only verifies the file is still readable and still this account — a
 * missing/switched file is a permanent 401, and the row is reaped instead
 * of looping.
 */
export async function refreshWorkbuddyEngine(site, session, fetchFn = outboundFetch) {
    if (session?.source === 'desktop') {
        const read = readWorkbuddyDesktop(site);
        if (!read || read.encrypted)
            throw new OAuthEndpointError(workbuddyDesktopReason(site), 401, 'invalid_grant');
        if (read.session.uid !== session.uid)
            throw new OAuthEndpointError('the desktop app signed in to another account; reconnect this provider', 401, 'invalid_grant');
        return { ...session };
    }
    const { plugin } = await workbuddyEnginePlugin(site, { fetchFn });
    let changed;
    try {
        changed = await plugin.auth.refresh(engineAuthOf(site, session));
    }
    catch (error) {
        throw translateEngineError(error);
    }
    if (!changed || typeof changed !== 'object')
        return session;
    return sessionFromEngineLogin(site, changed, session);
}
/**
 * fetchQuota: the engine's usage read (summary meter, enterprise fallback,
 * free-model exemptions — all engine-side now) mapped onto this repo's
 * quota-card rows. plan rides along for the identity write-back.
 */
export async function fetchWorkbuddySiteQuotaEngine(site, session, fetchFn = outboundFetch) {
    const { plugin } = await workbuddyEnginePlugin(site, { fetchFn });
    const usage = await plugin.auth.usage(() => Promise.resolve(engineAuthOf(site, session)));
    if (usage?.error)
        throw new Error(String(usage.error));
    const windows = Array.isArray(usage?.windows) ? usage.windows : [];
    const rows = windows
        .filter((w) => w && typeof w === 'object' && typeof w.used === 'number' && Number.isFinite(w.used) && (Number(w.limit) > 0))
        .map((w) => {
        const usedPercent = Math.max(0, Math.min(100, w.used));
        const resetAt = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN;
        return {
            key: 'credits',
            kind: 'cycle',
            product: typeof w.name === 'string' && w.name.trim() ? w.name.trim() : 'Credits',
            usedPercent,
            remainingPercent: 100 - usedPercent,
            used: Number(w.amount) || 0,
            total: Number(w.limit) || 0,
            // 'credits' is not a currency: the usage card renders it as plain
            // amounts (only 'tokens' and 'usd' are special-cased there).
            unit: typeof w.unit === 'string' && w.unit ? w.unit : 'credits',
            ...(Number.isFinite(resetAt) && resetAt > 0 ? { resetAt } : {}),
        };
    });
    return {
        planType: typeof usage?.plan === 'string' && usage.plan.trim() ? usage.plan.trim() : undefined,
        rows,
    };
}
export async function fetchWorkbuddyQuotaEngine(session, fetchFn = outboundFetch) {
    return fetchWorkbuddySiteQuotaEngine(WORKBUDDY_SITES.workbuddy, session, fetchFn);
}
export async function fetchWorkbuddyAiQuotaEngine(session, fetchFn = outboundFetch) {
    return fetchWorkbuddySiteQuotaEngine(WORKBUDDY_SITES['workbuddy-ai'], session, fetchFn);
}
/**
 * The browser sign-in start: the engine's authorize mints the sign-in page
 * (its callback is the poll). The flow slot, save/discover completion and
 * catalog notification stay ours (accounts.ts completeWorkbuddyBrowser).
 */
export async function workbuddyEngineAuthorizeBrowser(site, { fetchFn = outboundFetch } = {}) {
    const { plugin } = await workbuddyEnginePlugin(site, { fetchFn });
    const method = plugin.auth.methods.find((m) => /browser/i.test(String(m?.label ?? ''))) ?? plugin.auth.methods[0];
    const started = await method.authorize();
    if (!started?.url)
        throw new Error(`${site.name} gave no sign-in page`);
    const callback = started.callback;
    const settle = async () => {
        const result = await callback();
        if (result?.type !== 'success') {
            throw new Error(result?.error ?? `${site.name} sign-in failed`);
        }
        return sessionFromEngineLogin(site, result);
    };
    return { authorizeUrl: started.url, mode: 'browser', settle };
}
/**
 * The desktop import: the engine's desktop method returns the reference
 * (source + uid + display name) — the tokens stay in the app's file, which
 * the engine re-reads itself on every hop. Nothing is copied, ever.
 */
export async function workbuddyEngineAuthorizeDesktop(site, { fetchFn = outboundFetch } = {}) {
    const { plugin } = await workbuddyEnginePlugin(site, { fetchFn });
    const method = plugin.auth.methods.find((m) => /desktop/i.test(String(m?.label ?? '')));
    if (!method)
        throw new Error(workbuddyDesktopReason(site));
    const result = await (await method.authorize()).callback();
    if (result?.type !== 'success')
        throw new Error(result?.error ?? workbuddyDesktopReason(site));
    return sessionFromEngineLogin(site, result);
}
