/**
 * Open Design prompt cache.
 *
 * 上游 wire 上没有任何缓存亲和字段：模型请求 `headers: {}`（上游
 * servedOf，index.mjs:313），插件也从不在 body 里写缓存键。amr-link 是否
 * 隐式前缀缓存，上游未观测、未声明——所以这里**不发明**亲和：
 * 只剥 DSH / pi-ai 会带上来的别家字段（Codex `prompt_cache_key` /
 * `prompt_cache_retention` / `prompt_cache_options` / `session_id`），
 * 不钉系统提示，不写任何缓存头。
 *
 * `dsh-opendesign` 只给分析器标签（Kimi `dsh-kimi` 同款），绝不进上游
 * body。禁止 `Date.now()` / 随机数当会话 id。
 */
export declare const OPENDESIGN_STABLE_SESSION = "dsh-opendesign";
export declare function opendesignCacheSessionId(key: any): string | undefined;
export declare function opendesignConversationId(payload?: any): string;
export declare function applyOpendesignCache(payload?: any): {
    payload: any;
    cacheSessionId: string;
};
/** Open Design 不收 Codex / Grok / Cline 的会话头（上游 headers:{}，index.mjs:313）。 */
export declare function opendesignCacheHeaders(): {};
