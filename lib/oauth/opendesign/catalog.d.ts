/**
 * Live Open Design picker. GET https://amr-link.open-design.ai/v1/models at
 * the signed-in account's runtime key after login —「Nothing is listed per
 * account at request time from anywhere but the vendor」（上游 README:58-63）。
 * OPENDESIGN_MODELS 是离线 fallback。
 *
 * 行字段出处（上游 facts()，index.mjs:333-345 + refresh-models.mjs:67-87）：
 * - `contextWindow` ← `metadata.context_limit`
 * - `maxTokens` ← `metadata.context_budget`
 * - `input` ← `architecture.input_modalities` 去掉 text（本仓再收窄到
 *   text|image：audio / video / file 一律剥）
 * - `rate` ← `metadata.cost` 花费词 → 倍率（上游 COST，index.mjs:54）
 * - `reasoningEfforts`：种子记录的实测档 low/high/max（models.mjs，#137 /
 *   #141）——**目录不携带档位**，一个种子不认识的 id 在被实测之前不写
 *   档位（上游 levelsOf 的口径，index.mjs:260-263）。
 */
export declare const OPENDESIGN_CATALOG_TTL_MS: number;
/** 上游 modelOf 的缺省（index.mjs:289-292）：目录没给上限时的 200K / 32K。 */
export declare const OPENDESIGN_DEFAULT_CONTEXT = 200000;
export declare const OPENDESIGN_DEFAULT_OUTPUT = 32000;
export declare function resetOpendesignCatalogCache(): void;
export declare function opendesignCatalogModels(): readonly any[];
/** 实测档（种子里的 efforts）→ DSH 键；被实测之前不写（见文件头）。 */
export declare function opendesignReasoningEffortsOf(row: any): any;
export declare function toOpendesignPickerModels(payload: any): any[];
export declare function refreshOpendesignCatalog(session: any, options?: any): Promise<readonly any[]>;
