/**
 * MiMo quota: the pages the app's "Usage & billing" reads, as magpie's
 * built-in MiMo account shows them (index.mjs:357-364, 534-584):
 *   GET <base>/user/xiaomi/subscription/self — the plan in force and its end
 *   GET <base>/user/usage                   — the week's allowance, as the
 *                                            *remaining* percent and the day
 *                                            it resets (no reset date = no
 *                                            plan; `percent` is what is LEFT)
 * plus the open platform's Token Plan (platform.ts), best-effort: an account
 * with no app plan has the Token Plan as its card.
 */
import { outboundFetch } from '../../utils/outbound.js';
/** The week's window `span` (index.mjs:576: 7 * 24 * 3600 seconds). */
export declare const MIMO_WEEK_MINUTES: number;
/**
 * parseMimoSubscription (index.mjs:546-561): `current` names the plan — its
 * title, else the tier's app name (TIERS), else its code — and when it ends.
 * No `current` (or a non-object one) is the free offer.
 */
export declare function parseMimoSubscription(self: any): {
    renew?: any;
    until?: string | undefined;
    planType: any;
};
/**
 * parseMimoUsage (index.mjs:571-582): `/user/usage`'s `percent` is the share
 * of the week's allowance **remaining** — the card's row is DSH's remaining
 * bar, so `percent` is `remainingPercent` and the used side is its
 * complement. `resetDate` is Beijing's midnight of the reset day.
 */
export declare function parseMimoUsage(usage: any): {
    resetAt?: number | undefined;
    key: string;
    kind: string;
    windowMinutes: number;
    product: string;
    remainingPercent: number | undefined;
    usedPercent: number | undefined;
} | undefined;
/**
 * usage (index.mjs:537-584): the plan, the week's allowance, and the Token
 * Plan beside it. The Token Plan read is best-effort — a platform that cannot
 * be read leaves the app's own card standing.
 */
export declare function fetchMimoQuota(session: any, fetchFn?: typeof outboundFetch): Promise<{
    account: string;
    planType: any;
    rows: any[];
}>;
/** The Token Plan's credits as a card row (index.mjs:608-620). */
export declare function mimoTokenPlanRow(tp: any): {
    resetAt?: any;
    key: string;
    kind: string;
    product: any;
    usedPercent: number | undefined;
    remainingPercent: number | undefined;
    used: any;
    total: any;
    unit: string;
};
