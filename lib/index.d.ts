/**
 * dsh-plugin-oauth-subs host half.
 *
 * A Cordis plugin (export apply + inject + Config) that:
 *   1. runs a loopback OpenAI Responses proxy on 127.0.0.1:<port>
 *   2. drives ChatGPT Codex PKCE, xAI Grok device-code / PKCE,
 *      Zhipu GLM Z.ai / BigModel CLI-poll, AWS Kiro (Social / Builder ID /
 *      IdC / Entra / API key), Google Antigravity, Cursor, Ollama Cloud,
 *      Kimi Code Plan, Devin Agent and Open Design (Design Plan) logins
 *   3. syncs logged-in catalogs into llm-pi-ai
 *
 * The client half (左侧栏面板：插件按钮下方的订阅入口 →
 * 额度/模型/设置工作台) is discovered from package.json `dsh.client` —
 * this module only owns the node process.
 */
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-plugin-oauth-subs";
export declare const inject: string[];
/** Schemastery Standard Schema — Cordis reads Config["~standard"].validate. */
export declare const Config: z<Schemastery.ObjectS<{
    port: z<number, number>;
    provider: z<string, string>;
    dataDir: z<string, string>;
    grokLogin: z<"pkce" | "device", "pkce" | "device">;
    proxyUrl: z<string, string>;
    cursorProxy: z<string, string>;
}>, Schemastery.ObjectT<{
    port: z<number, number>;
    provider: z<string, string>;
    dataDir: z<string, string>;
    grokLogin: z<"pkce" | "device", "pkce" | "device">;
    proxyUrl: z<string, string>;
    cursorProxy: z<string, string>;
}>>;
export declare function registerRpc(ctx: any, controller: any): void;
export declare function apply(ctx: any, config?: any): void;
export { CODEX_CLIENT_ID, CODEX_AUTHORIZE_URL, CODEX_TOKEN_URL, CODEX_API_URL, CODEX_ORIGINATOR, CODEX_USER_AGENT, codexCredentialHeaders, } from './oauth/codex/index.js';
export { GROK_CLIENT_ID, GROK_DISCOVERY_URL, GROK_API_URL, GROK_USER_AGENT, GROK_LARGE_CONTEXT, GROK_47_CONTEXT, GROK_REASONING_45, GROK_REASONING_46, GROK_REASONING_47, GROK_FAST_MODEL_IDS, grokCredentialHeaders, } from './oauth/grok/index.js';
export { GLM_CLIENT_ID, GLM_CODING_URL, GLM_AUTHORIZE_URL, GLM_APP_VERSION, GLM_USER_AGENT, glmDesktopHeaders, glmUpstreamHeaders, } from './oauth/glm/index.js';
export { KIRO_PORTAL_URL, KIRO_MODELS, kiroUsageHeaders, kiroSession, } from './oauth/kiro/index.js';
export { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_API_URL, ANTIGRAVITY_STREAM_URL, antigravityRequestUserAgent, antigravityChatHeaders, } from './oauth/antigravity/index.js';
export { CURSOR_CLIENT_VERSION, CURSOR_MODELS, cursorChatHeaders, cursorSession, } from './oauth/cursor/index.js';
export { OLLAMA_MODELS, OLLAMA_CHAT_URL, ollamaSession, ollamaUpstreamHeaders, } from './apikey/ollama/index.js';
export { KIMI_CLIENT_ID, KIMI_MODELS, KIMI_CHAT_URL, kimiSession, kimiUpstreamHeaders, } from './oauth/kimi/index.js';
export { DEVIN_MODELS, DEVIN_AUTHORIZE_URL, DEVIN_TOKEN_URL, devinSession, normalizeDevinToken, } from './oauth/devin/index.js';
export { CLINE_MODELS, CLINE_API_BASE, CLINE_CHAT_URL, CLINE_WORKOS_CLIENT_ID, clineSessionFromAuthData, } from './oauth/cline/index.js';
export { clineEngineAuthorize, fetchClineQuotaEngine, refreshClineEngine, resetClineEnginePlugin } from './oauth/cline/engine.js';
export { WORKBUDDY_SITES, WORKBUDDY_MODELS, WORKBUDDY_AI_MODELS, WORKBUDDY_CLI_USER_AGENT, workbuddyChatUrl, } from './oauth/workbuddy/index.js';
export { fetchWorkbuddyQuotaEngine, fetchWorkbuddyAiQuotaEngine, refreshWorkbuddyEngine, resetWorkbuddyEnginePlugin, } from './oauth/workbuddy/engine.js';
export { applyWorkbuddyCache, resetWorkbuddyPins, } from './oauth/workbuddy/cache.js';
export { applyWorkbuddyChatBody, applyWorkbuddyThinking, applyWorkbuddyStreamUsage, mapWorkbuddyUsage, workbuddyQuotaFailure, } from './oauth/workbuddy/request.js';
export { toWorkbuddyCatalogRows, toWorkbuddyEfforts, refreshWorkbuddyCatalog, } from './oauth/workbuddy/catalog.js';
export { OAUTH_CREDENTIAL_REF } from './oauth/models.js';
export { ModelSwitch } from './oauth/model-switch.js';
export { defaultDataDir } from './oauth/store.js';
export { AuthController } from './oauth/controller.js';
export { applyFastMode, modelSupportsFastMode } from './utils/fast-mode.js';
export { CONTEXT_VARIANT_SUFFIX, codexMaxContextWindow, applyContextMode, isCodex900kBase, peelContextSuffix, } from './utils/context-mode.js';
export { parseCodexUsage, parseResetCredits } from './oauth/codex/quota.js';
export { parseGrokBilling } from './oauth/grok/quota.js';
export { parseGlmQuota, parseGlmResetCards } from './oauth/glm/quota.js';
export { parseKiroUsage } from './oauth/kiro/quota.js';
export { parseCursorPeriodUsage } from './oauth/cursor/quota.js';
export { parseKimiUsage } from './oauth/kimi/quota.js';
export { parseDevinUserStatus } from './oauth/devin/quota.js';
export { QuotaStore } from './oauth/quota.js';
export { AUTOCLAW_SITES, AUTOCLAW_PREEMPT_MS } from './oauth/autoclaw/index.js';
export { autoclawEngineAuthorizeBrowser, autoclawEngineAuthorizeSms, fetchAutoclawQuotaEngine, fetchAutoclawCnQuotaEngine, refreshAutoclawEngine, resetAutoclawEnginePlugin, } from './oauth/autoclaw/engine.js';
export { AUTOCLAW_MODELS, AUTOCLAW_CN_MODELS } from './oauth/autoclaw/catalog.js';
export { OPENDESIGN_API_BASE, OPENDESIGN_CHAT_URL, OPENDESIGN_CONTROL_ORIGIN, OPENDESIGN_LINK_ORIGIN, OPENDESIGN_USER_AGENT, opendesignSession, opendesignUpstreamHeaders, } from './oauth/opendesign/index.js';
export { fetchOpendesignQuotaEngine, opendesignEngineHop, resetOpendesignEnginePlugin } from './oauth/opendesign/engine.js';
export { KIMI_WORK_CHAT_URL, KIMI_WORK_MODELS_URL, KIMI_WORK_USER_AGENT, KIMI_WORK_API_BASE, kimiWorkSession, readKimiWorkDesktop, refreshKimiWork, kimiWorkAccountRef, } from './oauth/kimi-work/index.js';
export { applyKimiWorkCache, kimiWorkCacheSessionId, KIMI_WORK_STABLE_SESSION, resetKimiWorkPins, } from './oauth/kimi-work/cache.js';
export { applyKimiWorkThinking, mapKimiWorkUsage } from './oauth/kimi-work/request.js';
export { fetchKimiWorkQuota } from './oauth/kimi-work/engine.js';
export { kimiWorkCatalogModels, toKimiWorkPickerModels, refreshKimiWorkCatalog, resetKimiWorkCatalogCache, } from './oauth/kimi-work/catalog.js';
export { loginKimiWork, importKimiWork, maybeAutoImportKimiWork, discoverKimiWork, KIMI_WORK_IMPORT_EMPTY, } from './oauth/kimi-work/accounts.js';
export { MIMO_HOSTS, MIMO_DEFAULT_REGION, MIMO_ACCOUNT_ORIGIN, MIMO_APP_VERSION, MIMO_SOURCE, MIMO_USER_AGENT, MIMO_PREEMPT_MS, MIMO_RENEW_AFTER_MS, MIMO_MODELS, mimoSession, parseMimoStored, refreshMimo, mimoChatUrl, mimoServerTime, } from './oauth/mimo/index.js';
export { applyMimoCache, mimoCacheSessionId, resetMimoPins } from './oauth/mimo/cache.js';
export { applyMimoThinking, applyMimoStreamUsage } from './oauth/mimo/request.js';
export { fetchMimoQuota, parseMimoUsage } from './oauth/mimo/quota.js';
export { forwardMimo } from './oauth/mimo/transport.js';
export { ZED_SITE, ZED_CLOUD, ZED_VERSION, ZED_SIGN_IN_SUCCEEDED, ZED_SIGN_IN_TIMEOUT_MS, ZED_NEVER_EXPIRES, ZED_PLAN_NAMES, ZED_MODELS, zedUserAgent, zedModelsUrl, zedCompletionsUrl, zedSignInUrl, zedStateOf, refreshZed, zedModelToken, resetZedModelTokens, } from './oauth/zed/index.js';
export { applyZedCache } from './oauth/zed/cache.js';
export { zedCatalogModels, toZedPickerRows, fetchZedModels, refreshZedCatalog, resetZedCatalogCache } from './oauth/zed/catalog.js';
export { fetchZedQuotaEngine, forwardZedEngine, resetZedEnginePlugin } from './oauth/zed/engine.js';
export { loginZed, discoverZed, rememberZedIdentity, cancelZedLogin } from './oauth/zed/accounts.js';
export { formatPlanLabel, CODEX_PLAN_NAMES } from './oauth/plan.js';
export { REPO_URL, REPO_SLUG, installedVersion, fresherVersion, fetchLatest, localUpdateInfo, profileFromBaseUrl, isElectronManagedProfile, pluginUpdateCommand, } from './utils/update.js';
