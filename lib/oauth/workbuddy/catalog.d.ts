/**
 * WorkBuddy's live model catalog. GET {endpoint}/v3/config after login — the
 * product config behind both builds' pickers.
 *
 * The read needs the CLI agent's User-Agent (`CLI/2.0.0 WorkBuddy/5.5.6`):
 * the bare WorkBuddy UA returns the IDE's config, whose agents list carries
 * no `cli` entry and the parse below yields nothing (magpie 0.1.24
 * liveModels). Rows come from the `cli` agent's model ids plus the
 * `data.models[]` detail of each; the static tables in src/catalog/models.json
 * (`workbuddy` / `workbuddy-ai`) are the offline floor.
 */
import { type WorkbuddySite } from './index.js';
export declare const WORKBUDDY_CATALOG_TTL_MS: number;
/**
 * WorkBuddy AI's GLM models take no images whatever the config says: on
 * 2026-10-13 the live config marked every model supportsImages, and a chat to
 * glm-5.3-flash / glm-5.3 / glm-5.2 answered that the model does not support
 * images — the server had taken the image out (magpie noImages, workbuddy
 * README 模型). The China build's GLM reads them.
 */
export declare const WORKBUDDY_AI_TEXT_ONLY: RegExp;
export declare function resetWorkbuddyCatalogCache(): void;
export declare function workbuddyCatalogModels(): readonly any[];
export declare function workbuddyAiCatalogModels(): readonly any[];
/**
 * A model detail's credits multiple as magpie's creditsOf reads it — "x0.03",
 * "0.03", "X1.00" or a number; "x0.00" is free. Anything else (a word, a
 * negative, an infinity) is undefined: an unreadable multiple says neither
 * free nor rated, and the row carries no credits at all. magpie creditsOf,
 * and its freeCredits is exactly `creditsOf(c) === 0`.
 */
export declare function creditsOf(value: any): number | undefined;
/**
 * A model's credits now, as magpie keeps them (priceOf, magpie #121): the
 * detail's `credits` multiple, lowered by the config's `modelPromotions` for
 * whole days (Step-5-Preview's 独家限免). A promotion that holds only some
 * hours of the day (Hy4 preview free 23:00–8:00) is NOT counted: the list is
 * cached for minutes, so a list asked for at night would read "free" all day.
 * Undefined when the detail gives no readable multiple.
 */
export declare function workbuddyCreditsOf(details: any, promotions: any, now?: number): number | undefined;
/**
 * A model detail's reasoning ladder → DSH-keyed efforts. Keys are the DSH
 * closed set; the values keep WorkBuddy's own spellings (`none` is the value
 * of `off`, never a key). `off` needs the model's thinking to be
 * disengageable — `reasoning.canDisableThinking` unset-or-true and not
 * `onlyReasoning` — exactly magpie's gate. A vendor spelling outside the
 * closed set drops; an empty ladder is undefined (no efforts field).
 */
export declare function toWorkbuddyEfforts(details: any): {
    [k: string]: string;
} | undefined;
/**
 * /v3/config's JSON (the whole {code, msg, data} envelope or the data object
 * itself) → catalog rows: the `cli` agent's model ids, each with its
 * `data.models[]` detail — name (else the id), maxInputTokens →
 * contextWindow, maxOutputTokens → maxTokens (only when > 0), images via
 * supportsImages minus the AI build's text-only GLM rule, and the reasoning
 * ladder above. Same-name models take the magpie suffix (the `-sg` twin of
 * deepseek-v4.1-flash reads "Deepseek-V4.1-Flash (SG)"). Sorted by id.
 */
export declare function toWorkbuddyCatalogRows(site: WorkbuddySite, payload: any): any[];
/**
 * Refresh one build's catalog behind its own live instance, as magpie's
 * liveModels asks: the account's chat header group with the User-Agent
 * swapped to the CLI agent's. A non-2xx answer, a non-zero code, or zero
 * rows falls back to the last good list (or the static floor). A desktop
 * reference row holds no tokens — the live file read answers for it, the
 * same file the engine itself re-reads per hop.
 */
export declare function refreshWorkbuddyCatalog(site: WorkbuddySite, session: any, options?: any): Promise<readonly any[]>;
