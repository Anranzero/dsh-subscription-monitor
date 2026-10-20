import { GROK_MODELS, GROK_MODELS_URL, grokUpstreamHeaders } from './index.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
import { MODEL_DISCOVERY_TTL_MS, positiveLimit, modelText, modelEfforts, mergeCatalogFloor, readModelList } from '../../catalog/discovery.js';
import { outboundFetch } from '../../utils/outbound.js';

const live = createLiveCatalog({ fallback: () => [...GROK_MODELS] });
export const grokCatalogModels = () => live.models();
export const resetGrokCatalogCache = () => live.reset();
export function toGrokPickerModels(payload) {
    const rows = [];
    const seen = new Set();
    for (const entry of Array.isArray(payload?.data) ? payload.data : []) {
        const id = modelText(entry?.id);
        if (!id || seen.has(id) || (entry.api_backend && entry.api_backend !== 'responses') || entry.disabled === true)
            continue;
        const known = GROK_MODELS.find((row) => row.id === id);
        const contextWindow = known?.contextWindow ?? positiveLimit(entry.context_window);
        if (!contextWindow)
            continue;
        seen.add(id);
        const efforts = entry.supports_reasoning_effort === false ? false
            : modelEfforts(entry.reasoning_efforts) ?? known?.reasoningEfforts;
        const output = known?.maxTokens ?? positiveLimit(entry.max_completion_tokens);
        rows.push({
            ...known, id, name: modelText(entry.name) || known?.name || id, contextWindow,
            ...(efforts !== undefined ? { reasoningEfforts: efforts } : {}),
            ...(output ? { maxTokens: output } : {}),
        });
    }
    return rows;
}
export function refreshGrokCatalog(session, options = {}) {
    return live.refresh({
        credential: modelText(session?.accessToken),
        ttlMs: options.ttlMs ?? MODEL_DISCOVERY_TTL_MS, now: options.now,
        fetch: async () => {
            const payload = await readModelList(options.fetchFn ?? outboundFetch, GROK_MODELS_URL,
                { headers: grokUpstreamHeaders(session), signal: options.signal });
            const rows = toGrokPickerModels(payload);
            return rows.length ? mergeCatalogFloor(rows, GROK_MODELS) : null;
        },
    });
}
