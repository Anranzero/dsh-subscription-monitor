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
import { outboundFetch } from '../../utils/outbound.js';
/** The engine's auth shape for one of our stored sessions. */
export declare function engineAuthOf(session: any): {
    uid?: any;
    type: string;
    access: any;
    refresh: any;
    accountId: any;
    email: any;
};
/** A successful authorize/refresh result merged onto a stored session. */
export declare function sessionFromEngineResult(family: any, result: any, base?: any): {
    source: any;
    uid?: string | undefined;
    expiresAt: number;
    account: string | undefined;
    accessToken: string;
    refreshToken: string;
};
/** One build's engine plugin, built once per data dir. */
export declare function autoclawEnginePlugin(family: 'autoclaw' | 'autoclaw-cn', { fetchFn }?: any): Promise<{
    plugin: any;
    version: string;
}>;
/** Test seam: drop the cached plugin instances (production never resets). */
export declare function resetAutoclawEnginePlugin(): void;
/**
 * The international browser login: the engine's authorize brings its own
 * local server up (port pool first) and hands back the guide URL at once;
 * its callback waits for the code, exchanges it and reads the profile. The
 * flow slot and the save/discover completion stay ours (accounts.ts).
 */
export declare function autoclawEngineAuthorizeBrowser({ vendor, fetchFn }?: any): Promise<{
    authorizeUrl: any;
    mode: "browser";
    settle: () => Promise<{
        source: any;
        uid?: string | undefined;
        expiresAt: number;
        account: string | undefined;
        accessToken: string;
        refreshToken: string;
    }>;
}>;
export declare function autoclawEngineAuthorizeSms({ phone, code, fetchFn }?: any): Promise<{
    source: any;
    uid?: string | undefined;
    expiresAt: number;
    account: string | undefined;
    accessToken: string;
    refreshToken: string;
} | {
    mode: "code-sent";
    message: any;
}>;
/** Test seam for the pending-map shape (production never resets). */
export declare function resetAutoclawSmsPending(): void;
/**
 * TokenManager refresh: the engine's auth.refresh rotates the pair once and
 * back-fills a missing account name from user-profile (upstream 0.2.1). A
 * refused refresh reads as a permanent invalid_grant so the row is reaped:
 * the verdict comes from the engine's own dead marker (`signIn === 'expired'`
 * — it attaches that for HTTP 401/403 and invalid_grant/revoked/expired/
 * 登录已失效-class messages, index.mjs:477-481) or a 401/403 status; the
 * message match is only the safety net for errors that carry neither.
 */
export declare function refreshAutoclawEngine(family: 'autoclaw' | 'autoclaw-cn', session: any, fetchFn?: typeof outboundFetch): Promise<{
    source: any;
    uid?: string | undefined;
    expiresAt: number;
    account: string | undefined;
    accessToken: string;
    refreshToken: string;
}>;
/**
 * The hop's headersOf: the engine loader builds the whole biz group itself
 * (X-Authorization, the official client fingerprint, the signature) from the
 * token it re-reads per request; ours is the accept line only.
 */
export declare function autoclawEngineHeaders(): {
    accept: string;
};
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape feeds the engine
 * loader — it rewrites the body (official system prefix, max_tokens drop,
 * unflag), sets the biz header group and fails over between the two hosts
 * (the CN build rides its managed gateway). The URL we pass is nominal: the
 * engine owns the chat path.
 */
export declare function autoclawEngineFetch(family: 'autoclaw' | 'autoclaw-cn', { session, fetchFn }?: any): Promise<(url: any, init?: {}) => Promise<any>>;
/**
 * fetchQuota: the engine's usage read (wallets + the sign-in status) gives
 * display rows — the credits total and the named wallets, each as
 * {name, display}. Balance 制：余额即剩余——prepaid 余额行 remaining=余额
 * （cline/opendesign 钱包行同形），不发明 used/百分比；签到状态行没有卡面槽
 * （README「不采纳」），跳过。
 */
export declare function fetchAutoclawSiteQuotaEngine(family: 'autoclaw' | 'autoclaw-cn', session: any, fetchFn?: typeof outboundFetch): Promise<{
    rows: any[];
}>;
export declare function fetchAutoclawQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    rows: any[];
}>;
export declare function fetchAutoclawCnQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    rows: any[];
}>;
