/**
 * WorkBuddy prompt cache — the DSH side of it.
 *
 * WorkBuddy has no Codex-style `prompt_cache_key` wire field; the backend
 * keeps an implicit prefix cache (usage answers prompt_cache_hit_tokens /
 * prompt_cache_miss_tokens). This module strips the DSH cache fields and
 * parks extra DSH system snapshots at the messages suffix (Kimi's trick, on
 * the shared text helpers of utils/system-pin).
 *
 * The conversation's four headers (X-Conversation-ID, -Request-ID, -Message-
 * ID = X-Request-ID) are the ENGINE's to derive now (sign-off 2026-10-18:
 * 四会话头随上游): the hop passes the engine's session header carrying this
 * cacheSessionId (engine.ts workbuddyEngineHeaders), and the engine's
 * attend() derives the ids from it and the body — salted per process, as
 * upstream. Our part is only naming the conversation: a fallback id is not
 * one, so it is omitted and the engine falls back to the first user
 * message's signature, exactly as our derivation did before.
 *
 * Never stamp Date.now() in any of these. The fallback `dsh-workbuddy[-ai]`
 * is analyzer-visible only and never pins.
 */
import { splitLeadingSystem, systemText, unrelatedPrompt } from '../../utils/system-pin.js';
const SYSTEM_PIN_CAP = 64;
const SYSTEM_PINS = new Map();
export const WORKBUDDY_STABLE_SESSION = 'dsh-workbuddy';
export const WORKBUDDY_AI_STABLE_SESSION = 'dsh-workbuddy-ai';
/** The analyzer-visible fallback constant of one build (never pins). */
export function workbuddyStableSession(site) {
    return site.ai ? WORKBUDDY_AI_STABLE_SESSION : WORKBUDDY_STABLE_SESSION;
}
/** A fallback id is not a conversation: it never pins a system prompt. */
export function isWorkbuddyFallback(site, id) {
    const stable = workbuddyStableSession(site);
    return typeof id !== 'string' || id === '' || id === stable || id.startsWith(`${stable}:`);
}
export function workbuddyCacheSessionId(key) {
    if (typeof key !== 'string')
        return undefined;
    const cleaned = key.trim().replace(/[^A-Za-z0-9._:-]/g, '-');
    if (!cleaned)
        return undefined;
    return cleaned.slice(0, 64);
}
export function resetWorkbuddyPins() {
    SYSTEM_PINS.clear();
}
/**
 * Read a pin and mark it most recently used. Map order is recency, so the
 * cap drops the idlest conversation, never one that is still sending steps.
 * Pins key on the build too: one DSH session may hop both builds, and each
 * build's upstream prefix cache is its own.
 */
function usePin(key) {
    const pin = SYSTEM_PINS.get(key);
    if (pin === undefined)
        return undefined;
    SYSTEM_PINS.delete(key);
    SYSTEM_PINS.set(key, pin);
    return pin;
}
export function stabilizeWorkbuddySystemPrefix(messages, site, sessionId) {
    if (!Array.isArray(messages) || isWorkbuddyFallback(site, sessionId))
        return messages;
    const { head, rest } = splitLeadingSystem(messages);
    if (head.length === 0)
        return messages;
    const text = head.map(systemText).join('\n\n');
    const key = `${site.id}:${sessionId}`;
    const existing = usePin(key);
    if (existing === undefined) {
        if (SYSTEM_PINS.size >= SYSTEM_PIN_CAP) {
            const first = SYSTEM_PINS.keys().next().value;
            SYSTEM_PINS.delete(first);
        }
        SYSTEM_PINS.set(key, { head, text });
        return messages;
    }
    // A different prompt on the same id is its own request: re-pin, send as-is.
    if (unrelatedPrompt(existing.text, text)) {
        SYSTEM_PINS.set(key, { head, text });
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
/**
 * Strip the DSH cache fields and park the system prefix. cacheSessionId
 * falls back to the family constant (analyzer-visible); the engine derives
 * the conversation ids from it — or, for a fallback, from the body.
 */
export function applyWorkbuddyCache(site, payload = {}) {
    const cacheSessionId = workbuddyCacheSessionId(payload.session_id)
        ?? workbuddyCacheSessionId(payload.prompt_cache_key)
        ?? workbuddyStableSession(site);
    const next = { ...payload };
    delete next.prompt_cache_key;
    delete next.prompt_cache_retention;
    delete next.prompt_cache_options;
    delete next.session_id;
    if (Array.isArray(next.messages)) {
        next.messages = stabilizeWorkbuddySystemPrefix(next.messages, site, cacheSessionId);
    }
    return { payload: next, cacheSessionId };
}
