/**
 * MiMo prompt cache.
 *
 * The app's server is an implicit prefix cache: the upstream client sends no
 * cache or conversation-affinity field at all — its chat requests carry only
 * the session cookies, `X-Mimo-Source`, `X-Client-Version` and the UA
 * (index.mjs:745-750). There is no Codex `prompt_cache_key`, no Grok
 * `x-grok-conv-id`, and no sticky header to pin. This module strips those
 * foreign DSH fields and parks extra DSH system snapshots at the messages
 * suffix so the first system blob can still hit (the kimi/cline parking
 * discipline, written for this family's own ids).
 * Never stamp Date.now(). `dsh-mimo` is analyzer-only and never pins.
 */
export declare const MIMO_STABLE_SESSION = "dsh-mimo";
/** A fallback id is not a conversation: it never pins a system prompt. */
export declare function isMimoFallback(id: any): boolean;
export declare function mimoConversationId(payload?: any): string;
export declare function mimoCacheSessionId(key: any): string | undefined;
export declare function resetMimoPins(): void;
export declare function stabilizeMimoSystemPrefix(messages: any, sessionId: any): any;
export declare function applyMimoCache(payload?: any): {
    payload: any;
    cacheSessionId: string;
};
/** MiMo does not sticky-route on any HTTP header (index.mjs:745-750). */
export declare function mimoCacheHeaders(): {};
