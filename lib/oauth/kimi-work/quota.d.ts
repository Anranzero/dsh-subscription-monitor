/**
 * Kimi Work quota: the membership service's shared-allowance read.
 *
 * POST …/GetSubscriptionStats with the desktop's *web* credential (the Work
 * credential is for agent-gw only), body {} and Connect-Protocol-Version: 1.
 * One row — `subscriptionBalance.amountUsedRatio` (0..1) as the used percent
 * of the shared membership allowance. No reset time is reported:
 * `expireTime` / `upcomingExpiration` are expiration fields and have not
 * been verified to describe allowance resets, so no resetAt is invented. The
 * payload's `ratelimitCode5h` / `ratelimitCode7d` are Kimi Code windows, not
 * Work allowance, and stay unread. A refused read is a failed quota read —
 * it never invalidates the desktop sign-in.
 */
import { outboundFetch } from '../../utils/outbound.js';
/** The one window the membership read yields (the upstream usage window's own name). */
export declare const KIMI_WORK_ALLOWANCE_LABEL = "\u4F1A\u5458\u5171\u4EAB\u989D\u5EA6";
export declare function parseKimiWorkUsage(payload: any): {
    rows: {
        key: string;
        kind: string;
        product: string;
        usedPercent: number;
        remainingPercent: number;
    }[];
};
export declare function fetchKimiWorkQuota(session: any, fetchFn?: typeof outboundFetch): Promise<{
    rows: {
        key: string;
        kind: string;
        product: string;
        usedPercent: number;
        remainingPercent: number;
    }[];
}>;
