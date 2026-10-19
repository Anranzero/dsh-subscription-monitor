/**
 * Cursor quota: api2.cursor.sh JSON (period usage, email, Stripe profile),
 * not the agent transport.
 */
import { pickPlanRaw } from '../plan.js';
import { CURSOR_GET_EMAIL_URL, CURSOR_GET_ME_URL, CURSOR_HARD_LIMIT_URL, CURSOR_STRIPE_PROFILE_URL, CURSOR_USAGE_URL, cursorMembershipFromStripe, cursorNameFromProfile, cursorUsageHeaders, pickCursorHumanAccount, } from './index.js';
import { outboundFetch } from '../../utils/outbound.js';
import { asNumber, clampPct, quotaReads, stampOf } from '../quota-shared.js';
function clampUsedPct(value) {
    const n = asNumber(value);
    if (n === undefined)
        return undefined;
    const clamped = Math.max(0, Math.min(100, n));
    const rounded = Math.round(clamped);
    if (clamped > 0 && rounded === 0)
        return 1;
    return rounded;
}
function cursorProductRow(key, usedPercent, resetAt) {
    const used = clampUsedPct(usedPercent) ?? 0;
    return {
        key: `product:${key}`,
        kind: 'product',
        product: key,
        usedPercent: used,
        remainingPercent: 100 - used,
        ...(resetAt === undefined ? {} : { resetAt }),
    };
}
/**
 * planUsage.includedSpend / limit are cents (the same ratio Cursor's own
 * displayMessage uses for "You've used N% of your included usage"). Emitted as
 * a usd cycle row so the card shows real dollars alongside the percent bars.
 */
function cursorIncludedRow(planUsage, resetAt) {
    const limitCents = asNumber(planUsage?.limit);
    const includedCents = asNumber(planUsage?.includedSpend);
    if (limitCents === undefined || limitCents <= 0 || includedCents === undefined)
        return undefined;
    const usedPercent = clampPct((includedCents / limitCents) * 100);
    return {
        key: 'cycle:included',
        kind: 'cycle',
        product: 'included',
        unit: 'usd',
        used: includedCents / 100,
        total: limitCents / 100,
        ...(usedPercent === undefined ? {} : { remainingPercent: 100 - usedPercent }),
        ...(resetAt === undefined ? {} : { resetAt }),
    };
}
/**
 * The usage-based (on-demand) spend, from spendLimitUsage plus GetHardLimit's
 * reply — the same two the CLI dashboard reads (magpie packages/cursor
 * onDemandOf / hardLimit, index.mjs:430-452, 455-467): individual limits in
 * cents, the team pool's pooledLimit as an int64 string, hardLimit in whole
 * dollars. A member limit wins over the pool; a pool member with none of
 * their own spends the pool (the pool's used, not their own, is the bar).
 * Like the upstream card, only a capped spend and an explicitly unlimited
 * one make a row — usage-based off, or nothing known, makes none
 * (usage() renders `fixed` / `unlimited` only). The member's own spend
 * inside a team pool has no row slot (upstream carries it as mineDollars)
 * and is left off rather than mislabeled.
 */
function cursorOnDemandRow(spend, hard, resetAt) {
    if (!spend || typeof spend !== 'object')
        return undefined;
    const hardObj = hard && typeof hard === 'object' && !Array.isArray(hard) ? hard : undefined;
    const hardLimit = hardObj === undefined ? undefined : asNumber(hardObj.hardLimit) ?? 0;
    const uncapped = (used) => ({
        key: 'product:on-demand',
        kind: 'product',
        product: 'on-demand',
        unit: 'usd',
        used,
        ...(resetAt === undefined ? {} : { resetAt }),
    });
    const capped = (used, total) => {
        const usedPercent = clampPct((used / total) * 100);
        return {
            ...uncapped(used),
            total,
            ...(usedPercent === undefined ? {} : { usedPercent, remainingPercent: 100 - usedPercent }),
        };
    };
    const usedDollars = (asNumber(spend.individualUsed) ?? 0) / 100;
    const individualLimit = spend.individualLimit === undefined ? undefined : asNumber(spend.individualLimit);
    // The member's own limit: > 0 cents caps the spend; anything else stated
    // (0, null) says usage-based is off for this member — no row.
    const own = individualLimit === undefined ? undefined
        : individualLimit > 0 ? capped(usedDollars, individualLimit / 100)
            : undefined;
    if (spend.limitType === 'team') {
        if (own)
            return own;
        if (hardObj !== undefined && (hardObj.noUsageBasedAllowed === true || !((hardLimit ?? 0) > 0)))
            return undefined;
        const pool = asNumber(spend.pooledLimit) ?? 0; // int64 string on the wire
        if (pool > 0)
            return capped((asNumber(spend.pooledUsed) ?? 0) / 100, pool / 100);
        return hardObj !== undefined ? uncapped(usedDollars) : undefined;
    }
    if (hardObj === undefined)
        return own;
    if (hardObj.noUsageBasedAllowed === true)
        return undefined;
    if ((hardLimit ?? 0) >= 2_147_483_647)
        return uncapped(usedDollars);
    return (hardLimit ?? 0) > 0 ? capped(usedDollars, hardLimit) : undefined;
}
export function parseCursorPeriodUsage(payload, extras = {}) {
    if (!payload || typeof payload !== 'object')
        return { rows: [] };
    const planUsage = payload.planUsage && typeof payload.planUsage === 'object' ? payload.planUsage : {};
    const spend = payload.spendLimitUsage && typeof payload.spendLimitUsage === 'object' ? payload.spendLimitUsage : {};
    const stripe = extras.stripe && typeof extras.stripe === 'object' ? extras.stripe : {};
    const limitType = typeof spend.limitType === 'string' ? spend.limitType : undefined;
    const membership = pickPlanRaw(cursorMembershipFromStripe(stripe), extras.planType, payload.individualMembershipType, payload.membershipType, limitType === 'team' ? 'Team' : undefined, 'Pro');
    const resetAt = stampOf(payload.billingCycleEnd);
    return {
        planType: membership,
        account: pickCursorHumanAccount(extras.account, extras.email, payload.email),
        rows: [
            ...[cursorIncludedRow(planUsage, resetAt)].filter(Boolean),
            cursorProductRow('auto', planUsage.autoPercentUsed, resetAt),
            cursorProductRow('api', planUsage.apiPercentUsed, resetAt),
            // The upstream card's windows order: the two pools, on-demand, Total
            // last (magpie packages/cursor usage()).
            ...[cursorOnDemandRow(spend, extras.hardLimit, resetAt)].filter(Boolean),
            cursorProductRow('total', planUsage.totalPercentUsed, resetAt),
        ],
    };
}
export async function fetchCursorQuota(session, fetchFn = outboundFetch) {
    const headers = cursorUsageHeaders(session);
    const post = { method: 'POST', headers, body: '{}' };
    const [usage, stripe, email, hard] = await quotaReads(fetchFn, [
        { url: CURSOR_USAGE_URL, label: 'cursor period usage', init: post },
        { url: CURSOR_STRIPE_PROFILE_URL, label: 'cursor stripe profile', init: { headers } },
        { url: CURSOR_GET_EMAIL_URL, label: 'cursor email', init: post },
        // The on-demand row's cap: a failed read just leaves it uncapped (magpie
        // hardLimit treats a failed call as undefined, same).
        { url: CURSOR_HARD_LIMIT_URL, label: 'cursor hard limit', init: post },
    ]);
    if (!usage.ok)
        throw usage.error;
    let account = cursorNameFromProfile(email.ok ? email.raw : undefined);
    if (!account) {
        const [me] = await quotaReads(fetchFn, [
            { url: CURSOR_GET_ME_URL, label: 'cursor me', init: post },
        ]);
        account = cursorNameFromProfile(me.ok ? me.raw : undefined);
    }
    return parseCursorPeriodUsage(usage.raw, {
        stripe: stripe.ok ? stripe.raw : undefined,
        account,
        hardLimit: hard.ok ? hard.raw : undefined,
    });
}
