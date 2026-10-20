/**
 * Command Code（api.commandcode.ai）— 常量 + API key session + 模型目录。
 *
 * Command Code CLI `command-code@1.84.0`（npm 包 `command-code`，bin 别名
 * `cmd`/`cmdc`/`commandcode`）发：
 *
 *   GET  /alpha/whoami?limits=1
 *   GET  /alpha/billing/credits[?orgId=…]
 *   GET  /alpha/billing/subscriptions[?orgId=…]
 *   GET  /alpha/usage/summary[?orgId=…&since=…]
 *   POST /alpha/generate               ← CLI 自有 JSONL 流协议
 *
 * Provider API 的 /provider/v1/chat/completions 与 /provider/v1/messages
 * 可由宿主直接调用；Go 套餐无 API 权限，仍由引擎适配 CLI JSONL。
 *
 * 凭据：`COMMAND_CODE_API_KEY` 环境变量优先，其次 `~/.commandcode/auth.json`
 * 的 `apiKey`（CLI `getCommandAuthKey` 同序）。Bearer，无 refresh。
 *
 * 模型目录：CLI bundle 内嵌目录（1.84.0 为 100 行，8 行 hidden——本表取 92 个
 * 可见行；可选性看行上的 hidden，不再另有 hidden Set）。
 * 1.83.0 退役 inclusionai/ling-3.0-flash 两行（整行删除，不是标 hidden）。
 * reasoningEfforts 取目录行自带的列表；没有条目不发明 fallback。
 * contextWindow 缺省回填 CLI 默认 200000。/alpha/models 不存在；
 * 公开 GET /provider/v1/models 只刷新成员与窗口。
 * 规划价目（CLI `rr` 表，USD/月）：individual-go $10 / individual-provider
 * $15 / individual-pro $30 / individual-pro-v1 $80 / teams-pro $40 /
 * individual-goat $70 / individual-max $150 / individual-ultra $300。
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { outboundFetch } from '../../utils/outbound.js';
import { catalogRows } from '../../catalog/index.js';
const COMMAND_CODE_API_BASE = 'https://api.commandcode.ai';
export const COMMAND_CODE_GENERATE_URL = `${COMMAND_CODE_API_BASE}/alpha/generate`;
const COMMAND_CODE_WHOAMI_URL = `${COMMAND_CODE_API_BASE}/alpha/whoami`;
/**
 * The vendor's own model list (`{object:'list', data:[{id,name,context_length,supported_endpoints}]}`).
 * Public — it answers without a key (live 2026-10-10: 200, 87 rows) — and it is
 * not the CLI's path: `/alpha/generate` stays the inference surface.
 */
export const COMMAND_CODE_PROVIDER_MODELS_URL = `${COMMAND_CODE_API_BASE}/provider/v1/models`;
/** The engine loader's Provider-API chat endpoint (Go keys it reroutes to /alpha/generate itself). */
export const COMMAND_CODE_PROVIDER_CHAT_URL = `${COMMAND_CODE_API_BASE}/provider/v1/chat/completions`;
/** CLI 发 `x-command-code-version` 的值；无 header 时上游照跑（401/计费门正常）。 */
const COMMAND_CODE_CLI_VERSION = '1.84.0';
/** CLI `max_tokens ?? 64000` 上限；无 per-model output cap。 */
export const COMMAND_CODE_MAX_TOKENS = 64_000;
/** Static catalog. Rows live in `src/catalog/models.json` under `"command-code"`; per-model output cap comes from `COMMAND_CODE_MAX_TOKENS` at the harness seam. */
export const COMMAND_CODE_MODELS = catalogRows('command-code');
const MODEL_BY_ID = new Map(COMMAND_CODE_MODELS.map((row) => [row.id, row]));
export function commandCodeModelById(id) {
    const wanted = String(id ?? '').trim();
    return wanted ? MODEL_BY_ID.get(wanted) : undefined;
}
/**
 * API key 校验：`user_…` 前缀是 CLI 写入 auth.json 的形态，但只做长度
 * 兜底不硬绑前缀（env 里可能是派生 key）。拒绝换行 / 控制符，防止
 * 粘贴把多行 secret 拼进 Authorization。
 */
export function parseCommandCodeApiKey(input) {
    const key = typeof input === 'string' ? input.trim() : '';
    if (!key)
        throw new Error('Command Code API key is empty');
    if (/[\r\n\t]/.test(key) || key.length < 8)
        throw new Error('Command Code API key is invalid');
    return key;
}
/**
 * /alpha/whoami → session.account / planType / accountId 候选。
 * `{ success, user:{id,name,email,userName}, org:{id,…}|null }`；
 * 部分部署回 `{user:…}` 无 success 包装。身份显示优先级：userName >
 * email > name > user.id —— userName 是 CLI 登录后回显的字段。
 */
export function parseCommandCodeWhoami(payload) {
    const user = payload && typeof payload === 'object' ? payload.user : undefined;
    if (!user || typeof user !== 'object')
        return undefined;
    const id = typeof user.id === 'string' && user.id.trim() ? user.id.trim() : undefined;
    const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : undefined;
    const email = typeof user.email === 'string' && user.email.trim() ? user.email.trim() : undefined;
    const userName = typeof user.userName === 'string' && user.userName.trim() ? user.userName.trim() : undefined;
    const org = payload && typeof payload === 'object' && payload.org && typeof payload.org === 'object' ? payload.org : undefined;
    const orgId = org && typeof org.id === 'string' && org.id.trim() ? org.id.trim() : undefined;
    const account = userName ?? email ?? name ?? id;
    if (!account && !id)
        return undefined;
    return { id, name, email, userName, orgId, account };
}
/** CLI plan 价目表 `rr`（usage 面板），USD/月——键是订阅 planId 原文。 */
export const COMMAND_CODE_PLAN_CREDITS = Object.freeze({
    'individual-go': 10,
    'individual-goat': 70,
    'individual-pro': 30,
    'individual-pro-v1': 80,
    'individual-provider': 15,
    'individual-max': 150,
    'individual-ultra': 300,
    'teams-pro': 40,
});
/** CLI `or`/`Qr` 展示名（usage 面板 + getPlanDisplayName）。 */
const COMMAND_CODE_PLAN_NAMES = Object.freeze({
    'individual-go': 'Go',
    'individual-goat': 'GOAT',
    'individual-pro': 'Pro',
    'individual-pro-v1': 'Pro',
    'individual-provider': 'Provider',
    'individual-max': 'Max',
    'individual-ultra': 'Ultra',
    'teams-pro': 'Teams Pro',
});
/**
 * `getPlanInfo`: planId lowercased, `_`→`-`, longest-prefix match against the
 * plan table (so `individual-pro-v1` wins over `individual-pro`). Unknown ids
 * fall back to the `getPlanDisplayName` strip of `individual-`/`teams-`.
 * (Moved here from quota.ts — the label mapping outlives the quota wire.)
 */
export function commandCodePlanInfo(planId) {
    const text = typeof planId === 'string' ? planId.trim() : '';
    if (!text)
        return undefined;
    const normalized = text.toLowerCase().replace(/_/g, '-');
    const key = Object.keys(COMMAND_CODE_PLAN_CREDITS)
        .sort((a, b) => b.length - a.length)
        .find((candidate) => normalized.startsWith(candidate));
    if (key) {
        return {
            id: key,
            name: COMMAND_CODE_PLAN_NAMES[key] ?? key,
            monthlyCredits: COMMAND_CODE_PLAN_CREDITS[key],
        };
    }
    const stripped = normalized.replace(/^individual-/, '').replace(/^teams-/, 'teams-');
    return {
        id: normalized,
        name: stripped.charAt(0).toUpperCase() + stripped.slice(1),
        monthlyCredits: undefined,
    };
}
/** planType stored on the session → display label (plan.ts uses this). */
export function commandCodePlanLabel(planId) {
    return commandCodePlanInfo(planId)?.name;
}
/** session.account / displayName 的命名空间前缀（fingerprint 兜底时）。 */
const COMMAND_CODE_ACCOUNT_PREFIX = 'command-code';
/** Stable vault id seed that is not the raw key (sha256, not a key tail). */
function commandCodeAccountFingerprint(key) {
    return createHash('sha256').update(String(key ?? '')).digest('hex').slice(0, 8);
}
/** Vault / card id before /alpha/whoami resolves a human identity. */
export function commandCodeDefaultAccount(key) {
    return `${COMMAND_CODE_ACCOUNT_PREFIX}-${commandCodeAccountFingerprint(key)}`;
}
export function isCommandCodeOpaqueAccount(account) {
    // Fingerprint vault ids (`command-code-<sha256:8>`) plus the keyless
    // accountIdOf fallbacks stay out of the UI — whoami replaces them.
    return /^command-code-(account|[0-9a-f]{8})$/i.test(String(account ?? '').trim());
}
export function commandCodeSession(fields = {}) {
    const accessToken = parseCommandCodeApiKey(fields.accessToken ?? fields.apiKey);
    const source = typeof fields.source === 'string' && fields.source.trim() ? fields.source.trim() : 'paste';
    const session = {
        accessToken,
        refreshToken: accessToken, // 无 refresh：对称字段存同值，TokenManager 永不真正刷新
        expiresAt: Number.MAX_SAFE_INTEGER,
        account: typeof fields.account === 'string' && fields.account.trim()
            ? fields.account.trim()
            : commandCodeDefaultAccount(accessToken),
        source,
    };
    if (typeof fields.userId === 'string' && fields.userId.trim())
        session.userId = fields.userId.trim();
    if (typeof fields.userName === 'string' && fields.userName.trim())
        session.userName = fields.userName.trim();
    if (typeof fields.email === 'string' && fields.email.trim())
        session.email = fields.email.trim();
    if (typeof fields.orgId === 'string' && fields.orgId.trim())
        session.orgId = fields.orgId.trim();
    return session;
}
function commandCodeBearer(session) {
    return `Bearer ${session.accessToken}`;
}
/** 上游 hop 头：CLI 发 Authorization + x-command-code-version + x-cli-environment。 */
export function commandCodeUpstreamHeaders(session, extra = {}) {
    return {
        'content-type': 'application/json',
        authorization: commandCodeBearer(session),
        'x-command-code-version': COMMAND_CODE_CLI_VERSION,
        'x-cli-environment': 'production',
        ...extra,
    };
}
/* ---- credentials sources ------------------------------------------------- */
/** Env var the CLI reads first (`getCommandApiKeyFromEnv`). */
export const COMMAND_CODE_API_KEY_ENV = 'COMMAND_CODE_API_KEY';
/**
 * CLI auth dir resolves to `~/.commandcode/auth.json`
 * (`resolveCommandAuthDir` — `COMMANDCODE_HOME` is not a thing; the dir name
 * is fixed `.commandcode`).
 */
export function commandCodeAuthFilePath(home) {
    const dir = typeof home === 'string' && home.trim() ? home.trim() : homedir();
    return join(dir, '.commandcode', 'auth.json');
}
/** Masked hint for account rows that carry no friendlier account name. */
export function commandCodeKeyHint(key) {
    const text = typeof key === 'string' ? key.trim() : '';
    if (text.length <= 8)
        return text ? '••••' : '';
    return `${text.slice(0, 9)}…${text.slice(-4)}`;
}
const COMMAND_CODE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Friendly account label; opaque fingerprint/key-tail ids and raw user uuids stay out of the UI. */
export function pickCommandCodeHumanAccount(...candidates) {
    for (const candidate of candidates) {
        const text = typeof candidate === 'string' ? candidate.trim() : '';
        if (text && !isCommandCodeOpaqueAccount(text) && !COMMAND_CODE_UUID_RE.test(text))
            return text;
    }
    return undefined;
}
export function commandCodeSourceLabel(source) {
    if (source === 'env')
        return 'env';
    if (source === 'cli')
        return 'CLI';
    if (source === 'browser')
        return 'browser';
    if (source === 'paste')
        return 'key';
    return undefined;
}
/* ---- identity + permanent-key refresh ------------------------------------- */
/**
 * `/alpha/whoami` → identity. Returns undefined on any failure (paste form
 * stores the account hint instead); never throws for quota/identity display.
 */
export async function resolveCommandCodeIdentity(session, { fetchFn = outboundFetch, signal } = {}) {
    const key = typeof session?.accessToken === 'string' ? session.accessToken.trim() : '';
    if (!key)
        return undefined;
    try {
        const response = await fetchFn(`${COMMAND_CODE_WHOAMI_URL}?limits=1`, {
            method: 'GET',
            headers: commandCodeUpstreamHeaders(session),
            signal,
        });
        if (!response.ok)
            return undefined;
        const identity = parseCommandCodeWhoami(await response.json());
        return identity?.account ? identity : undefined;
    }
    catch {
        return undefined;
    }
}
/** Permanent key: TokenManager never refreshes (expiresAt = MAX_SAFE_INTEGER). */
export async function refreshCommandCode(session) {
    if (!session || typeof session.accessToken !== 'string' || !session.accessToken.trim()) {
        throw new Error('command-code session needs an API key');
    }
    return session;
}
export function isCommandCodePermanentRefreshError() {
    return false;
}
