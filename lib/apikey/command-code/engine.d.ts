/**
 * Command Code IS the upstream engine (maintainer sign-off 2026-10-18:
 * 全过, 不回退、不旧兼容). The pinned @magpie-community/opencode-commandcode-auth
 * drives the Studio browser sign-in (POST+CORS loopback on a random port),
 * the plan-aware hop (Provider API passthrough for paid plans, /alpha/generate
 * with the CLI's JSONL protocol for Go keys, GO_NO_API self-detection) and
 * the allowance read (billing/subscriptions + billing/credits). The TS paths
 * it replaced (transport.ts's JSONL hop, request.ts's wire mapping, quota.ts's
 * four reads) are deleted.
 *
 * Division that survives the engine:
 * - the vault: key session shape, paste/env/CLI-file imports (copy-only —
 *   metadata.cli is never set, so the engine's liveKey never re-reads
 *   ~/.commandcode/auth.json), the whoami identity write-back;
 * - the closed-set catalog (catalog.ts — the engine's plan-trimmed
 *   provider.models list is NOT adopted, checklist item 4's exemption);
 * - the strip-only cache (cache.ts — the engine's Go body has no threadId);
 * - the refusal classification (failure.ts commandCodeFailure — proxy
 *   semantics; reads both the raw Provider body and the engine's
 *   normalized {error:{message}} answers).
 *
 * The package's egress (api.commandcode.ai) speaks the bare global fetch —
 * the host rides the URL-scoped bridge. client.auth.set persists the plan
 * the usage read saw — our write-back client updates the vault row by key.
 */
import { outboundFetch } from '../../utils/outbound.js';
/**
 * The engine's auth shape for one of our stored sessions. The key is the
 * whole credential (type 'api'); metadata.plan is the DISPLAY name the
 * engine matches ('Go', 'Pro'…) and planId the vault's id form.
 */
export declare function engineAuthOf(session: any): {
    metadata?: {
        plan: any;
        planId: any;
    } | undefined;
    type: string;
    key: any;
};
/** A successful sign-in result merged onto a vault session. */
export declare function sessionFromEngineResult(result: any, base?: any): any;
/** Test seam: drop the cached plugin (production never resets). */
export declare function resetCommandCodeEnginePlugin(): void;
/**
 * The Studio browser sign-in: the engine starts its own loopback server
 * (POST+CORS, random port) and Studio posts the key straight to it —
 * settle IS the finished session material (whoami ran inside the engine).
 */
export declare function commandCodeEngineAuthorize({ fetchFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<{
    authorizeUrl: any;
    mode: "browser";
    settle: () => Promise<any>;
}>;
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape feeds the engine
 * loader — it signs both header ways, routes Go keys to /alpha/generate (CLI
 * JSONL translation inside) and passes everything else through the Provider
 * API as it came.
 */
export declare function commandCodeEngineFetch({ session, fetchFn }?: any): Promise<(url: any, init?: {}) => Promise<any>>;
/**
 * fetchQuota: the engine's allowance read (billing/subscriptions +
 * billing/credits) with its windows already computed — {name, used (0-100),
 * span?, display?, resetsAt?} plus plan/until/renew, or a bare balance when
 * the key has no plan. The plan the read saw is written back by the engine
 * itself (our client persists planId onto the vault row).
 */
export declare function fetchCommandCodeQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    planType: string | undefined;
    rows: any[];
}>;
