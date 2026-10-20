/** API-key inference goes through the host's native clients; the picker keeps its existing keys. */
import { familyOfProvider, HARNESS_ANTHROPIC_API } from '../oauth/models.js';
import { getSession } from '../oauth/store.js';
import { COMMAND_CODE_PROVIDER_CHAT_URL } from './command-code/index.js';
import { MINIMAX_CHAT_URL } from './minimax/index.js';
import { OLLAMA_CLOUD_ORIGIN } from './ollama/index.js';

const DIRECT_ROUTES = Object.freeze({
    'command-code': { apiKeyEnv: 'DSH_SUBS_COMMAND_CODE_API_KEY', baseURL: COMMAND_CODE_PROVIDER_CHAT_URL.replace(/\/chat\/completions$/, '') },
    minimax: { apiKeyEnv: 'DSH_SUBS_MINIMAX_API_KEY', baseURL: MINIMAX_CHAT_URL.replace(/\/chat\/completions$/, '') },
    ollama: { apiKeyEnv: 'DSH_SUBS_OLLAMA_API_KEY', baseURL: `${OLLAMA_CLOUD_ORIGIN}/v1` },
});

export function directApiKeyProviders(providers, { commandCodePlan } = {}) {
    const out = {};
    for (const [id, value] of Object.entries(providers)) {
        const family = familyOfProvider(id);
        const direct = DIRECT_ROUTES[family];
        // Go has no Provider API access; its CLI JSONL protocol still needs the adapter.
        if (!direct || (family === 'command-code' && commandCodePlan === 'individual-go')) {
            out[id] = value;
            continue;
        }
        // Long cache retention makes pi-ai send OpenAI-only cache parameters.
        const { cacheRetention: _retention, ...route } = value;
        const next = { ...route, ...direct };
        if (family !== 'command-code') {
            out[id] = next;
            continue;
        }
        // Provider API serves Claude only on /messages (commandcode.ai/docs/provider).
        // Split after selection/context projection so saved picker keys remain valid.
        const messages = next.models.filter((model) => /^(?:anthropic\/)?claude-/i.test(model.id));
        const chat = next.models.filter((model) => !messages.includes(model));
        if (chat.length)
            out[id] = { ...next, models: chat };
        if (messages.length) {
            const { compat: _compat, reasoning: _reasoning, ...native } = next;
            out[`${id}-messages`] = {
                ...native,
                displayName: 'Command Code · Messages',
                api: HARNESS_ANTHROPIC_API,
                baseURL: direct.baseURL.replace(/\/v1$/, ''),
                models: messages,
            };
        }
    }
    return out;
}

/** Only plugin-owned credential references are changed; secrets never enter model settings. */
export async function mirrorDirectApiKeys({ credentials, authPath }) {
    let commandCodePlan;
    for (const [family, { apiKeyEnv }] of Object.entries(DIRECT_ROUTES)) {
        const session = await getSession(family, authPath);
        if (family === 'command-code')
            commandCodePlan = session?.planType;
        const key = session?.accessToken;
        if (typeof credentials?.set === 'function') {
            const previous = typeof credentials.resolve === 'function' ? (await credentials.resolve(apiKeyEnv))?.value : undefined;
            if (key && key !== previous)
                await credentials.set(apiKeyEnv, key);
            else if (!key && (previous || typeof credentials.resolve !== 'function') && typeof credentials.unset === 'function')
                await credentials.unset(apiKeyEnv);
        }
        else if (key) {
            process.env[apiKeyEnv] = key;
        }
        else {
            delete process.env[apiKeyEnv];
        }
    }
    return { commandCodePlan };
}
