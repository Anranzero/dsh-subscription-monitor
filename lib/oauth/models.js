/**
 * Project every family's catalog into llm-pi-ai provider routes (ids, DSH
 * `api` / effort / compat constraints, picker keys and aliases). Writing them
 * to the host is harness-sync.ts; the picker's persisted state is
 * model-switch.ts.
 */
import { CODEX_MODELS, CODEX_REASONING_EFFORTS } from './codex/index.js';
import { CHATGPT_MODELS } from './chatgpt/index.js';
import { GROK_MODELS } from './grok/index.js';
import { AUTOCLAW_CN_MODELS, AUTOCLAW_MODELS } from './autoclaw/catalog.js';
import { OPENDESIGN_MODELS } from './opendesign/index.js';
import { GLM_MODELS } from './glm/index.js';
import { KIRO_MODELS } from './kiro/index.js';
import { ANTIGRAVITY_MODELS } from './antigravity/index.js';
import { CURSOR_MODELS } from './cursor/index.js';
import { OLLAMA_MODELS } from '../apikey/ollama/index.js';
import { MINIMAX_MODELS } from '../apikey/minimax/index.js';
import { COMMAND_CODE_MAX_TOKENS, COMMAND_CODE_MODELS } from '../apikey/command-code/index.js';
import { KIMI_MODELS } from './kimi/index.js';
import { DEVIN_MODELS } from './devin/index.js';
import { CLINE_MODELS } from './cline/index.js';
import { WORKBUDDY_MODELS, WORKBUDDY_AI_MODELS } from './workbuddy/index.js';
import { KIMI_WORK_MODELS } from './kimi-work/index.js';
import { MIMO_MODELS } from './mimo/index.js';
import { ZED_MODELS } from './zed/index.js';
import { opencodeGoRoutes, opencodeZenRoutes } from '../apikey/opencode-go/models.js';
import { modelSupportsFastMode } from '../utils/fast-mode.js';
import { familyMaxContextWindow, formatWindow, maxContextWindowOf } from '../utils/context-mode.js';
export const OAUTH_CREDENTIAL_REF = 'DSH_OAUTH_SUBS_API_KEY';
/**
 * DSH llm-pi-ai `api` is a closed union (`openai-completions` |
 * `openai-responses` | `anthropic-messages`). Bare `openai` is refused
 * and the whole section write is dropped, so Codex/Grok stay and GLM /
 * Kiro / Antigravity never land in settings.yaml.
 */
export const HARNESS_RESPONSES_API = 'openai-responses';
export const HARNESS_COMPLETIONS_API = 'openai-completions';
export const HARNESS_ANTHROPIC_API = 'anthropic-messages';
/**
 * DSH `reasoningEfforts` keys (`packages/llm/llm-pi-ai` THINKING_LEVELS).
 * Vendor wire spellings belong in the *value* (`off: "none"`), never as a
 * key. An unknown key fails the whole `llm-pi-ai` mutate, so the family
 * never lands in settings.yaml.
 */
export const DSH_THINKING_LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
/**
 * Completions-only `compat` switches. DSH `@deepseek-ai/dsh-llm-pi-ai`
 * `assertServiceable` (0.1.2-alpha.2 `catalog.ts`) refuses a route-level
 * field that no model on the route can read:
 * `sets compat "${field}", but no model on the route speaks a protocol that takes it`.
 * `supportsReasoningEffort` / `thinkingFormat` live on
 * `openai-completions` only — not `anthropic-messages` or `openai-responses`.
 * Stamping either on GLM's Anthropic hop aborts the atomic `llm-pi-ai`
 * mutate, so `oauth-kiro` never lands in settings.yaml.
 */
export const DSH_COMPLETIONS_ONLY_COMPAT = Object.freeze(['supportsReasoningEffort', 'thinkingFormat']);
export { CODEX_REASONING_EFFORTS };
/**
 * Local stand-in for DSH `assertServiceable` on one owned route. The host
 * package is not a dependency; this matches the JSON shape it rejects so a
 * bad payload fails here instead of silently keeping the last good section.
 */
export function assertDshServiceableProvider(provider, value) {
    if (value == null || typeof value !== 'object')
        return;
    const record = value;
    const api = record.api;
    if (typeof api === 'string' && api !== HARNESS_COMPLETIONS_API && api !== HARNESS_RESPONSES_API && api !== HARNESS_ANTHROPIC_API) {
        throw new Error(`llm-pi-ai: provider "${provider}" api must be openai-completions | openai-responses | anthropic-messages`);
    }
    for (const model of (Array.isArray(record.models) ? record.models : [])) {
        const efforts = model.reasoningEfforts;
        if (efforts && typeof efforts === 'object') {
            if (Object.keys(efforts).length === 0) {
                throw new Error(`llm-pi-ai: model "${model.id}" has an empty reasoningEfforts; declare the offered levels, set false for a non-reasoning model, or omit the field to keep the installed catalog's capability`);
            }
            for (const level of Object.keys(efforts)) {
                if (!DSH_THINKING_LEVELS.includes(level)) {
                    throw new Error(`llm-pi-ai: model "${model.id}" reasoningEfforts key "${level}" is not ${DSH_THINKING_LEVELS.join('|')} (vendor spelling belongs in the value, e.g. off: "none")`);
                }
            }
        }
    }
    const compat = record.compat;
    if (compat && typeof compat === 'object' && api !== HARNESS_COMPLETIONS_API) {
        const compatMap = compat;
        for (const field of DSH_COMPLETIONS_ONLY_COMPAT) {
            if (compatMap[field] !== undefined) {
                throw new Error(`llm-pi-ai: provider "${provider}" sets compat "${field}", but no model on the route speaks a protocol that takes it; it exists on openai-completions`);
            }
        }
    }
}
/**
 * Context-variant picker rows no longer exist (the large window became the
 * per-row custom-context ceiling), so nothing is opt-in. Stale `-900k` /
 * `-1m` keys from older switch files are unknown to the catalog and never
 * surface; real ids that merely end in a context suffix (Devin's `-1m`
 * backend variants) are ordinary rows. `isLargeContextKey` stays in
 * context-mode for hop peeling of routes older versions wrote.
 */
export function isOptInKey(_key) {
    return false;
}
export function modelKey(provider, id) {
    return `${provider}/${id}`;
}
/**
 * Custom input-context bounds (tokens). The floor keeps compaction headroom
 * math meaningful; the ceiling is an absolute sanity cap for untrusted
 * persisted entries — live validation caps each row at its own maximum
 * (`maxContextOfRow`), which never exceeds this.
 */
export const MODEL_CONTEXT_MIN = 4_096;
export const MODEL_CONTEXT_MAX = 2_097_152;
/**
 * A row's custom input-context ceiling: the vendor's large window when the
 * row advertises one (`maxContextWindow`, mirroring Codex CLI
 * `max_context_window`: Codex 872K, GLM 1M above the plan's default input
 * window), else its catalog window. `-fast` twins share the base model's
 * ceiling. The lookup is family-scoped because vendor ids collide across
 * families. Rows must come
 * from an un-overridden catalog build — an already-customized `contextWindow`
 * would shrink the ceiling on re-edit.
 */
export function maxContextOfRow(row, family) {
    const base = String(row?.id ?? '').replace(/-fast$/, '');
    const max = family !== undefined
        ? familyMaxContextWindow(family, base)
        : maxContextWindowOf(base);
    if (max !== undefined)
        return max;
    const window = Number(row?.contextWindow);
    return Number.isInteger(window) && window > 0 ? window : MODEL_CONTEXT_MIN;
}
/**
 * Apply per-model context overrides keyed by `modelKey(provider, id)` after
 * the catalogs are projected into harness rows. Key-exact: base, context
 * variant (`-900k`/`-1m`), and `-fast` twin rows are overridden
 * independently, and a variant keeps its id (the suffix is peeled upstream
 * regardless of the window). Non-mutating; providers without hits are
 * returned as-is.
 */
export function applyContextOverrides(providers, contexts = {}) {
    const keys = Object.keys(contexts ?? {});
    if (keys.length === 0)
        return providers;
    const out = {};
    for (const [provider, value] of Object.entries(providers)) {
        const models = value?.models;
        if (!Array.isArray(models) || !models.some((model) => contexts[`${provider}/${model.id}`] !== undefined)) {
            out[provider] = value;
            continue;
        }
        out[provider] = {
            ...value,
            models: models.map((model) => {
                const contextWindow = contexts[`${provider}/${model.id}`];
                return contextWindow === undefined ? model : { ...model, contextWindow };
            }),
        };
    }
    return out;
}
/**
 * Write a family's default effort as its route's provider `reasoning` (DSH
 * has no per-model default). DSH does not clamp — a level a model does not
 * declare fails its requests — so a model without the level gets that key
 * mapped to its own nearest one: the highest below (`off` only when `off` was
 * asked), else the lowest above; the picker then shows it under the global
 * name. A route with a non-reasoning model gets no default at all: DSH would
 * reject that model's every request that picks no effort.
 */
export function withDefaultEffort(value, level) {
    const models = value.models ?? [];
    if (!level || models.length === 0)
        return value;
    const rank = (l) => DSH_THINKING_LEVELS.indexOf(l);
    const mapped = models.map((model) => {
        const efforts = model.reasoningEfforts;
        if (!efforts || typeof efforts !== 'object')
            return undefined;
        if (efforts[level] !== undefined)
            return model;
        const declared = DSH_THINKING_LEVELS.filter((l) => efforts[l] != null && (l !== 'off' || level === 'off'));
        const nearest = declared.filter((l) => rank(l) < rank(level)).at(-1) ?? declared.find((l) => rank(l) > rank(level));
        return nearest ? { ...model, reasoningEfforts: { ...efforts, [level]: efforts[nearest] } } : undefined;
    });
    if (!mapped.every((model) => model !== undefined))
        return value;
    return { ...value, reasoning: level, models: mapped };
}
export const FAMILY_IDS = Object.freeze(['codex', 'chatgpt', 'grok', 'glm', 'kiro', 'antigravity', 'cursor', 'ollama', 'kimi', 'devin', 'cline', 'command-code', 'workbuddy', 'workbuddy-ai', 'kimi-work', 'autoclaw', 'autoclaw-cn', 'opendesign', 'mimo', 'minimax', 'zed']);
/**
 * OpenCode picker families: direct API-key routes, not OAuth logins, and no
 * loopback hop. Two products share the one OpenCode account behind
 * `OPENCODE_API_KEY` — Go (subscription meters) and Zen (pay-as-you-go) —
 * so each route id is its own picker family while the credential, vault,
 * Console session and account card stay one. The plugin writes the complete
 * catalog it ships on these routes; DSH's built-in `opencode-go` / `opencode`
 * catalog routes stay the user's to enable from the host's Models page.
 * Without `OPENCODE_API_KEY` every one of them is only locked (checkbox off).
 */
export const APIKEY_FAMILY_IDS = Object.freeze([
    ...opencodeGoRoutes().map((route) => route.id),
    ...opencodeZenRoutes().map((route) => route.id),
]);
/** Every family the Settings picker can toggle. */
export const MODEL_FAMILY_IDS = Object.freeze([...FAMILY_IDS, ...APIKEY_FAMILY_IDS]);
/** Dropped families. Still unset leftover harness routes; never written back. */
export const RETIRED_FAMILY_IDS = Object.freeze(['opencode', 'anthropic', 'copilot']);
export function ownedProviderIds(prefix) {
    return [...FAMILY_IDS, ...RETIRED_FAMILY_IDS].map((id) => `${prefix}-${id}`);
}
function harnessInput(model) {
    if (Array.isArray(model.input) && model.input.length > 0)
        return [...model.input];
    return ['text', 'image'];
}
function harnessReasoningEfforts(model) {
    const raw = model.reasoningEfforts;
    if (raw === false)
        return false;
    if (!raw || typeof raw !== 'object')
        return undefined;
    const efforts = {};
    for (const [level, wire] of Object.entries(raw)) {
        if (!DSH_THINKING_LEVELS.includes(level)) {
            throw new Error(`llm-pi-ai: model "${model.id}" reasoningEfforts key "${level}" is not ${DSH_THINKING_LEVELS.join('|')} (vendor spelling belongs in the value, e.g. off: "none")`);
        }
        efforts[level] = wire;
    }
    return efforts;
}
/**
 * Per-request completion budget written into the harness route — NOT the
 * vendor output ceiling. llm-pi-ai turns an explicit model `maxTokens` into
 * `defaultMaxTokens`, which DSH reserves against the context window on every
 * request and dsh-compaction-basic prices into its auto-compaction threshold
 * (`min(window*0.8, window - reserved - headroom 65536)`). Passing the real
 * 128k/500k cap would starve the threshold to ~25% of the window and compact
 * every step. 32768 is llm-pi-ai's own defaultMaxTokens.
 */
const HARNESS_REQUEST_MAX_TOKENS = 32_768;
function harnessMaxTokens(maxTokens) {
    const value = Number(maxTokens);
    if (!Number.isFinite(value) || value <= 0)
        return undefined;
    return Math.min(value, HARNESS_REQUEST_MAX_TOKENS);
}
function toHarnessModel(model) {
    const row = {
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        input: harnessInput(model),
    };
    const maxTokens = harnessMaxTokens(model.maxTokens);
    if (maxTokens !== undefined)
        row.maxTokens = maxTokens;
    const efforts = harnessReasoningEfforts(model);
    if (efforts !== undefined)
        row.reasoningEfforts = efforts;
    return row;
}
/**
 * Rows with `fastTier` grow a host-side `-fast` sibling (peeled before the
 * wire). `maxContextWindow` never expands a second picker row: each model
 * keeps exactly one default-window row, and the large window is the row's
 * custom input-context ceiling (`maxContextOfRow`).
 */
export function withPickerVariants(models) {
    const out = [];
    for (const model of models) {
        out.push(model);
        if (modelSupportsFastMode(model.id) && !String(model.id).endsWith('-fast')) {
            out.push({ ...model, id: `${model.id}-fast`, name: `${model.name} Fast` });
        }
    }
    return out;
}
function cursorHarnessModels(cursorModels) {
    if (Array.isArray(cursorModels) && cursorModels.length > 0)
        return cursorModels;
    return CURSOR_MODELS;
}
function ollamaHarnessModels(ollamaModels) {
    if (Array.isArray(ollamaModels) && ollamaModels.length > 0)
        return ollamaModels;
    return OLLAMA_MODELS;
}
function minimaxHarnessModels(minimaxModels) {
    if (Array.isArray(minimaxModels) && minimaxModels.length > 0)
        return minimaxModels;
    return MINIMAX_MODELS;
}
function kimiHarnessModels(kimiModels) {
    if (Array.isArray(kimiModels) && kimiModels.length > 0)
        return kimiModels;
    return KIMI_MODELS;
}
function devinHarnessModels(devinModels) {
    if (Array.isArray(devinModels) && devinModels.length > 0)
        return devinModels;
    return DEVIN_MODELS;
}
function kiroHarnessModels(kiroModels) {
    if (Array.isArray(kiroModels) && kiroModels.length > 0)
        return kiroModels;
    return KIRO_MODELS;
}
function glmHarnessModels(glmModels) {
    if (Array.isArray(glmModels) && glmModels.length > 0)
        return glmModels;
    return GLM_MODELS;
}
/** ChatGPT's own Fast twins: `fastTier` rows grow `<id>-fast` (peeled in chatgpt/request.ts). */
export function chatgptPickerModels(chatgptModels) {
    return chatgptHarnessModels(chatgptModels);
}
function chatgptHarnessModels(chatgptModels) {
    const rows = Array.isArray(chatgptModels) && chatgptModels.length > 0 ? chatgptModels : CHATGPT_MODELS;
    return rows.flatMap((model) => (model.fastTier === true && !String(model.id).endsWith('-fast')
        ? [model, { ...model, id: `${model.id}-fast`, name: `${model.name} Fast` }]
        : [model]));
}
function clineHarnessModels(clineModels) {
    if (Array.isArray(clineModels) && clineModels.length > 0)
        return clineModels;
    return CLINE_MODELS;
}
function opendesignHarnessModels(opendesignModels) {
    if (Array.isArray(opendesignModels) && opendesignModels.length > 0)
        return opendesignModels;
    return OPENDESIGN_MODELS;
}
/** One family, two builds: each build's live /v3/config rows, else its offline table. */
function workbuddyHarnessModels(workbuddyModels) {
    if (Array.isArray(workbuddyModels) && workbuddyModels.length > 0)
        return workbuddyModels;
    return WORKBUDDY_MODELS;
}
function workbuddyAiHarnessModels(workbuddyAiModels) {
    if (Array.isArray(workbuddyAiModels) && workbuddyAiModels.length > 0)
        return workbuddyAiModels;
    return WORKBUDDY_AI_MODELS;
}
/** Live desktop rows when a session is loaded, else the offline table. */
function kimiWorkHarnessModels(kimiWorkModels) {
    if (Array.isArray(kimiWorkModels) && kimiWorkModels.length > 0)
        return kimiWorkModels;
    return KIMI_WORK_MODELS;
}
/** Live /models rows when a session is loaded, else the offline table. */
function zedHarnessModels(zedModels) {
    if (Array.isArray(zedModels) && zedModels.length > 0)
        return zedModels;
    return ZED_MODELS;
}
/**
 * One family, three wires: each route carries only the vendor its wire speaks
 * (anthropic-messages → anthropic, responses → open_ai, chat → x_ai). The
 * vendor filter runs BEFORE toHarnessModel — it strips the field, so mapping
 * first would leave every route empty.
 */
function zedWireRows(zedModels, vendor) {
    return zedHarnessModels(zedModels)
        .filter((model) => model.vendor === vendor)
        .map(toHarnessModel);
}
/**
 * Command Code rows carry no per-model output cap — the CLI applies
 * `max_tokens ?? 64000` for every model, so the family constant is the real
 * cap toHarnessModel clamps against the request budget.
 */
function commandCodeHarnessModels(commandCodeModels) {
    const rows = Array.isArray(commandCodeModels) && commandCodeModels.length > 0
        ? commandCodeModels
        : COMMAND_CODE_MODELS;
    return rows.map((model) => ({ ...model, maxTokens: model.maxTokens ?? COMMAND_CODE_MAX_TOKENS }));
}
export function buildProviders({ prefix, origin, loggedIn, cursorModels, ollamaModels, minimaxModels, kiroModels, kimiModels, devinModels, glmModels, clineModels, commandCodeModels, chatgptModels = undefined, workbuddyModels, workbuddyAiModels, kimiWorkModels, opendesignModels, zedModels, contexts }) {
    const providers = {};
    if (loggedIn.codex) {
        providers[`${prefix}-codex`] = {
            displayName: 'ChatGPT Codex · Responses',
            api: HARNESS_RESPONSES_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            baseURL: `${origin}/codex/v1`,
            models: withPickerVariants(CODEX_MODELS).map(toHarnessModel),
        };
    }
    if (loggedIn.chatgpt) {
        // Sign in with ChatGPT → public Responses API. `-fast` twins ride
        // `service_tier: "priority"` (live-measured, see chatgpt/README 模型).
        providers[`${prefix}-chatgpt`] = {
            displayName: 'ChatGPT · Responses',
            api: HARNESS_RESPONSES_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            baseURL: `${origin}/chatgpt/v1`,
            models: chatgptHarnessModels(chatgptModels).map(toHarnessModel),
        };
    }
    if (loggedIn.grok) {
        providers[`${prefix}-grok`] = {
            displayName: 'Grok · Responses',
            api: HARNESS_RESPONSES_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            baseURL: `${origin}/grok/v1`,
            models: withPickerVariants(GROK_MODELS).map(toHarnessModel),
        };
    }
    if (loggedIn.glm) {
        providers[`${prefix}-glm`] = {
            displayName: 'GLM · Anthropic',
            api: HARNESS_ANTHROPIC_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Anthropic SDK posts `{baseURL}/v1/messages`. Completions leftover
            // still lives at /glm/v1/chat/completions until the next sync.
            // Anthropic thinking is hop `thinking: { type: enabled }`, not
            // completions-only compat. DSH rejects `supportsReasoningEffort` /
            // `thinkingFormat` on this protocol and the whole atomic mutate dies.
            //
            // forceAdaptiveThinking: pi-ai then dispatches the picker level as
            // `output_config.effort` (thinkingLevelMap values = GLM low/high/max),
            // which is exactly what ZCode's catalog map sends for 5.3 / 5.2.
            // allowEmptySignature: unsigned thinking blocks replay as `thinking`
            // with `signature: ""` (ZCode anthropic-reasoning-metadata.ts) instead
            // of being textified, so the reasoning prefix survives.
            compat: {
                forceAdaptiveThinking: true,
                allowEmptySignature: true,
            },
            baseURL: `${origin}/glm`,
            models: withPickerVariants(glmHarnessModels(glmModels)).map(toHarnessModel),
        };
    }
    if (loggedIn.kiro) {
        providers[`${prefix}-kiro`] = {
            displayName: 'Kiro · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            baseURL: `${origin}/kiro/v1`,
            compat: {
                supportsReasoningEffort: true,
                thinkingFormat: 'openai',
            },
            models: kiroHarnessModels(kiroModels).map(toHarnessModel),
        };
    }
    if (loggedIn.antigravity) {
        providers[`${prefix}-antigravity`] = {
            displayName: 'Antigravity · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            baseURL: `${origin}/antigravity/v1`,
            compat: {
                supportsReasoningEffort: true,
                thinkingFormat: 'openai',
            },
            models: ANTIGRAVITY_MODELS.map(toHarnessModel),
        };
    }
    if (loggedIn.cursor) {
        providers[`${prefix}-cursor`] = {
            displayName: 'Cursor · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /cursor/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/cursor`.
            baseURL: `${origin}/cursor`,
            compat: {
                supportsReasoningEffort: true,
                thinkingFormat: 'openai',
            },
            models: cursorHarnessModels(cursorModels).map(toHarnessModel),
        };
    }
    if (loggedIn.ollama) {
        providers[`${prefix}-ollama`] = {
            displayName: 'Ollama Cloud · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /ollama/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/ollama`.
            baseURL: `${origin}/ollama`,
            compat: {
                supportsReasoningEffort: true,
                thinkingFormat: 'openai',
            },
            models: ollamaHarnessModels(ollamaModels).map(toHarnessModel),
        };
    }
    if (loggedIn.minimax) {
        providers[`${prefix}-minimax`] = {
            displayName: 'MiniMax · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /minimax/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/minimax`.
            baseURL: `${origin}/minimax`,
            compat: {
                supportsReasoningEffort: true,
                thinkingFormat: 'openai',
            },
            models: minimaxHarnessModels(minimaxModels).map(toHarnessModel),
        };
    }
    if (loggedIn.kimi) {
        providers[`${prefix}-kimi`] = {
            displayName: 'Kimi · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /kimi/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/kimi`.
            baseURL: `${origin}/kimi`,
            compat: {
                supportsReasoningEffort: true,
                thinkingFormat: 'openai',
            },
            models: kimiHarnessModels(kimiModels).map(toHarnessModel),
        };
    }
    if (loggedIn.devin) {
        const devinRows = devinHarnessModels(devinModels).map(toHarnessModel);
        const devinHasEffort = devinRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-devin`] = {
            displayName: 'Devin · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /devin/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/devin`.
            baseURL: `${origin}/devin`,
            ...(devinHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: devinRows,
        };
    }
    if (loggedIn.cline) {
        const clineRows = clineHarnessModels(clineModels).map(toHarnessModel);
        const clineHasEffort = clineRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-cline`] = {
            displayName: 'Cline · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /cline/v1/chat/completions. DSH posts
            // `${baseURL}/v1/chat/completions`, so baseURL is `${origin}/cline`.
            baseURL: `${origin}/cline`,
            ...(clineHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: clineRows,
        };
    }
    if (loggedIn['command-code']) {
        const commandCodeRows = commandCodeHarnessModels(commandCodeModels).map(toHarnessModel);
        const commandCodeHasEffort = commandCodeRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-command-code`] = {
            displayName: 'Command Code · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /command-code/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/command-code`.
            baseURL: `${origin}/command-code`,
            ...(commandCodeHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: commandCodeRows,
        };
    }
    // One family, two builds, one route each: the China build (copilot.tencent.com)
    // and the international one (www.workbuddy.ai) answer different plans.
    if (loggedIn.workbuddy) {
        const workbuddyRows = workbuddyHarnessModels(workbuddyModels).map(toHarnessModel);
        const workbuddyHasEffort = workbuddyRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-workbuddy`] = {
            displayName: 'WorkBuddy · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /workbuddy/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/workbuddy`.
            baseURL: `${origin}/workbuddy`,
            ...(workbuddyHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: workbuddyRows,
        };
    }
    if (loggedIn['workbuddy-ai']) {
        const workbuddyAiRows = workbuddyAiHarnessModels(workbuddyAiModels).map(toHarnessModel);
        const workbuddyAiHasEffort = workbuddyAiRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-workbuddy-ai`] = {
            displayName: 'WorkBuddy AI · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /workbuddy-ai/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/workbuddy-ai`.
            baseURL: `${origin}/workbuddy-ai`,
            ...(workbuddyAiHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: workbuddyAiRows,
        };
    }
    if (loggedIn['kimi-work']) {
        const kimiWorkRows = kimiWorkHarnessModels(kimiWorkModels).map(toHarnessModel);
        const kimiWorkHasEffort = kimiWorkRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-kimi-work`] = {
            displayName: 'Kimi Work · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /kimi-work/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/kimi-work`.
            baseURL: `${origin}/kimi-work`,
            ...(kimiWorkHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: kimiWorkRows,
        };
    }
    // One family, two products: the overseas gateway and the CN managed one.
    // Static tables, read straight from the family constants (codex / grok /
    // antigravity shape — no live catalog, no BuildProvidersOptions input).
    if (loggedIn.autoclaw) {
        const autoclawRows = AUTOCLAW_MODELS.map(toHarnessModel);
        providers[`${prefix}-autoclaw`] = {
            displayName: 'AutoClaw · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /autoclaw/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/autoclaw`.
            baseURL: `${origin}/autoclaw`,
            models: autoclawRows,
        };
    }
    if (loggedIn['autoclaw-cn']) {
        const autoclawCnRows = AUTOCLAW_CN_MODELS.map(toHarnessModel);
        const autoclawCnHasEffort = autoclawCnRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-autoclaw-cn`] = {
            displayName: 'AutoClaw CN · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /autoclaw-cn/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/autoclaw-cn`.
            baseURL: `${origin}/autoclaw-cn`,
            ...(autoclawCnHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: autoclawCnRows,
        };
    }
    if (loggedIn.opendesign) {
        const opendesignRows = opendesignHarnessModels(opendesignModels).map(toHarnessModel);
        const opendesignHasEffort = opendesignRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-opendesign`] = {
            displayName: 'Open Design · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /opendesign/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/opendesign`.
            baseURL: `${origin}/opendesign`,
            ...(opendesignHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: opendesignRows,
        };
    }
    // Static two-row table straight from the family constant (codex / grok /
    // antigravity shape — no live catalog, no BuildProvidersOptions input). No
    // compat block: neither row declares reasoning.
    if (loggedIn.mimo) {
        providers[`${prefix}-mimo`] = {
            displayName: 'Xiaomi MiMo · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /mimo/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/mimo`.
            baseURL: `${origin}/mimo`,
            models: MIMO_MODELS.map(toHarnessModel),
        };
    }
    // One account, three wires, one baseURL: the route suffix names the api DSH
    // speaks, and each route lists only the vendor its wire talks to.
    if (loggedIn.zed) {
        providers[`${prefix}-zed`] = {
            displayName: 'Zed · Anthropic',
            api: HARNESS_ANTHROPIC_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // anthropic-messages hop is /zed/v1/messages, so baseURL is `${origin}/zed`.
            baseURL: `${origin}/zed`,
            models: zedWireRows(zedModels, 'anthropic'),
        };
        providers[`${prefix}-zed-responses`] = {
            displayName: 'Zed · Responses',
            api: HARNESS_RESPONSES_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Responses hop is /zed/v1/responses; DSH posts `{baseURL}/v1/responses`.
            baseURL: `${origin}/zed`,
            models: zedWireRows(zedModels, 'open_ai'),
        };
        const zedChatRows = zedWireRows(zedModels, 'x_ai');
        const zedChatHasEffort = zedChatRows.some((model) => model.reasoningEfforts && typeof model.reasoningEfforts === 'object');
        providers[`${prefix}-zed-chat`] = {
            displayName: 'Zed · Chat',
            api: HARNESS_COMPLETIONS_API,
            apiKeyEnv: OAUTH_CREDENTIAL_REF,
            // Completions hop is /zed/v1/chat/completions. DSH posts
            // `{baseURL}/v1/chat/completions`, so baseURL is `${origin}/zed`.
            baseURL: `${origin}/zed`,
            ...(zedChatHasEffort ? {
                compat: {
                    supportsReasoningEffort: true,
                    thinkingFormat: 'openai',
                },
            } : {}),
            models: zedChatRows,
        };
    }
    // pi-ai's openai-completions sends `prompt_cache_key = sessionId` (and
    // `prompt_cache_retention: "24h"`) only when the route asks for long
    // retention; the loopback auto-detects supportsLongCacheRetention. Without
    // it every Completions family falls back to its process-wide `dsh-<id>`
    // constant. Responses routes already get the id; on anthropic-messages
    // `long` means a 1h cache_control TTL, which is out of scope.
    for (const value of Object.values(providers)) {
        if (value.api === HARNESS_COMPLETIONS_API)
            value.cacheRetention = 'long';
    }
    return applyContextOverrides(providers, contexts);
}
export function describeProviders(providers) {
    return Object.entries(providers).map(([provider, value]) => ({
        provider,
        api: value.api,
        models: value.models.map((model) => ({ ...model, key: modelKey(provider, model.id) })),
    }));
}
export function catalogProviders({ prefix, origin, cursorModels, ollamaModels, kiroModels, kimiModels, devinModels, glmModels = undefined, clineModels, commandCodeModels, chatgptModels = undefined, workbuddyModels, workbuddyAiModels, kimiWorkModels, opendesignModels, zedModels, contexts }) {
    const providers = buildProviders({
        prefix,
        origin,
        loggedIn: { codex: true, chatgpt: true, grok: true, glm: true, kiro: true, antigravity: true, cursor: true, ollama: true, kimi: true, devin: true, cline: true, 'command-code': true, workbuddy: true, 'workbuddy-ai': true, 'kimi-work': true, autoclaw: true, 'autoclaw-cn': true, opendesign: true, mimo: true, minimax: true, zed: true },
        cursorModels,
        ollamaModels,
        kiroModels,
        kimiModels,
        devinModels,
        glmModels,
        clineModels,
        commandCodeModels,
        chatgptModels,
        workbuddyModels,
        workbuddyAiModels,
        kimiWorkModels,
        opendesignModels,
        zedModels,
        contexts,
    });
    // OpenCode is API key, not OAuth: the picker lists only the routes this
    // plugin writes; the controller decides locked vs usable from
    // OPENCODE_API_KEY. DSH serves the built-in `opencode-go` / `opencode`
    // catalogs itself and the plugin never writes those profiles.
    for (const route of [...opencodeGoRoutes(), ...opencodeZenRoutes()]) {
        providers[route.id] = {
            displayName: route.displayName,
            api: route.api,
            apiKeyEnv: OPENCODE_GO_API_KEY_ENV,
            baseURL: route.baseURL,
            ...('headers' in route && route.headers !== undefined ? { headers: { ...route.headers } } : {}),
            models: route.models.map(toHarnessModel),
        };
    }
    return applyContextOverrides(providers, contexts);
}
export function catalogKeys(providers) {
    return Object.entries(providers).flatMap(([provider, value]) => (value.models ?? []).map((model) => modelKey(provider, model.id)));
}
export function familyOfProvider(provider) {
    if (String(provider).endsWith('-codex'))
        return 'codex';
    if (String(provider).endsWith('-chatgpt'))
        return 'chatgpt';
    if (String(provider).endsWith('-grok'))
        return 'grok';
    if (String(provider).endsWith('-glm'))
        return 'glm';
    if (String(provider).endsWith('-kiro'))
        return 'kiro';
    if (String(provider).endsWith('-antigravity'))
        return 'antigravity';
    if (String(provider).endsWith('-cursor'))
        return 'cursor';
    if (String(provider).endsWith('-ollama'))
        return 'ollama';
    if (String(provider).endsWith('-minimax'))
        return 'minimax';
    if (String(provider).endsWith('-kimi'))
        return 'kimi';
    // Neither suffix contains the other ('-kimi-work' does not end in '-kimi'
    // and vice versa), so the two checks are order-free.
    if (String(provider).endsWith('-kimi-work'))
        return 'kimi-work';
    if (String(provider).endsWith('-devin'))
        return 'devin';
    if (String(provider).endsWith('-cline'))
        return 'cline';
    if (String(provider).endsWith('-command-code'))
        return 'command-code';
    // Neither suffix contains the other ('-workbuddy-ai' does not end in
    // '-workbuddy' and vice versa), so the two checks are order-free.
    if (String(provider).endsWith('-workbuddy-ai'))
        return 'workbuddy-ai';
    if (String(provider).endsWith('-workbuddy'))
        return 'workbuddy';
    // Same order-free pair for AutoClaw ('-autoclaw-cn' does not end in
    // '-autoclaw'; the reverse would).
    if (String(provider).endsWith('-autoclaw-cn'))
        return 'autoclaw-cn';
    if (String(provider).endsWith('-autoclaw'))
        return 'autoclaw';
    if (String(provider).endsWith('-opendesign'))
        return 'opendesign';
    // No other family id ends in '-mimo', so this check is order-free.
    if (String(provider).endsWith('-mimo'))
        return 'mimo';
    // Zed's three wire routes: none of the three suffixes contains another
    // ('-zed' vs '-zed-responses' vs '-zed-chat'), so the checks are order-free.
    if (String(provider).endsWith('-zed'))
        return 'zed';
    if (String(provider).endsWith('-zed-responses'))
        return 'zed';
    if (String(provider).endsWith('-zed-chat'))
        return 'zed';
    return String(provider);
}
export function familyOfKey(key) {
    const slash = String(key).indexOf('/');
    return familyOfProvider(slash === -1 ? key : key.slice(0, slash));
}
export function familyCatalogKeys(catalog, family) {
    return catalogKeys(catalog).filter((key) => familyOfKey(key) === family);
}
/**
 * settings.yaml `name` is the picker's per-model label — DSH shows it in the
 * trigger and headers without the provider group, so synced rows carry the
 * family as "<agent>/<display name>" ("OpenCode Go/DeepSeek V4.1 Flash").
 * Both settings writers pass the catalog/live display name, including Fast
 * variants. Missing names fall back to the unchanged id, never guessed casing.
 * Agent labels mirror FAMILY_NAME
 * in src/ui/client.ts.
 */
const HARNESS_MODEL_AGENT = {
    codex: 'Codex', chatgpt: 'ChatGPT', grok: 'Grok', glm: 'GLM', kiro: 'Kiro', antigravity: 'Antigravity',
    cursor: 'Cursor', ollama: 'Ollama', minimax: 'MiniMax', kimi: 'Kimi', devin: 'Devin',
    cline: 'Cline', 'command-code': 'Command Code',
    workbuddy: 'WorkBuddy', 'workbuddy-ai': 'WorkBuddy AI', 'kimi-work': 'Kimi Work',
    autoclaw: 'AutoClaw', 'autoclaw-cn': 'AutoClaw CN', opendesign: 'Open Design', mimo: 'Xiaomi MiMo', zed: 'Zed',
    // The two OpenCode products keep separate agent labels even though they share
    // one account: settings.yaml shows the alias without the provider group, so
    // `OpenCode Zen/gpt-5.5` must not read as Go.
    'opencode-go': 'OpenCode Go', 'opencode-zen': 'OpenCode Zen',
};
/** The product a route id belongs to; OpenCode ids carry their own prefix. */
function opencodeProduct(provider) {
    if (String(provider).startsWith('opencode-zen'))
        return 'opencode-zen';
    if (String(provider).startsWith('opencode-go'))
        return 'opencode-go';
    return undefined;
}
export function harnessModelAlias(provider, id, displayName) {
    const family = opencodeProduct(provider) ?? familyOfProvider(provider);
    const label = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : id;
    return `${HARNESS_MODEL_AGENT[family] ?? family}/${label}`;
}
/**
 * `rates` (`<family>/<model id>` → cost multiplier) is display-only: it never
 * rides in a route row. `pricing` (`<family>/<model id>` → rates.json row)
 * is likewise display-only: the Models tab renders it as a USD-per-1M-token
 * tooltip. `providers` must be an un-overridden catalog build —
 * the effective window is computed here from `contexts` so the row's catalog
 * default and ceiling stay visible alongside the override.
 */
export function describeCatalog(providers, { enabledKeys, loggedIn, awaitingPick, rates, contexts, pricing, pricingTimeOfDay, credits } = {}) {
    const enabled = enabledKeys === undefined ? null : new Set(enabledKeys);
    const overrides = contexts ?? {};
    return Object.entries(providers).map(([provider, value]) => {
        const family = familyOfProvider(provider);
        return {
            provider,
            displayName: value.displayName,
            family,
            loggedIn: loggedIn ? Boolean(loggedIn[family]) : true,
            // Signed in here and still all-off on purpose: the Models page explains
            // why the family has no row on (登录默认) instead of looking broken.
            ...(awaitingPick?.has(family) ? { awaitingPick: true } : {}),
            ...(pricingTimeOfDay ? { pricingTimeOfDay } : {}),
            models: value.models.map((model) => {
                const key = modelKey(provider, model.id);
                const override = overrides[key];
                const max = maxContextOfRow(model, family);
                return {
                    id: model.id,
                    name: model.name,
                    key,
                    enabled: enabled === null ? !isOptInKey(key) : enabled.has(key),
                    fast: String(model.id).endsWith('-fast'),
                    input: Array.isArray(model.input) ? [...model.input] : ['text', 'image'],
                    // Effective window (override ?? catalog default) plus the row's
                    // custom ceiling — the dialog's edit bounds.
                    window: formatWindow(override ?? model.contextWindow),
                    windowDefault: formatWindow(model.contextWindow),
                    windowMax: formatWindow(max),
                    contextValue: override ?? model.contextWindow,
                    contextDefault: model.contextWindow,
                    contextMax: max,
                    custom: override !== undefined,
                    ...(rates?.[`${family}/${model.id}`] ? { rate: rates[`${family}/${model.id}`] } : {}),
                    ...(pricing?.[`${family}/${model.id}`] ? { pricing: pricing[`${family}/${model.id}`] } : {}),
                    // WorkBuddy's credits multiple as its catalog carries it; 0 is the
                    // plan's free rung. Display-only, like `pricing` — it never rides in
                    // a route row (toHarnessModel drops it).
                    ...(typeof credits?.[`${family}/${model.id}`] === 'number' ? { credits: credits[`${family}/${model.id}`] } : {}),
                };
            }),
        };
    });
}
export const OPENCODE_GO_API_KEY_ENV = 'OPENCODE_API_KEY';
