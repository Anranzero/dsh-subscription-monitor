/**
 * WorkBuddy / WorkBuddy AI (Tencent CodeBuddy's desktop-agent plans) OAuth.
 *
 * Attribution: **@magpie-community/opencode-workbuddy-auth 0.1.24**
 * (github.com/magpie-community/plugins, packages/workbuddy; MIT) — loaded at
 * runtime as the upstream engine (engine.ts; docs/oauth.md「上游引擎」).
 * One package, two named exports:
 *
 * | provider id | build | endpoint |
 * |---|---|---|
 * | workbuddy | WorkBuddy, the China build (CodeBuddy plan) | https://copilot.tencent.com |
 * | workbuddy-ai | WorkBuddy AI, the international build | https://www.workbuddy.ai |
 *
 * The engine owns the wire: browser sign-in, the one-time token rotation,
 * the chat hop (sign group, conversation ids, body fit) and the usage read.
 * What this module still holds is the family's non-wire facts both sides
 * share — the two sites' identity, the catalog read's endpoints and header
 * seeds, the desktop file reader (the engine reads it too, but the catalog
 * read and the diagnostics need it on our side) and the vault-facing
 * constants. Sign-in is the desktop app's own browser flow; the desktop
 * sign-in itself is a reference (the engine re-reads the file per hop —
 * nothing is copied, WorkBuddy 5.6+ keeps it sealed anyway).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { catalogRows } from '../../catalog/index.js';
/** The version WorkBuddy's sign-in page is opened with (APP_VERSION). */
export const WORKBUDDY_APP_VERSION = '2.0.0';
/** WorkBuddy/<this> is the User-Agent the API takes (UA_VERSION); without it error 10085. */
export const WORKBUDDY_UA_VERSION = '5.5.6';
export const WORKBUDDY_USER_AGENT = `WorkBuddy/${WORKBUDDY_UA_VERSION}`;
/** The /v3/config product-config read needs the CLI agent's UA, not the bare one. */
export const WORKBUDDY_CLI_USER_AGENT = `CLI/${WORKBUDDY_APP_VERSION} ${WORKBUDDY_USER_AGENT}`;
/** A token this close to its end is refreshed before a request (the engine's LEAD_MS era; the vault refresh mirrors it). */
export const WORKBUDDY_PREEMPT_MS = 60_000;
export const WORKBUDDY_SOURCES = Object.freeze(['oauth', 'desktop']);
/** makePlugin(SITES[...]) — the two builds differ only in these fields. */
export const WORKBUDDY_SITES = Object.freeze({
    workbuddy: {
        id: 'workbuddy',
        name: 'WorkBuddy',
        endpoint: 'https://copilot.tencent.com',
        authID: 'workbuddy-desktop',
        platform: 'workbuddy',
        ai: false,
    },
    'workbuddy-ai': {
        id: 'workbuddy-ai',
        name: 'WorkBuddy AI',
        endpoint: 'https://www.workbuddy.ai',
        authID: 'workbuddy-desktop-ai',
        platform: 'workbuddy-ai',
        ai: true,
    },
});
export function workbuddySiteOf(id) {
    const site = WORKBUDDY_SITES[id];
    if (!site)
        throw new Error(`unknown workbuddy build: ${id}`);
    return site;
}
export function workbuddyApiBase(site) {
    return `${site.endpoint}/v2`;
}
export function workbuddyChatUrl(site) {
    return `${workbuddyApiBase(site)}/chat/completions`;
}
/** The product config (live model list) — /v3, not /v2. */
export function workbuddyConfigUrl(site) {
    return `${site.endpoint}/v3/config`;
}
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export function workbuddySourceLabel(source) {
    if (source === 'desktop')
        return 'desktop';
    if (source === 'oauth')
        return 'OAuth';
    return undefined;
}
/** wbDomain: the account's own domain, else the API host (CN accounts carry www.workbuddy.cn). */
export function workbuddyDomainOf(site, session) {
    return trimmed(session?.domain) ?? new URL(workbuddyApiBase(site)).host;
}
/**
 * X-Enterprise-Id / X-Tenant-Id name the enterprise (team) an account signed
 * in as, exactly as WorkBuddy's own auth interceptor sends them; without them
 * the backend answers as the personal plan. A personal account has none.
 */
export function workbuddyEnterpriseHeaders(session) {
    const id = trimmed(session?.enterpriseId);
    return id ? { 'X-Enterprise-Id': id, 'X-Tenant-Id': id } : {};
}
// ---- the desktop app's own sign-in (read-only; the engine reads it too) ----
export function workbuddyDesktopFile(site, { home = homedir() } = {}) {
    const base = process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'CodeBuddyExtension')
        : process.platform === 'win32'
            ? join(home, 'AppData', 'Local', 'CodeBuddyExtension')
            : join(home, '.local', 'share', 'CodeBuddyExtension');
    return join(base, 'Data', 'Public', 'auth', `${site.authID}.info`);
}
/**
 * readWorkbuddyDesktop: the app's sign-in as it keeps it now. null for none;
 * `encrypted` names the WorkBuddy 5.6+ at-rest seal ({$wbEncrypted, envelope})
 * that only the app opens. The engine re-reads this file on every hop for a
 * desktop-source account — a vault row for one never holds its tokens.
 */
export function readWorkbuddyDesktop(site, { home } = {}) {
    let file;
    try {
        file = JSON.parse(readFileSync(workbuddyDesktopFile(site, home === undefined ? {} : { home }), 'utf8'));
    }
    catch {
        return null;
    }
    const token = file?.auth ?? {};
    if (token.accessToken?.$wbEncrypted || token.refreshToken?.$wbEncrypted) {
        return { session: {}, name: undefined, encrypted: true };
    }
    if (typeof token.accessToken !== 'string' || !token.accessToken || !file?.account?.uid)
        return null;
    const now = Date.now();
    const account = file.account;
    const session = {
        accessToken: token.accessToken,
        refreshToken: trimmed(token.refreshToken) ?? token.accessToken,
        expiresAt: Number(token.expiresAt) > 0 ? Math.trunc(Number(token.expiresAt))
            : Number(token.expiresIn) > 0 ? now + Number(token.expiresIn) * 1000
                : 0,
        uid: String(account.uid),
        source: 'desktop',
        // The account's own domain (CN: www.workbuddy.cn), as the engine's
        // readDesktop keeps it — X-Domain is the account's, never the site host.
        ...(trimmed(token.domain) ? { domain: trimmed(token.domain) } : {}),
        ...(trimmed(account.enterpriseId) ? { enterpriseId: trimmed(account.enterpriseId) } : {}),
    };
    return {
        session,
        name: trimmed(account.nickname) ?? trimmed(account.phoneNumber) ?? String(account.uid),
        encrypted: false,
    };
}
export function workbuddyDesktopReason(site, { home } = {}) {
    const read = readWorkbuddyDesktop(site, home === undefined ? {} : { home });
    if (read?.encrypted) {
        return `${site.name} desktop keeps its sign-in encrypted (WorkBuddy 5.6 and later); sign in with the browser instead`;
    }
    return `${site.name} desktop isn't signed in`;
}
/** Wire plan spellings → the card's name (plan.ts maps the rest). */
export const WORKBUDDY_PLAN_NAMES = Object.freeze({
    free: 'Free',
    pro: 'Pro',
    enterprise: 'Enterprise',
});
/** Offline floors (magpie 0.1.24's CN_MODELS / AI_MODELS); rows live in src/catalog/models.json. */
export const WORKBUDDY_MODELS = catalogRows('workbuddy');
export const WORKBUDDY_AI_MODELS = catalogRows('workbuddy-ai');
