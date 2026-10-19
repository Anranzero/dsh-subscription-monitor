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
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OAuthEndpointError } from '../errors.js';
import { catalogRows } from '../../catalog/index.js';
export { applyKimiWorkCache, kimiWorkCacheHeaders, kimiWorkCacheSessionId, resetKimiWorkPins } from './cache.js';
export const KIMI_WORK_API_ORIGIN = 'https://agent-gw.kimi.com';
export const KIMI_WORK_API_BASE = `${KIMI_WORK_API_ORIGIN}/coding/v1`;
export const KIMI_WORK_CHAT_URL = `${KIMI_WORK_API_BASE}/chat/completions`;
export const KIMI_WORK_MODELS_URL = `${KIMI_WORK_API_BASE}/models`;
/** The membership service the shared-allowance read goes to (web credential, not the Work one). */
export const KIMI_WORK_MEMBER_BASE = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/';
export const KIMI_WORK_USAGE_URL = `${KIMI_WORK_MEMBER_BASE}GetSubscriptionStats`;
/** This plugin's own UA — the upstream package uses its own too and does not impersonate the desktop client. */
export const KIMI_WORK_USER_AGENT = 'dsh-subscription-monitor';
/** The server lists the plan's XL context; the standard window is the cap (upstream modelRows). */
export const KIMI_WORK_CONTEXT_CAP = 262_144;
export const KIMI_WORK_MAX_TOKENS = 32_768;
export const KIMI_WORK_INPUT = Object.freeze(['text', 'image']);
export const KIMI_WORK_SOURCES = Object.freeze(['desktop']);
/** A reference session never expires on its own: the desktop app owns the token lifetime. */
export const KIMI_WORK_NEVER_EXPIRES = 8.64e15;
/**
 * The vault floor (store.ts assertSessionShape) wants non-empty token
 * strings. The upstream package's own loader hands the SDK the placeholder
 * `apiKey: 'local-desktop-session'` for the same reason; no real credential
 * is ever written to auth.json.
 */
export const KIMI_WORK_PLACEHOLDER = 'local-desktop-session';
/** The one readable label a reference session carries (upstream accountId). */
export const KIMI_WORK_ACCOUNT_LABEL = 'Kimi Work (local)';
/** The desktop file is refused past this size (upstream readDesktop guard). */
export const KIMI_WORK_DESKTOP_MAX_BYTES = 8 * 1024 * 1024;
/** Offline floor; live `GET /coding/v1/models` replaces it after login. Rows live in src/catalog/models.json under "kimi-work". */
export const KIMI_WORK_MODELS = catalogRows('kimi-work');
export function kimiWorkSourceLabel(source) {
    if (source === 'desktop')
        return 'desktop';
    return undefined;
}
/**
 * The desktop app's sign-in file (upstream desktopFile):
 * win `%APPDATA%/kimi-desktop/`, macOS `~/Library/Application Support/kimi-desktop/`,
 * linux `~/.config/kimi-desktop/` — then `daimon-share/daimon/config.json`.
 */
export function kimiWorkDesktopFile({ home = homedir(), platform = process.platform, appdata = process.env.APPDATA } = {}) {
    const parent = platform === 'win32'
        ? appdata || join(home, 'AppData', 'Roaming')
        : platform === 'darwin'
            ? join(home, 'Library', 'Application Support')
            : join(home, '.config');
    return join(parent, 'kimi-desktop', 'daimon-share', 'daimon', 'config.json');
}
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/**
 * The live desktop sign-in (upstream readDesktop). The internal field is
 * named `kimiCode`, but the credential is only accepted when its `baseUrl`
 * points at the Work gateway exactly — a Code-origin credential is refused,
 * never substituted. `kimiWeb` supplies the membership credential and the
 * user id the account reference hashes. undefined when the file, a field, or
 * the origin check fails; nothing is ever written back.
 */
export function readKimiWorkDesktop(file = kimiWorkDesktopFile()) {
    let text;
    try {
        const stat = statSync(file);
        if (!stat.isFile() || stat.size > KIMI_WORK_DESKTOP_MAX_BYTES)
            return undefined;
        text = readFileSync(file, 'utf8');
    }
    catch {
        return undefined;
    }
    let doc;
    try {
        doc = JSON.parse(text.replace(/^\uFEFF/, ''));
    }
    catch {
        return undefined;
    }
    const work = doc?.credentials?.kimiCode;
    const web = doc?.credentials?.kimiWeb;
    const workToken = trimmed(work?.apiKey);
    const webToken = trimmed(web?.accessToken);
    const userId = trimmed(web?.userId);
    if (!workToken || !webToken || !userId)
        return undefined;
    if (String(work?.baseUrl ?? '').replace(/\/$/, '') !== KIMI_WORK_API_BASE)
        return undefined;
    return { workToken, webToken, uid: kimiWorkAccountRef(userId) };
}
/** The hashed account reference (upstream uid): sha256 of a domain-separated user id, never the raw one. */
export function kimiWorkAccountRef(userId) {
    return createHash('sha256').update(`kimi-work-account\0${userId}`).digest('hex');
}
/** The stored shape: an account reference only — tokens stay in Kimi's own file. */
export function kimiWorkSession({ uid, account, source = 'desktop' } = {}) {
    const ref = trimmed(uid);
    if (!ref)
        throw new Error('kimi-work session needs the desktop account reference');
    return {
        accessToken: KIMI_WORK_PLACEHOLDER,
        refreshToken: KIMI_WORK_PLACEHOLDER,
        expiresAt: KIMI_WORK_NEVER_EXPIRES,
        uid: ref,
        account: trimmed(account) ?? KIMI_WORK_ACCOUNT_LABEL,
        source: KIMI_WORK_SOURCES.includes(source) ? source : 'desktop',
    };
}
export function isKimiWorkOpaqueAccount(value) {
    return /^[0-9a-f]{64}$/.test(String(value ?? '').trim());
}
/** The reconnect demand an account switch is (upstream: changing the desktop account requires reconnecting). */
export function kimiWorkAccountChanged() {
    return new OAuthEndpointError('Kimi Work: the desktop app signed in as another account; reconnect the Kimi Work provider', 401, 'invalid_grant');
}
/**
 * The live credentials for one stored session: re-read the desktop file and
 * refuse a changed account (upstream current()). Rotation under the desktop
 * app is picked up here for free — the read happens per operation.
 */
export function currentKimiWorkDesktop(session) {
    const read = readKimiWorkDesktop();
    if (!read) {
        throw new OAuthEndpointError("Kimi Work desktop isn't signed in; open Kimi and sign in to Work, then reconnect", 401, 'invalid_grant');
    }
    if (trimmed(session?.uid) && session.uid !== read.uid)
        throw kimiWorkAccountChanged();
    return read;
}
/**
 * TokenManager refresh: a desktop-source session re-reads the file (never an
 * endpoint — spending anything of the desktop's would be inventing a flow the
 * upstream package does not have). A missing file or a changed account reads
 * as a permanent 401 so the row is reaped into a reconnect, not a loop.
 */
export async function refreshKimiWork(session) {
    currentKimiWorkDesktop(session);
    return { ...session };
}
/** JSON-read headers (models, membership): the Connect protocol header rides POSTs (upstream jsonRequest). */
export function kimiWorkJsonHeaders(token, { post = false } = {}) {
    return {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'user-agent': KIMI_WORK_USER_AGENT,
        ...(post ? { 'content-type': 'application/json', 'connect-protocol-version': '1' } : {}),
    };
}
