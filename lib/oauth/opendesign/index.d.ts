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
export { applyOpendesignCache, opendesignCacheHeaders, opendesignCacheSessionId, OPENDESIGN_STABLE_SESSION } from './cache.js';
export declare const OPENDESIGN_CONTROL_ORIGIN = "https://amr-api.open-design.ai";
export declare const OPENDESIGN_LINK_ORIGIN = "https://amr-link.open-design.ai";
/** 模型面 base（上游 LINK，index.mjs:23）。 */
export declare const OPENDESIGN_API_BASE = "https://amr-link.open-design.ai/v1";
export declare const OPENDESIGN_CHAT_URL = "https://amr-link.open-design.ai/v1/chat/completions";
export declare const OPENDESIGN_MODELS_URL = "https://amr-link.open-design.ai/v1/models";
/** 设备授权两跳（上游 startDevice / waitForDevice，index.mjs:125,153）。 */
export declare const OPENDESIGN_WORKSPACES_URL = "https://amr-api.open-design.ai/api/v1/workspaces/current";
/** 上游所有请求的 UA（index.mjs:46 + package.json:2-3 version 0.1.6）。 */
export declare const OPENDESIGN_USER_AGENT = "opencode-opendesign-auth/0.1.6";
/** 设备授权 body 里自称的 CLI 版本（上游 CLI_VERSION，index.mjs:47）。 */
/** 上游 device 授权缺省有效期兜底（index.mjs:140）。 */
/** 两把 key 都不过期（index.mjs:71-86）——会话 expiry 用 Kimi 同款远期哨兵。 */
export declare const OPENDESIGN_NEVER_EXPIRES = 8640000000000000;
export declare const OPENDESIGN_PREEMPT_MS: number;
export declare const OPENDESIGN_SOURCES: readonly string[];
/** 上游 COST 表：厂商花费词 → 倍率（index.mjs:54），`rate` 徽标的唯一出处。 */
export declare const OPENDESIGN_COST: Readonly<{
    low: 0.5;
    medium: 1;
    high: 2;
    very_high: 4;
}>;
/** 离线底表；登录后 `GET /v1/models` 替换（上游 refresh 流程，README:73-78）。行在 `src/catalog/models.json` 的 `"opendesign"` 键。 */
export declare const OPENDESIGN_MODELS: readonly any[];
export declare function opendesignModel(modelId: any): any;
export declare function opendesignSourceLabel(source: any): "key" | "OAuth" | undefined;
export declare function isOpendesignKeySource(source: any): boolean;
/**
 * 会话：accessToken = 运行时 key（模型面），controlKey = 控制面 key。
 * refreshToken 没有真身——上游 `refresh: ""`（index.mjs:79）且 key 不过期，
 * 这里填运行时 key 只为满足 store 的非空形状，永远不会被发送到任何端点
 * （`refreshOpendesign` 原样返回会话）。
 */
export declare function opendesignSession({ runtimeKey, controlKey, account, uid, planType, source, }?: any): any;
export declare function opendesignAccountFingerprint(key: any): string;
/** 粘贴 key 没有 email 可用（控制面不接受 API key，README:51）——用指纹兜底，不打印 key。 */
export declare function opendesignDefaultAccount(runtimeKey: any): string;
export declare function isOpendesignOpaqueAccount(value: any): boolean;
/** 运行时 key：控制面 key 不能当运行时 key 用（上游 runtimeKeyOf，index.mjs:62-65）。 */
export declare function opendesignRuntimeKeyOf(session: any): string;
/** 控制面 key（上游 controlKeyOf，index.mjs:66）。 */
export declare function opendesignControlKeyOf(session: any): string;
export declare function parseOpendesignApiKey(value: any): string;
/** 上游 said()（index.mjs:99-105）：厂商自己的话，永不渲染 HTML 页。 */
export declare function opendesignSaid(body: any, fallback: any): any;
/** 模型面请求头（上游 api() + loader，index.mjs:107-110,461-465）。 */
export declare function opendesignUpstreamHeaders(session: any): {
    authorization: string;
    accept: string;
    'user-agent': string;
};
/** 控制面请求头（上游 usage 的读，index.mjs:393-400）。 */
export declare function opendesignControlHeaders(session: any): {
    accept: string;
    'user-agent': string;
    authorization?: string | undefined;
};
/**
 * 两把 key 不过期、没有刷新端点（index.mjs:71-86,79）——刷新就是原样返回。
 * 上游 401/403 只意味着 key 被吊销，重登才能修（quota.ts 报错）。
 */
export declare function refreshOpendesign(session: any): Promise<any>;
