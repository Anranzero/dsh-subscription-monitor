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
import { CATALOG_EFFORT_KEYS } from '../../catalog/index.js';
import { outboundFetch } from '../../utils/outbound.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
import { ZED_MODELS, zedModelsUrl, zedModelToken, zedStateOf, zedTokenStale, zedUserAgent } from './index.js';
export const ZED_CATALOG_TTL_MS = 10 * 60_000;
/** The vendors whose wire a DSH api can speak; `google` (generateContent) stays out. */
export const ZED_PICKABLE_VENDORS = new Set(['anthropic', 'open_ai', 'x_ai']);
const live = createLiveCatalog({ fallback: () => [...ZED_MODELS] });
export function resetZedCatalogCache() {
    live.reset();
}
export function zedCatalogModels() {
    return live.models();
}
function positiveInt(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isInteger(n) && n > 0 ? n : undefined;
}
/**
 * A model's effort levels as a DSH-keyed ladder: each level the list names
 * keeps its own spelling as the value (`none` is the `off` key's value, never
 * a key itself — docs/rules.md). A spelling outside the DSH ladder is dropped,
 * not folded into a neighbor.
 */
export function zedEffortsOf(levels) {
    if (!Array.isArray(levels))
        return undefined;
    const map = {};
    for (const entry of levels) {
        const value = typeof entry === 'string' ? entry : typeof entry?.value === 'string' ? entry.value : undefined;
        if (typeof value !== 'string' || !value)
            continue;
        const key = value === 'none' ? 'off' : value;
        if (CATALOG_EFFORT_KEYS.includes(key))
            map[key] = value;
    }
    const ordered = Object.fromEntries(CATALOG_EFFORT_KEYS.filter((key) => key in map).map((key) => [key, map[key]]));
    return Object.keys(ordered).length > 0 ? ordered : undefined;
}
/** parseModels + entry: what /models lists that this family can serve (index.mjs:283-316). */
export function toZedPickerRows(payload) {
    const rows = Array.isArray(payload?.models) ? payload.models : [];
    const out = [];
    for (const model of rows) {
        if (!model || typeof model !== 'object' || typeof model.id !== 'string' || !model.id)
            continue;
        if (model.is_disabled === true)
            continue;
        const vendor = model.provider;
        if (!ZED_PICKABLE_VENDORS.has(vendor))
            continue;
        const contextWindow = positiveInt(model.max_token_count);
        if (contextWindow === undefined)
            continue; // no window: not a row, never an invented one
        const images = model.supports_images === true;
        out.push({
            id: model.id,
            name: typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name.trim() : model.id,
            vendor,
            contextWindow,
            ...(positiveInt(model.max_output_tokens) !== undefined ? { maxTokens: positiveInt(model.max_output_tokens) } : {}),
            input: images ? ['text', 'image'] : ['text'],
            ...(zedEffortsOf(model.supported_effort_levels) !== undefined ? { reasoningEfforts: zedEffortsOf(model.supported_effort_levels) } : {}),
        });
    }
    return out;
}
/**
 * fetchModels: mint the token, read GET /models (with the x-ai support flag
 * upstream sends), minting again once when Zed calls the token stale
 * (index.mjs:266-279).
 */
export async function fetchZedModels(session, { fetchFn = outboundFetch, signal } = {}) {
    const state = zedStateOf(session);
    if (!state)
        throw new Error('the stored Zed sign-in is unreadable; sign in again');
    for (let t = 0;; t++) {
        const token = await zedModelToken(state, t > 0, fetchFn);
        const response = await fetchFn(zedModelsUrl(), {
            headers: {
                Authorization: `Bearer ${token}`,
                'x-zed-client-supports-x-ai': 'true',
                'User-Agent': zedUserAgent(),
            },
            signal: signal ?? AbortSignal.timeout(15_000),
        });
        const text = await response.text();
        if (!response.ok && t === 0 && zedTokenStale(response.status, response.headers))
            continue;
        if (!response.ok) {
            throw Object.assign(new Error(`Zed: ${text.slice(0, 200) || response.statusText} (${response.status})`), { status: response.status });
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new Error('Zed: /models returned non-JSON');
        }
        const rows = toZedPickerRows(parsed);
        if (!rows.length) {
            throw new Error("Zed lists no models this hop can serve — the account's plan may not include Zed's hosted models (see zed.dev/account)");
        }
        return rows;
    }
}
/** Live refresh behind the family registry: the static floor answers when there is none. */
export async function refreshZedCatalog(session, options = {}) {
    const state = zedStateOf(session);
    return live.refresh({
        credential: state ? `zed:${state.userId}` : '',
        ttlMs: options.ttlMs ?? ZED_CATALOG_TTL_MS,
        now: options.now,
        fetch: async () => {
            try {
                return await fetchZedModels(session, { fetchFn: options.fetchFn ?? outboundFetch, signal: options.signal });
            }
            catch {
                return null;
            }
        },
    });
}
