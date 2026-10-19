/**
 * Zed prompt cache.
 *
 * Zed's /completions wire has no cache-affinity field: the envelope is
 * {provider, model, provider_request} and the cloud keeps its own implicit
 * prefix cache (upstream index.mjs sends no session or cache key on any of
 * its wires — the only field it ever deletes is the AI SDK google package's
 * own `session_id`, index.mjs:502-507, which DSH never sends). So this
 * module's whole job is the DSH side: strip the host's cache fields before
 * the body is wrapped into `provider_request`, and name the request for the
 * analyzer with the family's fallback constant. Never import another
 * family's cache helper; never stamp Date.now()/random (docs/rules.md).
 */
/** Analyzer-visible fallback constant — not a conversation, never pins. */
export declare const ZED_STABLE_SESSION = "dsh-zed";
/** A cleaned DSH session id (≤64, [^A-Za-z0-9._:-] → '-'), undefined when there is none. */
export declare function zedCacheSessionId(key: unknown): string | undefined;
/**
 * applyZedCache: strip the DSH cache fields (the completions wire's
 * session_id / prompt_cache_key / prompt_cache_retention / prompt_cache_options
 * — the anthropic metadata.user_id field is Anthropic's own telemetry and
 * passes through as the vendor's body) and fall back to `dsh-zed`.
 */
export declare function applyZedCache(payload?: any): {
    payload: any;
    cacheSessionId: string;
};
