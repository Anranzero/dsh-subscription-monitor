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
import { splitLeadingSystem, systemText, unrelatedPrompt } from '../../utils/system-pin.js';
const SYSTEM_PIN_CAP = 64;
const SYSTEM_PINS = new Map();
export const KIMI_WORK_STABLE_SESSION = 'dsh-kimi-work';
/** A fallback id is not a conversation: it never pins a system prompt. */
export function isKimiWorkFallback(id) {
    return typeof id !== 'string' || id === '' || id === KIMI_WORK_STABLE_SESSION || id.startsWith(`${KIMI_WORK_STABLE_SESSION}:`);
}
export function kimiWorkConversationId(payload = {}) {
    return kimiWorkCacheSessionId(payload.session_id)
        ?? kimiWorkCacheSessionId(payload.prompt_cache_key)
        ?? KIMI_WORK_STABLE_SESSION;
}
export function kimiWorkCacheSessionId(key) {
    if (typeof key !== 'string')
        return undefined;
    const cleaned = key.trim().replace(/[^A-Za-z0-9._:-]/g, '-');
    if (!cleaned)
        return undefined;
    return cleaned.slice(0, 64);
}
export function resetKimiWorkPins() {
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
export function stabilizeKimiWorkSystemPrefix(messages, sessionId) {
    if (!Array.isArray(messages) || isKimiWorkFallback(sessionId))
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
export function applyKimiWorkCache(payload = {}) {
    const cacheSessionId = kimiWorkConversationId(payload);
    const next = { ...payload };
    delete next.prompt_cache_key;
    delete next.prompt_cache_retention;
    delete next.prompt_cache_options;
    delete next.session_id;
    if (Array.isArray(next.messages)) {
        next.messages = stabilizeKimiWorkSystemPrefix(next.messages, cacheSessionId);
    }
    return { payload: next, cacheSessionId };
}
/** The Work gateway has no Codex / Grok / Cline cache-affinity header. */
export function kimiWorkCacheHeaders() {
    return {};
}
