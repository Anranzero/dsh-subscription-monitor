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
import { randomBytes } from 'node:crypto';
import { OAuthEndpointError } from '../errors.js';
import { outboundFetch } from '../../utils/outbound.js';
import { catalogRows } from '../../catalog/index.js';
export { applyMimoCache, mimoCacheHeaders, mimoCacheSessionId, resetMimoPins } from './cache.js';
/** HOSTS (index.mjs:14-18) — the API base per region, `/api` included. */
export const MIMO_HOSTS = Object.freeze({
    SGP: 'https://mimo-server-sgp.xiaomimimo.com/api',
    RU: 'https://mimo-server-ru.xiaomimimo.com/api',
    IN: 'https://mimo-server-in.xiaomimimo.com/api',
});
/** REGION (index.mjs:19) — every sign-in starts on Singapore. */
export const MIMO_DEFAULT_REGION = 'SGP';
/** ACCOUNT (index.mjs:20) — where the passToken lives and the sign-in page is. */
export const MIMO_ACCOUNT_ORIGIN = 'https://account.xiaomi.com';
/** APP_VERSION (index.mjs:21) — `X-Client-Version` on every server request. */
export const MIMO_APP_VERSION = '26.929.292248';
/** SOURCE (index.mjs:22) — `X-Mimo-Source` on chat requests only. */
export const MIMO_SOURCE = 'mimocode-cli-free';
/** UA (index.mjs:23) — the account SDK's own Windows UA, sent on every request. */
export const MIMO_USER_AGENT = 'miNative PC/Normal Windows_NT/10.0.26100 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop APPV/0.1.0';
/** RENEW_AFTER (index.mjs:24) — the app signs on again after a day. */
export const MIMO_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
/** LEAD_MS (index.mjs:25) — renew this close to the day's end (TokenManager preemptMs). */
export const MIMO_PREEMPT_MS = 10 * 60 * 1000;
/** SIGN_IN_LIFE (index.mjs:26) — the long-poll ticket's life cap. */
export const MIMO_SIGN_IN_LIFE_MS = 10 * 60 * 1000;
/** waitPoll's sleep (index.mjs:331). */
export const MIMO_POLL_MS = 1_000;
/** TP_LIFE (index.mjs:36) — this long, an account the app refused is asked at its Token Plan. */
export const MIMO_TP_LIFE_MS = 60 * 60 * 1000;
/** PLATFORM (index.mjs:169) — the open platform that sells the Token Plan. */
export const MIMO_PLATFORM_ORIGIN = 'https://platform.xiaomimimo.com';
/** The platform's serviceLogin sid (usage.test.mjs:129 asserts it). */
export const MIMO_PLATFORM_SID = 'api-platform';
/** TIERS (index.mjs:375) — the app's names for its plans' tiers. */
export const MIMO_TIER_NAMES = Object.freeze({ 1: 'Starter', 2: 'Plus', 3: 'Pro', 4: 'Ultra' });
/** Wire plan spellings → the card's name (plan.ts maps the rest). */
export const MIMO_PLAN_NAMES = Object.freeze({
    free: 'Free',
    starter: 'Starter',
    plus: 'Plus',
    pro: 'Pro',
    ultra: 'Ultra',
});
export const MIMO_INPUT = Object.freeze(['text', 'image']);
export const MIMO_SOURCES = Object.freeze(['oauth']);
/**
 * Offline picker floor = the upstream plugin's own pinned table (index.mjs:28-32,
 * README "Models"): both models are 1,000,000 context / 128,000 output,
 * text+image in, no reasoning control advertised (hence `reasoningEfforts:
 * false`). Rows live in `src/catalog/models.json` under `"mimo"`.
 */
export const MIMO_MODELS = catalogRows('mimo');
/** Catalog lookup for the custom-context ceiling (`familyMaxContextWindow`). */
export function mimoModel(modelId) {
    return MIMO_MODELS.find((model) => model.id === modelId);
}
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/** baseOf (index.mjs:38). */
export function mimoBaseOf(region) {
    return MIMO_HOSTS[String(region ?? '').trim().toUpperCase()] ?? '';
}
/** deviceId (index.mjs:39) — the sign-in's device identity, kept in the creds. */
export function mimoDeviceId() {
    return 'pc_' + randomBytes(16).toString('hex');
}
/** accountJSON (index.mjs:43-49) — Xiaomi's JSON comes after a `&&&START&&&` guard. */
export function mimoAccountJSON(text) {
    try {
        return JSON.parse(String(text).trim().replace(/^&&&START&&&/, ''));
    }
    catch {
        return null;
    }
}
/**
 * The sign-in's redirect cookie jar (index.mjs:53-101): just enough domain /
 * path / secure matching to follow account.xiaomi.com → the MiMo server's
 * `/sts` → `/user/xiaomi/me` by hand (`redirect: "manual"`). Family-owned —
 * no other family's jar or cache helper is imported.
 */
export class MimoJar {
    cookies;
    constructor() {
        this.cookies = [];
    }
    put(cookie) {
        this.cookies = this.cookies.filter((other) => !(other.name === cookie.name && other.domain === cookie.domain && other.path === cookie.path));
        if (!cookie.gone)
            this.cookies.push(cookie);
    }
    /** Seed a cookie as a browser would hold it for `url` (index.mjs:61-63). */
    seed(url, name, value) {
        this.put({ name, value, domain: new URL(url).hostname.toLowerCase(), hostOnly: false, path: '/', secure: false });
    }
    /** Take a response's Set-Cookie lines as set for `url` (index.mjs:64-88). */
    take(response, url) {
        const target = new URL(url);
        const lines = typeof response.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
        for (const line of lines) {
            const [pair, ...attrs] = line.split(';');
            const eq = pair.indexOf('=');
            if (eq <= 0)
                continue;
            const cookie = {
                name: pair.slice(0, eq).trim(),
                value: pair.slice(eq + 1).trim(),
                domain: target.hostname.toLowerCase(),
                hostOnly: true,
                secure: false,
            };
            const dir = target.pathname.lastIndexOf('/');
            cookie.path = dir > 0 ? target.pathname.slice(0, dir) : '/';
            for (const attr of attrs) {
                const at = attr.indexOf('=');
                const key = (at < 0 ? attr : attr.slice(0, at)).trim().toLowerCase();
                const value = at < 0 ? '' : attr.slice(at + 1).trim();
                if (key === 'domain' && value) {
                    const domain = value.replace(/^\./, '').toLowerCase();
                    if (cookie.domain === domain || cookie.domain.endsWith('.' + domain)) {
                        cookie.domain = domain;
                        cookie.hostOnly = false;
                    }
                }
                else if (key === 'path' && value.startsWith('/'))
                    cookie.path = value;
                else if (key === 'secure')
                    cookie.secure = true;
                else if (key === 'max-age' && Number(value) <= 0)
                    cookie.gone = true;
                else if (key === 'expires' && Date.parse(value) <= Date.now())
                    cookie.gone = true;
            }
            this.put(cookie);
        }
    }
    /** The cookies a request to `url` carries (index.mjs:89-97). */
    for(url) {
        const target = new URL(url);
        const host = target.hostname.toLowerCase();
        return this.cookies.filter((cookie) => {
            if (cookie.secure && target.protocol !== 'https:')
                return false;
            if (cookie.hostOnly ? host !== cookie.domain : host !== cookie.domain && !host.endsWith('.' + cookie.domain))
                return false;
            return target.pathname === cookie.path || target.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/') || cookie.path === '/';
        });
    }
    /** The jar as a Cookie header for `url` (index.mjs:98-100). */
    header(url) {
        return this.for(url).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    }
}
/**
 * Lapsed (index.mjs:105): the passToken no longer signs the account on. Not a
 * transient failure — the stored login must be re-made by the user.
 */
export class MimoLapsedError extends OAuthEndpointError {
    constructor(message = 'Xiaomi MiMo: the Xiaomi sign-in has lapsed; sign in again') {
        super(message, 401, 'invalid_grant');
        this.name = 'MimoLapsedError';
    }
}
/** appHeaders (index.mjs:107) — every MiMo server request carries these two. */
export function mimoAppHeaders() {
    return { 'User-Agent': MIMO_USER_AGENT, 'X-Client-Version': MIMO_APP_VERSION };
}
/**
 * The account's cookies as the server's pages and chat requests send them
 * (cookieHeader, index.mjs:229-234): `serviceToken`, `userId`, `cUserId`
 * first, in that order, the rest behind them.
 */
export function mimoCookieHeader(cookies) {
    const first = ['serviceToken', 'userId', 'cUserId'];
    const held = cookies && typeof cookies === 'object' ? cookies : {};
    const parts = first.filter((name) => name in held).map((name) => `${name}=${held[name]}`);
    for (const [name, value] of Object.entries(held))
        if (!first.includes(name))
            parts.push(`${name}=${value}`);
    return parts.join('; ');
}
/** Chat headers (index.mjs:745-750): cookies, no Authorization, plus the app's marks. */
export function mimoUpstreamHeaders(session) {
    const parsed = parseMimoStored(session);
    return {
        Cookie: mimoCookieHeader(parsed?.cookies ?? {}),
        'X-Mimo-Source': MIMO_SOURCE,
        'User-Agent': MIMO_USER_AGENT,
        'X-Client-Version': MIMO_APP_VERSION,
    };
}
/** Page headers (index.mjs:512-514): the server's own pages send no X-Mimo-Source. */
export function mimoPageHeaders(session) {
    const parsed = parseMimoStored(session);
    return { Cookie: mimoCookieHeader(parsed?.cookies ?? {}), ...mimoAppHeaders() };
}
export function mimoApiBase(session) {
    const base = trimmed(session?.base);
    return base || mimoBaseOf(session?.region) || MIMO_HOSTS[MIMO_DEFAULT_REGION];
}
export function mimoChatUrl(session) {
    return `${mimoApiBase(session).replace(/\/+$/, '')}/route/chat/completions`;
}
export function mimoMeUrl(session) {
    return `${mimoApiBase(session).replace(/\/+$/, '')}/user/xiaomi/me`;
}
export function mimoSubscriptionUrl(session) {
    return `${mimoApiBase(session).replace(/\/+$/, '')}/user/xiaomi/subscription/self`;
}
export function mimoUsageUrl(session) {
    return `${mimoApiBase(session).replace(/\/+$/, '')}/user/usage`;
}
/**
 * serverTime (index.mjs:409-417): the server's times carry no zone and the
 * app shows them as they come, which is Beijing's (and Singapore's) — parse
 * zone-less stamps at +08:00; a date alone is midnight there.
 */
export function mimoServerTime(value) {
    const text = String(value ?? '').trim();
    let iso = '';
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/i.test(text))
        iso = text;
    else if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?$/.test(text))
        iso = text.replace(' ', 'T') + '+08:00';
    else if (/^\d{4}-\d\d-\d\d$/.test(text))
        iso = text + 'T00:00:00+08:00';
    const at = iso ? Date.parse(iso) : NaN;
    return isNaN(at) ? undefined : new Date(at).toISOString();
}
/** The passToken cookies every sign-on dance seeds on account.xiaomi.com (index.mjs:116-118). */
const MIMO_ACCOUNT_COOKIES = [
    ['userId', (creds) => creds.userId],
    ['passToken', (creds) => creds.passToken],
    ['cUserId', (creds) => creds.cUserId],
    ['deviceId', (creds) => creds.deviceId],
    ['pass_ua', () => 'pc'],
    ['uLocale', () => 'zh_CN'],
];
function seedAccountCookies(jar, creds) {
    for (const [name, read] of MIMO_ACCOUNT_COOKIES) {
        const value = read(creds);
        if (value)
            jar.seed(MIMO_ACCOUNT_ORIGIN, name, value);
    }
}
/**
 * Sign the account on at a MiMo server as the app's window does (session,
 * index.mjs:114-161): `/user/xiaomi/me` asked with no session sends the
 * browser to account.xiaomi.com's serviceLogin (holding the passToken), which
 * sends it back through the server's `/sts`, where the session cookies are
 * set, to `/user/xiaomi/me` again. Redirects are followed by hand because the
 * server writes its followup `http://` while its cookies only ride `https`.
 */
export async function mimoSignOn(creds, base, fetchFn = outboundFetch, { signal } = {}) {
    const jar = new MimoJar();
    seedAccountCookies(jar, creds);
    const target = new URL(base);
    // The dance's own cap (index.mjs:121): one 30-second deadline shared by
    // every hop (merged with a caller's signal), so a hanging hop fails at
    // 30 seconds instead of undici's default.
    const deadline = AbortSignal.timeout(30_000);
    const hopSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let url = base.replace(/\/+$/, '') + '/user/xiaomi/me';
    let response;
    for (let hop = 0;; hop++) {
        if (hop > 10)
            throw new Error('Xiaomi MiMo sign-in: too many redirects');
        const headers = mimoAppHeaders();
        const cookie = jar.header(url);
        if (cookie)
            headers.Cookie = cookie;
        try {
            response = await fetchFn(url, { headers, redirect: 'manual', signal: hopSignal });
        }
        catch (error) {
            const why = error instanceof Error ? error.message : String(error);
            throw new Error('Xiaomi MiMo sign-in: ' + why);
        }
        jar.take(response, url);
        const location = response.headers?.get?.('location');
        if (response.status < 300 || response.status >= 400 || !location)
            break;
        await response.arrayBuffer().catch(() => undefined);
        const next = new URL(location, url);
        // The server's followup is written http://; its session cookies only go
        // back over https (index.mjs:140-142).
        if (next.protocol === 'http:' && target.protocol === 'https:' && next.host.toLowerCase() === target.host.toLowerCase())
            next.protocol = 'https:';
        url = next.href;
    }
    const text = await response.text();
    let me;
    try {
        me = JSON.parse(text);
    }
    catch {
        // Xiaomi's sign-in page, not the server's answer: the passToken no longer
        // signs the account on (index.mjs:147-152).
        throw new MimoLapsedError();
    }
    if (response.status === 403 || me?.code === 403 || me?.code === 46109) {
        throw new Error("Xiaomi MiMo doesn't serve this Xiaomi account (its region isn't served here)");
    }
    if (me?.code !== 0 || !String(me?.data?.userId ?? ''))
        throw new MimoLapsedError();
    const cookies = {};
    for (const cookie of jar.for(target.href))
        cookies[cookie.name] = cookie.value;
    if (!Object.keys(cookies).length)
        throw new Error('Xiaomi MiMo sign-in: the server set no session');
    return { cookies, me: me.data };
}
/**
 * toAuth (index.mjs:239-247) in this store's shape: `refreshToken` is the
 * Xiaomi account JSON (what signs the account on again), `accessToken` the
 * session cookies JSON, `expiresAt` a day after the session was issued.
 */
export function mimoSession({ creds, cookies, issuedAt = Date.now() }) {
    const account = trimmed(creds?.userId);
    if (!account || !trimmed(creds?.passToken))
        throw new Error('mimo session needs the Xiaomi account (userId + passToken)');
    if (!cookies || typeof cookies !== 'object' || !Object.keys(cookies).length)
        throw new Error('mimo session needs the server cookies');
    return {
        accessToken: JSON.stringify(cookies),
        refreshToken: JSON.stringify(creds),
        expiresAt: Math.trunc(issuedAt) + MIMO_RENEW_AFTER_MS,
        account,
        source: 'oauth',
        ...(trimmed(creds.region) ? { region: trimmed(creds.region) } : {}),
        ...(trimmed(creds.base) ? { base: trimmed(creds.base) } : {}),
    };
}
/**
 * fromAuth (index.mjs:249-263): a stored session back into `{creds, cookies}`;
 * null when the row is not a Xiaomi-account sign-in. A missing base is
 * resolved from the region, else Singapore.
 */
export function parseMimoStored(session) {
    if (!session || typeof session !== 'object')
        return null;
    let creds;
    try {
        creds = JSON.parse(session.refreshToken);
    }
    catch {
        return null;
    }
    if (!creds || typeof creds !== 'object')
        return null;
    if (!creds.passToken || !creds.userId)
        return null;
    let cookies = {};
    try {
        cookies = JSON.parse(session.accessToken || '{}') ?? {};
    }
    catch {
        cookies = {};
    }
    creds.base ||= mimoBaseOf(creds.region) || MIMO_HOSTS[MIMO_DEFAULT_REGION];
    return { creds, cookies, expiresAt: Number(session.expiresAt) || 0 };
}
/**
 * renew / refresh (index.mjs:438-455, 478-493): sign the account on again
 * with the same passToken, once per credential version (the shared
 * TokenManager owns that). A passToken Xiaomi no longer takes is a permanent
 * `invalid_grant` — the login is reaped, not retried. The Xiaomi account in
 * `refreshToken` stays exactly as it was; only the cookies and the clock move.
 */
export async function refreshMimo(session, fetchFn = outboundFetch) {
    const parsed = parseMimoStored(session);
    if (!parsed)
        throw new OAuthEndpointError('Xiaomi MiMo: not a Xiaomi-account sign-in', 401, 'invalid_grant');
    const next = await mimoSignOn(parsed.creds, parsed.creds.base, fetchFn);
    const creds = { ...parsed.creds, userId: String(next.me?.userId ?? '') || parsed.creds.userId };
    return mimoSession({ creds, cookies: next.cookies, issuedAt: Date.now() });
}
/**
 * serviceOf (index.mjs:278-292): the sid and callback the MiMo server sends a
 * session-less browser to account.xiaomi.com with. The defaults hold when the
 * probe cannot run.
 */
export async function mimoServiceOf(base, fetchFn = outboundFetch) {
    let sid = 'mimosgp';
    let callback = base.replace(/\/+$/, '') + '/sts';
    try {
        const response = await fetchFn(base.replace(/\/+$/, '') + '/user/xiaomi/me', { headers: mimoAppHeaders(), redirect: 'manual', signal: AbortSignal.timeout(15_000) });
        await response.arrayBuffer().catch(() => undefined);
        const location = response.headers?.get?.('location');
        if (location) {
            const query = new URL(location, base).searchParams;
            sid = query.get('sid') || sid;
            callback = query.get('callback') || callback;
        }
    }
    catch {
        // the defaults above
    }
    return { sid, callback };
}
/** accountGet (index.mjs:294-297): the ticket's two account.xiaomi.com reads. */
export async function mimoAccountGet(url, device, fetchFn = outboundFetch, signal) {
    const response = await fetchFn(url, {
        headers: { 'User-Agent': MIMO_USER_AGENT, Cookie: `deviceId=${device}; pass_ua=pc; uLocale=zh_CN` },
        signal,
    });
    return { status: response.status, text: await response.text() };
}
/**
 * startSignIn (index.mjs:299-320): mint the sign-in page and its long-poll
 * ticket. The query is the app's own, byte for byte.
 */
export async function mimoSignInPage({ device = mimoDeviceId(), fetchFn = outboundFetch } = {}) {
    const base = MIMO_HOSTS[MIMO_DEFAULT_REGION];
    const { sid, callback } = await mimoServiceOf(base, fetchFn);
    const query = new URLSearchParams({
        _group: 'DEFAULT',
        _qrsize: '240',
        qs: '%3Fsid%3D' + encodeURIComponent(sid) + '%26_json%3Dtrue',
        callback,
        _hasLogo: 'false',
        sid,
        serviceParam: '',
        _locale: 'en_US',
    });
    const { status, text } = await mimoAccountGet(`${MIMO_ACCOUNT_ORIGIN}/longPolling/loginUrl?${query}`, device, fetchFn, AbortSignal.timeout(20_000));
    const parsed = mimoAccountJSON(text);
    if (!parsed || parsed.code !== 0 || !parsed.loginUrl || !parsed.lp) {
        throw new Error(`Xiaomi MiMo sign-in: account.xiaomi.com answered ${status} ${parsed?.desc || String(text).trim().slice(0, 200)}`);
    }
    const life = parsed.timeout > 0 ? Math.min(parsed.timeout * 1000, MIMO_SIGN_IN_LIFE_MS) : MIMO_SIGN_IN_LIFE_MS;
    return { url: parsed.loginUrl, lp: parsed.lp, device, until: Date.now() + life };
}
/**
 * waitPoll (index.mjs:323-334): ask the ticket's long poll until Xiaomi says
 * the account is in — a 200 whose JSON carries the passToken and the user id.
 */
export async function waitMimoPoll(ticket, fetchFn = outboundFetch, signal) {
    while (Date.now() < ticket.until) {
        if (signal?.aborted)
            throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
        try {
            const left = ticket.until - Date.now();
            const { status, text } = await mimoAccountGet(ticket.lp, ticket.device, fetchFn, AbortSignal.timeout(Math.min(70_000, Math.max(left, 1))));
            const parsed = status === 200 ? mimoAccountJSON(text) : null;
            if (parsed?.passToken && String(parsed.userId ?? ''))
                return parsed;
        }
        catch {
            // the poll's own timeout: ask again
        }
        await new Promise((resolve) => setTimeout(resolve, MIMO_POLL_MS));
    }
    throw new Error('the Xiaomi sign-in page expired before the sign-in finished; start it again');
}
/**
 * signedInWith (index.mjs:336-355): the ticket's passToken signs the account
 * on at the MiMo server, and an account of another region is served by that
 * region's server — the sign-on runs again there and the creds move with it.
 */
export async function mimoSignInWith(poll, device, fetchFn = outboundFetch) {
    let creds = {
        userId: String(poll.userId),
        cUserId: poll.cUserId ?? '',
        passToken: poll.passToken,
        deviceId: device,
        region: MIMO_DEFAULT_REGION,
        base: MIMO_HOSTS[MIMO_DEFAULT_REGION],
    };
    let signed;
    try {
        signed = await mimoSignOn(creds, creds.base, fetchFn);
    }
    catch (error) {
        if (error instanceof MimoLapsedError) {
            throw new Error('Xiaomi signed the account in, but the MiMo server didn\'t take it; try again');
        }
        throw error;
    }
    const region = String(signed.me?.region ?? '').trim().toUpperCase();
    const moved = mimoBaseOf(region);
    if (region && region !== creds.region && moved && moved !== creds.base) {
        try {
            signed = await mimoSignOn(creds, moved, fetchFn);
            creds = { ...creds, region, base: moved };
        }
        catch {
            // Singapore's session stays: the account is served there anyway
        }
    }
    return { creds: { ...creds, userId: String(signed.me?.userId ?? '') || creds.userId }, cookies: signed.cookies };
}
