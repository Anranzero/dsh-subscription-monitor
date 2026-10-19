/**
 * Zed IS the upstream engine (maintainer sign-off 2026-10-18: 全过, 不回退、
 * 不旧兼容). The pinned @magpie-community/opencode-zed-auth drives Zed's own
 * RSA-loopback sign-in (keypair, native_app_signin page, state-checked
 * callback, the /me read), the model-token minting and staleness retry, the
 * three-wire hop (provider envelope, vendor mapping, per-wire event
 * translation — its answer arrives in the wire's native dialect), and the
 * plan usage read. The TS paths it replaced (transport.ts, request.ts's
 * event machinery, quota.ts's /me read, the RSA login in accounts.ts) are
 * deleted.
 *
 * Division that survives the engine:
 * - the vault: session shape (access + the refresh JSON carrier — the same
 *   shape the engine's stateOf reads), the flow slot, the save/discover
 *   completion and the identity write-back (accounts.ts);
 * - the closed-set catalog (catalog.ts keeps its /models read at the
 *   account's pair);
 * - the cache strip (cache.ts — DSH fields never ride into provider_request);
 * - refresh stays an identity no-op: the stored pair never expires, and the
 *   model token the hop mints per call is the thing that can go stale — the
 *   engine handles that itself.
 *
 * The package's egress speaks the bare global fetch: cloud.zed.dev rides the
 * URL-scoped bridge. The factory takes {client} for one thing — usage's plan
 * save — which our write-back client answers by updating the vault row.
 */
import type { ServerResponse } from 'node:http';
import { outboundFetch } from '../../utils/outbound.js';
/** The engine's auth shape for one of our stored sessions (the refresh field is the JSON carrier both sides read). */
export declare function engineAuthOf(session: any): {
    type: string;
    access: any;
    refresh: any;
    accountId: any;
};
/** The engine plugin, built once per data dir. */
export declare function zedEnginePlugin({ fetchFn }?: any): Promise<{
    plugin: any;
    version: string;
}>;
/** Test seam: drop the cached plugin (production never resets). */
export declare function resetZedEnginePlugin(): void;
/**
 * The browser sign-in: the engine's authorize generates the RSA keypair,
 * brings its loopback server up and hands back the native_app_signin URL;
 * its callback decrypts the token and reads /me. The flow slot and the
 * save/discover completion stay ours (accounts.ts).
 */
export declare function zedEngineAuthorize({ fetchFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<{
    authorizeUrl: any;
    mode: "browser";
    settle: () => Promise<{
        planType?: string | undefined;
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        account: any;
        source: string;
    }>;
}>;
/**
 * The hop: the engine loader takes the wire's native-dialect body and URL,
 * mints the model token, wraps the provider envelope and translates the
 * stream back to the wire's own events — the answer is piped as-is. The
 * package's own /completions fetch carries only the caller's signal, so the
 * family timers are enforced here, exactly like every other hop: the engine
 * call and the pipe run inside `upstreamRequest` (first-byte / pre-output
 * budget / idle once data flows; a stall answers 504 before the head and
 * destroys the response after it).
 */
export declare function forwardZedEngine(response: ServerResponse, { wire, payload, stream, session, fetchFn, signal, startedAt, timeouts }: any): Promise<void>;
/**
 * fetchQuota: the engine's usage read (GET /client/users/me at the account's
 * pair) gives the plan display name, the period's end and the overdue-invoice
 * error. Zed reports no spend windows — no rows, exactly as before.
 */
export declare function fetchZedQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    planType: any;
    rows: never[];
}>;
