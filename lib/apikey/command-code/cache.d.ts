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
export declare function applyCommandCodeCache(payload: any): {
    payload: any;
    cacheSessionId: string | undefined;
};
