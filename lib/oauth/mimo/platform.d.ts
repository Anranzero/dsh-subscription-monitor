/**
 * The open platform (platform.xiaomimimo.com) and its Token Plan.
 *
 * The platform sells the Token Plan, a plan of its own spent with its `tp-`
 * API key at `token-plan-<region>.xiaomimimo.com` — not through the app's
 * `/route`. The same Xiaomi account signs on there as at the MiMo server: a
 * page asked with no session answers 401 with a serviceLogin URL (sid
 * `api-platform`), which the passToken follows back through the platform's
 * `/sts` to the page (index.mjs:163-226). Ported from
 * @magpie-community/opencode-mimo-auth 0.1.9; every read is best-effort —
 * a platform that cannot be read leaves the app's own card standing
 * (index.mjs:623-626).
 */
/** Test isolation: drop every cached platform session, key and reroute mark. */
export declare function resetMimoPlatformState(): void;
/**
 * platformPage (index.mjs:174-226): one of the platform's `/api/v1` pages as
 * `{cookies, data}`. The session given in is tried first; a page that turns
 * the session away (or none held) is signed on for afresh through Xiaomi's
 * serviceLogin. `data` null is a page the account can read but that carries
 * no plan; a throw is a page that could not be read at all.
 */
export declare function mimoPlatformPage(creds: any, path: any, cookies: any, fetchFn: any): Promise<{
    cookies: any;
    data: any;
}>;
/**
 * tokenPlan (index.mjs:591-627): the account's Token Plan as
 * `{plan, until, renew, window}`, or null — none, expired, or the platform
 * cannot be read. `window.used` is a percent (used of limit).
 */
export declare function mimoTokenPlanOf(creds: any, hasAppPlan: any, fetchFn: any): Promise<any>;
/**
 * planKey (index.mjs:632-660): the account's Token Plan as
 * `{key, base}` — its `tp-` key and OpenAI base URL — or null when it has no
 * live plan or no key yet (the platform's page makes one; this plugin never
 * does). Cached MIMO_TP_LIFE_MS per account.
 */
export declare function mimoPlanKeyOf(creds: any, fetchFn: any): Promise<any>;
/** A key reset at the platform is read again on the next request (index.mjs:736). */
export declare function forgetMimoPlanKey(userId: any): void;
/**
 * onPlan (index.mjs:662, 739-744): an hour after the app refused an account
 * (membership_required) with a Token Plan behind it, its requests go straight
 * to the plan — then the app is asked first again, in case a membership was
 * bought.
 */
export declare function noteMimoOnPlan(userId: any): void;
export declare function mimoPrefersPlan(userId: any): boolean;
/** The app refused with no Token Plan behind it: stop routing around it. */
export declare function clearMimoOnPlan(userId: any): void;
