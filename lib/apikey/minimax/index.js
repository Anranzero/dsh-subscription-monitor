/**
 * MiniMax (platform.minimax.cn) — a plain API key over the OpenAI-compatible
 * Chat Completions API.
 *
 * Auth is `Authorization: Bearer <key>`; the hop is
 * POST https://api.minimax.cn/v1/chat/completions, which is exactly the path
 * DSH posts to `{baseURL}/v1/chat/completions`, so the harness route is
 * `${origin}/minimax`.
 *
 * MiniMax publishes no balance endpoint, so this family carries no quota
 * meters: the card shows the account and says so rather than inventing one.
 */
export const MINIMAX_ORIGIN = 'https://api.minimax.cn';
export const MINIMAX_CHAT_URL = `${MINIMAX_ORIGIN}/v1/chat/completions`;
export const MINIMAX_MODELS_URL = `${MINIMAX_ORIGIN}/v1/models`;
/** API keys do not expire; the store still insists on a finite stamp. */
export const MINIMAX_NEVER_EXPIRES = 8.64e15;
export const MINIMAX_DEFAULT_CONTEXT = 1_000_000;
export const MINIMAX_DEFAULT_MAX_TOKENS = 524_288;
/**
 * DSH picker keys → the wire's `reasoning_effort`. Only MiniMax-M3.1-Flash
 * honours the field; the other rows carry no effort picker at all.
 * Never use a vendor spelling as a key.
 */
export const MINIMAX_REASONING = Object.freeze({
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
});
export const MINIMAX_SOURCES = Object.freeze(['paste', 'env']);
/**
 * Static floor from platform.minimax.cn/docs/api-reference/text-openai-api:
 * M3.1-Flash and M3 take 1M context and up to 512K output; M2.7 is the
 * previous 200K generation. Thinking cannot be disabled on M3.1-Flash, and
 * `reasoning_effort: none` is a 400 there, which is why the effort picker
 * starts at `low`.
 */
export const MINIMAX_MODELS = Object.freeze([
    { id: 'MiniMax-M3.1-Flash', name: 'MiniMax-M3.1-Flash', contextWindow: 1_000_000, maxTokens: 524_288, input: ['text', 'image'], reasoningEfforts: { ...MINIMAX_REASONING } },
    { id: 'MiniMax-M3', name: 'MiniMax-M3', contextWindow: 1_000_000, maxTokens: 524_288, input: ['text', 'image'] },
    { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', contextWindow: 204_800, maxTokens: 204_800, input: ['text'] },
]);
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/** `Bearer …` and stray whitespace are both what a pasted key arrives with. */
export function parseMinimaxApiKey(raw) {
    const key = String(raw ?? '').trim().replace(/^bearer\s+/i, '');
    if (!key)
        throw new Error('MiniMax API key is required');
    return key;
}
export function minimaxSourceLabel(source) {
    return source === 'env' ? 'MINIMAX_API_KEY' : 'API key';
}
export function minimaxSession({ accessToken, account, source = 'paste' } = {}) {
    const key = parseMinimaxApiKey(accessToken);
    return {
        accessToken: key,
        // The key is its own refresh token: there is no rotation endpoint.
        refreshToken: key,
        expiresAt: MINIMAX_NEVER_EXPIRES,
        account: trimmed(account) ?? 'MiniMax',
        source: MINIMAX_SOURCES.includes(source) ? source : 'paste',
    };
}
export function minimaxUpstreamHeaders(session) {
    return {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
    };
}
/**
 * The key never rotates (there is no token endpoint), so the refresh is the
 * identity function and the TokenManager only gates sign-in state.
 */
export async function refreshMinimax(session) {
    if (!session || typeof session.accessToken !== 'string' || !session.accessToken.trim())
        throw new Error('minimax session needs an API key');
    return session;
}
