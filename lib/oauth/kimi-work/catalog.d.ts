/**
 * Kimi Work's live model catalog. GET https://agent-gw.kimi.com/coding/v1/models
 * with the Work credential after login; the static floor in
 * src/catalog/models.json ("kimi-work") answers until then.
 *
 * Payload shape (upstream modelRows + the checked redacted catalog):
 * `{data: [{id, display_name, context_length, supports_image_in,
 * supports_reasoning, reasoningEffortOptions: [{effort:
 * "REASONING_EFFORT_LOW" | …}]}], has_more}`. The server lists the plan's XL
 * context; the standard window (262144) is the cap, and the output limit is
 * the gateway's own 32768. Every advertised effort value is retained — only
 * spellings that map onto a DSH level; anything else is dropped, not guessed.
 */
export declare const KIMI_WORK_CATALOG_TTL_MS: number;
export declare function resetKimiWorkCatalogCache(): void;
export declare function kimiWorkCatalogModels(): readonly any[];
/** `GET /coding/v1/models` → picker rows, with the upstream's own catalog guards. */
export declare function toKimiWorkPickerModels(payload: any): any[];
/** One raw read of the live catalog for this session's desktop credentials. */
export declare function fetchKimiWorkCatalogRows(session: any, { fetchFn, signal }?: any): Promise<any[] | null>;
export declare function refreshKimiWorkCatalog(session: any, options?: any): Promise<readonly any[]>;
