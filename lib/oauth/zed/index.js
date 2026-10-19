/**
 * Zed subscription (Zed Pro / trial / student / business) — the models Zed
 * hosts (Anthropic's, OpenAI's, xAI's), asked through cloud.zed.dev the way
 * the Zed editor asks them.
 *
 * Pinned attribution: **@magpie-community/opencode-zed-auth 0.1.8**
 * (.local/upstream-magpie/packages/zed, MIT; `index.mjs` line refs below),
 * itself ported from magpie's built-in Zed account, which was read from Zed's
 * source (github.com/zed-industries/zed, 1.23.0). Copy, don't invent:
 *
 * - Sign-in: RSA-2048 key + loopback port; zed.dev/native_app_signin carries
 *   the port and the key's public half; the browser comes back with user_id
 *   and an access_token encrypted to the key (index.mjs:396-445).
 * - The pair `Authorization: <user_id> <access_token>` serves every /client/*
 *   call and lasts until Zed refuses it — Zed has no refresh token
 *   (index.mjs:24-26, 157-169).
 * - POST /client/llm_tokens trades the pair for a short-lived model token,
 *   minted again on a 401 or x-zed-expired-token / x-zed-outdated-token
 *   (index.mjs:216-246, 152).
 * - GET /models lists what the account may call; POST /completions takes
 *   {provider, model, provider_request} and streams newline-delimited JSON,
 *   each line the provider's own stream event or a status (index.mjs:17-21).
 *
 * DSH speaks a closed api union (openai-completions / openai-responses /
 * anthropic-messages), so this family serves the three Zed vendors that match
 * it (anthropic → Messages, open_ai → Responses, x_ai → Completions) on three
 * routes; Zed's google models (generateContent wire) stay out — see README.
 */
import { catalogRows } from '../../catalog/index.js';
import { outboundFetch } from '../../utils/outbound.js';
export const ZED_SITE = 'https://zed.dev';
export const ZED_CLOUD = 'https://cloud.zed.dev';
/** The Zed release the requests say they come from (index.mjs VERSION). */
export const ZED_VERSION = '1.23.0';
export const ZED_SIGN_IN_SUCCEEDED = `${ZED_SITE}/native_app_signin_succeeded`;
/** How long a sign-in waits for the browser (index.mjs SIGN_IN_TIMEOUT). */
export const ZED_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
/** Zed has no refresh token: the stored pair is permanent until Zed refuses it (index.mjs:24-26). */
export const ZED_NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;
/**
 * The TokenManager's refresh hook: an identity no-op, exactly command-code's
 * permanent-key shape (`src/apikey/command-code/index.ts` refreshCommandCode).
 * A sign-in Zed refuses surfaces as the hop's 401, not a refresh loop.
 */
export async function refreshZed(session) {
    if (!session || typeof session.accessToken !== 'string' || !session.accessToken.trim()) {
        throw new Error('zed session needs its access token');
    }
    return session;
}
/** Zed userAgent: Zed/<version> (<os>; <arch>) in Rust's names (index.mjs:66-70). */
export function zedUserAgent() {
    const os = { darwin: 'macos', win32: 'windows' }[process.platform] ?? process.platform;
    const arch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch] ?? process.arch;
    return `Zed/${ZED_VERSION} (${os}; ${arch})`;
}
export function zedUsersMeUrl() {
    return `${ZED_CLOUD}/client/users/me`;
}
export function zedLlmTokensUrl() {
    return `${ZED_CLOUD}/client/llm_tokens`;
}
export function zedModelsUrl() {
    return `${ZED_CLOUD}/models`;
}
export function zedCompletionsUrl() {
    return `${ZED_CLOUD}/completions`;
}
export function zedSignInUrl(port, publicKey, systemId) {
    const query = new URLSearchParams({
        native_app_port: String(port),
        native_app_public_key: publicKey,
        system_id: systemId,
    });
    return `${ZED_SITE}/native_app_signin?${query}`;
}
/** Wire plan slugs → Settings-card labels (index.mjs planName, 199-202). */
export const ZED_PLAN_NAMES = Object.freeze({
    zed_pro: 'Pro',
    zed_pro_trial: 'Pro Trial',
    zed_business: 'Business',
    zed_student: 'Student',
    zed_vip: 'VIP',
    zed_free: 'Free',
    '': 'Free',
});
function parseJson(text) {
    try {
        return JSON.parse(String(text));
    }
    catch {
        return undefined;
    }
}
/**
 * stateOf: the stored sign-in as the wire needs it. Zed has no refresh token,
 * so the vault's `refreshToken` slot carries the rest of the pair's context
 * (user id, machine id, organization, plan) as JSON — exactly the shape
 * magpie keeps in OpenCode's oauth entry (index.mjs:23-27, 207-212).
 */
export function zedStateOf(session) {
    if (!session || typeof session !== 'object')
        return null;
    const access = typeof session.accessToken === 'string' ? session.accessToken : '';
    if (!access)
        return null;
    const rest = parseJson(session.refreshToken ?? '');
    if (!rest || typeof rest !== 'object' || !rest.userId)
        return null;
    return {
        access,
        userId: String(rest.userId),
        systemId: typeof rest.systemId === 'string' ? rest.systemId : '',
        org: typeof rest.org === 'string' ? rest.org : '',
        plan: typeof rest.plan === 'string' ? rest.plan : '',
    };
}
/**
 * cloud(): one /client/* read with the account's pair (index.mjs:157-169) —
 * `Authorization: <user_id> <access_token>`, x-zed-system-id when the sign-in
 * carried one, Zed's own User-Agent.
 */
export async function zedCloud(method, path, state, body, timeoutMs, fetchFn = outboundFetch, signal) {
    const headers = {
        Authorization: `${state.userId} ${state.access}`,
        'Content-Type': 'application/json',
        'User-Agent': zedUserAgent(),
    };
    if (state.systemId)
        headers['x-zed-system-id'] = state.systemId;
    const response = await fetchFn(`${ZED_CLOUD}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(timeoutMs > 0 || signal
            ? { signal: AbortSignal.any([signal, timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined].filter(Boolean)) }
            : {}),
    });
    const text = await response.text();
    if (!response.ok) {
        throw Object.assign(new Error(`Zed: ${zedFailureMessage(response.status, text)} (${response.status})`), {
            status: response.status,
            body: text,
        });
    }
    return text;
}
/** The message in an error body: {code, message} else the body, else the status name (index.mjs:98-109). */
export function zedFailureMessage(status, body) {
    const parsed = parseJson(body);
    if (parsed && typeof parsed === 'object') {
        if (parsed.message)
            return String(parsed.message);
        if (typeof parsed.error === 'string' && parsed.error)
            return parsed.error;
        if (parsed.code)
            return String(parsed.code);
    }
    const text = String(body ?? '').trim();
    if (text && text.length < 500)
        return text;
    if (status === 402)
        return 'payment required: this Zed account has no plan that calls models, or its allowance is used up';
    return STATUS_TEXT[status] ?? String(status);
}
const STATUS_TEXT = {
    400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 408: 'Request Timeout', 429: 'Too Many Requests', 500: 'Internal Server Error',
    501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
    529: 'Service Overloaded',
};
/**
 * stale: a model request was turned away for its model token, which a new one
 * would fix (index.mjs:152).
 */
export function zedTokenStale(status, headers) {
    return status === 401 || !!headers.get('x-zed-expired-token') || !!headers.get('x-zed-outdated-token');
}
// ---- the model token ---------------------------------------------------------
/**
 * Zed mints model tokens for an hour or so and says when one is stale, so
 * none is written down: both maps are in-memory only (index.mjs:216-246).
 */
const modelTokens = new Map();
const minting = new Map();
/** Test isolation: drop every minted token and in-flight mint. */
export function resetZedModelTokens() {
    modelTokens.clear();
    minting.clear();
}
/**
 * modelToken: a live model token for `state`, minted anew when `renew` is set
 * (the last one was refused) or none is kept. POST /client/llm_tokens with the
 * organization the models are called under (index.mjs:223-246).
 */
export async function zedModelToken(state, renew, fetchFn = outboundFetch) {
    const key = `${state.userId} ${state.access}`;
    if (!renew && modelTokens.has(key))
        return modelTokens.get(key);
    if (minting.has(key))
        return minting.get(key);
    const run = (async () => {
        try {
            const text = await zedCloud('POST', '/client/llm_tokens', state, { organization_id: state.org }, 20_000, fetchFn);
            const token = parseJson(text)?.token;
            if (!token)
                throw new Error('Zed: no model token in the reply');
            modelTokens.set(key, token);
            return token;
        }
        catch (error) {
            modelTokens.delete(key);
            throw error;
        }
    })();
    minting.set(key, run);
    try {
        return await run;
    }
    finally {
        minting.delete(key);
    }
}
/**
 * Offline floor (the rows before the account's own list is read): Zed's hosted
 * families, one model each — every parameter from index.mjs:56-63. The google
 * row (gemini-3.5-flash) stays out: DSH has no generateContent api. Effort
 * ladders are omitted — the offline table names no levels and none are
 * invented; the live /models read carries them.
 *
 * The `zed` key of src/catalog/models.json (and its CATALOG_KEYS closure) is
 * registry-owned shared wiring: until it lands, the same pinned five rows
 * keep this module loadable and testable standalone; once the key exists the
 * file wins (test/zed.test.ts pins both to this table so they cannot drift).
 */
const ZED_FLOOR_ROWS = Object.freeze([
    Object.freeze({ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', vendor: 'anthropic', contextWindow: 1000000, maxTokens: 64000, input: Object.freeze(['text', 'image']) }),
    Object.freeze({ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', vendor: 'anthropic', contextWindow: 1000000, maxTokens: 128000, input: Object.freeze(['text', 'image']) }),
    Object.freeze({ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', vendor: 'anthropic', contextWindow: 200000, maxTokens: 64000, input: Object.freeze(['text', 'image']) }),
    Object.freeze({ id: 'gpt-5.5', name: 'GPT-5.5', vendor: 'open_ai', contextWindow: 400000, maxTokens: 128000, input: Object.freeze(['text', 'image']) }),
    Object.freeze({ id: 'grok-4.7', name: 'Grok 4.7', vendor: 'x_ai', contextWindow: 500000, maxTokens: 64000, input: Object.freeze(['text', 'image']) }),
]);
export const ZED_MODELS = (() => {
    try {
        return catalogRows('zed');
    }
    catch {
        return ZED_FLOOR_ROWS;
    }
})();
