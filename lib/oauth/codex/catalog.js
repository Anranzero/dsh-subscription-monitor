import { CODEX_MODELS, CODEX_MODELS_URL, CODEX_CLIENT_VERSION, CODEX_ORIGINATOR, codexUpstreamHeaders } from './index.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
import { MODEL_DISCOVERY_TTL_MS, positiveLimit, modelText, modelInput, modelEfforts, mergeCatalogFloor, readModelList } from '../../catalog/discovery.js';
import { outboundFetch } from '../../utils/outbound.js';

const live = createLiveCatalog({ fallback: () => [...CODEX_MODELS] });
let clientVersion = CODEX_CLIENT_VERSION;
export const codexCatalogModels = () => live.models();
export const resetCodexCatalogCache = () => {
    live.reset();
    clientVersion = CODEX_CLIENT_VERSION;
};
async function catalogClientVersion(fetchFn, signal) {
    // New models are gated on client_version. Public metadata gets no account headers.
    const metadata = await readModelList(fetchFn, 'https://registry.npmjs.org/@openai/codex/latest', { signal }).catch(() => null);
    const version = modelText(metadata?.version);
    if (!/^\d+\.\d+\.\d+$/.test(version))
        return clientVersion;
    const latest = version.split('.').map(Number);
    const pinned = clientVersion.split('.').map(Number);
    for (let i = 0; i < pinned.length; i++) {
        if (latest[i] > pinned[i])
            return clientVersion = version;
        if (latest[i] < pinned[i])
            return clientVersion;
    }
    return version;
}
export function toCodexPickerModels(payload) {
    const rows = [];
    const seen = new Set();
    for (const entry of Array.isArray(payload?.models) ? payload.models : []) {
        const id = modelText(entry?.slug);
        if (!id || seen.has(id) || entry.visibility !== 'list' || entry.supported_in_api === false)
            continue;
        const known = CODEX_MODELS.find((row) => row.id === id);
        const contextWindow = known?.contextWindow ?? positiveLimit(entry.context_window);
        if (!contextWindow)
            continue;
        seen.add(id);
        const input = modelInput(entry.input_modalities) ?? known?.input;
        const efforts = modelEfforts(entry.supported_reasoning_levels, null) ?? known?.reasoningEfforts;
        const ceiling = positiveLimit(entry.max_context_window) ?? known?.maxContextWindow;
        const output = positiveLimit(entry.max_output_tokens) ?? known?.maxTokens;
        rows.push({
            ...known, id, name: modelText(entry.display_name) || known?.name || id, contextWindow,
            ...(input ? { input } : {}),
            ...(efforts !== undefined ? { reasoningEfforts: efforts } : {}),
            ...(ceiling > contextWindow ? { maxContextWindow: ceiling } : {}),
            ...(output ? { maxTokens: output } : {}),
            fastTier: Array.isArray(entry.service_tiers)
                ? entry.service_tiers.some((tier) => (typeof tier === 'string' ? tier : tier?.id) === 'priority')
                : known?.fastTier === true,
        });
    }
    return rows;
}
export function refreshCodexCatalog(session, options = {}) {
    return live.refresh({
        credential: modelText(session?.accessToken),
        ttlMs: options.ttlMs ?? MODEL_DISCOVERY_TTL_MS, now: options.now,
        fetch: async () => {
            const fetchFn = options.fetchFn ?? outboundFetch;
            const version = await catalogClientVersion(fetchFn, options.signal);
            const payload = await readModelList(fetchFn,
                CODEX_MODELS_URL + '?client_version=' + version,
                { headers: { ...codexUpstreamHeaders(session), 'openai-version': version,
                    'user-agent': `${CODEX_ORIGINATOR}/${version}` }, signal: options.signal });
            const rows = toCodexPickerModels(payload);
            return rows.length ? mergeCatalogFloor(rows, CODEX_MODELS) : null;
        },
    });
}
