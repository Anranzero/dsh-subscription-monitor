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
import { splitLeadingSystem, systemText, unrelatedPrompt } from '../../utils/system-pin.js';
const SYSTEM_PIN_CAP = 64;
const SYSTEM_PINS = new Map();
export const MIMO_STABLE_SESSION = 'dsh-mimo';
/** A fallback id is not a conversation: it never pins a system prompt. */
export function isMimoFallback(id) {
    return typeof id !== 'string' || id === '' || id === MIMO_STABLE_SESSION || id.startsWith(`${MIMO_STABLE_SESSION}:`);
}
export function mimoConversationId(payload = {}) {
    return mimoCacheSessionId(payload.session_id)
        ?? mimoCacheSessionId(payload.prompt_cache_key)
        ?? MIMO_STABLE_SESSION;
}
export function mimoCacheSessionId(key) {
    if (typeof key !== 'string')
        return undefined;
    const cleaned = key.trim().replace(/[^A-Za-z0-9._:-]/g, '-');
    if (!cleaned)
        return undefined;
    return cleaned.slice(0, 64);
}
export function resetMimoPins() {
    SYSTEM_PINS.clear();
}
/**
 * Read a pin and mark it most recently used. Map order is recency, so the
 * cap drops the idlest conversation, never one that is still sending steps.
 */
function usePin(key) {
    const pin = SYSTEM_PINS.get(key);
    if (pin === undefined)
        return undefined;
    SYSTEM_PINS.delete(key);
    SYSTEM_PINS.set(key, pin);
    return pin;
}
export function stabilizeMimoSystemPrefix(messages, sessionId) {
    if (!Array.isArray(messages) || isMimoFallback(sessionId))
        return messages;
    const { head, rest } = splitLeadingSystem(messages);
    if (head.length === 0)
        return messages;
    const text = head.map(systemText).join('\n\n');
    const existing = usePin(sessionId);
    if (existing === undefined) {
        if (SYSTEM_PINS.size >= SYSTEM_PIN_CAP) {
            const first = SYSTEM_PINS.keys().next().value;
            SYSTEM_PINS.delete(first);
        }
        SYSTEM_PINS.set(sessionId, { head, text });
        return messages;
    }
    // A different prompt on the same id is its own request: re-pin, send as-is.
    if (unrelatedPrompt(existing.text, text)) {
        SYSTEM_PINS.set(sessionId, { head, text });
        return messages;
    }
    let extra = '';
    if (text !== existing.text) {
        extra = text.startsWith(existing.text)
            ? text.slice(existing.text.length).replace(/^\n+/, '').trim()
            : text;
    }
    const parked = extra ? [{ role: 'system', content: extra }] : [];
    return [...existing.head, ...rest, ...parked];
}
export function applyMimoCache(payload = {}) {
    const cacheSessionId = mimoConversationId(payload);
    const next = { ...payload };
    delete next.prompt_cache_key;
    delete next.prompt_cache_retention;
    delete next.prompt_cache_options;
    delete next.session_id;
    if (Array.isArray(next.messages)) {
        next.messages = stabilizeMimoSystemPrefix(next.messages, cacheSessionId);
    }
    return { payload: next, cacheSessionId };
}
/** MiMo does not sticky-route on any HTTP header (index.mjs:745-750). */
export function mimoCacheHeaders() {
    return {};
}
