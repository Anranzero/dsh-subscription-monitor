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
/** 国际版离线表（rows live in src/catalog/models.json "autoclaw"）。 */
export declare const AUTOCLAW_MODELS: readonly any[];
/** 国内 managed 离线表（rows live in src/catalog/models.json "autoclaw-cn"）。 */
export declare const AUTOCLAW_CN_MODELS: readonly any[];
/**
 * 一行的目录查找。context-mode familyMaxContextWindow 的 autoclaw 分支经此取
 * maxContextWindow——该分支是 sharedPatch（注册台落地）；落地前
 * familyMaxContextWindow('autoclaw*', …) 走 default 返回 undefined（当前无行
 * 声明 maxContextWindow，结果相同；槽位为未来的 pin 保留）。
 */
export declare function autoclawModelOf(family: string, modelId: any): any;
