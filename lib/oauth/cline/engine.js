/**
 * Cline IS the upstream engine (maintainer sign-off 2026-10-18: 全过, 不回退、
 * 不旧兼容). The pinned @magpie-community/opencode-cline-auth drives the
 * WorkOS device sign-in, the single-use refresh rotation (serialized, with the
 * in-memory spent-token holds the package keeps per account), the chat hop
 * (Cline's own header group, the X-Task-ID derived from our session name, the
 * pinUpstream option the package defaults off) and the usage read (me +
 * balance + ClinePass limits). The TS paths it replaced (the register/refresh
 * wire helpers, quota.ts's three reads and parsers, the header factory) are
 * deleted.
 *
 * Division that survives the engine:
 * - the vault: session shape, the flow slot and the save/discover completion,
 *   the read-only CLI import (import.ts) and the identity write-back;
 * - the closed-set catalog (catalog.ts keeps its model-table rows);
 * - the cache strip (cache.ts — DSH fields never ride; the session name rides
 *   the engine's own session header and becomes its X-Task-ID);
 * - the refusal classification (request.ts clineQuotaFailure — proxy
 *   semantics).
 *
 * The package's egress (WorkOS + api.cline.bot) speaks the bare global fetch:
 * both hosts ride the URL-scoped bridge. client.auth.set persists the rotated
 * pair — our write-back client updates the vault row by uid.
 */
import { OAuthEndpointError } from '../errors.js';
import { ImportedLoginStale } from '../tokens.js';
import { listStoredSessions, updateAccountSession } from '../store.js';
import { assertEnginePlugin, loadUpstreamEngine, upstreamEngineConfiguredFor } from '../../upstream-engine/engine.js';
import { registerEngineHosts } from '../../upstream-engine/bridge.js';
import { isClineFallback } from './cache.js';
import { CLINE_PREEMPT_MS, formatClineAccessToken } from './index.js';
import { clineImported } from './import.js';
import { outboundFetch } from '../../utils/outbound.js';
const CLINE_ENGINE_NPM = '@magpie-community/opencode-cline-auth';
/** The engine's session header (index.mjs SESSION): how we name the task. */
export const CLINE_SESSION_HEADER = 'x-magpie-cline-session';
/** The engine's auth shape for one of our stored sessions. */
export function engineAuthOf(session) {
    return {
        type: 'oauth',
        access: typeof session?.accessToken === 'string' ? session.accessToken : '',
        refresh: typeof session?.refreshToken === 'string' ? session.refreshToken : '',
        expires: Number(session?.expiresAt) || 0,
        uid: typeof session?.uid === 'string' ? session.uid : '',
        email: typeof session?.account === 'string' ? session.account : '',
        accountId: typeof session?.account === 'string' ? session.account : '',
    };
}
/** A successful authorize/refresh result merged onto a stored session. */
export function sessionFromEngineResult(result, base = {}) {
    return {
        ...base,
        accessToken: formatClineAccessToken(String(result?.access ?? '')),
        refreshToken: String(result?.refresh ?? ''),
        expiresAt: Number(result?.expires) > 0 ? Math.trunc(Number(result.expires)) : (Number(base?.expiresAt) > 0 ? base.expiresAt : 0),
        uid: typeof result?.uid === 'string' && result.uid ? result.uid : base.uid,
        account: typeof result?.accountId === 'string' && result.accountId.trim() ? result.accountId.trim()
            : typeof result?.email === 'string' && result.email.trim() ? result.email.trim()
                : base.account,
        // The row keeps the login it came in with: an engine write-back onto a
        // `cli` row must not rebrand it `oauth` (that would hand the CLI's
        // rotating refresh token to the exchange path). A device login merges
        // onto no base and stays `oauth`.
        source: typeof base?.source === 'string' && base.source ? base.source : 'oauth',
    };
}
/**
 * README decision 4 (imported logins are read-only): a `cli` login's refresh
 * token belongs to the Cline CLI — redeeming it rotates the pair and logs the
 * CLI out. The engine's fresh() spends it the moment the access token is
 * inside the package's REFRESH_LEAD (pinned equal to CLINE_PREEMPT_MS), so an
 * imported login that close to its end never reaches the engine's loader or
 * usage read; it gets the same stale verdict the shared manager's
 * providers.json reread gives. The same predicate the TokenManager uses
 * (`clineImported.is`) decides — `paste`/`env` logins cannot exist for cline.
 */
function assertImportedLoginFresh(session) {
    if (!clineImported.is(session))
        return;
    if (Number(session?.expiresAt) - Date.now() > CLINE_PREEMPT_MS)
        return;
    throw new ImportedLoginStale('Cline', 'cline');
}
function engineClientFor() {
    return {
        auth: {
            set: async ({ body } = {}) => {
                const authPath = upstreamEngineConfiguredFor();
                if (!authPath || !body || typeof body !== 'object')
                    return;
                try {
                    const rows = await listStoredSessions('cline', authPath);
                    const uid = typeof body.uid === 'string' ? body.uid : '';
                    const hit = rows.find((row) => row.session?.uid === uid && uid) ?? rows.find((row) => row.active);
                    if (!hit)
                        return;
                    const next = sessionFromEngineResult(body, hit.session);
                    await updateAccountSession('cline', hit, next, authPath);
                }
                catch { /* a failed write-back leaves the engine's in-memory pair serving */ }
            },
        },
    };
}
let pendingPlugin;
/** The engine plugin, built once per data dir. */
function clineEnginePlugin({ fetchFn = outboundFetch } = {}) {
    const authPath = upstreamEngineConfiguredFor();
    if (!authPath)
        return Promise.reject(new Error('cline engine needs the plugin data dir'));
    registerEngineHosts('cline', ['api.cline.bot', 'api.workos.com']);
    if (!pendingPlugin) {
        pendingPlugin = (async () => {
            const engine = await loadUpstreamEngine('cline', { authPath, fetchFn, entry: (module) => module?.ClinePlugin });
            const plugin = await engine.module.ClinePlugin({ client: engineClientFor() });
            assertEnginePlugin('cline', plugin);
            return { plugin, version: engine.version };
        })();
        pendingPlugin.catch(() => { pendingPlugin = undefined; });
    }
    return pendingPlugin;
}
/** Test seam: drop the cached plugin (production never resets). */
export function resetClineEnginePlugin() {
    pendingPlugin = undefined;
}
/**
 * The device sign-in: the engine's authorize drives the WorkOS device flow;
 * its callback polls the token. The flow slot and the completion stay ours
 * (accounts.ts completeClineDevice).
 */
export async function clineEngineAuthorize({ fetchFn = outboundFetch } = {}) {
    const { plugin } = await clineEnginePlugin({ fetchFn });
    const method = plugin.auth.methods.find((m) => m?.type === 'oauth') ?? plugin.auth.methods[0];
    const started = await method.authorize();
    if (!started?.url)
        throw new Error('Cline gave no sign-in page');
    const callback = started.callback;
    const settle = async () => {
        const result = await callback();
        if (result?.type !== 'success' || !result?.access) {
            throw new Error(result?.error ?? 'the Cline sign-in failed');
        }
        return sessionFromEngineResult(result);
    };
    return { authorizeUrl: started.url, userCode: started.userCode, mode: 'device', settle };
}
/**
 * TokenManager refresh: the engine's auth.refresh takes the auth object
 * itself (not a getter — usage/loader do), spends the single-use token once
 * (serialized, held in memory) and reports the changed fields; the manager
 * persists what comes back. A refused refresh carries signIn: 'expired' and
 * is a permanent invalid_grant so the row is reaped.
 */
export async function refreshClineEngine(session, fetchFn = outboundFetch) {
    // Decision 4 again: an explicit engine refresh is exactly the exchange a
    // `cli` login must never make — the shared manager rereads providers.json
    // instead of ever calling here with one.
    if (clineImported.is(session))
        throw new ImportedLoginStale('Cline', 'cline');
    const { plugin } = await clineEnginePlugin({ fetchFn });
    try {
        const changed = await plugin.auth.refresh(engineAuthOf(session));
        if (!changed || typeof changed !== 'object')
            return session;
        return sessionFromEngineResult({ ...engineAuthOf(session), ...changed }, session);
    }
    catch (error) {
        // Only the engine's own verdict decides: a refused refresh carries
        // signIn 'expired' (the package's Lapsed). Anything else — a 403 rate
        // limit, a 5xx whose body mentions 401 — is the vendor's own words and
        // stays transient; the adapter never re-classifies message text.
        if (error?.signIn === 'expired' || error?.expired === true) {
            throw new OAuthEndpointError(error instanceof Error ? error.message : String(error), 401, 'invalid_grant');
        }
        throw error;
    }
}
/**
 * The hop's headersOf: the engine loader sets Cline's whole header group and
 * derives X-Task-ID from its own session header — ours carries the
 * cacheSessionId when it names a conversation (the `dsh-cline` fallback is
 * omitted; the engine then derives from the task formula's own inputs, as
 * the checklist accepted).
 */
export function clineEngineHeaders(cacheSessionId) {
    const headers = { accept: 'application/json' };
    if (!isClineFallback(cacheSessionId))
        headers[CLINE_SESSION_HEADER] = cacheSessionId;
    return headers;
}
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape feeds the engine
 * loader — it re-reads the credential, rotates it when stale, pins/unwraps the
 * body and posts with Cline's own headers.
 */
export async function clineEngineFetch({ session, fetchFn = outboundFetch } = {}) {
    assertImportedLoginFresh(session);
    const { plugin } = await clineEnginePlugin({ fetchFn });
    const loader = await plugin.auth.loader(() => Promise.resolve(engineAuthOf(session)));
    if (typeof loader?.fetch !== 'function')
        throw new Error('the cline engine loader returned no fetch function');
    return async (url, init = {}) => loader.fetch(url, init);
}
/**
 * fetchQuota: the engine's usage read (me + balance + ClinePass limits) with
 * its windows already computed — {name, used (0-100), display?}. Dollars map
 * to the prepaid wallet row; percent windows to primary/weekly by span; the
 * balance string and the plan ride along. A limits read that failed while
 * me/balance succeeded (the package's #79 partial design) keeps the rows it
 * read and carries the reason on `error`; only a read with nothing to show
 * still throws.
 */
export async function fetchClineQuotaEngine(session, fetchFn = outboundFetch) {
    assertImportedLoginFresh(session);
    const { plugin } = await clineEnginePlugin({ fetchFn });
    const usage = await plugin.auth.usage(() => Promise.resolve(engineAuthOf(session)));
    if (usage?.signIn === 'expired') {
        throw new OAuthEndpointError(String(usage?.error ?? 'the Cline sign-in has expired'), 401, 'invalid_grant');
    }
    const rows = [];
    for (const w of Array.isArray(usage?.windows) ? usage.windows : []) {
        if (!w || typeof w?.used !== 'number' || !Number.isFinite(w.used))
            continue;
        const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim() : 'ClinePass';
        const resetAt = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN;
        rows.push({
            key: 'window',
            kind: 'primary',
            product: name,
            usedPercent: Math.max(0, Math.min(100, w.used)),
            remainingPercent: Math.round((100 - Math.max(0, Math.min(100, w.used))) * 10) / 10,
            ...(Number.isFinite(resetAt) && resetAt > 0 ? { resetAt } : {}),
        });
    }
    const balance = typeof usage?.balance === 'string' && /^\$/.test(usage.balance.trim())
        ? Number(usage.balance.trim().slice(1))
        : NaN;
    if (Number.isFinite(balance)) {
        rows.push({ key: 'wallet', kind: 'prepaid', remaining: Math.round(balance * 100) / 100, unit: 'usd' });
    }
    const softError = usage?.error ? String(usage.error).trim() : '';
    if (softError && !rows.length)
        throw new Error(softError);
    return {
        planType: typeof usage?.plan === 'string' && usage.plan.trim() ? usage.plan.trim() : undefined,
        account: typeof usage?.user === 'string' && usage.user.trim() ? usage.user.trim() : undefined,
        rows,
        ...(softError ? { error: softError } : {}),
    };
}
