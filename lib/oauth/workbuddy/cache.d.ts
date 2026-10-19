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
import type { WorkbuddySite } from './index.js';
export declare const WORKBUDDY_STABLE_SESSION = "dsh-workbuddy";
export declare const WORKBUDDY_AI_STABLE_SESSION = "dsh-workbuddy-ai";
/** The analyzer-visible fallback constant of one build (never pins). */
export declare function workbuddyStableSession(site: WorkbuddySite): "dsh-workbuddy" | "dsh-workbuddy-ai";
/** A fallback id is not a conversation: it never pins a system prompt. */
export declare function isWorkbuddyFallback(site: WorkbuddySite, id: any): boolean;
export declare function workbuddyCacheSessionId(key: any): string | undefined;
export declare function resetWorkbuddyPins(): void;
export declare function stabilizeWorkbuddySystemPrefix(messages: any, site: WorkbuddySite, sessionId: any): any;
/**
 * Strip the DSH cache fields and park the system prefix. cacheSessionId
 * falls back to the family constant (analyzer-visible); the engine derives
 * the conversation ids from it — or, for a fallback, from the body.
 */
export declare function applyWorkbuddyCache(site: WorkbuddySite, payload?: any): {
    payload: any;
    cacheSessionId: string;
};
