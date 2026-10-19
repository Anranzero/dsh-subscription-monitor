/**
 * AutoClaw 静态模型目录。上游没有目录端点：模型清单是 magpie 0.2.1 从官方
 * 客户端实测存下的固定表（upstream overseasModels / managedModels，
 * index.mjs:150-168），两 provider 各 4 行——`zai_` 智谱 / `zaicoding_`
 * coding plan 前缀的 routeModelId。`zai_glm-5-turbo` 与 `tdpsk_deepseek-*`
 * 已被上游下线（README.md:18），不在表内。
 *
 * 行数据落在 `src/catalog/models.json` 的 `autoclaw` / `autoclaw-cn` 键（全
 * 家族单一来源）；键还没落盘时（家族目录先于共享接线合入）以本文件的种子
 * 行回答，种子与 models.json 意图逐字段相同，落盘后 catalogRows 即接管。
 * 注意 `zai_auto-fast` 是上游真实 routeModelId（不是本插件 `-fast` 孪生，
 * 不走 fast-mode 剥离）；国内表带 low/high/max 推理档（upstream VARIANTS，
 * index.mjs:147），国际表代码未标 variants（README.md:14-16 声称支持，活测
 * 前不发明——见 README「模型」）。
 */
import { catalogRows } from '../../catalog/index.js';
const EFFORT_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const OVERSEAS_SEED = [
    // upstream overseasModels（index.mjs:150-158）：limit {context, output}，
    // reasoning: true 但无 variants；attachment 未标 → text-only。
    { id: 'zai_auto', name: 'GLM Auto (路由)', contextWindow: 200000, maxTokens: 32000, input: ['text'] },
    { id: 'zai_auto-fast', name: 'GLM Auto Fast', contextWindow: 200000, maxTokens: 32000, input: ['text'] },
    { id: 'zaicoding_glm-5.3', name: 'GLM-5.3 Coding', contextWindow: 1000000, maxTokens: 131072, input: ['text'] },
    { id: 'zai_glm-5.3-flash', name: 'GLM-5.3 Flash', contextWindow: 1000000, maxTokens: 32000, input: ['text'] },
];
const MANAGED_SEED = [
    // upstream managedModels（index.mjs:161-167）：context 1048576；output 各异；
    // attachment true → image；variants low/high/max（wire 值同档名）。
    { id: 'zai_auto', name: 'Auto', contextWindow: 1048576, maxTokens: 393216, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' } },
    { id: 'zai_auto-fast', name: 'Auto-Fast', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' } },
    { id: 'zaicoding_glm-5.3', name: 'GLM-5.3', contextWindow: 1048576, maxTokens: 307200, input: ['text'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' } },
    { id: 'zai_glm-5.3-flash', name: 'GLM-5.3-Flash', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' } },
];
/** 种子行的加载期自检（models.json 的 assertCatalog 落盘后接管同样的规则）。 */
function validateSeed(key, rows) {
    const seen = new Set();
    for (const row of rows) {
        if (typeof row.id !== 'string' || !row.id || seen.has(row.id))
            throw new Error(`autoclaw catalog seed "${key}": bad or duplicate id`);
        seen.add(row.id);
        if (typeof row.name !== 'string' || !row.name)
            throw new Error(`autoclaw catalog seed "${key}.${row.id}": missing name`);
        if (!Number.isInteger(row.contextWindow) || row.contextWindow <= 0)
            throw new Error(`autoclaw catalog seed "${key}.${row.id}": bad contextWindow`);
        if (!Number.isInteger(row.maxTokens) || row.maxTokens <= 0)
            throw new Error(`autoclaw catalog seed "${key}.${row.id}": bad maxTokens`);
        for (const kind of row.input ?? []) {
            if (!['text', 'image'].includes(kind))
                throw new Error(`autoclaw catalog seed "${key}.${row.id}": bad input kind`);
        }
        for (const level of Object.keys(row.reasoningEfforts ?? {})) {
            if (!EFFORT_KEYS.includes(level))
                throw new Error(`autoclaw catalog seed "${key}.${row.id}": effort key "${level}" outside the closed set`);
        }
    }
}
/** models.json 的键在就读它（单一来源）；不在（共享接线未合入）则用种子行。 */
function rowsOf(key, seed) {
    try {
        return catalogRows(key);
    }
    catch {
        validateSeed(key, seed);
        return Object.freeze(seed.map((row) => Object.freeze({ ...row, input: Object.freeze([...row.input]) })));
    }
}
/** 国际版离线表（rows live in src/catalog/models.json "autoclaw"）。 */
export const AUTOCLAW_MODELS = rowsOf('autoclaw', OVERSEAS_SEED);
/** 国内 managed 离线表（rows live in src/catalog/models.json "autoclaw-cn"）。 */
export const AUTOCLAW_CN_MODELS = rowsOf('autoclaw-cn', MANAGED_SEED);
/**
 * 一行的目录查找。context-mode familyMaxContextWindow 的 autoclaw 分支经此取
 * maxContextWindow——该分支是 sharedPatch（注册台落地）；落地前
 * familyMaxContextWindow('autoclaw*', …) 走 default 返回 undefined（当前无行
 * 声明 maxContextWindow，结果相同；槽位为未来的 pin 保留）。
 */
export function autoclawModelOf(family, modelId) {
    const rows = family === 'autoclaw-cn' ? AUTOCLAW_CN_MODELS : AUTOCLAW_MODELS;
    const base = String(modelId ?? '').replace(/-fast$/, '');
    return rows.find((row) => row.id === modelId) ?? rows.find((row) => row.id === base);
}
