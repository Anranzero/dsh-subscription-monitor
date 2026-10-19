/**
 * Live Zed picker.
 *
 * Membership + facts both come from `GET cloud.zed.dev/models` with the
 * account's short-lived model token: disabled models are left out, each
 * model's effort levels become its variants (upstream README 模型; index.mjs
 * fetchModels 266-279, parseModels 283-289, entry 301-316).
 *
 * Zed also hosts google models, but their wire is generateContent — outside
 * the DSH api union this plugin speaks — so those rows are filtered out here,
 * not translated (README 模型). A model Zed lists without a window cannot
 * become a picker row (the local catalog requires a real contextWindow) and
 * is left out rather than given invented numbers.
 */
import { type ZedVendor } from './index.js';
export declare const ZED_CATALOG_TTL_MS: number;
/** The vendors whose wire a DSH api can speak; `google` (generateContent) stays out. */
export declare const ZED_PICKABLE_VENDORS: ReadonlySet<ZedVendor>;
export declare function resetZedCatalogCache(): void;
export declare function zedCatalogModels(): readonly any[];
/**
 * A model's effort levels as a DSH-keyed ladder: each level the list names
 * keeps its own spelling as the value (`none` is the `off` key's value, never
 * a key itself — docs/rules.md). A spelling outside the DSH ladder is dropped,
 * not folded into a neighbor.
 */
export declare function zedEffortsOf(levels: unknown): Record<string, string> | undefined;
/** parseModels + entry: what /models lists that this family can serve (index.mjs:283-316). */
export declare function toZedPickerRows(payload: any): any[];
/**
 * fetchModels: mint the token, read GET /models (with the x-ai support flag
 * upstream sends), minting again once when Zed calls the token stale
 * (index.mjs:266-279).
 */
export declare function fetchZedModels(session: any, { fetchFn, signal }?: any): Promise<any[]>;
/** Live refresh behind the family registry: the static floor answers when there is none. */
export declare function refreshZedCatalog(session: any, options?: any): Promise<readonly any[]>;
