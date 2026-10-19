/**
 * Cline IS the upstream engine (maintainer sign-off 2026-10-18: 全过, 不回退、
 * 不旧兼容). The pinned @magpie-community/opencode-cline-auth drives the
 * WorkOS device sign-in, the single-use refresh rotation (serialized, with the
 * in-memory spent-token holds the package keeps per account), the chat hop
 * (Cline's own header group, the X-Task-ID derived from our session name, the
 * pinUpstream option the package defaults off) and the usage read (me +
 * balance + ClinePass limits). The TS paths it replaced (the register/refresh
 * wire helpers, quota.ts's three reads and parsers, the header factory) are
 * deleted.
 *
 * Division that survives the engine:
 * - the vault: session shape, the flow slot and the save/discover completion,
 *   the read-only CLI import (import.ts) and the identity write-back;
 * - the closed-set catalog (catalog.ts keeps its model-table rows);
 * - the cache strip (cache.ts — DSH fields never ride; the session name rides
 *   the engine's own session header and becomes its X-Task-ID);
 * - the refusal classification (request.ts clineQuotaFailure — proxy
 *   semantics).
 *
 * The package's egress (WorkOS + api.cline.bot) speaks the bare global fetch:
 * both hosts ride the URL-scoped bridge. client.auth.set persists the rotated
 * pair — our write-back client updates the vault row by uid.
 */
import { outboundFetch } from '../../utils/outbound.js';
/** The engine's session header (index.mjs SESSION): how we name the task. */
export declare const CLINE_SESSION_HEADER = "x-magpie-cline-session";
/** The engine's auth shape for one of our stored sessions. */
export declare function engineAuthOf(session: any): {
    type: string;
    access: any;
    refresh: any;
    expires: number;
    uid: any;
    email: any;
    accountId: any;
};
/** A successful authorize/refresh result merged onto a stored session. */
export declare function sessionFromEngineResult(result: any, base?: any): any;
/** Test seam: drop the cached plugin (production never resets). */
export declare function resetClineEnginePlugin(): void;
/**
 * The device sign-in: the engine's authorize drives the WorkOS device flow;
 * its callback polls the token. The flow slot and the completion stay ours
 * (accounts.ts completeClineDevice).
 */
export declare function clineEngineAuthorize({ fetchFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<{
    authorizeUrl: any;
    userCode: any;
    mode: "device";
    settle: () => Promise<any>;
}>;
/**
 * TokenManager refresh: the engine's auth.refresh takes the auth object
 * itself (not a getter — usage/loader do), spends the single-use token once
 * (serialized, held in memory) and reports the changed fields; the manager
 * persists what comes back. A refused refresh carries signIn: 'expired' and
 * is a permanent invalid_grant so the row is reaped.
 */
export declare function refreshClineEngine(session: any, fetchFn?: typeof outboundFetch): Promise<any>;
/**
 * The hop's headersOf: the engine loader sets Cline's whole header group and
 * derives X-Task-ID from its own session header — ours carries the
 * cacheSessionId when it names a conversation (the `dsh-cline` fallback is
 * omitted; the engine then derives from the task formula's own inputs, as
 * the checklist accepted).
 */
export declare function clineEngineHeaders(cacheSessionId: any): Record<string, string>;
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape feeds the engine
 * loader — it re-reads the credential, rotates it when stale, pins/unwraps the
 * body and posts with Cline's own headers.
 */
export declare function clineEngineFetch({ session, fetchFn }?: any): Promise<(url: any, init?: {}) => Promise<any>>;
/**
 * fetchQuota: the engine's usage read (me + balance + ClinePass limits) with
 * its windows already computed — {name, used (0-100), display?}. Dollars map
 * to the prepaid wallet row; percent windows to primary/weekly by span; the
 * balance string and the plan ride along. A limits read that failed while
 * me/balance succeeded (the package's #79 partial design) keeps the rows it
 * read and carries the reason on `error`; only a read with nothing to show
 * still throws.
 */
export declare function fetchClineQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    error?: string | undefined;
    planType: any;
    account: any;
    rows: any[];
}>;
