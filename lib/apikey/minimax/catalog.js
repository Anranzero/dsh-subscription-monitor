/**
 * Account /models decides membership. Missing model parameters come from the
 * existing models.dev metadata source; incomplete new rows wait for metadata.
 */
import { MINIMAX_MODELS, MINIMAX_MODELS_URL, minimaxUpstreamHeaders } from './index.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
import { MODEL_DISCOVERY_TTL_MS, positiveLimit, modelText, modelInput, mergeCatalogFloor, readModelList } from '../../catalog/discovery.js';
import { outboundFetch } from '../../utils/outbound.js';
const live = createLiveCatalog({ fallback: () => [...MINIMAX_MODELS] });
export function minimaxCatalogModels() {
    return live.models();
}
export function resetMinimaxCatalogCache() {
    live.reset();
}
export function toMinimaxPickerModels(payload, metadata = {}) {
    const rows = [];
    const seen = new Set();
    for (const entry of Array.isArray(payload?.data) ? payload.data : []) {
        const id = modelText(entry?.id);
        if (!id || seen.has(id))
            continue;
        const known = MINIMAX_MODELS.find((row) => row.id === id);
        const meta = metadata?.minimax?.models?.[id] ?? metadata?.['minimax-cn']?.models?.[id];
        const contextWindow = known?.contextWindow ?? positiveLimit(entry.context_window ?? entry.context_length)
            ?? positiveLimit(meta?.limit?.context);
        if (!contextWindow || (!known && meta?.modalities?.input && !meta.modalities.input.includes('text')))
            continue;
        seen.add(id);
        const input = known?.input ?? modelInput(meta?.modalities?.input);
        const output = known?.maxTokens ?? positiveLimit(entry.max_output_tokens) ?? positiveLimit(meta?.limit?.output);
        rows.push({
            ...known, id, name: known?.name || modelText(entry.name) || modelText(meta?.name) || id, contextWindow,
            ...(input ? { input } : {}),
            ...(output ? { maxTokens: output } : {}),
        });
    }
    return rows;
}
export function refreshMinimaxCatalog(session, options = {}) {
    return live.refresh({
        credential: modelText(session?.accessToken),
        ttlMs: options.ttlMs ?? MODEL_DISCOVERY_TTL_MS, now: options.now,
        fetch: async () => {
            const fetchFn = options.fetchFn ?? outboundFetch;
            const payload = await readModelList(fetchFn, MINIMAX_MODELS_URL,
                { headers: minimaxUpstreamHeaders(session), signal: options.signal });
            if (!Array.isArray(payload?.data) || !payload.data.length)
                return null;
            const needsMetadata = payload.data.some((row) => !MINIMAX_MODELS.some((known) => known.id === row?.id)
                && !positiveLimit(row?.context_window ?? row?.context_length));
            const metadata = needsMetadata
                ? await readModelList(fetchFn, 'https://models.dev/api.json', { signal: options.signal }).catch(() => null)
                : undefined;
            if (needsMetadata && !metadata)
                return null;
            const rows = toMinimaxPickerModels(payload, metadata);
            return rows.length ? mergeCatalogFloor(rows, MINIMAX_MODELS) : null;
        },
    });
}
