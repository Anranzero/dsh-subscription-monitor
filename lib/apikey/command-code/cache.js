/**
 * Command Code cache strip. The engine's Go body carries no threadId — the
 * CLI's per-conversation uuid was dropped with the 1.72.2 wire the package
 * speaks (checklist item 2, accepted: cache-prefix affinity resets once), so
 * what stays ours is only the field hygiene: never send Codex/Grok/Cursor
 * or OpenAI sampling fields the wire doesn't take.
 */
/**
 * Strip DSH/OpenAI fields upstream does not understand. Returns the
 * rewritten payload; cacheSessionId is the cleaned DSH conversation key
 * (logging affinity only — nothing rides the wire as an id any more).
 */
export function applyCommandCodeCache(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return { payload, cacheSessionId: undefined };
    }
    const next = { ...payload };
    const explicit = [next.prompt_cache_key, next.session_id]
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .find((v) => v.length > 0);
    const cacheSessionId = explicit
        ? explicit.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 64) || undefined
        : undefined;
    for (const key of [
        'prompt_cache_key',
        'session_id',
        'prompt_cache_retention',
        'prompt_cache_options',
        'cache_control',
        'service_tier',
        'store',
        'user',
        'metadata',
        'parallel_tool_calls',
        'logprobs',
        'top_logprobs',
        'logit_bias',
        'n',
        'seed',
        'stream_options',
        'response_format',
        'frequency_penalty',
        'presence_penalty',
        'stop',
    ]) {
        delete next[key];
    }
    return { payload: next, cacheSessionId };
}
