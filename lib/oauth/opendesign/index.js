/**
 * Open Design (open-design.ai) Cloud — Design Plan 订阅。
 *
 * 归因（上游 .local/upstream-magpie/packages/opendesign，即
 * @magpie-community/opencode-opendesign-auth 0.1.6，下称「上游」；行号均指
 * 其 index.mjs / models.mjs / README.md）：
 *
 * - 云端两个面（README:26-32）：控制面 `amr-api.open-design.ai`（key
 *   `vela_ctrl_…`，管套餐 / 钱包 / 5h+7d 窗 / workspace），模型面
 *   `amr-link.open-design.ai/v1`（key `sk-amr-…`，OpenAI 兼容）。
 * - 登录是 `vela login` 同款设备授权（非 RFC 8628）：POST
 *   `/api/v1/cli/device-authorizations`（body `{cliVersion, host, profile}`，
 *   index.mjs:124-129），轮询 POST
 *   `/api/v1/cli/device-authorizations/{deviceId}/token`（body
 *   `{deviceSecret}`，index.mjs:153-156），批准后一次拿回两把 key 与
 *   `{id, email}`（index.mjs:163）。
 * - 两把 key 都不过期、没有刷新端点（index.mjs:71-86，README:92-97）。
 * - 上游绝不读写 OpenDesign 桌面应用自己的 `~/.amr/config.json`
 *   （index.mjs:10-12，README:42-44）——本家族同样没有 import.ts。
 * - UA：上游所有请求都带 `opencode-opendesign-auth/<version>`
 *   （index.mjs:46,107-108）；设备授权 body 的 cliVersion 钉 `0.1.4`
 *   （index.mjs:47，「what the sign-in says it is, as the CLI does」）。
 */
import { createHash } from 'node:crypto';
import { catalogRows } from '../../catalog/index.js';
export { applyOpendesignCache, opendesignCacheHeaders, opendesignCacheSessionId, OPENDESIGN_STABLE_SESSION } from './cache.js';
export const OPENDESIGN_CONTROL_ORIGIN = 'https://amr-api.open-design.ai';
export const OPENDESIGN_LINK_ORIGIN = 'https://amr-link.open-design.ai';
/** 模型面 base（上游 LINK，index.mjs:23）。 */
export const OPENDESIGN_API_BASE = `${OPENDESIGN_LINK_ORIGIN}/v1`;
export const OPENDESIGN_CHAT_URL = `${OPENDESIGN_API_BASE}/chat/completions`;
export const OPENDESIGN_MODELS_URL = `${OPENDESIGN_API_BASE}/models`;
/** 设备授权两跳（上游 startDevice / waitForDevice，index.mjs:125,153）。 */
export const OPENDESIGN_WORKSPACES_URL = `${OPENDESIGN_CONTROL_ORIGIN}/api/v1/workspaces/current`;
/** 上游所有请求的 UA（index.mjs:46 + package.json:2-3 version 0.1.6）。 */
export const OPENDESIGN_USER_AGENT = 'opencode-opendesign-auth/0.1.6';
/** 设备授权 body 里自称的 CLI 版本（上游 CLI_VERSION，index.mjs:47）。 */
/** 上游 device 授权缺省有效期兜底（index.mjs:140）。 */
/** 两把 key 都不过期（index.mjs:71-86）——会话 expiry 用 Kimi 同款远期哨兵。 */
export const OPENDESIGN_NEVER_EXPIRES = 8.64e15;
export const OPENDESIGN_PREEMPT_MS = 24 * 60 * 60_000;
export const OPENDESIGN_SOURCES = Object.freeze(['oauth', 'paste']);
/** 上游 COST 表：厂商花费词 → 倍率（index.mjs:54），`rate` 徽标的唯一出处。 */
export const OPENDESIGN_COST = Object.freeze({
    low: 0.5,
    medium: 1,
    high: 2,
    very_high: 4,
});
/** 离线底表；登录后 `GET /v1/models` 替换（上游 refresh 流程，README:73-78）。行在 `src/catalog/models.json` 的 `"opendesign"` 键。 */
export const OPENDESIGN_MODELS = catalogRows('opendesign');
export function opendesignModel(modelId) {
    return OPENDESIGN_MODELS.find((model) => model.id === modelId);
}
export function opendesignSourceLabel(source) {
    if (source === 'paste')
        return 'key';
    if (source === 'oauth')
        return 'OAuth';
    return undefined;
}
export function isOpendesignKeySource(source) {
    return source === 'paste';
}
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/**
 * 会话：accessToken = 运行时 key（模型面），controlKey = 控制面 key。
 * refreshToken 没有真身——上游 `refresh: ""`（index.mjs:79）且 key 不过期，
 * 这里填运行时 key 只为满足 store 的非空形状，永远不会被发送到任何端点
 * （`refreshOpendesign` 原样返回会话）。
 */
export function opendesignSession({ runtimeKey, controlKey, account, uid, planType, source = 'oauth', } = {}) {
    const access = trimmed(runtimeKey);
    if (!access)
        throw new Error('opendesign sign-in returned no runtime key');
    if (access.startsWith('vela_ctrl_'))
        throw new Error('opendesign runtime key expected (sk-amr-…), got a control key');
    const next = {
        accessToken: access,
        refreshToken: access,
        expiresAt: OPENDESIGN_NEVER_EXPIRES,
        ...(trimmed(controlKey) ? { controlKey: trimmed(controlKey) } : {}),
        account: trimmed(account) ?? opendesignDefaultAccount(access),
        source: OPENDESIGN_SOURCES.includes(source) ? source : 'oauth',
    };
    if (trimmed(uid))
        next.uid = trimmed(uid);
    if (trimmed(planType))
        next.planType = trimmed(planType);
    return next;
}
export function opendesignAccountFingerprint(key) {
    return createHash('sha256').update(String(key ?? '')).digest('hex').slice(0, 8);
}
/** 粘贴 key 没有 email 可用（控制面不接受 API key，README:51）——用指纹兜底，不打印 key。 */
export function opendesignDefaultAccount(runtimeKey) {
    return `opendesign-${opendesignAccountFingerprint(runtimeKey)}`;
}
export function isOpendesignOpaqueAccount(value) {
    return /^opendesign-[0-9a-f]{8}$/i.test(String(value ?? '').trim());
}
/** 运行时 key：控制面 key 不能当运行时 key 用（上游 runtimeKeyOf，index.mjs:62-65）。 */
export function opendesignRuntimeKeyOf(session) {
    const access = trimmed(session?.accessToken) ?? '';
    return access.startsWith('vela_ctrl_') ? '' : access;
}
/** 控制面 key（上游 controlKeyOf，index.mjs:66）。 */
export function opendesignControlKeyOf(session) {
    return trimmed(session?.controlKey) ?? '';
}
export function parseOpendesignApiKey(value) {
    const key = trimmed(value);
    if (!key || key.length < 8)
        throw new Error('opendesign API key is empty');
    if (key.startsWith('vela_ctrl_')) {
        throw new Error('that is an Open Design control key; paste the runtime key (sk-amr-…) the model plane takes');
    }
    return key;
}
/** 上游 said()（index.mjs:99-105）：厂商自己的话，永不渲染 HTML 页。 */
export function opendesignSaid(body, fallback) {
    const raw = body?.error?.message ?? body?.message ?? body?.error ?? body?.__text;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text || text.startsWith('<'))
        return fallback;
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
// ---- 请求头 / 刷新 ----------------------------------------------------------
/** 模型面请求头（上游 api() + loader，index.mjs:107-110,461-465）。 */
export function opendesignUpstreamHeaders(session) {
    return {
        authorization: `Bearer ${opendesignRuntimeKeyOf(session)}`,
        accept: 'application/json',
        'user-agent': OPENDESIGN_USER_AGENT,
    };
}
/** 控制面请求头（上游 usage 的读，index.mjs:393-400）。 */
export function opendesignControlHeaders(session) {
    const control = opendesignControlKeyOf(session);
    return {
        ...(control ? { authorization: `Bearer ${control}` } : {}),
        accept: 'application/json',
        'user-agent': OPENDESIGN_USER_AGENT,
    };
}
/**
 * 两把 key 不过期、没有刷新端点（index.mjs:71-86,79）——刷新就是原样返回。
 * 上游 401/403 只意味着 key 被吊销，重登才能修（quota.ts 报错）。
 */
export async function refreshOpendesign(session) {
    if (!opendesignRuntimeKeyOf(session))
        throw new Error('opendesign session needs a runtime key');
    return session;
}
