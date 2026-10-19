/**
 * Kimi Work prompt cache.
 *
 * The Work gateway is the same `/coding/v1` OpenAI-Completions wire as Kimi
 * Code: no Codex `prompt_cache_key` field, no Grok `x-grok-conv-id` header —
 * the backend keeps an implicit prefix cache over the leading system +
 * history. The upstream kimi-work package leaves the body untouched (its
 * caller keeps instructions stable); DSH re-sends growing system snapshots,
 * so this module strips the DSH cache fields and parks those snapshots at
 * the messages suffix (the Kimi family's own trick on the shared text
 * helpers of utils/system-pin) so the first system blob can still hit.
 * Never stamp Date.now(). `dsh-kimi-work` is analyzer-visible only.
 */
export declare const KIMI_WORK_STABLE_SESSION = "dsh-kimi-work";
/** A fallback id is not a conversation: it never pins a system prompt. */
export declare function isKimiWorkFallback(id: any): boolean;
export declare function kimiWorkConversationId(payload?: any): string;
export declare function kimiWorkCacheSessionId(key: any): string | undefined;
export declare function resetKimiWorkPins(): void;
export declare function stabilizeKimiWorkSystemPrefix(messages: any, sessionId: any): any;
export declare function applyKimiWorkCache(payload?: any): {
    payload: any;
    cacheSessionId: string;
};
/** The Work gateway has no Codex / Grok / Cline cache-affinity header. */
export declare function kimiWorkCacheHeaders(): {};
