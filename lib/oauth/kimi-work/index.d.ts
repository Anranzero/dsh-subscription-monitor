/**
 * Kimi Work (the ordinary Kimi desktop Work subscription) via the local
 * desktop sign-in.
 *
 * Pinned attribution: **@magpie-community/opencode-kimi-work-auth 0.1.4**
 * (github.com/magpie-community/plugins, packages/kimi-work; MIT; local clone
 * `.local/upstream-magpie/packages/kimi-work/`). That package reads the
 * desktop app's own sign-in file read-only and forwards to the Work gateway;
 * this family follows it endpoint for endpoint:
 *
 * - chat: OpenAI Completions, POST https://agent-gw.kimi.com/coding/v1/chat/completions
 *   — never api.kimi.com, never a Kimi Code key.
 * - models: GET …/coding/v1/models with the Work credential.
 * - usage: POST https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats
 *   with the desktop's *web* credential (Connect-Protocol-Version: 1).
 * - the vault stores only an account reference: the tokens stay in Kimi's own
 *   file and are re-read for every operation, including after the desktop app
 *   rotates them (the upstream package's core design).
 */
import { OAuthEndpointError } from '../errors.js';
export { applyKimiWorkCache, kimiWorkCacheHeaders, kimiWorkCacheSessionId, resetKimiWorkPins } from './cache.js';
export declare const KIMI_WORK_API_ORIGIN = "https://agent-gw.kimi.com";
export declare const KIMI_WORK_API_BASE = "https://agent-gw.kimi.com/coding/v1";
export declare const KIMI_WORK_CHAT_URL = "https://agent-gw.kimi.com/coding/v1/chat/completions";
export declare const KIMI_WORK_MODELS_URL = "https://agent-gw.kimi.com/coding/v1/models";
/** The membership service the shared-allowance read goes to (web credential, not the Work one). */
export declare const KIMI_WORK_MEMBER_BASE = "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/";
export declare const KIMI_WORK_USAGE_URL = "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats";
/** This plugin's own UA — the upstream package uses its own too and does not impersonate the desktop client. */
export declare const KIMI_WORK_USER_AGENT = "dsh-subscription-monitor";
/** The server lists the plan's XL context; the standard window is the cap (upstream modelRows). */
export declare const KIMI_WORK_CONTEXT_CAP = 262144;
export declare const KIMI_WORK_MAX_TOKENS = 32768;
export declare const KIMI_WORK_INPUT: readonly string[];
export declare const KIMI_WORK_SOURCES: readonly string[];
/** A reference session never expires on its own: the desktop app owns the token lifetime. */
export declare const KIMI_WORK_NEVER_EXPIRES = 8640000000000000;
/**
 * The vault floor (store.ts assertSessionShape) wants non-empty token
 * strings. The upstream package's own loader hands the SDK the placeholder
 * `apiKey: 'local-desktop-session'` for the same reason; no real credential
 * is ever written to auth.json.
 */
export declare const KIMI_WORK_PLACEHOLDER = "local-desktop-session";
/** The one readable label a reference session carries (upstream accountId). */
export declare const KIMI_WORK_ACCOUNT_LABEL = "Kimi Work (local)";
/** The desktop file is refused past this size (upstream readDesktop guard). */
export declare const KIMI_WORK_DESKTOP_MAX_BYTES: number;
/** Offline floor; live `GET /coding/v1/models` replaces it after login. Rows live in src/catalog/models.json under "kimi-work". */
export declare const KIMI_WORK_MODELS: readonly any[];
export declare function kimiWorkSourceLabel(source: any): "desktop" | undefined;
/**
 * The desktop app's sign-in file (upstream desktopFile):
 * win `%APPDATA%/kimi-desktop/`, macOS `~/Library/Application Support/kimi-desktop/`,
 * linux `~/.config/kimi-desktop/` — then `daimon-share/daimon/config.json`.
 */
export declare function kimiWorkDesktopFile({ home, platform, appdata }?: {
    home?: string | undefined;
    platform?: NodeJS.Platform | undefined;
    appdata?: string | undefined;
}): string;
/**
 * The live desktop sign-in (upstream readDesktop). The internal field is
 * named `kimiCode`, but the credential is only accepted when its `baseUrl`
 * points at the Work gateway exactly — a Code-origin credential is refused,
 * never substituted. `kimiWeb` supplies the membership credential and the
 * user id the account reference hashes. undefined when the file, a field, or
 * the origin check fails; nothing is ever written back.
 */
export declare function readKimiWorkDesktop(file?: string): {
    workToken: string;
    webToken: string;
    uid: string;
} | undefined;
/** The hashed account reference (upstream uid): sha256 of a domain-separated user id, never the raw one. */
export declare function kimiWorkAccountRef(userId: any): string;
/** The stored shape: an account reference only — tokens stay in Kimi's own file. */
export declare function kimiWorkSession({ uid, account, source }?: any): {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    uid: string;
    account: string;
    source: any;
};
export declare function isKimiWorkOpaqueAccount(value: any): boolean;
/** The reconnect demand an account switch is (upstream: changing the desktop account requires reconnecting). */
export declare function kimiWorkAccountChanged(): OAuthEndpointError;
/**
 * The live credentials for one stored session: re-read the desktop file and
 * refuse a changed account (upstream current()). Rotation under the desktop
 * app is picked up here for free — the read happens per operation.
 */
export declare function currentKimiWorkDesktop(session: any): {
    workToken: string;
    webToken: string;
    uid: string;
};
/**
 * TokenManager refresh: a desktop-source session re-reads the file (never an
 * endpoint — spending anything of the desktop's would be inventing a flow the
 * upstream package does not have). A missing file or a changed account reads
 * as a permanent 401 so the row is reaped into a reconnect, not a loop.
 */
export declare function refreshKimiWork(session: any): Promise<any>;
/** JSON-read headers (models, membership): the Connect protocol header rides POSTs (upstream jsonRequest). */
export declare function kimiWorkJsonHeaders(token: any, { post }?: {
    post?: boolean | undefined;
}): {
    'content-type'?: string | undefined;
    'connect-protocol-version'?: string | undefined;
    authorization: string;
    accept: string;
    'user-agent': string;
};
