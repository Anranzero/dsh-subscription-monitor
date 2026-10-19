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
/** 官方客户端的 app 凭据（WAF 签名头组要用的固定值，upstream index.mjs:25-26）。 */
export declare const AUTOCLAW_APP_ID = "100003";
export declare const AUTOCLAW_APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";
export declare const AUTOCLAW_PRODUCT = "autoclaw";
/** 国际版客户端指纹（upstream index.mjs:28-29）。 */
export declare const AUTOCLAW_CHANNEL = "AutoClaw4";
export declare const AUTOCLAW_CLIENT_VERSION = "1.18.1";
/** 国内版 managed gateway 指纹（AutoClaw 2.1.0，upstream index.mjs:30-31）。 */
export declare const AUTOCLAW_CN_CHANNEL = "AutoClaw26";
export declare const AUTOCLAW_CN_CLIENT_VERSION = "2.1.0";
export declare const AUTOCLAW_GLOBAL_HOST = "https://autoglm-api.autoglm.ai";
export declare const AUTOCLAW_CN_HOST = "https://autoglm-api.zhipuai.cn";
export declare const AUTOCLAW_MANAGED_HOST = "https://autoglm-acceleration-api.zhipuai.cn";
/** 国际版 chat 路径带 `/v1`，国内 managed 不带（upstream index.mjs:38-39）。 */
export declare const AUTOCLAW_CHAT_PATH = "/autoclaw-proxy/proxy/autoclaw/v1/chat/completions";
export declare const AUTOCLAW_CN_CHAT_PATH = "/autoclaw-proxy/proxy/autoclaw/chat/completions";
/** 积分钱包（额度端点，upstream index.mjs:42）。 */
/** 注意结尾的斜杠是上游原样（upstream index.mjs:767）。 */
/** access token 过期前这段时间内视为将过期（upstream OAUTH_EXPIRY_SKEW_MS，index.mjs:142）。 */
export declare const AUTOCLAW_EXPIRY_SKEW_MS: number;
/** JWT 不可读时的兜底有效期（upstream FALLBACK_EXPIRES_IN_S，index.mjs:143）。 */
export declare const AUTOCLAW_FALLBACK_EXPIRES_IN_S: number;
/** TokenManager 的预刷窗口＝skew：JWT exp 前 10 分钟内刷新。 */
export declare const AUTOCLAW_PREEMPT_MS: number;
/** 官方 TokenServer 端口池——OAuth client 注册的回调白名单端口（upstream index.mjs:847）。 */
export declare const AUTOCLAW_OAUTH_PORTS: readonly number[];
/** 浏览器回调 code 的等待上限（upstream index.mjs:1023）。 */
export declare const AUTOCLAW_LOGIN_WAIT_MS: number;
/** 本地登录会话（服务器占用端口）的上限（upstream OAUTH_SESSION_TIMEOUT_MS，index.mjs:145）。 */
export declare const AUTOCLAW_LOGIN_SESSION_MS: number;
export declare const AUTOCLAW_SOURCES: readonly string[];
export interface AutoclawSite {
    id: 'autoclaw' | 'autoclaw-cn';
    name: string;
    /** 登录 / 业务端点（profile、refresh 起始 host、钱包起始 host）。 */
    homeHost: string;
    /** chat 的上游（国际＝海外直连；国内＝managed gateway）。 */
    chatHost: string;
    chatPath: string;
    /** 国际版 401/403 时换侧重试的 host；国内无（401/403 即失效）。 */
    chatFallbackHost?: string;
    managed: boolean;
}
/** makePlugin(SITES[...]) —— 两个 provider 只差这些字段（upstream index.mjs:1185-1198）。 */
export declare const AUTOCLAW_SITES: Record<"autoclaw" | "autoclaw-cn", AutoclawSite>;
export declare function autoclawSiteOf(id: string): AutoclawSite;
/** The two hosts a wallets/profile read tries, home first (upstream loader/usage hosts). */
export declare function autoclawHosts(site: AutoclawSite): string[];
export declare function autoclawChatUrl(site: AutoclawSite): string;
/** 国际版 401/403 的换侧重试地址；国内版没有（undefined）。 */
export declare function autoclawChatFallbackUrl(site: AutoclawSite): string | undefined;
export declare function autoclawSourceLabel(source: any): "OAuth" | "SMS" | undefined;
/** 官方客户端的平台缩写（upstream PLATFORM_TM，index.mjs:32）。 */
export declare function autoclawPlatformTm(platform?: NodeJS.Platform): string;
/** 国际版 UA：`AutoClaw/1.18.1 (mac-arm64)` 形（upstream index.mjs:33）。 */
export declare function autoclawUserAgent(version?: string): string;
/** 64 位十六进制 device_id（官方客户端形态，upstream newDeviceId，index.mjs:187-189）。 */
export declare function newAutoclawDeviceId(): string;
/** 剥掉 token 上误带的 "Bearer " 前缀（upstream bareToken，index.mjs:218-223）。 */
export declare function autoclawBareToken(value: any): string;
/** 读 JWT payload 字段（不校验签名——只取自己账号的 device_id / exp；upstream index.mjs:229-240）。 */
export declare function autoclawJwtClaim(token: any, key: any): any;
/** access token 真实过期时间（epoch ms）；JWT exp 才是事实来源（upstream index.mjs:242-246）。 */
export declare function autoclawJwtExpiresAtMs(token: any): number | undefined;
/**
 * 业务签名头组（task / wallet / 登录 / refresh），WAF 要求带客户端 UA
 * （upstream bizHeaders，index.mjs:191-212）。X-Trace-Id 是每次请求的随机
 * nonce——不是会话或缓存 id。
 */
export declare function autoclawBizHeaders(accessToken?: any, { channel, clientVersion, userAgent }?: any): Record<string, string>;
/**
 * call(): AutoClaw 业务端点的 `{code, msg, data}` 信封（upstream callEnvelope,
 * index.mjs:248-269）。code 0 = 成功；HTTP 401/403 不论响应体形态都是登录
 * 失效（挂 401，共享 TokenManager 会按永久失败收回）。
 */
export declare function autoclawTokenFields(data: any, fallbackRefresh?: any): {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
};
/** 会话形状（store 的硬性底座：accessToken / refreshToken / expiresAt）。 */
export declare function autoclawSession({ accessToken, refreshToken, expiresAt, account, uid, source }?: any): {
    source: any;
    uid?: string | undefined;
    expiresAt: number;
    account: string | undefined;
    accessToken: string;
    refreshToken: string;
};
/**
 * POST /userapi/v1/user-profile → { user_name, user_phone, user_id }（upstream
 * index.mjs:427-447）。device_id 在这里是调用方自己的标识（upstream 填
 * 'magpie-plugin'，本插件填自己的名字）；失败返回 null。
 */
export declare function pickAutoclawHumanAccount(...values: any[]): string | undefined;
/**
 * refresh token 轮换（upstream refreshTokens，index.mjs:459-484）：
 * - host 顺序由 token 的 source_id 决定（`agent*` = 短信账号先国内，网页账号先国际）；
 * - `/refresh` 回 code 400002 时换 `/agent-refresh` 重试同一 host；
 * - 信封 code 400000 = 「该 host 不认这个 token」→ 换下一个 host，其余 code 都停；
 * - 401/403 或 invalid_grant / revoked / expired / 登录已失效 → 永久失败。
 */
export { AUTOCLAW_MODELS, AUTOCLAW_CN_MODELS, autoclawModelOf } from './catalog.js';
