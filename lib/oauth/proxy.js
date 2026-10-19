/**
 * Loopback LLM proxy: authenticates DSH calls and dispatches each route to its
 * family transport or to the passthrough hop (passthrough.ts; body read and
 * cache rewrite in proxy-body.ts; timing, retries and failure answers in
 * upstream.ts). Settings operations stay on the host-owned RPC channel;
 * vendor translation lives in each family.
 */
import { createServer } from 'node:http';
import { CODEX_API_URL, CODEX_CLIENT_VERSION, CODEX_MODELS, CODEX_MODELS_URL, codexUpstreamHeaders, } from './codex/index.js';
import { GROK_API_URL, GROK_MODELS, grokUpstreamHeaders } from './grok/index.js';
import { GLM_MODELS, glmAnthropicDirectUrl, glmAnthropicHeaders, glmAnthropicUrl, glmCodingUrl, glmUpstreamHeaders, } from './glm/index.js';
import { kiroCatalogModels } from './kiro/catalog.js';
import { forwardKiro } from './kiro/transport.js';
import { ANTIGRAVITY_MODELS } from './antigravity/index.js';
import { forwardAntigravity } from './antigravity/transport.js';
import { cursorCatalogModels } from './cursor/catalog.js';
import { OLLAMA_CHAT_URL, ollamaUpstreamHeaders } from '../apikey/ollama/index.js';
import { ollamaCatalogModels } from '../apikey/ollama/catalog.js';
import { commandCodeCatalogModels } from '../apikey/command-code/catalog.js';
import { COMMAND_CODE_PROVIDER_CHAT_URL } from '../apikey/command-code/index.js';
import { commandCodeEngineFetch } from '../apikey/command-code/engine.js';
import { commandCodeFailure } from '../apikey/command-code/failure.js';
import { KIMI_CHAT_URL, kimiUpstreamHeaders } from './kimi/index.js';
import { kimiCatalogModels } from './kimi/catalog.js';
import { forwardCursor } from './cursor/transport.js';
import { devinCatalogModels } from './devin/catalog.js';
import { forwardDevin } from './devin/transport.js';
import { sendJson } from '../utils/http.js';
import { CODEX_RATE_LIMITS_EVENT } from './codex/quota.js';
import { encodeCodexBody } from './codex/request.js';
import { CLINE_CHAT_URL } from './cline/index.js';
import { clineEngineFetch, clineEngineHeaders } from './cline/engine.js';
import { clineCatalogModels } from './cline/catalog.js';
import { clineQuotaFailure } from './cline/request.js';
import { WORKBUDDY_SITES, workbuddyChatUrl } from './workbuddy/index.js';
import { workbuddyEngineFetch, workbuddyEngineHeaders } from './workbuddy/engine.js';
import { workbuddyAiCatalogModels, workbuddyCatalogModels } from './workbuddy/catalog.js';
import { workbuddyQuotaFailure } from './workbuddy/request.js';
import { AUTOCLAW_MODELS, AUTOCLAW_CN_MODELS, AUTOCLAW_SITES, autoclawChatUrl } from './autoclaw/index.js';
import { autoclawEngineFetch, autoclawEngineHeaders } from './autoclaw/engine.js';
import { classifyAutoclawFailure } from './autoclaw/request.js';
import { opendesignEngineHop } from './opendesign/engine.js';
import { opendesignCatalogModels } from './opendesign/catalog.js';
import { KIMI_WORK_CHAT_URL } from './kimi-work/index.js';
import { kimiWorkEngineFetch, kimiWorkEngineHeaders } from './kimi-work/engine.js';
import { kimiWorkCatalogModels } from './kimi-work/catalog.js';
import { MIMO_MODELS } from './mimo/index.js';
import { forwardMimo } from './mimo/transport.js';
import { forwardZedEngine } from './zed/engine.js';
import { zedCatalogModels } from './zed/catalog.js';
import { CHATGPT_RESPONSES_URL, chatgptUpstreamHeaders } from './chatgpt/index.js';
import { chatgptCatalogModels } from './chatgpt/catalog.js';
import { chatgptPickerModels } from './models.js';
import { chatgptQuotaFailure } from './chatgpt/request.js';
import { CHATGPT_USAGE_EVENT } from './chatgpt/usage.js';
import { withPickerVariants } from './models.js';
import { outboundFetch } from '../utils/outbound.js';
import { answerFailure } from './upstream.js';
import { forward } from './passthrough.js';
import { inboundCacheKeys, MAX_REQUEST_BODY_BYTES, readBody, rewriteUpstreamBody } from './proxy-body.js';
import { accountIdOf, getStoredSession } from './store.js';
function originOf(port) {
    return `http://127.0.0.1:${port}`;
}
export { describeError } from '../utils/http.js';
export { MAX_REQUEST_BODY_BYTES } from './proxy-body.js';
function abortOnDisconnect(request, response) {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('client disconnected'));
    const onClose = () => {
        if (!response.writableEnded)
            abort();
    };
    request.once('aborted', abort);
    response.once('close', onClose);
    if (request.aborted || response.destroyed)
        abort();
    return {
        signal: controller.signal,
        cleanup() {
            request.removeListener('aborted', abort);
            response.removeListener('close', onClose);
        },
    };
}
export function createProxy({ port, apiKey, tokens, fetchFn = outboundFetch, maxRequestBodyBytes = MAX_REQUEST_BODY_BYTES, upstreamTimeouts = undefined, onAntigravityValidation = undefined, cursorRpc = undefined, devinChat = undefined, onQuotaUsed = undefined, onQuotaLearned = undefined }) {
    let server;
    // Set once close() starts. A socket that was busy then stays keep-alive and the
    // old server keeps answering on it, so every answer from here on tells the
    // client to reconnect (to the new instance on the same port).
    let closing = false;
    // The session a chat hop selected. close can fire before session() returns;
    // a later resolution must not be treated as a spend.
    const spent = new WeakMap();
    function noteSession(response, session) {
        const slot = spent.get(response);
        if (slot)
            slot.session = session;
    }
    async function takeSession(response, manager) {
        const session = await manager.session();
        noteSession(response, session);
        return session;
    }
    // Logout removes the vault row. A refresh failure must not look like that,
    // so a real manager is checked by the stored row, not by session().
    async function sessionStillHeld(family, session) {
        if (!session)
            return false;
        const manager = tokens?.[family];
        if (!manager)
            return false;
        const id = accountIdOf(family, session);
        if (typeof manager.authPath === 'string' && manager.authPath.length > 0) {
            try {
                const stored = await getStoredSession(family, id, manager.authPath);
                return !!stored?.session && accountIdOf(family, stored.session) === id;
            }
            catch {
                return false;
            }
        }
        if (typeof manager.session !== 'function')
            return false;
        try {
            const live = await manager.session(id);
            return accountIdOf(family, live) === id;
        }
        catch {
            return false;
        }
    }
    async function reportUsed(family, session) {
        if (!onQuotaUsed || !(await sessionStillHeld(family, session)))
            return;
        try {
            onQuotaUsed(family, session);
        }
        catch { /* best-effort */ }
    }
    async function reportLearned(family, data, session) {
        if (!onQuotaLearned || !(await sessionStillHeld(family, session)))
            return;
        try {
            onQuotaLearned(family, data, session);
        }
        catch { /* best-effort */ }
    }
    // llm-pi-ai sends Authorization: Bearer for Completions/Responses but the
    // Anthropic SDK authenticates with x-api-key (authToken is only used for
    // sk-ant-oat* OAuth tokens). Accept either spelling of the same proxy key —
    // a 401 here surfaces in DSH as 「API 密钥无效」 before the hop ever runs.
    const authorized = (request) => {
        const header = request.headers.authorization ?? '';
        const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        const apiKeyHeader = request.headers['x-api-key'];
        const apiKeyToken = typeof apiKeyHeader === 'string' ? apiKeyHeader.trim() : '';
        return (bearer.length > 0 && bearer === apiKey) || (apiKeyToken.length > 0 && apiKeyToken === apiKey);
    };
    const handle = async (request, response) => {
        // The pre-output budget starts here, so the tokens.session() wait counts.
        const startedAt = Date.now();
        if (closing)
            response.setHeader('connection', 'close');
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname.replace(/\/+$/, '') || '/';
        if (path === '/health' && request.method === 'GET') {
            sendJson(response, 200, { ok: true, plugin: 'dsh-plugin-oauth-subs', inboundCacheKeys });
            return;
        }
        if (!authorized(request)) {
            sendJson(response, 401, { error: 'unauthorized' });
            return;
        }
        if (path === '/v1/models' && request.method === 'GET') {
            const data = [];
            try {
                await tokens.codex.session();
                data.push(...withPickerVariants(CODEX_MODELS).map((model) => ({ id: model.id, object: 'model', owned_by: 'codex' })));
            }
            catch { /* not logged in */ }
            try {
                if (tokens.chatgpt) {
                    await tokens.chatgpt.session();
                    data.push(...chatgptPickerModels(chatgptCatalogModels()).map((model) => ({ id: model.id, object: 'model', owned_by: 'chatgpt' })));
                }
            }
            catch { /* not logged in */ }
            try {
                await tokens.grok.session();
                data.push(...withPickerVariants(GROK_MODELS).map((model) => ({ id: model.id, object: 'model', owned_by: 'grok' })));
            }
            catch { /* not logged in */ }
            try {
                await tokens.glm.session();
                data.push(...withPickerVariants(GLM_MODELS).map((model) => ({ id: model.id, object: 'model', owned_by: 'glm' })));
            }
            catch { /* not logged in */ }
            try {
                if (tokens.kiro) {
                    await tokens.kiro.session();
                    data.push(...kiroCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'kiro' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.antigravity) {
                    await tokens.antigravity.session();
                    data.push(...ANTIGRAVITY_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'antigravity' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.cursor) {
                    await tokens.cursor.session();
                    data.push(...cursorCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'cursor' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.ollama) {
                    await tokens.ollama.session();
                    data.push(...ollamaCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'ollama' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.kimi) {
                    await tokens.kimi.session();
                    data.push(...kimiCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'kimi' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.devin) {
                    await tokens.devin.session();
                    data.push(...devinCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'devin' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.cline) {
                    await tokens.cline.session();
                    data.push(...clineCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'cline' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.workbuddy) {
                    await tokens.workbuddy.session();
                    data.push(...workbuddyCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'workbuddy' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens['workbuddy-ai']) {
                    await tokens['workbuddy-ai'].session();
                    data.push(...workbuddyAiCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'workbuddy-ai' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens['command-code']) {
                    await tokens['command-code'].session();
                    data.push(...commandCodeCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'command-code' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens['kimi-work']) {
                    await tokens['kimi-work'].session();
                    data.push(...kimiWorkCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'kimi-work' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.mimo) {
                    await tokens.mimo.session();
                    data.push(...MIMO_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'mimo' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.zed) {
                    await tokens.zed.session();
                    data.push(...zedCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'zed' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.autoclaw) {
                    await tokens.autoclaw.session();
                    data.push(...AUTOCLAW_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'autoclaw' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens['autoclaw-cn']) {
                    await tokens['autoclaw-cn'].session();
                    data.push(...AUTOCLAW_CN_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'autoclaw-cn' })));
                }
            }
            catch { /* not logged in */ }
            try {
                if (tokens.opendesign) {
                    await tokens.opendesign.session();
                    data.push(...opendesignCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'opendesign' })));
                }
            }
            catch { /* not logged in */ }
            sendJson(response, 200, { object: 'list', data });
            return;
        }
        if (path === '/codex/v1/models' && request.method === 'GET') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await tokens.codex.session();
                const upstream = await fetchFn(`${CODEX_MODELS_URL}?client_version=${CODEX_CLIENT_VERSION}`, {
                    headers: {
                        ...codexUpstreamHeaders(session),
                    },
                    signal: client.signal,
                });
                if (!upstream.ok) {
                    sendJson(response, upstream.status, { error: await upstream.text() });
                    return;
                }
                const payload = await upstream.json();
                sendJson(response, 200, payload);
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/codex/v1/responses' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.codex);
                await forward(request, response, {
                    url: CODEX_API_URL,
                    session,
                    tokens: tokens.codex,
                    headersOf: codexUpstreamHeaders,
                    fetchFn,
                    family: 'codex',
                    encodeBody: encodeCodexBody,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                    // The stream's own rate-limit frame is quota data; the store decides
                    // what to keep (quota.ts learn). The hop's session stays with it.
                    ...(onQuotaLearned ? { captureSse: { type: CODEX_RATE_LIMITS_EVENT, onData: (data) => { void reportLearned('codex', data, session); } } } : {}),
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/chatgpt/v1/models' && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: chatgptPickerModels(chatgptCatalogModels()).map((model) => ({ id: model.id, object: 'model', owned_by: 'chatgpt' })),
            });
            return;
        }
        if (path === '/chatgpt/v1/responses' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.chatgpt);
                await forward(request, response, {
                    url: CHATGPT_RESPONSES_URL,
                    session,
                    tokens: tokens.chatgpt,
                    headersOf: chatgptUpstreamHeaders,
                    fetchFn,
                    family: 'chatgpt',
                    classifyFailure: chatgptQuotaFailure,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                    // The terminal event's usage block is this route's only in-contract
                    // usage signal; the store turns it into measured window rows.
                    ...(onQuotaLearned ? { captureSse: { type: CHATGPT_USAGE_EVENT, onData: (data) => { void reportLearned('chatgpt', data, session); } } } : {}),
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/grok/v1/responses' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                await forward(request, response, {
                    url: GROK_API_URL,
                    session: await takeSession(response, tokens.grok),
                    tokens: tokens.grok,
                    headersOf: grokUpstreamHeaders,
                    fetchFn,
                    family: 'grok',
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/glm/v1/chat/completions' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.glm);
                await forward(request, response, {
                    url: glmCodingUrl(session.region),
                    session,
                    tokens: tokens.glm,
                    headersOf: glmUpstreamHeaders,
                    fetchFn,
                    family: 'glm',
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if ((path === '/glm/v1/messages' || path === '/glm/v1/v1/messages') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.glm);
                await forward(request, response, {
                    // Official Coding Plan hop: the endpoint rewritten to the ZCode
                    // gateway (official-coding-plan-gateway.ts). Direct endpoint stays as
                    // the one-shot fallback when the gateway refuses the bearer.
                    url: glmAnthropicUrl(session.region),
                    fallbackUrl: glmAnthropicDirectUrl(session.region),
                    session,
                    tokens: tokens.glm,
                    headersOf: glmAnthropicHeaders,
                    fetchFn,
                    family: 'glm',
                    wire: 'anthropic',
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/glm/v1/models' && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: withPickerVariants(GLM_MODELS).map((model) => ({ id: model.id, object: 'model', owned_by: 'glm' })),
            });
            return;
        }
        if (path === '/kiro/v1/models' && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: kiroCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'kiro' })),
            });
            return;
        }
        if (path === '/antigravity/v1/models' && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: ANTIGRAVITY_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'antigravity' })),
            });
            return;
        }
        if ((path === '/cursor/v1/models' || path === '/cursor/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: cursorCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'cursor' })),
            });
            return;
        }
        if (path === '/kiro/v1/chat/completions' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.kiro);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'kiro');
                await forwardKiro(response, {
                    ...input,
                    session,
                    tokens: tokens.kiro,
                    fetchFn,
                    signal: client.signal,
                    startedAt,
                    timeouts: upstreamTimeouts,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/zed/v1/models' && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: zedCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'zed' })),
            });
            return;
        }
        if (path === '/zed/v1/messages' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.zed);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'zed');
                await forwardZedEngine(response, {
                    wire: 'anthropic',
                    ...input,
                    session,
                    fetchFn,
                    signal: client.signal,
                    startedAt,
                    timeouts: upstreamTimeouts,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/zed/v1/responses' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.zed);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'zed');
                await forwardZedEngine(response, {
                    wire: 'responses',
                    ...input,
                    session,
                    fetchFn,
                    signal: client.signal,
                    startedAt,
                    timeouts: upstreamTimeouts,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/zed/v1/chat/completions' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.zed);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'zed');
                await forwardZedEngine(response, {
                    wire: 'chat',
                    ...input,
                    session,
                    fetchFn,
                    signal: client.signal,
                    startedAt,
                    timeouts: upstreamTimeouts,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/kiro/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Kiro chat is AWS generateAssistantResponse. Point llm-pi-ai at POST /kiro/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/cursor/v1/chat/completions' || path === '/cursor/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.cursor);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'cursor');
                await forwardCursor(response, {
                    ...input,
                    session,
                    tokens: tokens.cursor,
                    startedAt,
                    upstreamTimeouts,
                    signal: client.signal,
                    runFn: cursorRpc,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/cursor/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Cursor chat is Connect AgentService/Run. Point llm-pi-ai at POST /cursor/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/ollama/v1/models' || path === '/ollama/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: ollamaCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'ollama' })),
            });
            return;
        }
        if ((path === '/ollama/v1/chat/completions' || path === '/ollama/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                await forward(request, response, {
                    url: OLLAMA_CHAT_URL,
                    session: await takeSession(response, tokens.ollama),
                    tokens: tokens.ollama,
                    headersOf: ollamaUpstreamHeaders,
                    fetchFn,
                    family: 'ollama',
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/ollama/v1/responses') {
            sendJson(response, 501, {
                error: {
                    // Cloud does serve /v1/responses but ignores previous_response_id and
                    // store, so this hop deliberately stays Completions (see ollama README).
                    message: 'Ollama hop is Completions only. Point llm-pi-ai at POST /ollama/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/kimi/v1/models' || path === '/kimi/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: kimiCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'kimi' })),
            });
            return;
        }
        if ((path === '/kimi/v1/chat/completions' || path === '/kimi/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                await forward(request, response, {
                    url: KIMI_CHAT_URL,
                    session: await takeSession(response, tokens.kimi),
                    tokens: tokens.kimi,
                    headersOf: kimiUpstreamHeaders,
                    fetchFn,
                    family: 'kimi',
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/kimi/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Kimi Code is Completions. Point llm-pi-ai at POST /kimi/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/devin/v1/models' || path === '/devin/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: devinCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'devin' })),
            });
            return;
        }
        if ((path === '/devin/v1/chat/completions' || path === '/devin/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.devin);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'devin');
                await forwardDevin(response, {
                    ...input,
                    session,
                    tokens: tokens.devin,
                    fetchFn,
                    signal: client.signal,
                    startedAt,
                    timeouts: upstreamTimeouts,
                    runFn: devinChat,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/devin/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Devin chat is Connect ApiServerService/GetChatMessage. Point llm-pi-ai at POST /devin/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/cline/v1/models' || path === '/cline/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: clineCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'cline' })),
            });
            return;
        }
        if ((path === '/cline/v1/chat/completions' || path === '/cline/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.cline);
                await forward(request, response, {
                    url: CLINE_CHAT_URL,
                    session,
                    tokens: tokens.cline,
                    headersOf: (current, cacheSessionId) => clineEngineHeaders(cacheSessionId),
                    fetchFn: await clineEngineFetch({ session, fetchFn }),
                    family: 'cline',
                    classifyFailure: clineQuotaFailure,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/cline/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Cline is Completions. Point llm-pi-ai at POST /cline/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/workbuddy/v1/models' || path === '/workbuddy/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: workbuddyCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'workbuddy' })),
            });
            return;
        }
        if ((path === '/workbuddy/v1/chat/completions' || path === '/workbuddy/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const site = WORKBUDDY_SITES.workbuddy;
                const session = await takeSession(response, tokens.workbuddy);
                await forward(request, response, {
                    url: workbuddyChatUrl(site),
                    session,
                    tokens: tokens.workbuddy,
                    // The engine loader owns the sign group and derives the four
                    // conversation heads from the session header our headersOf passes
                    // (workbuddy/engine.ts; ruling 2026-10-18: engine-only, no TS lane).
                    headersOf: (current, cacheSessionId) => workbuddyEngineHeaders(site, cacheSessionId),
                    fetchFn: await workbuddyEngineFetch(site, { session, fetchFn }),
                    family: 'workbuddy',
                    classifyFailure: workbuddyQuotaFailure,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/workbuddy/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'WorkBuddy is Completions (streamed only). Point llm-pi-ai at POST /workbuddy/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/workbuddy-ai/v1/models' || path === '/workbuddy-ai/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: workbuddyAiCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'workbuddy-ai' })),
            });
            return;
        }
        if ((path === '/workbuddy-ai/v1/chat/completions' || path === '/workbuddy-ai/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const site = WORKBUDDY_SITES['workbuddy-ai'];
                const session = await takeSession(response, tokens['workbuddy-ai']);
                await forward(request, response, {
                    url: workbuddyChatUrl(site),
                    session,
                    tokens: tokens['workbuddy-ai'],
                    headersOf: (current, cacheSessionId) => workbuddyEngineHeaders(site, cacheSessionId),
                    fetchFn: await workbuddyEngineFetch(site, { session, fetchFn }),
                    family: 'workbuddy-ai',
                    classifyFailure: workbuddyQuotaFailure,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/workbuddy-ai/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'WorkBuddy AI is Completions (streamed only). Point llm-pi-ai at POST /workbuddy-ai/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/autoclaw/v1/models' || path === '/autoclaw/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: AUTOCLAW_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'autoclaw' })),
            });
            return;
        }
        if ((path === '/autoclaw/v1/chat/completions' || path === '/autoclaw/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.autoclaw);
                await forward(request, response, {
                    // The engine loader owns the wire: biz headers, the body rewrite,
                    // the home-host failover (ruling 2026-10-18: engine-only; the URL
                    // is nominal — the engine owns the chat path).
                    url: autoclawChatUrl(AUTOCLAW_SITES.autoclaw),
                    session,
                    tokens: tokens.autoclaw,
                    headersOf: autoclawEngineHeaders,
                    fetchFn: await autoclawEngineFetch('autoclaw', { session, fetchFn }),
                    family: 'autoclaw',
                    classifyFailure: classifyAutoclawFailure,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/autoclaw/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'AutoClaw is Completions. Point llm-pi-ai at POST /autoclaw/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/autoclaw-cn/v1/models' || path === '/autoclaw-cn/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: AUTOCLAW_CN_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'autoclaw-cn' })),
            });
            return;
        }
        if ((path === '/autoclaw-cn/v1/chat/completions' || path === '/autoclaw-cn/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens['autoclaw-cn']);
                await forward(request, response, {
                    // The CN managed gateway is the engine's too (2.1.0 fingerprint,
                    // system prefix, max_tokens refusal — all package-side now).
                    url: autoclawChatUrl(AUTOCLAW_SITES['autoclaw-cn']),
                    session,
                    tokens: tokens['autoclaw-cn'],
                    headersOf: autoclawEngineHeaders,
                    fetchFn: await autoclawEngineFetch('autoclaw-cn', { session, fetchFn }),
                    family: 'autoclaw-cn',
                    classifyFailure: classifyAutoclawFailure,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/autoclaw-cn/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'AutoClaw CN is Completions. Point llm-pi-ai at POST /autoclaw-cn/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/kimi-work/v1/models' || path === '/kimi-work/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: kimiWorkCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'kimi-work' })),
            });
            return;
        }
        if ((path === '/kimi-work/v1/chat/completions' || path === '/kimi-work/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens['kimi-work']);
                await forward(request, response, {
                    url: KIMI_WORK_CHAT_URL,
                    session,
                    tokens: tokens['kimi-work'],
                    // The upstream engine owns the wire (ruling 2026-10-18: engine-only,
                    // no TS fallback): it re-reads the desktop file, checks the account
                    // uid and posts to the one Work-gateway endpoint (kimi-work/engine.ts).
                    headersOf: kimiWorkEngineHeaders,
                    fetchFn: await kimiWorkEngineFetch({ session, fetchFn }),
                    family: 'kimi-work',
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/kimi-work/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Kimi Work is Completions. Point llm-pi-ai at POST /kimi-work/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/opendesign/v1/models' || path === '/opendesign/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: opendesignCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'opendesign' })),
            });
            return;
        }
        if ((path === '/opendesign/v1/chat/completions' || path === '/opendesign/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.opendesign);
                // The engine loader owns the wire facts (base URL, runtime key, the
                // package's own UA — opendesign/engine.ts; ruling 2026-10-18).
                const hop = await opendesignEngineHop({ session, fetchFn });
                await forward(request, response, {
                    url: `${hop.baseURL}/chat/completions`,
                    session,
                    tokens: tokens.opendesign,
                    headersOf: () => ({
                        authorization: `Bearer ${hop.apiKey}`,
                        accept: 'application/json',
                        'user-agent': hop.userAgent,
                    }),
                    fetchFn,
                    family: 'opendesign',
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/opendesign/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Open Design hop is Completions. Point llm-pi-ai at POST /opendesign/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/command-code/v1/models' || path === '/command-code/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: commandCodeCatalogModels().map((model) => ({ id: model.id, object: 'model', owned_by: 'command-code' })),
            });
            return;
        }
        if ((path === '/command-code/v1/chat/completions' || path === '/command-code/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens['command-code']);
                await forward(request, response, {
                    url: COMMAND_CODE_PROVIDER_CHAT_URL,
                    session,
                    tokens: tokens['command-code'],
                    headersOf: () => ({}),
                    fetchFn: await commandCodeEngineFetch({ session, fetchFn }),
                    family: 'command-code',
                    classifyFailure: commandCodeFailure,
                    maxRequestBodyBytes,
                    upstreamTimeouts,
                    startedAt,
                    signal: client.signal,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/command-code/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Command Code chat is /alpha/generate JSONL. Point llm-pi-ai at POST /command-code/v1/chat/completions.',
                },
            });
            return;
        }
        if ((path === '/mimo/v1/models' || path === '/mimo/models') && request.method === 'GET') {
            sendJson(response, 200, {
                object: 'list',
                data: MIMO_MODELS.map((model) => ({ id: model.id, object: 'model', owned_by: 'mimo' })),
            });
            return;
        }
        if ((path === '/mimo/v1/chat/completions' || path === '/mimo/chat/completions') && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.mimo);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'mimo');
                await forwardMimo(response, {
                    ...input,
                    session,
                    tokens: tokens.mimo,
                    fetchFn,
                    signal: client.signal,
                    startedAt,
                    timeouts: upstreamTimeouts,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/mimo/v1/responses') {
            sendJson(response, 501, {
                error: {
                    message: 'Xiaomi MiMo is Completions. Point llm-pi-ai at POST /mimo/v1/chat/completions.',
                },
            });
            return;
        }
        if (path === '/antigravity/v1/chat/completions' && request.method === 'POST') {
            const client = abortOnDisconnect(request, response);
            try {
                const session = await takeSession(response, tokens.antigravity);
                const input = rewriteUpstreamBody(await readBody(request, maxRequestBodyBytes), 'antigravity');
                await forwardAntigravity(response, {
                    ...input,
                    session,
                    tokens: tokens.antigravity,
                    fetchFn,
                    signal: client.signal,
                    startedAt,
                    upstreamTimeouts,
                    onValidation: onAntigravityValidation,
                });
            }
            finally {
                client.cleanup();
            }
            return;
        }
        if (path === '/codex/v1/chat/completions' || path === '/grok/v1/chat/completions') {
            sendJson(response, 400, {
                error: {
                    message: 'this proxy speaks the OpenAI Responses API (POST /v1/responses). Point llm-pi-ai api at openai-responses.',
                },
            });
            return;
        }
        sendJson(response, 404, { error: `not found: ${path}` });
    };
    return {
        origin: () => originOf(port),
        async listen() {
            server = createServer((request, response) => {
                // A chat hop spends the selected login's quota whatever the outcome
                // (a 429 is news too). close before that login is selected is not a
                // spend, and a login removed before the observation is not one either.
                const family = onQuotaUsed ? quotaFamilyOf(request) : undefined;
                const slot = { session: undefined };
                spent.set(response, slot);
                if (family)
                    response.once('close', () => { void reportUsed(family, slot.session); });
                handle(request, response).catch((error) => answerFailure(response, error));
            });
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, '127.0.0.1', resolve);
            });
            return server;
        },
        /**
         * Stops accepting, lets in-flight requests finish, and resolves once the last
         * connection is gone — the caller closes what the handlers use (the outbound
         * agent) only after that.
         */
        async close() {
            if (server === undefined)
                return;
            closing = true;
            const gone = new Promise((resolve) => server.close(() => resolve()));
            // close() only drops connections idle right now; sweep the ones that go idle later.
            const sweep = setInterval(() => server.closeIdleConnections(), 250);
            sweep.unref();
            await gone;
            clearInterval(sweep);
            server = undefined;
        },
    };
}
const QUOTA_CHAT_PATH = /^\/([a-z-]+)\/(?:v1\/)*(?:chat\/completions|responses|messages)$/;
/** Family whose quota a POST chat request spends; undefined for anything else. */
export function quotaFamilyOf(request) {
    if (request.method !== 'POST')
        return undefined;
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.replace(/\/+$/, '');
    return QUOTA_CHAT_PATH.exec(path)?.[1];
}
