/**
 * AutoClaw（智谱澳龙 / OpenClaw 云端账号体系）订阅登录。
 *
 * Pinned attribution: **@magpie-community/opencode-autoclaw-auth@0.2.1**
 * (github.com/magpie-community/plugins, `packages/autoclaw`; MIT). 一个家族
 * 目录、两个 provider（与 magpie 包一致，两套登录、两个 vault）：
 *
 * | provider id | build | chat 上游 | 登录 |
 * |---|---|---|---|
 * | autoclaw | 国际版（海外直连网关） | `https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw/v1/chat/completions` | 本地网页 OAuth（Google / z.ai，滑块 + state 校验回调） |
 * | autoclaw-cn | 国内版（managed gateway） | `https://autoglm-acceleration-api.zhipuai.cn/autoclaw-proxy/proxy/autoclaw/chat/completions` | 手机验证码（+86） |
 *
 * 鉴权是 `X-Authorization`（不是 Authorization），业务端点带 md5 签名头组
 * （X-Auth-Appid / X-Auth-TimeStamp / X-Auth-Sign）。token 过期时间以 JWT
 * exp 为准（约 24h），比 expires_in 可靠；refresh token 一次一换，与桌面端
 * 共用会互踢。详见 README「归因」。
 */
import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
/** 官方客户端的 app 凭据（WAF 签名头组要用的固定值，upstream index.mjs:25-26）。 */
export const AUTOCLAW_APP_ID = '100003';
export const AUTOCLAW_APP_KEY = '38d2391985e2369a5fb8227d8e6cd5e5';
export const AUTOCLAW_PRODUCT = 'autoclaw';
/** 国际版客户端指纹（upstream index.mjs:28-29）。 */
export const AUTOCLAW_CHANNEL = 'AutoClaw4';
export const AUTOCLAW_CLIENT_VERSION = '1.18.1';
/** 国内版 managed gateway 指纹（AutoClaw 2.1.0，upstream index.mjs:30-31）。 */
export const AUTOCLAW_CN_CHANNEL = 'AutoClaw26';
export const AUTOCLAW_CN_CLIENT_VERSION = '2.1.0';
export const AUTOCLAW_GLOBAL_HOST = 'https://autoglm-api.autoglm.ai';
export const AUTOCLAW_CN_HOST = 'https://autoglm-api.zhipuai.cn';
export const AUTOCLAW_MANAGED_HOST = 'https://autoglm-acceleration-api.zhipuai.cn';
/** 国际版 chat 路径带 `/v1`，国内 managed 不带（upstream index.mjs:38-39）。 */
export const AUTOCLAW_CHAT_PATH = '/autoclaw-proxy/proxy/autoclaw/v1/chat/completions';
export const AUTOCLAW_CN_CHAT_PATH = '/autoclaw-proxy/proxy/autoclaw/chat/completions';
/** 积分钱包（额度端点，upstream index.mjs:42）。 */
/** 注意结尾的斜杠是上游原样（upstream index.mjs:767）。 */
/** access token 过期前这段时间内视为将过期（upstream OAUTH_EXPIRY_SKEW_MS，index.mjs:142）。 */
export const AUTOCLAW_EXPIRY_SKEW_MS = 10 * 60_000;
/** JWT 不可读时的兜底有效期（upstream FALLBACK_EXPIRES_IN_S，index.mjs:143）。 */
export const AUTOCLAW_FALLBACK_EXPIRES_IN_S = 5 * 3600;
/** TokenManager 的预刷窗口＝skew：JWT exp 前 10 分钟内刷新。 */
export const AUTOCLAW_PREEMPT_MS = AUTOCLAW_EXPIRY_SKEW_MS;
/** 官方 TokenServer 端口池——OAuth client 注册的回调白名单端口（upstream index.mjs:847）。 */
export const AUTOCLAW_OAUTH_PORTS = Object.freeze([18432, 19654, 19723, 53699]);
/** 浏览器回调 code 的等待上限（upstream index.mjs:1023）。 */
export const AUTOCLAW_LOGIN_WAIT_MS = 5 * 60_000;
/** 本地登录会话（服务器占用端口）的上限（upstream OAUTH_SESSION_TIMEOUT_MS，index.mjs:145）。 */
export const AUTOCLAW_LOGIN_SESSION_MS = 10 * 60_000;
export const AUTOCLAW_SOURCES = Object.freeze(['oauth', 'sms']);
/** makePlugin(SITES[...]) —— 两个 provider 只差这些字段（upstream index.mjs:1185-1198）。 */
export const AUTOCLAW_SITES = Object.freeze({
    autoclaw: {
        id: 'autoclaw',
        name: 'AutoClaw',
        homeHost: AUTOCLAW_GLOBAL_HOST,
        chatHost: AUTOCLAW_GLOBAL_HOST,
        chatPath: AUTOCLAW_CHAT_PATH,
        chatFallbackHost: AUTOCLAW_CN_HOST,
        managed: false,
    },
    'autoclaw-cn': {
        id: 'autoclaw-cn',
        name: 'AutoClaw CN',
        homeHost: AUTOCLAW_CN_HOST,
        chatHost: AUTOCLAW_MANAGED_HOST,
        chatPath: AUTOCLAW_CN_CHAT_PATH,
        managed: true,
    },
});
export function autoclawSiteOf(id) {
    const site = AUTOCLAW_SITES[id];
    if (!site)
        throw new Error(`unknown autoclaw build: ${id}`);
    return site;
}
/** The two hosts a wallets/profile read tries, home first (upstream loader/usage hosts). */
export function autoclawHosts(site) {
    return site.id === 'autoclaw-cn'
        ? [AUTOCLAW_CN_HOST, AUTOCLAW_GLOBAL_HOST]
        : [AUTOCLAW_GLOBAL_HOST, AUTOCLAW_CN_HOST];
}
export function autoclawChatUrl(site) {
    return site.chatHost + site.chatPath;
}
/** 国际版 401/403 的换侧重试地址；国内版没有（undefined）。 */
export function autoclawChatFallbackUrl(site) {
    return typeof site.chatFallbackHost === 'string' ? site.chatFallbackHost + site.chatPath : undefined;
}
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export function autoclawSourceLabel(source) {
    if (source === 'sms')
        return 'SMS';
    if (source === 'oauth')
        return 'OAuth';
    return undefined;
}
/** 官方客户端的平台缩写（upstream PLATFORM_TM，index.mjs:32）。 */
export function autoclawPlatformTm(platform = process.platform) {
    if (platform === 'darwin')
        return 'mac';
    if (platform === 'win32')
        return 'win';
    return 'linux';
}
/** 国际版 UA：`AutoClaw/1.18.1 (mac-arm64)` 形（upstream index.mjs:33）。 */
export function autoclawUserAgent(version = AUTOCLAW_CLIENT_VERSION) {
    return `AutoClaw/${version} (${autoclawPlatformTm()}-${process.arch})`;
}
function md5Hex(input) {
    return createHash('md5').update(input).digest('hex');
}
function randomHex(n) {
    return randomBytes(n).toString('hex');
}
/** 64 位十六进制 device_id（官方客户端形态，upstream newDeviceId，index.mjs:187-189）。 */
export function newAutoclawDeviceId() {
    return randomHex(32);
}
/** 剥掉 token 上误带的 "Bearer " 前缀（upstream bareToken，index.mjs:218-223）。 */
export function autoclawBareToken(value) {
    let token = String(value ?? '').trim();
    while (token.toLowerCase().startsWith('bearer '))
        token = token.slice(7).trim();
    return token;
}
/** 读 JWT payload 字段（不校验签名——只取自己账号的 device_id / exp；upstream index.mjs:229-240）。 */
export function autoclawJwtClaim(token, key) {
    const raw = autoclawBareToken(token);
    const part = raw.split('.')[1];
    if (!part)
        return undefined;
    try {
        const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        const value = JSON.parse(json)[key];
        return value === undefined || value === null ? undefined : value;
    }
    catch {
        return undefined;
    }
}
/** access token 真实过期时间（epoch ms）；JWT exp 才是事实来源（upstream index.mjs:242-246）。 */
export function autoclawJwtExpiresAtMs(token) {
    const exp = autoclawJwtClaim(token, 'exp');
    return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
}
/**
 * 业务签名头组（task / wallet / 登录 / refresh），WAF 要求带客户端 UA
 * （upstream bizHeaders，index.mjs:191-212）。X-Trace-Id 是每次请求的随机
 * nonce——不是会话或缓存 id。
 */
export function autoclawBizHeaders(accessToken, { channel = AUTOCLAW_CHANNEL, clientVersion = AUTOCLAW_CLIENT_VERSION, userAgent = autoclawUserAgent() } = {}) {
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'User-Agent': userAgent,
        'X-Version': clientVersion,
        'X-Tm': autoclawPlatformTm(),
        'X-Product': AUTOCLAW_PRODUCT,
        'X-Auth-Appid': AUTOCLAW_APP_ID,
        'X-Auth-TimeStamp': ts,
        'X-Auth-Sign': md5Hex(`${AUTOCLAW_APP_ID}&${ts}&${AUTOCLAW_APP_KEY}`),
        'X-Trace-Id': randomHex(16),
        'X-Lang': 'zh-CN',
        'X-Channel': channel,
        // 官方 TokenServer 的本地源（upstream 同样固定 18432，即使端口池顺延）。
        Origin: 'http://localhost:18432',
        Referer: 'http://localhost:18432/',
    };
    if (accessToken)
        headers.Authorization = `Bearer ${autoclawBareToken(accessToken)}`;
    return headers;
}
/**
 * call(): AutoClaw 业务端点的 `{code, msg, data}` 信封（upstream callEnvelope,
 * index.mjs:248-269）。code 0 = 成功；HTTP 401/403 不论响应体形态都是登录
 * 失效（挂 401，共享 TokenManager 会按永久失败收回）。
 */
export function autoclawTokenFields(data, fallbackRefresh) {
    const access = trimmed(data?.access_token) ?? '';
    if (!access)
        throw new Error('AutoClaw token response contained no access_token');
    const refresh = trimmed(data?.refresh_token) ?? trimmed(fallbackRefresh) ?? '';
    if (!refresh)
        throw new Error('AutoClaw token response contained no refresh_token');
    const jwtExpires = autoclawJwtExpiresAtMs(autoclawBareToken(access));
    const expiresInS = typeof data?.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : undefined;
    const expiresAt = jwtExpires !== undefined
        ? jwtExpires - AUTOCLAW_EXPIRY_SKEW_MS
        : Date.now() + (expiresInS ?? AUTOCLAW_FALLBACK_EXPIRES_IN_S) * 1000 - AUTOCLAW_EXPIRY_SKEW_MS;
    return { accessToken: autoclawBareToken(access), refreshToken: autoclawBareToken(refresh), expiresAt };
}
/** 会话形状（store 的硬性底座：accessToken / refreshToken / expiresAt）。 */
export function autoclawSession({ accessToken, refreshToken, expiresAt, account, uid, source = 'oauth' } = {}) {
    const tokens = autoclawTokenFields({ access_token: accessToken, refresh_token: refreshToken, expires_in: undefined });
    const resolved = expiresAt === undefined ? tokens.expiresAt
        : typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? expiresAt
            : tokens.expiresAt;
    return {
        ...tokens,
        expiresAt: resolved,
        account: trimmed(account),
        ...(trimmed(uid) ? { uid: trimmed(uid) } : {}),
        source: AUTOCLAW_SOURCES.includes(source) ? source : 'oauth',
    };
}
/**
 * POST /userapi/v1/user-profile → { user_name, user_phone, user_id }（upstream
 * index.mjs:427-447）。device_id 在这里是调用方自己的标识（upstream 填
 * 'magpie-plugin'，本插件填自己的名字）；失败返回 null。
 */
export function pickAutoclawHumanAccount(...values) {
    for (const value of values) {
        const next = typeof value === 'string' ? value.trim() : '';
        if (next && !next.startsWith('ac-'))
            return next;
    }
    return undefined;
}
/**
 * refresh token 轮换（upstream refreshTokens，index.mjs:459-484）：
 * - host 顺序由 token 的 source_id 决定（`agent*` = 短信账号先国内，网页账号先国际）；
 * - `/refresh` 回 code 400002 时换 `/agent-refresh` 重试同一 host；
 * - 信封 code 400000 = 「该 host 不认这个 token」→ 换下一个 host，其余 code 都停；
 * - 401/403 或 invalid_grant / revoked / expired / 登录已失效 → 永久失败。
 */
export { AUTOCLAW_MODELS, AUTOCLAW_CN_MODELS, autoclawModelOf } from './catalog.js';
