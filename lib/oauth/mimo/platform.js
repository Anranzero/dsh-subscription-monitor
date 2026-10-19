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
import { MIMO_ACCOUNT_ORIGIN, MIMO_PLATFORM_ORIGIN, MIMO_TP_LIFE_MS, MimoJar, } from './index.js';
/** `/api/v1` pages (index.mjs:176). */
const PLATFORM_PAGE_TIMEOUT_MS = 20_000;
/** userId → the platform's session cookies (index.mjs:590 `platform`). */
const platformCookies = new Map();
/** userId → {key, base, at} (index.mjs:632 `planKeys`). */
const planKeys = new Map();
/** userId → until when the app's refusal sends requests straight to the plan (index.mjs:662 `onPlan`). */
const onPlanUntil = new Map();
/** Test isolation: drop every cached platform session, key and reroute mark. */
export function resetMimoPlatformState() {
    platformCookies.clear();
    planKeys.clear();
    onPlanUntil.clear();
}
function seedJar(jar, creds) {
    for (const [name, value] of [
        ['userId', creds.userId],
        ['passToken', creds.passToken],
        ['cUserId', creds.cUserId],
        ['deviceId', creds.deviceId],
        ['pass_ua', 'pc'],
        ['uLocale', 'zh_CN'],
    ]) {
        if (value)
            jar.seed(MIMO_ACCOUNT_ORIGIN, name, value);
    }
}
/**
 * platformPage (index.mjs:174-226): one of the platform's `/api/v1` pages as
 * `{cookies, data}`. The session given in is tried first; a page that turns
 * the session away (or none held) is signed on for afresh through Xiaomi's
 * serviceLogin. `data` null is a page the account can read but that carries
 * no plan; a throw is a page that could not be read at all.
 */
export async function mimoPlatformPage(creds, path, cookies, fetchFn) {
    const url = `${MIMO_PLATFORM_ORIGIN}/api/v1${path}`;
    const signal = AbortSignal.timeout(PLATFORM_PAGE_TIMEOUT_MS);
    const ask = async (cookieHeader) => {
        const response = await fetchFn(url, { headers: cookieHeader ? { Cookie: cookieHeader } : {}, redirect: 'manual', signal });
        return { response, text: await response.text() };
    };
    const dataOf = (text) => {
        try {
            const parsed = JSON.parse(text);
            return parsed?.code === 0 ? (parsed.data ?? null) : undefined;
        }
        catch {
            return undefined;
        }
    };
    if (cookies) {
        const { response, text } = await ask(Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; '));
        const data = response.status === 200 ? dataOf(text) : undefined;
        if (data !== undefined)
            return { cookies, data };
    }
    let { response, text } = await ask('');
    let login;
    try {
        login = JSON.parse(text)?.loginUrl;
    }
    catch {
        login = undefined;
    }
    if (response.status !== 401 || typeof login !== 'string' || !login.startsWith(MIMO_ACCOUNT_ORIGIN + '/')) {
        throw new Error(`Xiaomi MiMo platform ${path}: answered ${response.status}`);
    }
    const jar = new MimoJar();
    seedJar(jar, creds);
    let at = login;
    for (let hop = 0;; hop++) {
        if (hop > 10)
            throw new Error('Xiaomi MiMo platform sign-in: too many redirects');
        const cookie = jar.header(at);
        response = await fetchFn(at, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual', signal });
        jar.take(response, at);
        const location = response.headers?.get?.('location');
        if (response.status < 300 || response.status >= 400 || !location)
            break;
        await response.arrayBuffer().catch(() => undefined);
        const next = new URL(location, at);
        // The followup is written http://; the session's cookies go back over
        // https (index.mjs:215-217).
        if (next.protocol === 'http:' && next.host === new URL(MIMO_PLATFORM_ORIGIN).host)
            next.protocol = 'https:';
        at = next.href;
    }
    text = await response.text();
    const data = response.status === 200 ? dataOf(text) : undefined;
    // Back on Xiaomi's sign-in page: the passToken doesn't sign on here.
    if (data === undefined)
        throw new Error(`Xiaomi MiMo platform ${path}: the Xiaomi account didn't sign on (${response.status})`);
    const held = {};
    for (const cookie of jar.for(MIMO_PLATFORM_ORIGIN + '/'))
        held[cookie.name] = cookie.value;
    return { cookies: held, data };
}
/**
 * tokenPlan (index.mjs:591-627): the account's Token Plan as
 * `{plan, until, renew, window}`, or null — none, expired, or the platform
 * cannot be read. `window.used` is a percent (used of limit).
 */
export async function mimoTokenPlanOf(creds, hasAppPlan, fetchFn) {
    const who = String(creds.userId);
    try {
        const detail = await mimoPlatformPage(creds, '/tokenPlan/detail', platformCookies.get(who), fetchFn);
        platformCookies.set(who, detail.cookies);
        const plan = detail.data;
        const name = typeof plan?.planName === 'string' ? plan.planName.trim() : '';
        if (!name || plan.expired !== false)
            return null;
        const out = {
            plan: `Token Plan ${name}`,
            renew: plan.enableAutoRenew || plan.hasAutoRenewSubscribed ? 'auto' : 'off',
        };
        // The platform's times are UTC ("有效期至 2026-11-06 23:59:59 (UTC)",
        // index.mjs:602-604).
        const end = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(plan.currentPeriodEnd ?? '')
            ? Date.parse(String(plan.currentPeriodEnd).replace(' ', 'T') + 'Z')
            : NaN;
        if (!isNaN(end))
            out.until = end;
        try {
            const usage = await mimoPlatformPage(creds, '/tokenPlan/usage', detail.cookies, fetchFn);
            platformCookies.set(who, usage.cookies);
            const items = [...(usage.data?.monthUsage?.items ?? []), ...(usage.data?.usage?.items ?? [])];
            const item = items.find((row) => row?.name === 'month_total_token') ?? items.find((row) => row?.name === 'plan_total_token');
            if (Number.isFinite(item?.used) && Number(item.limit) > 0) {
                out.window = {
                    name: hasAppPlan ? 'Token Plan · API key' : 'Token Plan',
                    usedPercent: Math.max(0, Math.min(100, (100 * item.used) / item.limit)),
                    used: item.used,
                    total: item.limit,
                    // `aside: true` upstream — with an app plan the account's requests
                    // go to the app, so the plan's credits are its key's. This repo's
                    // row shape has no aside flag; the card shows the window beside the
                    // app plan's week either way (README 额度).
                    aside: hasAppPlan === true,
                    ...(out.until !== undefined ? { resetsAt: out.until } : {}),
                };
            }
        }
        catch {
            // the plan stands without its usage window
        }
        return out;
    }
    catch {
        platformCookies.delete(who);
        return null;
    }
}
/**
 * planKey (index.mjs:632-660): the account's Token Plan as
 * `{key, base}` — its `tp-` key and OpenAI base URL — or null when it has no
 * live plan or no key yet (the platform's page makes one; this plugin never
 * does). Cached MIMO_TP_LIFE_MS per account.
 */
export async function mimoPlanKeyOf(creds, fetchFn) {
    const who = String(creds.userId);
    const held = planKeys.get(who);
    if (held && Date.now() - held.at < MIMO_TP_LIFE_MS)
        return held;
    planKeys.delete(who);
    try {
        let cookies = platformCookies.get(who);
        const read = async (path) => {
            const page = await mimoPlatformPage(creds, path, cookies, fetchFn);
            cookies = page.cookies;
            platformCookies.set(who, cookies);
            return page.data;
        };
        const plan = await read('/tokenPlan/detail');
        if (!plan?.planName || plan.expired !== false)
            return null;
        const apiKey = await read('/tokenPlan/apiKey');
        // The plan's own endpoint, only when it is a xiaomimimo.com https base
        // (index.mjs:649).
        const base = typeof apiKey?.openaiBaseUrl === 'string' && /^https:\/\/[^/]+\.xiaomimimo\.com\//.test(apiKey.openaiBaseUrl)
            ? apiKey.openaiBaseUrl.replace(/\/+$/, '')
            : '';
        if (!base)
            return null;
        const raw = await read('/tokenPlan/apiKey/raw');
        if (typeof raw !== 'string' || !raw.startsWith('tp-'))
            return null;
        const got = { key: raw, base, at: Date.now() };
        planKeys.set(who, got);
        return got;
    }
    catch {
        platformCookies.delete(who);
        return null;
    }
}
/** A key reset at the platform is read again on the next request (index.mjs:736). */
export function forgetMimoPlanKey(userId) {
    planKeys.delete(String(userId));
}
/**
 * onPlan (index.mjs:662, 739-744): an hour after the app refused an account
 * (membership_required) with a Token Plan behind it, its requests go straight
 * to the plan — then the app is asked first again, in case a membership was
 * bought.
 */
export function noteMimoOnPlan(userId) {
    onPlanUntil.set(String(userId), Date.now() + MIMO_TP_LIFE_MS);
}
export function mimoPrefersPlan(userId) {
    const until = onPlanUntil.get(String(userId));
    return until !== undefined && Date.now() < until;
}
/** The app refused with no Token Plan behind it: stop routing around it. */
export function clearMimoOnPlan(userId) {
    onPlanUntil.delete(String(userId));
}
