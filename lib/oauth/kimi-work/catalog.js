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
import { KIMI_WORK_CONTEXT_CAP, KIMI_WORK_INPUT, KIMI_WORK_MAX_TOKENS, KIMI_WORK_MODELS, KIMI_WORK_MODELS_URL, currentKimiWorkDesktop, kimiWorkJsonHeaders, } from './index.js';
import { outboundFetch } from '../../utils/outbound.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
export const KIMI_WORK_CATALOG_TTL_MS = 5 * 60_000;
const live = createLiveCatalog({ fallback: () => [...KIMI_WORK_MODELS] });
export function resetKimiWorkCatalogCache() {
    live.reset();
}
export function kimiWorkCatalogModels() {
    return live.models();
}
/**
 * A wire effort spelling → the DSH level whose value it is. `standard` maps
 * onto `low` because Kimi displays LOW as Standard (upstream README); a
 * spelling outside this table (e.g. `ultra`) has no DSH level to be and is
 * dropped rather than guessed onto a rung.
 */
const EFFORT_LEVELS = Object.freeze({
    off: 'off',
    minimal: 'minimal',
    low: 'low',
    standard: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
});
function asPositiveInt(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n) || n <= 0)
        return undefined;
    return Math.trunc(n);
}
/** One `REASONING_EFFORT_*` entry onto the row's level→wire table (first spelling of a level wins). */
function effortsOf(row, id) {
    const raw = row.reasoningEffortOptions;
    if (raw === undefined)
        return undefined;
    if (!Array.isArray(raw))
        throw new Error('Kimi Work 思考档位格式无效。');
    const efforts = {};
    for (const option of raw) {
        const effort = String(option?.effort ?? '').replace(/^REASONING_EFFORT_/, '').toLowerCase();
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(effort))
            throw new Error('Kimi Work 思考档位格式无效。');
        const level = EFFORT_LEVELS[effort];
        if (level === undefined || efforts[level] !== undefined)
            continue;
        efforts[level] = effort;
    }
    return Object.keys(efforts).length > 0 ? efforts : undefined;
}
/** `GET /coding/v1/models` → picker rows, with the upstream's own catalog guards. */
export function toKimiWorkPickerModels(payload) {
    const root = payload && typeof payload === 'object' ? payload : {};
    if (!Array.isArray(root.data) || root.has_more || root.data.length > 100) {
        throw new Error('Kimi Work 模型目录暂不可用。');
    }
    const seen = new Set();
    const models = [];
    for (const row of root.data) {
        const id = typeof row?.id === 'string' ? row.id : '';
        if (!id || id.length > 256 || /[\x00-\x20/]/.test(id) || seen.has(id))
            continue;
        seen.add(id);
        const staticRow = KIMI_WORK_MODELS.find((model) => model.id === id);
        // The server lists the plan's maximum XL context; cap at the standard
        // window rather than silently asking for a more expensive XL session.
        const contextWindow = Math.min(asPositiveInt(row.context_length) ?? KIMI_WORK_CONTEXT_CAP, KIMI_WORK_CONTEXT_CAP);
        const input = [...KIMI_WORK_INPUT];
        if (row.supports_image_in !== true) {
            const at = input.indexOf('image');
            if (at >= 0)
                input.splice(at, 1);
        }
        const reasoningEfforts = row.supports_reasoning === false ? undefined : effortsOf(row, id);
        models.push({
            id,
            name: typeof row.display_name === 'string' && row.display_name.trim()
                ? row.display_name.trim()
                : staticRow?.name ?? id,
            contextWindow,
            maxTokens: staticRow?.maxTokens ?? KIMI_WORK_MAX_TOKENS,
            input,
            ...(reasoningEfforts ? { reasoningEfforts } : {}),
        });
    }
    if (models.length === 0)
        throw new Error('Kimi Work 模型目录为空。');
    models.sort((left, right) => left.id.localeCompare(right.id));
    return models;
}
/** One raw read of the live catalog for this session's desktop credentials. */
export async function fetchKimiWorkCatalogRows(session, { fetchFn = outboundFetch, signal } = {}) {
    const read = currentKimiWorkDesktop(session);
    const response = await fetchFn(KIMI_WORK_MODELS_URL, {
        headers: kimiWorkJsonHeaders(read.workToken),
        signal,
    });
    if (!response?.ok)
        return null;
    const rows = toKimiWorkPickerModels(await response.json());
    return rows.length > 0 ? rows : null;
}
export async function refreshKimiWorkCatalog(session, options = {}) {
    // The stored session carries no credential: the live instance keys on the
    // account reference, which is what a desktop rotation or reconnect changes.
    const credential = typeof session?.uid === 'string' ? session.uid : '';
    return live.refresh({
        credential,
        ttlMs: options.ttlMs ?? KIMI_WORK_CATALOG_TTL_MS,
        now: options.now,
        fetch: () => fetchKimiWorkCatalogRows(session, options),
    });
}
