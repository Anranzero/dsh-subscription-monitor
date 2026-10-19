/**
 * WorkBuddy IS the upstream engine (maintainer sign-off 2026-10-18: 全过,
 * 不回退、不旧兼容). The pinned @magpie-community/opencode-workbuddy-auth
 * drives the browser sign-in, the desktop reference import, the token
 * refresh, the chat hop and the usage read for BOTH builds — one package,
 * two named exports (WorkBuddyAuthPlugin / WorkBuddyAIAuthPlugin). The TS
 * wire paths it replaced are deleted; a load/contract/download failure
 * fails the operation with the engine's error.
 *
 * Division that survives the engine (rules.md):
 * - the vault's session shape and lifecycle (accounts.ts saves what the
 *   engine's authorize callbacks hand back; desktop sign-ins store a
 *   REFERENCE — source + uid + placeholder tokens — because the engine
 *   re-reads the desktop file itself on every hop, never a copy);
 * - the closed-set catalog (catalog.ts keeps the /v3/config read; the
 *   engine's provider.models speaks magpie's row shape, which we don't
 *   adopt — rows are the curator's domain, docs/models.md);
 * - the DSH→OpenAI dialect rewrites (request.ts) and the cache strip +
 *   system-prefix parking (cache.ts): the engine's loader then applies its
 *   own fit (tools, unflag, leading system) on top;
 * - the conversation ids: ours to NAME (the session header carries the
 *   cacheSessionId), the engine's to derive (attend()'s four heads —
 *   salted per process now, the sign-off's approved reversal).
 *
 * The package takes no fetchImpl: every egress speaks the bare global
 * fetch, so the adapter registers both sites' endpoint hosts with the
 * URL-scoped engine bridge (upstream-engine/bridge.ts) — engine traffic
 * rides outboundFetch, everything else keeps the original global fetch.
 */
import { type WorkbuddySite } from './index.js';
import { outboundFetch } from '../../utils/outbound.js';
/** The engine's own session header (index.mjs SESSION): how we name the chat. */
export declare const WORKBUDDY_SESSION_HEADER = "x-magpie-workbuddy-session";
/** A desktop reference row carries no credential; the vault wants strings. */
export declare const WORKBUDDY_PLACEHOLDER = "workbuddy-desktop-reference";
/** The engine's auth shape for one of our stored sessions. */
export declare function engineAuthOf(site: WorkbuddySite, session: any): Record<string, unknown>;
/** A successful authorize/refresh result merged onto a stored session. */
export declare function sessionFromEngineLogin(site: WorkbuddySite, result: any, base?: any): any;
/** One build's engine plugin, built once per data dir with our host seams. */
export declare function workbuddyEnginePlugin(site: WorkbuddySite, { fetchFn }?: any): Promise<{
    plugin: any;
    version: string;
}>;
/** Test seam: drop the cached plugin instances (production never resets). */
export declare function resetWorkbuddyEnginePlugin(): void;
/**
 * The hop's headersOf: the session header names the chat for the engine's
 * attend() derivation. A fallback id is not a conversation — it is omitted,
 * and the engine then derives from the first user message, as before.
 */
export declare function workbuddyEngineHeaders(site: WorkbuddySite, cacheSessionId: any): Record<string, string>;
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape is the engine
 * loader's string-input path — it strips the caller's auth headers, keeps the
 * session header for its id derivation, sets the full WorkBuddy sign group,
 * fits the body (tools, unflag, leading system) and wraps the answer.
 */
export declare function workbuddyEngineFetch(site: WorkbuddySite, { session, fetchFn }?: any): Promise<(url: any, init?: {}) => Promise<any>>;
/**
 * TokenManager refresh. A browser session asks the engine's auth.refresh
 * (one-time rotation held engine-side; a changed-fields answer merges onto
 * the stored row) — its failures run through translateEngineError, so the
 * dead-grant wordings (a plainly signed-out account, a bare no-token answer,
 * a structured 401) land as a permanent failure that reaps the row instead
 * of replaying the dead exchange on every request. A desktop reference
 * never refreshes over the wire: the engine re-reads the file per hop, so
 * this only verifies the file is still readable and still this account — a
 * missing/switched file is a permanent 401, and the row is reaped instead
 * of looping.
 */
export declare function refreshWorkbuddyEngine(site: WorkbuddySite, session: any, fetchFn?: typeof outboundFetch): Promise<any>;
/**
 * fetchQuota: the engine's usage read (summary meter, enterprise fallback,
 * free-model exemptions — all engine-side now) mapped onto this repo's
 * quota-card rows. plan rides along for the identity write-back.
 */
export declare function fetchWorkbuddySiteQuotaEngine(site: WorkbuddySite, session: any, fetchFn?: typeof outboundFetch): Promise<{
    planType: any;
    rows: any;
}>;
export declare function fetchWorkbuddyQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    planType: any;
    rows: any;
}>;
export declare function fetchWorkbuddyAiQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    planType: any;
    rows: any;
}>;
/**
 * The browser sign-in start: the engine's authorize mints the sign-in page
 * (its callback is the poll). The flow slot, save/discover completion and
 * catalog notification stay ours (accounts.ts completeWorkbuddyBrowser).
 */
export declare function workbuddyEngineAuthorizeBrowser(site: WorkbuddySite, { fetchFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<{
    authorizeUrl: any;
    mode: "browser";
    settle: () => Promise<any>;
}>;
/**
 * The desktop import: the engine's desktop method returns the reference
 * (source + uid + display name) — the tokens stay in the app's file, which
 * the engine re-reads itself on every hop. Nothing is copied, ever.
 */
export declare function workbuddyEngineAuthorizeDesktop(site: WorkbuddySite, { fetchFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<any>;
