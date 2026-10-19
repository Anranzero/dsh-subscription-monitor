/**
 * Xiaomi MiMo (the MiMo desktop app's coding plan) — Xiaomi-account sign-in.
 *
 * Pinned attribution: **@magpie-community/opencode-mimo-auth 0.1.9**
 * (github.com/magpie-community/plugins, packages/mimo; MIT) — every constant,
 * endpoint and header below cites its `index.mjs` line in the README's
 * attribution table. The sign-in is the Xiaomi account itself: the plugin
 * opens account.xiaomi.com's long-poll ticket (QR or password), waits on the
 * ticket until Xiaomi says the account is in, then the passToken signs the
 * account on at the MiMo server through its `/sts`, which sets the session
 * cookies (`serviceToken`, `userId`, `cUserId`). An account of another region
 * is served by that region's server (`mimo-server-ru` / `-in`).
 *
 * Chat is OpenAI **Completions** at `<base>/route/chat/completions`,
 * authenticated with those cookies only — no Authorization header — plus
 * `X-Mimo-Source: mimocode-cli-free`, `X-Client-Version: 26.929.292248` and
 * the account SDK's User-Agent. The session is renewed by signing on again
 * with the same passToken a day after it was issued (10 min lead).
 */
import { OAuthEndpointError } from '../errors.js';
import { outboundFetch } from '../../utils/outbound.js';
export { applyMimoCache, mimoCacheHeaders, mimoCacheSessionId, resetMimoPins } from './cache.js';
/** HOSTS (index.mjs:14-18) — the API base per region, `/api` included. */
export declare const MIMO_HOSTS: Readonly<{
    SGP: "https://mimo-server-sgp.xiaomimimo.com/api";
    RU: "https://mimo-server-ru.xiaomimimo.com/api";
    IN: "https://mimo-server-in.xiaomimimo.com/api";
}>;
/** REGION (index.mjs:19) — every sign-in starts on Singapore. */
export declare const MIMO_DEFAULT_REGION = "SGP";
/** ACCOUNT (index.mjs:20) — where the passToken lives and the sign-in page is. */
export declare const MIMO_ACCOUNT_ORIGIN = "https://account.xiaomi.com";
/** APP_VERSION (index.mjs:21) — `X-Client-Version` on every server request. */
export declare const MIMO_APP_VERSION = "26.929.292248";
/** SOURCE (index.mjs:22) — `X-Mimo-Source` on chat requests only. */
export declare const MIMO_SOURCE = "mimocode-cli-free";
/** UA (index.mjs:23) — the account SDK's own Windows UA, sent on every request. */
export declare const MIMO_USER_AGENT = "miNative PC/Normal Windows_NT/10.0.26100 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop APPV/0.1.0";
/** RENEW_AFTER (index.mjs:24) — the app signs on again after a day. */
export declare const MIMO_RENEW_AFTER_MS: number;
/** LEAD_MS (index.mjs:25) — renew this close to the day's end (TokenManager preemptMs). */
export declare const MIMO_PREEMPT_MS: number;
/** SIGN_IN_LIFE (index.mjs:26) — the long-poll ticket's life cap. */
export declare const MIMO_SIGN_IN_LIFE_MS: number;
/** waitPoll's sleep (index.mjs:331). */
export declare const MIMO_POLL_MS = 1000;
/** TP_LIFE (index.mjs:36) — this long, an account the app refused is asked at its Token Plan. */
export declare const MIMO_TP_LIFE_MS: number;
/** PLATFORM (index.mjs:169) — the open platform that sells the Token Plan. */
export declare const MIMO_PLATFORM_ORIGIN = "https://platform.xiaomimimo.com";
/** The platform's serviceLogin sid (usage.test.mjs:129 asserts it). */
export declare const MIMO_PLATFORM_SID = "api-platform";
/** TIERS (index.mjs:375) — the app's names for its plans' tiers. */
export declare const MIMO_TIER_NAMES: Readonly<{
    1: "Starter";
    2: "Plus";
    3: "Pro";
    4: "Ultra";
}>;
/** Wire plan spellings → the card's name (plan.ts maps the rest). */
export declare const MIMO_PLAN_NAMES: Readonly<{
    free: "Free";
    starter: "Starter";
    plus: "Plus";
    pro: "Pro";
    ultra: "Ultra";
}>;
export declare const MIMO_INPUT: readonly string[];
export declare const MIMO_SOURCES: readonly string[];
/**
 * Offline picker floor = the upstream plugin's own pinned table (index.mjs:28-32,
 * README "Models"): both models are 1,000,000 context / 128,000 output,
 * text+image in, no reasoning control advertised (hence `reasoningEfforts:
 * false`). Rows live in `src/catalog/models.json` under `"mimo"`.
 */
export declare const MIMO_MODELS: readonly any[];
/** Catalog lookup for the custom-context ceiling (`familyMaxContextWindow`). */
export declare function mimoModel(modelId: any): any;
/** baseOf (index.mjs:38). */
export declare function mimoBaseOf(region: any): any;
/** deviceId (index.mjs:39) — the sign-in's device identity, kept in the creds. */
export declare function mimoDeviceId(): string;
/** accountJSON (index.mjs:43-49) — Xiaomi's JSON comes after a `&&&START&&&` guard. */
export declare function mimoAccountJSON(text: any): any;
/**
 * The sign-in's redirect cookie jar (index.mjs:53-101): just enough domain /
 * path / secure matching to follow account.xiaomi.com → the MiMo server's
 * `/sts` → `/user/xiaomi/me` by hand (`redirect: "manual"`). Family-owned —
 * no other family's jar or cache helper is imported.
 */
export declare class MimoJar {
    cookies: any[];
    constructor();
    put(cookie: any): void;
    /** Seed a cookie as a browser would hold it for `url` (index.mjs:61-63). */
    seed(url: any, name: any, value: any): void;
    /** Take a response's Set-Cookie lines as set for `url` (index.mjs:64-88). */
    take(response: any, url: any): void;
    /** The cookies a request to `url` carries (index.mjs:89-97). */
    for(url: any): any[];
    /** The jar as a Cookie header for `url` (index.mjs:98-100). */
    header(url: any): string;
}
/**
 * Lapsed (index.mjs:105): the passToken no longer signs the account on. Not a
 * transient failure — the stored login must be re-made by the user.
 */
export declare class MimoLapsedError extends OAuthEndpointError {
    constructor(message?: string);
}
/** appHeaders (index.mjs:107) — every MiMo server request carries these two. */
export declare function mimoAppHeaders(): {
    'User-Agent': string;
    'X-Client-Version': string;
};
/**
 * The account's cookies as the server's pages and chat requests send them
 * (cookieHeader, index.mjs:229-234): `serviceToken`, `userId`, `cUserId`
 * first, in that order, the rest behind them.
 */
export declare function mimoCookieHeader(cookies: any): string;
/** Chat headers (index.mjs:745-750): cookies, no Authorization, plus the app's marks. */
export declare function mimoUpstreamHeaders(session: any): {
    Cookie: string;
    'X-Mimo-Source': string;
    'User-Agent': string;
    'X-Client-Version': string;
};
/** Page headers (index.mjs:512-514): the server's own pages send no X-Mimo-Source. */
export declare function mimoPageHeaders(session: any): {
    'User-Agent': string;
    'X-Client-Version': string;
    Cookie: string;
};
export declare function mimoApiBase(session: any): any;
export declare function mimoChatUrl(session: any): string;
export declare function mimoMeUrl(session: any): string;
export declare function mimoSubscriptionUrl(session: any): string;
export declare function mimoUsageUrl(session: any): string;
/**
 * serverTime (index.mjs:409-417): the server's times carry no zone and the
 * app shows them as they come, which is Beijing's (and Singapore's) — parse
 * zone-less stamps at +08:00; a date alone is midnight there.
 */
export declare function mimoServerTime(value: any): string | undefined;
/**
 * Sign the account on at a MiMo server as the app's window does (session,
 * index.mjs:114-161): `/user/xiaomi/me` asked with no session sends the
 * browser to account.xiaomi.com's serviceLogin (holding the passToken), which
 * sends it back through the server's `/sts`, where the session cookies are
 * set, to `/user/xiaomi/me` again. Redirects are followed by hand because the
 * server writes its followup `http://` while its cookies only ride `https`.
 */
export declare function mimoSignOn(creds: any, base: any, fetchFn?: typeof outboundFetch, { signal }?: any): Promise<{
    cookies: Record<string, string>;
    me: any;
}>;
/**
 * toAuth (index.mjs:239-247) in this store's shape: `refreshToken` is the
 * Xiaomi account JSON (what signs the account on again), `accessToken` the
 * session cookies JSON, `expiresAt` a day after the session was issued.
 */
export declare function mimoSession({ creds, cookies, issuedAt }: {
    creds: any;
    cookies: any;
    issuedAt?: number | undefined;
}): {
    base?: string | undefined;
    region?: string | undefined;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    account: string;
    source: string;
};
/**
 * fromAuth (index.mjs:249-263): a stored session back into `{creds, cookies}`;
 * null when the row is not a Xiaomi-account sign-in. A missing base is
 * resolved from the region, else Singapore.
 */
export declare function parseMimoStored(session: any): {
    creds: any;
    cookies: Record<string, string>;
    expiresAt: number;
} | null;
/**
 * renew / refresh (index.mjs:438-455, 478-493): sign the account on again
 * with the same passToken, once per credential version (the shared
 * TokenManager owns that). A passToken Xiaomi no longer takes is a permanent
 * `invalid_grant` — the login is reaped, not retried. The Xiaomi account in
 * `refreshToken` stays exactly as it was; only the cookies and the clock move.
 */
export declare function refreshMimo(session: any, fetchFn?: typeof outboundFetch): Promise<{
    base?: string | undefined;
    region?: string | undefined;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    account: string;
    source: string;
}>;
/**
 * serviceOf (index.mjs:278-292): the sid and callback the MiMo server sends a
 * session-less browser to account.xiaomi.com with. The defaults hold when the
 * probe cannot run.
 */
export declare function mimoServiceOf(base: any, fetchFn?: typeof outboundFetch): Promise<{
    sid: string;
    callback: string;
}>;
/** accountGet (index.mjs:294-297): the ticket's two account.xiaomi.com reads. */
export declare function mimoAccountGet(url: any, device: any, fetchFn: typeof outboundFetch | undefined, signal: any): Promise<{
    status: any;
    text: any;
}>;
/**
 * startSignIn (index.mjs:299-320): mint the sign-in page and its long-poll
 * ticket. The query is the app's own, byte for byte.
 */
export declare function mimoSignInPage({ device, fetchFn }?: {
    device?: string | undefined;
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<{
    url: any;
    lp: any;
    device: string;
    until: number;
}>;
/**
 * waitPoll (index.mjs:323-334): ask the ticket's long poll until Xiaomi says
 * the account is in — a 200 whose JSON carries the passToken and the user id.
 */
export declare function waitMimoPoll(ticket: any, fetchFn: typeof outboundFetch | undefined, signal: any): Promise<any>;
/**
 * signedInWith (index.mjs:336-355): the ticket's passToken signs the account
 * on at the MiMo server, and an account of another region is served by that
 * region's server — the sign-on runs again there and the creds move with it.
 */
export declare function mimoSignInWith(poll: any, device: any, fetchFn?: typeof outboundFetch): Promise<{
    creds: any;
    cookies: any;
}>;
