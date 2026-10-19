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
import { MIMO_RENEW_AFTER_MS, MIMO_TIER_NAMES, mimoPageHeaders, mimoServerTime, mimoSignOn, mimoSubscriptionUrl, mimoUsageUrl, parseMimoStored, } from './index.js';
import { mimoTokenPlanOf } from './platform.js';
import { outboundFetch } from '../../utils/outbound.js';
import { clampPct } from '../quota-shared.js';
/** The week's window `span` (index.mjs:576: 7 * 24 * 3600 seconds). */
export const MIMO_WEEK_MINUTES = 7 * 24 * 60;
/**
 * parseMimoSubscription (index.mjs:546-561): `current` names the plan — its
 * title, else the tier's app name (TIERS), else its code — and when it ends.
 * No `current` (or a non-object one) is the free offer.
 */
export function parseMimoSubscription(self) {
    const current = self && typeof self === 'object' && self.current && typeof self.current === 'object'
        ? self.current
        : undefined;
    if (!current)
        return { planType: 'Free' };
    const text = (value) => (typeof value === 'string' ? value.trim() : '');
    const planType = text(current.title) || MIMO_TIER_NAMES[current.planTier] || text(current.planCode) || 'MiMo';
    const until = mimoServerTime(current.endTime);
    let renew;
    if (current.renewalMode === 'MONTHLY' || current.renewalMode === 'YEARLY')
        renew = 'auto';
    else if (current.renewalMode === 'ONE_TIME')
        renew = 'off';
    return {
        planType,
        ...(until !== undefined ? { until } : {}),
        ...(renew !== undefined ? { renew } : {}),
    };
}
/**
 * parseMimoUsage (index.mjs:571-582): `/user/usage`'s `percent` is the share
 * of the week's allowance **remaining** — the card's row is DSH's remaining
 * bar, so `percent` is `remainingPercent` and the used side is its
 * complement. `resetDate` is Beijing's midnight of the reset day.
 */
export function parseMimoUsage(usage) {
    const root = usage && typeof usage === 'object' ? usage : {};
    const percent = root.percent;
    const reset = root.resetDate;
    if (typeof percent !== 'number' || typeof reset !== 'string')
        return undefined;
    const remainingPercent = clampPct(percent);
    const resetAt = mimoServerTime(reset);
    return {
        key: 'week',
        kind: 'primary',
        windowMinutes: MIMO_WEEK_MINUTES,
        product: '7 days',
        remainingPercent,
        usedPercent: remainingPercent === undefined ? undefined : 100 - remainingPercent,
        ...(resetAt !== undefined ? { resetAt: Date.parse(resetAt) } : {}),
    };
}
/**
 * page (index.mjs:499-532): one of the server's `{code, msg, data}` pages. A
 * 401, or a 200 that is not the server's envelope (a redirect to Xiaomi's
 * sign-in page), means the session is stale: the account is signed on again
 * once — in memory; the store's writes belong to the TokenManager — and the
 * page re-read. Still stale is a dead sign-in, in magpie's own words.
 */
async function mimoPage(getSession, url, fetchFn, reSignOn) {
    for (let attempt = 0;; attempt++) {
        let response;
        try {
            response = await fetchFn(url, { headers: mimoPageHeaders(getSession()), signal: AbortSignal.timeout(20_000) });
        }
        catch (error) {
            const why = error instanceof Error ? error.message : String(error);
            throw new Error(`Xiaomi MiMo ${url}: ${why}`);
        }
        const text = await response.text();
        let envelope;
        try {
            envelope = JSON.parse(text);
        }
        catch {
            envelope = undefined;
        }
        const bad = !envelope || typeof envelope !== 'object' || Array.isArray(envelope)
            || (envelope.code != null && !Number.isInteger(envelope.code))
            || (envelope.msg != null && typeof envelope.msg !== 'string');
        if (response.status === 401 || (response.status === 200 && bad)) {
            if (attempt === 0 && reSignOn) {
                await reSignOn();
                continue;
            }
            throw new Error(`${url}: the Xiaomi MiMo sign-in has expired — sign in again`);
        }
        if (response.status !== 200 || bad) {
            throw new Error(`Xiaomi MiMo ${url}: ${text.trim().slice(0, 200) || response.status}`);
        }
        if ((envelope.code ?? 0) !== 0) {
            throw new Error(`Xiaomi MiMo ${url}: code ${envelope.code} ${envelope.msg ?? ''}`.trim());
        }
        return envelope.data;
    }
}
/**
 * usage (index.mjs:537-584): the plan, the week's allowance, and the Token
 * Plan beside it. The Token Plan read is best-effort — a platform that cannot
 * be read leaves the app's own card standing.
 */
export async function fetchMimoQuota(session, fetchFn = outboundFetch) {
    const decoded = parseMimoStored(session);
    if (!decoded)
        throw new Error('Xiaomi MiMo: not a Xiaomi-account sign-in');
    let raw = session;
    // The stale-session rescue: sign the account on again once, in memory.
    const reSignOn = async () => {
        const signed = await mimoSignOn(decoded.creds, decoded.creds.base, fetchFn);
        decoded.cookies = signed.cookies;
        raw = { ...session, accessToken: JSON.stringify(signed.cookies), expiresAt: Date.now() + MIMO_RENEW_AFTER_MS };
    };
    const self = await mimoPage(() => raw, mimoSubscriptionUrl(session), fetchFn, reSignOn);
    const subscription = parseMimoSubscription(self);
    const hasAppPlan = !!(self && typeof self === 'object' && self.current && typeof self.current === 'object');
    const rows = [];
    let planType = subscription.planType;
    let tp;
    try {
        tp = await mimoTokenPlanOf(decoded.creds, hasAppPlan, fetchFn);
    }
    catch {
        tp = null;
    }
    if (!hasAppPlan && tp) {
        // No app plan: the account's plan is the platform's Token Plan
        // (index.mjs:556-561) — its requests go there, so its credits are the
        // account's allowance.
        planType = tp.plan;
    }
    try {
        const usage = await mimoPage(() => raw, mimoUsageUrl(session), fetchFn, reSignOn);
        const week = parseMimoUsage(usage);
        if (week)
            rows.push(week);
    }
    catch {
        // The plan alone, when the week's allowance can't be read (index.mjs:565-569).
        if (tp?.window)
            rows.push(mimoTokenPlanRow(tp));
        return { account: String(decoded.creds.userId), planType, rows };
    }
    if (tp?.window)
        rows.push(mimoTokenPlanRow(tp));
    return { account: String(decoded.creds.userId), planType, rows };
}
/** The Token Plan's credits as a card row (index.mjs:608-620). */
export function mimoTokenPlanRow(tp) {
    const window = tp.window;
    return {
        key: 'token-plan',
        kind: 'product',
        product: window.name,
        usedPercent: clampPct(window.usedPercent),
        remainingPercent: clampPct(100 - window.usedPercent),
        used: window.used,
        total: window.total,
        unit: 'credits',
        ...(window.resetsAt !== undefined ? { resetAt: window.resetsAt } : {}),
    };
}
