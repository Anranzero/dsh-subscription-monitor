/**
 * Zed IS the upstream engine (maintainer sign-off 2026-10-18: 全过, 不回退、
 * 不旧兼容). The pinned @magpie-community/opencode-zed-auth drives Zed's own
 * RSA-loopback sign-in (keypair, native_app_signin page, state-checked
 * callback, the /me read), the model-token minting and staleness retry, the
 * three-wire hop (provider envelope, vendor mapping, per-wire event
 * translation — its answer arrives in the wire's native dialect), and the
 * plan usage read. The TS paths it replaced (transport.ts, request.ts's
 * event machinery, quota.ts's /me read, the RSA login in accounts.ts) are
 * deleted.
 *
 * Division that survives the engine:
 * - the vault: session shape (access + the refresh JSON carrier — the same
 *   shape the engine's stateOf reads), the flow slot, the save/discover
 *   completion and the identity write-back (accounts.ts);
 * - the closed-set catalog (catalog.ts keeps its /models read at the
 *   account's pair);
 * - the cache strip (cache.ts — DSH fields never ride into provider_request);
 * - refresh stays an identity no-op: the stored pair never expires, and the
 *   model token the hop mints per call is the thing that can go stale — the
 *   engine handles that itself.
 *
 * The package's egress speaks the bare global fetch: cloud.zed.dev rides the
 * URL-scoped bridge. The factory takes {client} for one thing — usage's plan
 * save — which our write-back client answers by updating the vault row.
 */
import { Readable } from 'node:stream';
import { ZED_NEVER_EXPIRES } from './index.js';
/** The engine's success/save body → a vault row (the refresh field is the JSON carrier both sides read). */
function sessionFromEngine(body) {
    let planType;
    try {
        const carrier = JSON.parse(String(body?.refresh ?? ''));
        if (typeof carrier?.plan === 'string' && carrier.plan)
            planType = carrier.plan;
    }
    catch { /* the carrier is optional for a save that carries only tokens */ }
    return {
        accessToken: String(body?.access ?? ''),
        refreshToken: String(body?.refresh ?? ''),
        expiresAt: ZED_NEVER_EXPIRES,
        account: typeof body?.accountId === 'string' && body.accountId ? body.accountId : undefined,
        source: 'oauth',
        ...(planType ? { planType } : {}),
    };
}
import { assertEnginePlugin, loadUpstreamEngine, upstreamEngineConfiguredFor } from '../../upstream-engine/engine.js';
import { registerEngineHosts } from '../../upstream-engine/bridge.js';
import { outboundFetch } from '../../utils/outbound.js';
import { upstreamRequest } from '../upstream.js';
const ZED_ENGINE_NPM = '@magpie-community/opencode-zed-auth';
/** The engine's auth shape for one of our stored sessions (the refresh field is the JSON carrier both sides read). */
export function engineAuthOf(session) {
    return {
        type: 'oauth',
        access: typeof session?.accessToken === 'string' ? session.accessToken : '',
        refresh: typeof session?.refreshToken === 'string' ? session.refreshToken : '',
        accountId: typeof session?.account === 'string' ? session.account : '',
    };
}
/** The wire's URL (wireOf reads the path; the host is nominal). */
const ZED_WIRE_URLS = {
    anthropic: 'https://zed.dev/v1/messages',
    responses: 'https://zed.dev/v1/responses',
    chat: 'https://zed.dev/v1/chat/completions',
};
/**
 * usage's plan save: the engine hands the whole auth back with the refresh
 * carrier's plan fields updated — write it onto the vault row (found by the
 * account name it carries).
 */
/** The plan slug the engine's usage save last wrote per account — the usage answer itself names the plan as the dashboard does; the vault and the card want the slug. */
const planSaves = new Map();
function engineClientFor() {
    return {
        auth: {
            set: async ({ body } = {}) => {
                const authPath = upstreamEngineConfiguredFor();
                if (!authPath || !body || typeof body !== 'object')
                    return;
                try {
                    try {
                        const carrier = JSON.parse(String(body.refresh ?? ''));
                        if (typeof carrier?.plan === 'string' && carrier.plan && typeof body.accountId === 'string') {
                            planSaves.set(body.accountId, carrier.plan);
                        }
                    }
                    catch { /* a save without the carrier keeps the last known plan */ }
                    const { listStoredSessions, updateAccountSession } = await import('../store.js');
                    const rows = await listStoredSessions('zed', authPath);
                    const name = typeof body.accountId === 'string' ? body.accountId : '';
                    const hit = rows.find((row) => row.session?.account === name) ?? rows.find((row) => row.active);
                    if (!hit)
                        return;
                    const next = { ...hit.session, ...sessionFromEngine({ ...body, accountId: name || hit.session.account }) };
                    await updateAccountSession('zed', hit, next, authPath);
                }
                catch { /* a failed write-back leaves the engine's read standing */ }
            },
        },
    };
}
let pendingPlugin;
/** The engine plugin, built once per data dir. */
export function zedEnginePlugin({ fetchFn = outboundFetch } = {}) {
    const authPath = upstreamEngineConfiguredFor();
    if (!authPath)
        return Promise.reject(new Error('zed engine needs the plugin data dir'));
    registerEngineHosts('zed', ['cloud.zed.dev']);
    if (!pendingPlugin) {
        pendingPlugin = (async () => {
            const engine = await loadUpstreamEngine('zed', { authPath, fetchFn, entry: (module) => module?.ZedAuthPlugin });
            const plugin = await engine.module.ZedAuthPlugin({ client: engineClientFor() });
            assertEnginePlugin('zed', plugin);
            return { plugin, version: engine.version };
        })();
        pendingPlugin.catch(() => { pendingPlugin = undefined; });
    }
    return pendingPlugin;
}
/** Test seam: drop the cached plugin (production never resets). */
export function resetZedEnginePlugin() {
    pendingPlugin = undefined;
    planSaves.clear();
}
/**
 * The browser sign-in: the engine's authorize generates the RSA keypair,
 * brings its loopback server up and hands back the native_app_signin URL;
 * its callback decrypts the token and reads /me. The flow slot and the
 * save/discover completion stay ours (accounts.ts).
 */
export async function zedEngineAuthorize({ fetchFn = outboundFetch } = {}) {
    const { plugin } = await zedEnginePlugin({ fetchFn });
    const started = await plugin.auth.methods[0].authorize();
    if (!started?.url)
        throw new Error('Zed gave no sign-in page');
    const callback = started.callback;
    const settle = async () => {
        const result = await callback();
        if (result?.type !== 'success' || !result?.access) {
            throw new Error(result?.error ?? 'the Zed sign-in failed');
        }
        return sessionFromEngine(result);
    };
    return { authorizeUrl: started.url, mode: 'browser', settle };
}
/**
 * The hop: the engine loader takes the wire's native-dialect body and URL,
 * mints the model token, wraps the provider envelope and translates the
 * stream back to the wire's own events — the answer is piped as-is. The
 * package's own /completions fetch carries only the caller's signal, so the
 * family timers are enforced here, exactly like every other hop: the engine
 * call and the pipe run inside `upstreamRequest` (first-byte / pre-output
 * budget / idle once data flows; a stall answers 504 before the head and
 * destroys the response after it).
 */
export async function forwardZedEngine(response, { wire, payload, stream, session, fetchFn, signal, startedAt, timeouts }) {
    const { plugin } = await zedEnginePlugin({ fetchFn });
    const loader = await plugin.auth.loader(() => Promise.resolve(engineAuthOf(session)));
    if (typeof loader?.fetch !== 'function')
        throw new Error('the zed engine loader returned no fetch function');
    const url = ZED_WIRE_URLS[wire] ?? ZED_WIRE_URLS.chat;
    await upstreamRequest({ family: 'zed', signal, startedAt, stream, response, timeouts }).run(async (attempt) => {
        const res = await loader.fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(stream ? { accept: 'text/event-stream' } : {}) },
            body: JSON.stringify(payload),
            signal: attempt.signal,
        });
        attempt.signal.throwIfAborted();
        const headers = { 'cache-control': 'no-store' };
        res.headers.forEach((value, key) => {
            const name = key.toLowerCase();
            if (name === 'content-encoding' || name === 'content-length' || name.startsWith('x-magpie-'))
                return;
            headers[key] = value;
        });
        response.writeHead(res.status, headers);
        if (!res.body) {
            response.end();
            return;
        }
        await new Promise((resolve, reject) => {
            const pipe = Readable.fromWeb(res.body);
            const onClose = () => { pipe.destroy(); resolve(); };
            const settle = () => { response.off('close', onClose); };
            pipe.on('error', (error) => { settle(); reject(error); });
            pipe.on('end', () => { settle(); resolve(); });
            response.on('close', onClose);
            pipe.on('data', () => attempt.touch());
            pipe.pipe(response);
        });
    });
}
/**
 * fetchQuota: the engine's usage read (GET /client/users/me at the account's
 * pair) gives the plan display name, the period's end and the overdue-invoice
 * error. Zed reports no spend windows — no rows, exactly as before.
 */
export async function fetchZedQuotaEngine(session, fetchFn = outboundFetch) {
    const { plugin } = await zedEnginePlugin({ fetchFn });
    const usage = await plugin.auth.usage(() => Promise.resolve(engineAuthOf(session)));
    if (usage?.signIn === 'expired') {
        throw new Error(String(usage?.error ?? 'the Zed sign-in has expired — sign in again'));
    }
    if (usage?.error)
        throw new Error(String(usage.error));
    const account = typeof session?.account === 'string' ? session.account : '';
    const slug = planSaves.get(account);
    return {
        planType: slug ?? (typeof usage?.plan === 'string' && usage.plan.trim() ? usage.plan.trim() : undefined),
        rows: [],
    };
}
