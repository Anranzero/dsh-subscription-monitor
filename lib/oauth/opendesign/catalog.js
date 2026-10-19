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
import { OPENDESIGN_COST, OPENDESIGN_MODELS, OPENDESIGN_MODELS_URL, opendesignRuntimeKeyOf, opendesignUpstreamHeaders, } from './index.js';
import { opendesignEngineUserAgent } from './engine.js';
import { outboundFetch } from '../../utils/outbound.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
export const OPENDESIGN_CATALOG_TTL_MS = 5 * 60_000;
/** 上游 modelOf 的缺省（index.mjs:289-292）：目录没给上限时的 200K / 32K。 */
export const OPENDESIGN_DEFAULT_CONTEXT = 200_000;
export const OPENDESIGN_DEFAULT_OUTPUT = 32_000;
const live = createLiveCatalog({ fallback: () => [...OPENDESIGN_MODELS] });
export function resetOpendesignCatalogCache() {
    live.reset();
}
export function opendesignCatalogModels() {
    return live.models();
}
function asPositiveInt(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n) || n <= 0)
        return undefined;
    return Math.trunc(n);
}
function seedRow(id) {
    return OPENDESIGN_MODELS.find((model) => model.id === id);
}
/** 实测档（种子里的 efforts）→ DSH 键；被实测之前不写（见文件头）。 */
export function opendesignReasoningEffortsOf(row) {
    const seed = seedRow(typeof row?.id === 'string' ? row.id : '');
    const efforts = seed?.reasoningEfforts;
    if (efforts === false)
        return false;
    return efforts && typeof efforts === 'object' ? { ...efforts } : undefined;
}
export function toOpendesignPickerModels(payload) {
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const seen = new Set();
    const models = [];
    for (const row of rows) {
        const id = typeof row?.id === 'string' && row.id.trim() ? row.id.trim() : '';
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        const meta = row?.metadata ?? {};
        // 上游 facts()（index.mjs:335-337）：modalities 缺失 = 空数组（纯文本），
        // 不是「默认有 image」——不发明输入模态。
        const input = Array.isArray(row?.architecture?.input_modalities)
            ? row.architecture.input_modalities.filter((kind) => kind === 'image')
            : [];
        const cost = typeof meta.cost === 'string' ? meta.cost.trim() : '';
        const efforts = opendesignReasoningEffortsOf(row);
        models.push({
            id,
            name: seedRow(id)?.name ?? id,
            // 上游 modelOf（index.mjs:289-292）：上限只看目录 metadata，缺省
            // 200K / 32K；种子只借 name 与 efforts（modelsOf，index.mjs:361）。
            contextWindow: asPositiveInt(meta.context_limit) ?? OPENDESIGN_DEFAULT_CONTEXT,
            maxTokens: asPositiveInt(meta.context_budget) ?? OPENDESIGN_DEFAULT_OUTPUT,
            input: ['text', ...input],
            ...(cost && OPENDESIGN_COST[cost] !== undefined ? { rate: OPENDESIGN_COST[cost] } : {}),
            ...(efforts !== undefined ? { reasoningEfforts: efforts } : {}),
        });
    }
    return models;
}
export async function refreshOpendesignCatalog(session, options = {}) {
    const token = opendesignRuntimeKeyOf(session);
    return live.refresh({
        credential: token,
        ttlMs: options.ttlMs ?? OPENDESIGN_CATALOG_TTL_MS,
        now: options.now,
        fetch: async () => {
            const fetchFn = options.fetchFn ?? outboundFetch;
            const response = await fetchFn(OPENDESIGN_MODELS_URL, {
                headers: {
                    ...opendesignUpstreamHeaders(session),
                    // The catalog read self-reports the loaded engine's version too
                    // (the hop already does): a dist-tag bump must not split one
                    // account's two amr-link planes into two different UAs.
                    'user-agent': opendesignEngineUserAgent(),
                    accept: 'application/json',
                },
                signal: options.signal,
            });
            if (!response?.ok)
                return null;
            const parsed = toOpendesignPickerModels(await response.json());
            return parsed.length > 0 ? parsed : null;
        },
    });
}
