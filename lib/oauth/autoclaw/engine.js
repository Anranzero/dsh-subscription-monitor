/**
 * AutoClaw IS the upstream engine (maintainer sign-off 2026-10-18: 全过,
 * 不回退、不旧兼容). The pinned @magpie-community/opencode-autoclaw-auth
 * drives both builds' logins (the international local-OAuth server — port
 * pool, slider, state-checked callback — and the CN phone-SMS two-step), the
 * one-shot token rotation with its account-name back-fill, the chat hop (biz
 * header group, official-system-prefix body rewrite, host failover, the CN
 * managed gateway) and the credits usage read. The TS paths it replaced
 * (local-oauth.ts, the refresh/wire helpers, quota.ts's wallet reads) are
 * deleted.
 *
 * Division that survives the engine:
 * - the vault: session shape, the attempt registry (autoclawFlows) and the
 *   save/discover completion (accounts.ts); the SMS two-step's pending state
 *   holds the ENGINE's started sign-in instead of a device id;
 * - the closed-set catalog (catalog.ts static rows);
 * - the cache strip (cache.ts) and the refusal classification
 *   (classifyAutoclawFailure — proxy semantics);
 * - reasoningEfforts stay unadvertised on the international rows (本仓目录
 *   侧裁定, ROLLOUT.md).
 *
 * The package's egress speaks the bare global fetch: all three endpoint
 * hosts ride the URL-scoped bridge. The factory takes no host surface
 * (`async ({client}, options)` — client and options both unused by both
 * builds' flows; the daily check-in hook stays off by default upstream).
 */
import { OAuthEndpointError } from '../errors.js';
import { autoclawSession } from './index.js';
import { assertEnginePlugin, loadUpstreamEngine, upstreamEngineConfiguredFor } from '../../upstream-engine/engine.js';
import { registerEngineHosts } from '../../upstream-engine/bridge.js';
import { outboundFetch } from '../../utils/outbound.js';
const AUTOCLAW_ENGINE_NPM = '@magpie-community/opencode-autoclaw-auth';
/** All three hosts both builds may speak to (home host first per family). */
const AUTOCLAW_ENGINE_HOSTS = Object.freeze([
    'autoglm-api.autoglm.ai',
    'autoglm-api.zhipuai.cn',
    'autoglm-acceleration-api.zhipuai.cn',
]);
function engineEntryOf(family) {
    return family === 'autoclaw'
        ? (module) => module?.AutoclawAuthPlugin
        : (module) => module?.AutoclawCnAuthPlugin;
}
/** The engine's auth shape for one of our stored sessions. */
export function engineAuthOf(session) {
    return {
        type: 'oauth',
        access: typeof session?.accessToken === 'string' ? session.accessToken : '',
        refresh: typeof session?.refreshToken === 'string' ? session.refreshToken : '',
        accountId: typeof session?.account === 'string' ? session.account : '',
        email: typeof session?.account === 'string' ? session.account : '',
        ...(typeof session?.uid === 'string' && session.uid ? { uid: session.uid } : {}),
    };
}
/** A successful authorize/refresh result merged onto a stored session. */
export function sessionFromEngineResult(family, result, base = {}) {
    if (!result?.access || !result?.refresh) {
        throw new Error('the AutoClaw engine sign-in returned no token pair');
    }
    return autoclawSession({
        accessToken: result.access,
        refreshToken: result.refresh,
        expiresAt: Number(result.expires) > 0 ? Math.trunc(Number(result.expires)) : undefined,
        account: typeof result.accountId === 'string' && result.accountId.trim() ? result.accountId.trim() : base.account,
        uid: typeof result.uid === 'string' && result.uid ? result.uid : base.uid,
        source: base.source,
    });
}
const pluginByFamily = new Map();
/** One build's engine plugin, built once per data dir. */
export function autoclawEnginePlugin(family, { fetchFn = outboundFetch } = {}) {
    const authPath = upstreamEngineConfiguredFor();
    if (!authPath)
        return Promise.reject(new Error('autoclaw engine needs the plugin data dir'));
    registerEngineHosts(family, AUTOCLAW_ENGINE_HOSTS);
    let pending = pluginByFamily.get(family);
    if (!pending) {
        pending = (async () => {
            const engine = await loadUpstreamEngine(family, { authPath, fetchFn, entry: engineEntryOf(family) });
            const factory = engineEntryOf(family)(engine.module);
            const plugin = await factory({});
            assertEnginePlugin(family, plugin);
            return { plugin, version: engine.version };
        })();
        pluginByFamily.set(family, pending);
        pending.catch(() => pluginByFamily.delete(family));
    }
    return pending;
}
/** Test seam: drop the cached plugin instances (production never resets). */
export function resetAutoclawEnginePlugin() {
    pluginByFamily.clear();
}
/**
 * The international browser login: the engine's authorize brings its own
 * local server up (port pool first) and hands back the guide URL at once;
 * its callback waits for the code, exchanges it and reads the profile. The
 * flow slot and the save/discover completion stay ours (accounts.ts).
 */
export async function autoclawEngineAuthorizeBrowser({ vendor = 'google', fetchFn = outboundFetch } = {}) {
    const { plugin } = await autoclawEnginePlugin('autoclaw', { fetchFn });
    const method = plugin.auth.methods[0];
    const started = await method.authorize({ vendor: vendor === 'zai' ? 'zai' : 'google' });
    if (!started?.url)
        throw new Error('the AutoClaw engine gave no local sign-in page');
    const callback = started.callback;
    const settle = async () => {
        const result = await callback();
        if (result?.type !== 'success')
            throw new Error(result?.error ?? 'AutoClaw 登录失败');
        return sessionFromEngineResult('autoclaw', result);
    };
    return { authorizeUrl: started.url, mode: 'browser', settle };
}
/**
 * The CN phone-SMS two-step, engine-driven: step one (`authorize({phone})`)
 * sends the code and returns the started sign-in (`method: "code"`); step
 * two submits the digits to its callback. The pending map keeps the started
 * sign-in for the second RPC (10 分钟内有效, accounts.ts's shape).
 */
const SMS_STARTED = new Map();
const SMS_PENDING_TTL_MS = 10 * 60_000;
function startedOf(phone) {
    const hit = SMS_STARTED.get(phone);
    if (!hit || Date.now() - hit.at > SMS_PENDING_TTL_MS) {
        SMS_STARTED.delete(phone);
        return undefined;
    }
    return hit;
}
export async function autoclawEngineAuthorizeSms({ phone, code, fetchFn = outboundFetch } = {}) {
    if (code === undefined || code === null || String(code) === '') {
        const pending = startedOf(String(phone));
        if (pending)
            return { mode: 'code-sent', message: pending.started.instructions ?? '验证码已发送' };
        const { plugin } = await autoclawEnginePlugin('autoclaw-cn', { fetchFn });
        const started = await plugin.auth.methods[0].authorize({ phone: String(phone) });
        SMS_STARTED.set(String(phone), { started, at: Date.now() });
        return { mode: 'code-sent', message: String(started.instructions ?? '验证码已发送') };
    }
    const pending = startedOf(String(phone));
    if (!pending)
        throw new Error('验证码会话已过期，请重新发送');
    SMS_STARTED.delete(String(phone));
    const result = await pending.started.callback(code);
    if (result?.type !== 'success')
        throw new Error(result?.error ?? '登录失败');
    return sessionFromEngineResult('autoclaw-cn', result, { source: 'sms' });
}
/** Test seam for the pending-map shape (production never resets). */
export function resetAutoclawSmsPending() {
    SMS_STARTED.clear();
}
/**
 * TokenManager refresh: the engine's auth.refresh rotates the pair once and
 * back-fills a missing account name from user-profile (upstream 0.2.1). A
 * refused refresh reads as a permanent invalid_grant so the row is reaped:
 * the verdict comes from the engine's own dead marker (`signIn === 'expired'`
 * — it attaches that for HTTP 401/403 and invalid_grant/revoked/expired/
 * 登录已失效-class messages, index.mjs:477-481) or a 401/403 status; the
 * message match is only the safety net for errors that carry neither.
 */
export async function refreshAutoclawEngine(family, session, fetchFn = outboundFetch) {
    const { plugin } = await autoclawEnginePlugin(family, { fetchFn });
    try {
        const next = await plugin.auth.refresh(engineAuthOf(session));
        if (!next?.access || !next?.refresh)
            throw new Error('the AutoClaw engine refresh returned no token pair');
        return sessionFromEngineResult(family, next, session);
    }
    catch (error) {
        const dead = error?.signIn === 'expired'
            || error?.status === 401 || error?.status === 403
            || /refresh_token|invalid|失效|refused|revoked|expired|401|403/i.test(String(error?.message ?? ''));
        if (dead) {
            throw new OAuthEndpointError(error instanceof Error ? error.message : String(error), 401, 'invalid_grant');
        }
        throw error;
    }
}
/**
 * The hop's headersOf: the engine loader builds the whole biz group itself
 * (X-Authorization, the official client fingerprint, the signature) from the
 * token it re-reads per request; ours is the accept line only.
 */
export function autoclawEngineHeaders() {
    return { accept: 'application/json' };
}
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape feeds the engine
 * loader — it rewrites the body (official system prefix, max_tokens drop,
 * unflag), sets the biz header group and fails over between the two hosts
 * (the CN build rides its managed gateway). The URL we pass is nominal: the
 * engine owns the chat path.
 */
export async function autoclawEngineFetch(family, { session, fetchFn = outboundFetch } = {}) {
    const { plugin } = await autoclawEnginePlugin(family, { fetchFn });
    const loader = await plugin.auth.loader(() => Promise.resolve(engineAuthOf(session)));
    if (typeof loader?.fetch !== 'function')
        throw new Error(`the autoclaw engine loader returned no fetch function (${family})`);
    return async (url, init = {}) => loader.fetch(url, init);
}
/**
 * fetchQuota: the engine's usage read (wallets + the sign-in status) gives
 * display rows — the credits total and the named wallets, each as
 * {name, display}. Balance 制：余额即剩余——prepaid 余额行 remaining=余额
 * （cline/opendesign 钱包行同形），不发明 used/百分比；签到状态行没有卡面槽
 * （README「不采纳」），跳过。
 */
export async function fetchAutoclawSiteQuotaEngine(family, session, fetchFn = outboundFetch) {
    const { plugin } = await autoclawEnginePlugin(family, { fetchFn });
    const usage = await plugin.auth.usage(() => Promise.resolve(engineAuthOf(session)));
    if (usage?.error)
        throw new Error(String(usage.error));
    const rows = [];
    for (const w of Array.isArray(usage?.windows) ? usage.windows : []) {
        if (!w || typeof w?.name !== 'string')
            continue;
        if (w.name === '每日签到' || String(w.display ?? '').startsWith('今日'))
            continue;
        const total = Number.parseInt(String(w.display ?? '').replace(/[^\d-]/g, ''), 10);
        if (!Number.isFinite(total))
            continue;
        const first = rows.length === 0;
        rows.push({
            key: first ? 'credits' : `wallet:${w.name}`,
            kind: 'prepaid',
            product: w.name,
            remaining: Math.round(total),
            unit: 'credits',
        });
    }
    if (!rows.length)
        throw new Error('积分接口无数据（token 可能不属于该 host）');
    return { rows };
}
export async function fetchAutoclawQuotaEngine(session, fetchFn = outboundFetch) {
    return fetchAutoclawSiteQuotaEngine('autoclaw', session, fetchFn);
}
export async function fetchAutoclawCnQuotaEngine(session, fetchFn = outboundFetch) {
    return fetchAutoclawSiteQuotaEngine('autoclaw-cn', session, fetchFn);
}
