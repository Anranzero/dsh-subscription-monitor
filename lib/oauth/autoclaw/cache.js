/**
 * AutoClaw prompt cache。
 *
 * AutoClaw 的 wire 上没有任何缓存亲和字段——没有 Codex 的
 * `prompt_cache_key`、没有 Grok 的 `x-grok-conv-id`、没有会话头（upstream
 * loader 的 chat 请求只带鉴权 + 客户端指纹 + 每请求 nonce，index.mjs:575-601 /
 * 490-507）。上游插件也不做 system 停车：网关强制的官方 system 前缀
 * （request.ts）本身就是稳定头。
 *
 * 本模块只做两件事：剥掉 DSH 的缓存字段（绝不原样发上游），给分析器一个
 * 家族常量兜底。绝不用 Date.now()/random 造会话 id；不 import 别家的 cache。
 */
export const AUTOCLAW_STABLE_SESSION = 'dsh-autoclaw';
export const AUTOCLAW_CN_STABLE_SESSION = 'dsh-autoclaw-cn';
/** The analyzer-visible fallback constant of one build (never pins). */
export function autoclawStableSession(site) {
    return site?.id === 'autoclaw-cn' ? AUTOCLAW_CN_STABLE_SESSION : AUTOCLAW_STABLE_SESSION;
}
/** A fallback id is not a conversation: it never pins a system prompt. */
export function isAutoclawFallback(site, id) {
    const stable = autoclawStableSession(site);
    return typeof id !== 'string' || id === '' || id === stable || id.startsWith(`${stable}:`);
}
/** 家族自己的会话键清洗（与别家同规则、不同模块——缓存隔离按家族算）。 */
export function autoclawCacheSessionId(key) {
    if (typeof key !== 'string')
        return undefined;
    const cleaned = key.trim().replace(/[^A-Za-z0-9._:-]/g, '-');
    if (!cleaned)
        return undefined;
    return cleaned.slice(0, 64);
}
/**
 * 剥 DSH 缓存字段：`session_id` / `prompt_cache_key` / retention / options
 * 全部删去（上游网关拒收未知字段的风险 + 绝不把 DSH 会话 id 发上游）。
 * cacheSessionId 只给分析器记账，兜底常量不是会话。
 */
export function applyAutoclawCache(site, payload = {}) {
    const cacheSessionId = autoclawCacheSessionId(payload.session_id)
        ?? autoclawCacheSessionId(payload.prompt_cache_key)
        ?? autoclawStableSession(site);
    const next = { ...payload };
    delete next.prompt_cache_key;
    delete next.prompt_cache_retention;
    delete next.prompt_cache_options;
    delete next.session_id;
    return { payload: next, cacheSessionId };
}
