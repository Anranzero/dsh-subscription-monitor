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
import { KIMI_WORK_USAGE_URL, currentKimiWorkDesktop, kimiWorkJsonHeaders, } from './index.js';
import { outboundFetch } from '../../utils/outbound.js';
import { asNumber, clampPct, quotaReads } from '../quota-shared.js';
/** The one window the membership read yields (the upstream usage window's own name). */
export const KIMI_WORK_ALLOWANCE_LABEL = '会员共享额度';
export function parseKimiWorkUsage(payload) {
    const root = payload && typeof payload === 'object' ? payload : {};
    const ratio = asNumber(root.subscriptionBalance?.amountUsedRatio);
    const usedPercent = ratio === undefined ? undefined : clampPct(ratio * 100);
    return {
        rows: usedPercent === undefined ? [] : [{
                key: 'membership',
                kind: 'cycle',
                product: KIMI_WORK_ALLOWANCE_LABEL,
                usedPercent,
                remainingPercent: 100 - usedPercent,
            }],
    };
}
export async function fetchKimiWorkQuota(session, fetchFn = outboundFetch) {
    // The web credential lives in the desktop file like the Work one; a missing
    // file or a changed account fails this read without touching the login.
    const read = currentKimiWorkDesktop(session);
    const [usage] = await quotaReads(fetchFn, [
        {
            label: 'kimi-work usage',
            url: KIMI_WORK_USAGE_URL,
            init: {
                method: 'POST',
                headers: kimiWorkJsonHeaders(read.webToken, { post: true }),
                body: JSON.stringify({}),
            },
        },
    ]);
    if (!usage.ok)
        throw usage.error;
    return parseKimiWorkUsage(usage.raw);
}
