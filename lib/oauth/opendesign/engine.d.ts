/**
 * Open Design IS the upstream engine (maintainer sign-off 2026-10-18: 全过,
 * 不回退、不旧兼容). The pinned @magpie-community/opencode-opendesign-auth
 * drives the CLI device sign-in and the control-plane usage read; the hop's
 * wire facts (base URL, runtime key, the package's own UA) come from its
 * loader. The TS device poll and the three-read quota it replaced are
 * deleted.
 *
 * Division that survives the engine:
 * - the vault: session shape, the pasted-key sign-in (a vault-domain input —
 *   the package's own method[1] is magpie's key prompt, not ours), identity
 *   write-back. The two keys never expire and there is no refresh endpoint —
 *   refreshOpendesign stays a no-op;
 * - the closed-set catalog (catalog.ts keeps the /models read at the runtime
 *   key; the engine's provider.models speaks magpie's row shape);
 * - the cache strip (cache.ts) and the DSH dialect rewrites — none needed on
 *   this native Completions wire.
 *
 * The package's egress (device start/poll, the control-plane reads) speaks
 * the bare global fetch: both endpoint hosts ride the URL-scoped bridge.
 */
import { outboundFetch } from '../../utils/outbound.js';
/** The engine's auth shape for one of our stored sessions. */
export declare function engineAuthOf(session: any): {
    type: string;
    access: string;
    control: string;
};
/**
 * The UA the package's own api() sends — `opencode-opendesign-auth/<v>` with
 * the loaded package's version, so a dist-tag bump moves the UA with it. The
 * audited seed answers before the first load.
 */
export declare function opendesignEngineUserAgent(): string;
/** The engine plugin, built once per data dir (the factory takes no host surface at all). */
export declare function opendesignEnginePlugin({ fetchFn }?: any): Promise<{
    plugin: any;
    version: string;
}>;
/** Test seam: drop the cached plugin (production never resets). */
export declare function resetOpendesignEnginePlugin(): void;
/**
 * The device sign-in: the engine's authorize mints the activation page and
 * its callback is the poll. The flow slot, the save/discover completion and
 * the catalog notification stay ours (accounts.ts completeOpendesignDevice).
 */
export declare function opendesignEngineAuthorize({ fetchFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<{
    authorizeUrl: any;
    userCode: any;
    mode: "device";
    settle: () => Promise<any>;
}>;
/**
 * The hop's wire facts from the engine loader: the link base URL, the runtime
 * key it accepts and the package's own UA. Our forward() posts Completions
 * there — the loader has no fetch of its own (the host client owns the wire).
 */
export declare function opendesignEngineHop({ session, fetchFn }?: any): Promise<{
    baseURL: any;
    apiKey: any;
    userAgent: string;
}>;
/**
 * fetchQuota: the engine's usage read (workspace → preflight → summary) with
 * its windows already computed — {name, used (%, one decimal), span (s),
 * resetsAt, display}, shortest first. A pasted-key session has no control
 * key: empty rows, not an error (the control plane takes no API key). The
 * engine's signIn:"expired" (the key was revoked) reads as a permanent 401.
 */
export declare function fetchOpendesignQuotaEngine(session: any, fetchFn?: typeof outboundFetch): Promise<{
    account: any;
    rows: never[];
    planType?: undefined;
} | {
    planType: any;
    rows: any;
    account?: undefined;
}>;
