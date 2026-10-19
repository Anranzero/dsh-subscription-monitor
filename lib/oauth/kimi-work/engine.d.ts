/**
 * Kimi Work IS the upstream engine (maintainer ruling 2026-10-18: 全过签核,
 * 不回退、不旧兼容). The pinned @magpie-community package drives the login
 * probe, the chat hop and the usage read; the TS implementation it replaced
 * is deleted. A load/contract/download failure fails the operation with the
 * engine's error — there is no fallback lane anymore.
 *
 * What stays ours regardless: session shape and vault, catalog rows and
 * closed sets, cache/session affinity (kimi-work/cache.ts — the engine
 * rewrites neither bodies nor ids), and the login/import lifecycle wiring.
 */
import { outboundFetch } from '../../utils/outbound.js';
/** The membership window's own name (upstream usage window, index.mjs:132-134). */
export declare const KIMI_WORK_ALLOWANCE_LABEL = "\u4F1A\u5458\u5171\u4EAB\u989D\u5EA6";
/** The engine plugin for one data dir, built once with our fetch/session injection and contract-checked. */
export declare function kimiWorkEnginePlugin({ fetchFn }?: any): Promise<{
    plugin: any;
    version: string;
}>;
/** Test seam: drop the cached plugin instances (production never resets). */
export declare function resetKimiWorkEnginePlugin(): void;
/** The hop's headersOf: the engine sets its own auth surface; ours is the accept line only. */
export declare function kimiWorkEngineHeaders(): {
    accept: string;
};
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` call shape is exactly
 * the engine loader's string-input path (kimi-work index.mjs:103-118) — it
 * strips the caller's auth headers, re-reads the desktop file and posts to
 * the one Work-gateway endpoint; anything it throws is translated so
 * 401-refresh / transport-retry semantics stay the proxy's.
 */
export declare function kimiWorkEngineFetch({ session, fetchFn }?: any): Promise<(url: any, init?: {}) => Promise<any>>;
/**
 * The login probe: the upstream authorize callback reads the desktop file
 * and proves the Work credential against /models (kimi-work
 * index.mjs:89-100), returning the account reference the save tail stores.
 */
export declare function kimiWorkEngineAuthorize({ fetchFn }?: any): Promise<{
    uid: any;
}>;
/**
 * fetchQuota: the engine's membership parse (kimi-work index.mjs:128-135)
 * mapped onto this repo's quota-card row — one shared-allowance window,
 * used 0-100, no invented reset time.
 */
export declare function fetchKimiWorkQuota(session: any, fetchFn?: typeof outboundFetch): Promise<{
    rows: {
        key: string;
        kind: string;
        product: string;
        usedPercent: number;
        remainingPercent: number;
    }[];
}>;
