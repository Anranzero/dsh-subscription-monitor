/**
 * Cline (cline.bot) subscription OAuth — usage-billing / ClinePass credits.
 *
 * Pinned client: **Cline CLI 3.0.70** (npm `cline`, `apps/cli`) on
 * `@cline/core 0.0.92` — source tag `cli-v3.0.70` of github.com/cline/cline:
 * `sdk/packages/core/src/auth/cline.ts` (login / refresh),
 * `sdk/packages/core/src/auth/provider-auth-registry.ts` (`workos:` prefix),
 * `sdk/packages/llms/src/providers/request-headers.ts` (chat headers),
 * `sdk/packages/llms/src/providers/vendors/cline.ts` (OpenAI-compatible hop),
 * `sdk/packages/llms/src/catalog/catalog-cline-recommended.ts` (picker feed).
 *
 * Login is **WorkOS device authorization** + a Cline register exchange:
 * no PKCE, no loopback callback server, no browser redirect. The CLI defaults
 * to it (`useWorkOSDeviceAuth: true`); its PKCE/browser branch exists only for
 * the legacy VS Code extension and this hop does not carry it.
 *
 * Chat is OpenAI **Completions** at `{apiBaseUrl}/api/v1/chat/completions`,
 * authenticated with `Authorization: Bearer workos:<jwt>`. The `workos:`
 * prefix is not decoration: the API answers 401 `Unauthorized: Please make
 * sure you're using the latest version of Cline…` for a bare JWT
 * (live-verified 2026-09-19; mirrors `formatAccessToken` in
 * `provider-auth-registry.ts`).
 */
import os from 'node:os';
import { join } from 'node:path';
import { OAuthEndpointError, oauthError } from '../errors.js';
import { applyClineCache, clineCacheSessionId, resetClinePins } from './cache.js';
import { outboundFetch } from '../../utils/outbound.js';
import { catalogRows } from '../../catalog/index.js';
const CLINE_API_ORIGIN = 'https://api.cline.bot';
export const CLINE_API_BASE = `${CLINE_API_ORIGIN}/api/v1`;
export const CLINE_CHAT_URL = `${CLINE_API_BASE}/chat/completions`;
export const CLINE_REGISTER_URL = `${CLINE_API_BASE}/auth/register`;
export const CLINE_REFRESH_URL = `${CLINE_API_BASE}/auth/refresh`;
export const CLINE_ME_URL = `${CLINE_API_BASE}/users/me`;
export const CLINE_RECOMMENDED_MODELS_URL = `${CLINE_API_BASE}/ai/cline/recommended-models`;
/** Cloud catalog `loadCloudModels` reads. Facts only — not the picker membership. */
export const CLINE_MODELS_URL = `${CLINE_API_BASE}/ai/cline/models`;
const CLINE_WORKOS_ORIGIN = 'https://api.workos.com';
export const CLINE_WORKOS_DEVICE_URL = `${CLINE_WORKOS_ORIGIN}/user_management/authorize/device`;
export const CLINE_WORKOS_AUTHENTICATE_URL = `${CLINE_WORKOS_ORIGIN}/user_management/authenticate`;
/** WorkOS client registered for the Cline production environment. */
export const CLINE_WORKOS_CLIENT_ID = 'client_01K3A541FN8TA3EPPHTD2325AR';
export const CLINE_ACCESS_TOKEN_PREFIX = 'workos:';
/** `cliBuildInfo.version` — the installed `apps/cli/package.json`. */
const CLINE_CLIENT_VERSION = '3.0.70';
/** `@cline/core` package version (`X-CORE-VERSION`). */
export const CLINE_CORE_VERSION = '0.0.92';
/** `apps/cli/src/main.ts` extensionContext.client — the CLI's own identity. */
export const CLINE_CLIENT_TYPE = 'cline-cli';
const CLINE_PLATFORM = 'cli';
export const CLINE_USER_AGENT = `Cline/${CLINE_CLIENT_VERSION}`;
/** `DEFAULT_REFRESH_BUFFER_MS` — refresh 5 min before `expiresAt`. */
export const CLINE_PREEMPT_MS = 5 * 60_000;
const CLINE_SOURCES = Object.freeze(['oauth', 'cli', 'paste', 'env']);
/**
 * DSH picker level → `reasoning_effort` value.
 *
 * Transcribed from `sdk/packages/llms/src/providers/routing/portable-reasoning.ts`:
 * the `cline` provider id is in neither the portable nor the non-portable set,
 * so an effort passes through unchanged except `max` → `xhigh`, and a disabled
 * reasoning control sends **no** field at all — hence no `off` key.
 * `@ai-sdk/openai-compatible` composes the portable
 * option into the `reasoning_effort` body field this hop forwards.
 */
export const CLINE_REASONING = Object.freeze({
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'xhigh',
});
export const CLINE_DEFAULT_CONTEXT = 128_000;
export const CLINE_DEFAULT_MAX_TOKENS = 8_192;
export const CLINE_INPUT = Object.freeze(['text', 'image']);
/**
 * Offline picker seed. `refreshClineCatalog` replaces it after login from
 * the recommended feed plus `/ai/cline/models`; it never drops the seed when
 * that fetch fails. Rows live in `src/catalog/models.json` under `"cline"`.
 */
export const CLINE_MODELS = catalogRows('cline');
/** Catalog lookup for the custom-context ceiling (`familyMaxContextWindow`). */
export function clineModel(modelId) {
    return CLINE_MODELS.find((model) => model.id === modelId);
}
export function clineSourceLabel(source) {
    if (source === 'env')
        return 'env';
    if (source === 'paste')
        return 'key';
    if (source === 'cli')
        return 'CLI';
    if (source === 'oauth')
        return 'OAuth';
    return undefined;
}
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/** `formatAccessToken` — idempotent `workos:` prefix on the bearer value. */
export function formatClineAccessToken(value) {
    const token = trimmed(value);
    if (!token)
        return undefined;
    if (token.toLowerCase().startsWith(CLINE_ACCESS_TOKEN_PREFIX)) {
        // Keep the body, normalize the prefix case: a stored `Workos:`/`WORKOS:`
        // value otherwise survives into requests and string checks.
        return `${CLINE_ACCESS_TOKEN_PREFIX}${token.slice(CLINE_ACCESS_TOKEN_PREFIX.length)}`;
    }
    return `${CLINE_ACCESS_TOKEN_PREFIX}${token}`;
}
/** `normalizeStoredAccessToken` — the bare WorkOS JWT. */
export function normalizeClineAccessToken(value) {
    const token = trimmed(value);
    if (!token)
        return undefined;
    return token.toLowerCase().startsWith(CLINE_ACCESS_TOKEN_PREFIX)
        ? token.slice(CLINE_ACCESS_TOKEN_PREFIX.length)
        : token;
}
function clineBearer(session) {
    const token = formatClineAccessToken(session?.accessToken);
    if (!token)
        throw new Error('cline session needs an access token');
    return token;
}
function clineUserInfo(payload) {
    const user = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const email = trimmed(user.email);
    const clineUserId = trimmed(user.clineUserId);
    const name = trimmed(user.name);
    const subject = trimmed(user.subject);
    return {
        ...(email ? { email } : {}),
        ...(clineUserId ? { clineUserId } : {}),
        ...(name ? { name } : {}),
        ...(subject ? { subject } : {}),
    };
}
export function clineSessionFromAuthData(data, fallback = {}) {
    const access = normalizeClineAccessToken(data?.accessToken ?? fallback.accessToken);
    if (!access)
        throw new Error('cline token endpoint returned no access token');
    const refresh = trimmed(data?.refreshToken) ?? trimmed(fallback.refreshToken);
    if (!refresh)
        throw new Error('cline token endpoint returned no refresh token');
    const expiresAt = clineExpiresAt(data?.expiresAt, fallback.expiresAt);
    if (expiresAt === undefined)
        throw new Error('cline token endpoint returned no usable expiry');
    const user = clineUserInfo(data?.userInfo);
    const account = user.email ?? user.clineUserId ?? trimmed(fallback.account);
    const tokenType = trimmed(data?.tokenType);
    return {
        accessToken: formatClineAccessToken(access),
        refreshToken: refresh,
        expiresAt,
        account: account ?? clineDefaultAccount(access),
        ...(user.clineUserId ? { userId: user.clineUserId } : {}),
        ...(tokenType ? { tokenType } : {}),
        source: CLINE_SOURCES.includes(fallback.source) ? fallback.source : 'oauth',
        ...(trimmed(fallback.planType) ? { planType: trimmed(fallback.planType) } : {}),
    };
}
function clineExpiresAt(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value > 1e12 ? Math.trunc(value) : Math.trunc(value * 1000);
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value.trim());
        if (Number.isFinite(parsed))
            return parsed;
    }
    return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : undefined;
}
/**
 * Account id for a register payload that carried no `userInfo`: the WorkOS JWT
 * `external_id` (which *is* the `usr-…` id), else `sub`, else a constant. Never
 * a token fragment — the stored/displayed id must stay non-reversible.
 */
export function clineDefaultAccount(token) {
    const raw = normalizeClineAccessToken(token);
    const payloadPart = typeof raw === 'string' ? raw.split('.')[1] : undefined;
    if (payloadPart) {
        try {
            const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
            const id = trimmed(claims?.external_id) ?? trimmed(claims?.sub);
            if (id)
                return id;
        }
        catch {
            // not a JWT — fall through to the constant
        }
    }
    return 'cline-account';
}
export function isClineOpaqueAccount(value) {
    return /^cline-account$/i.test(String(value ?? '').trim());
}
/**
 * `ClineOAuthTokenError.isLikelyInvalidGrant` from the pinned CLI
 * (`@cline/core` 0.0.92) — the endpoint answers **400**
 * `{"data":"","error":"failed to refresh token: invalid_grant","success":false}`
 * for a dead grant (live-probed 2026-10-11), and the shared test matches grant
 * codes exactly, so `invalid_grant` buried in a sentence would be filed as a
 * transient 4xx and the dead login would be retried forever.
 */
async function clineRefreshFailure(response) {
    const error = await oauthError(response, 'cline refresh');
    const code = typeof error.oauthCode === 'string' ? error.oauthCode : '';
    const rejected = /invalid_grant|invalid_token|unauthorized/i.test(code)
        || ((error.status === 400 || error.status === 401 || error.status === 403)
            && /invalid|expired|revoked|unauthorized/i.test(error.message));
    return rejected ? new OAuthEndpointError(error.message, error.status, 'invalid_grant') : error;
}
/**
 * `buildClineRequestHeaders` from `request-headers.ts` plus the CLI's own
 * client context (`apps/cli/src/main.ts`: name `cline-cli`, platform `cli`).
 * `X-Task-ID` is the per-conversation sticky id (the engine's loader derives it
 * from the DSH session pin, never from `Date.now()`.
 */
function clineCredentialHeaders() {
    return {
        'HTTP-Referer': 'https://cline.bot',
        'X-Title': 'Cline',
        'X-IS-MULTIROOT': 'false',
        'X-CLIENT-TYPE': CLINE_CLIENT_TYPE,
        'X-CLIENT-VERSION': CLINE_CLIENT_VERSION,
        'X-PLATFORM': CLINE_PLATFORM,
        'X-PLATFORM-VERSION': CLINE_CLIENT_VERSION,
        'X-CORE-VERSION': CLINE_CORE_VERSION,
    };
}
/**
 * Identity the CLI sends on catalog, auth, and account calls
 * (`buildClineClientHeaders`). No `X-Task-ID`: those calls are not a
 * conversation, and a fresh id per request would also break the prefix
 * cache the chat path pins.
 */
export function clineIdentityHeaders() {
    return {
        accept: 'application/json',
        'user-agent': CLINE_USER_AGENT,
        ...clineCredentialHeaders(),
    };
}
/** `GET /api/v1/users/me` — envelope-wrapped (`{success, data}`). */
function parseClineUserInfo(payload) {
    const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
        ? payload.data
        : payload;
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return undefined;
    const account = trimmed(data.email) ?? trimmed(data.displayName);
    const planType = trimmed(data.planType ?? data.plan?.name ?? data.plan?.displayName);
    const organizations = Array.isArray(data.organizations) ? data.organizations : [];
    const active = organizations.find((organization) => organization?.active === true);
    if (!account && !planType && !active)
        return undefined;
    return {
        ...(account ? { account } : {}),
        ...(planType ? { planType } : {}),
        ...(trimmed(data.id) ? { userId: trimmed(data.id) } : {}),
        ...(active && trimmed(active.organizationId)
            ? { organizationId: trimmed(active.organizationId), organizationName: trimmed(active.name) }
            : {}),
    };
}
export async function resolveClineIdentity(session, { fetchFn = outboundFetch, signal } = {}) {
    const token = trimmed(session?.accessToken);
    if (!token)
        return undefined;
    try {
        const response = await fetchFn(CLINE_ME_URL, {
            headers: { ...clineIdentityHeaders(), authorization: `Bearer ${clineBearer(session)}` },
            signal,
        });
        if (!response.ok)
            return undefined;
        return parseClineUserInfo(await response.json());
    }
    catch {
        return undefined;
    }
}
export function clineHomePaths({ env = process.env, home = os.homedir() } = {}) {
    const clineHome = trimmed(env.CLINE_HOME) || join(home, '.cline');
    return [join(clineHome, 'data', 'settings', 'providers.json')];
}
/** `/api/v1/users/me/plan` slugs — names taken from the CLI's own provider
 *  entries (`builtins.ts`: "Cline Usage-Billing" / "ClinePass"). */
export const CLINE_PLAN_NAMES = Object.freeze({
    usage_billing: 'Usage-Billing',
    usagebilling: 'Usage-Billing',
    'usage-billing': 'Usage-Billing',
    clinepass: 'ClinePass',
    cline_pass: 'ClinePass',
    'cline-pass': 'ClinePass',
});
export { applyClineCache, clineCacheSessionId, resetClinePins };
