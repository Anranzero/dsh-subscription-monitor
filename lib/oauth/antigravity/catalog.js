import { ANTIGRAVITY_MODELS, ANTIGRAVITY_MODELS_URL, antigravityLoadCodeAssistHeaders, fetchAntigravityCloudCode } from './index.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
import { MODEL_DISCOVERY_TTL_MS, positiveLimit, modelText, mergeCatalogFloor, discoverySignal } from '../../catalog/discovery.js';
import { outboundFetch } from '../../utils/outbound.js';

const live = createLiveCatalog({ fallback: () => [...ANTIGRAVITY_MODELS] });
export const antigravityCatalogModels = () => live.models();
export const resetAntigravityCatalogCache = () => live.reset();
export function toAntigravityPickerModels(payload) {
    const models = payload?.models;
    if (!models || typeof models !== 'object' || Array.isArray(models))
        return [];
    const rows = [];
    for (const [id, entry] of Object.entries(models)) {
        if (!entry || typeof entry !== 'object' || entry.disabled === true || entry.isInternal === true
            || entry.hidden === true || id.endsWith('-disabled'))
            continue;
        const known = ANTIGRAVITY_MODELS.find((row) => row.id === id);
        const name = modelText(entry.displayName) || known?.name;
        const contextWindow = known?.contextWindow ?? positiveLimit(entry.maxTokens);
        if (!name || !contextWindow)
            continue;
        const output = known?.maxTokens ?? positiveLimit(entry.maxOutputTokens);
        rows.push({
            ...known, id, name, contextWindow,
            ...(output ? { maxTokens: output } : {}),
            ...(typeof entry.supportsImages === 'boolean'
                ? { input: entry.supportsImages ? ['text', 'image'] : ['text'] } : {}),
            ...(entry.supportsThinking === false ? { reasoningEfforts: false } : {}),
        });
    }
    return rows;
}
export function refreshAntigravityCatalog(session, options = {}) {
    const token = modelText(session?.accessToken);
    return live.refresh({
        credential: token ? token + '\n' + modelText(session?.projectId) : '',
        ttlMs: options.ttlMs ?? MODEL_DISCOVERY_TTL_MS, now: options.now,
        fetch: async () => {
            const response = await fetchAntigravityCloudCode(ANTIGRAVITY_MODELS_URL, {
                method: 'POST', headers: antigravityLoadCodeAssistHeaders(token),
                body: JSON.stringify(session.projectId ? { project: session.projectId } : {}),
                signal: discoverySignal(options.signal),
            }, options.fetchFn ?? outboundFetch);
            const rows = response?.ok ? toAntigravityPickerModels(await response.json()) : [];
            return rows.length ? mergeCatalogFloor(rows, ANTIGRAVITY_MODELS) : null;
        },
    });
}
