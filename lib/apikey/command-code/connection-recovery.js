import { UPSTREAM_ATTEMPTS } from '../../oauth/upstream.js';
import { appendPrivateLine } from '../../utils/private-text.js';
import { normalizeCommandCodeResponsesStream } from './responses-stream.js';

const PROVIDER_PATHS = new Set(['/provider/v1/chat/completions', '/provider/v1/messages', '/provider/v1/responses']);
let disposeCurrent;

function commandCodeRequestUrl(input, init) {
    // The SDK sends serialized JSON. A Request/stream body can be consumed by
    // the failed fetch, so never replay it or try to buffer it here.
    if (typeof init?.body !== 'string' || String(init.method ?? '').toUpperCase() !== 'POST')
        return undefined;
    try {
        const url = new URL(typeof input?.url === 'string' ? input.url : input);
        return url.protocol === 'https:' && url.hostname === 'api.commandcode.ai'
            && !url.port && PROVIDER_PATHS.has(url.pathname) ? url : undefined;
    }
    catch {
        return undefined;
    }
}
function connectTimeoutCode(error) {
    for (let link = error, depth = 0; link && depth < 6; link = link.cause, depth++) {
        if (link.code === 'UND_ERR_CONNECT_TIMEOUT' || link.code === 'ERR_SOCKET_CONNECTION_TIMEOUT')
            return link.code;
    }
    return undefined;
}

/**
 * Keep host fetch/proxy/dispatcher settings intact. Only an explicit connect
 * timeout can be retried here: no HTTP request was delivered. In particular,
 * ECONNRESET, header/body timeouts, HTTP errors and partial streams are not
 * evidence that replaying a model request is safe.
 * Responses reasoning aliases are adapted after the fetch resolves; failures
 * while reading that body cannot enter this connection retry loop.
 */
export function installCommandCodeConnectionRecovery({ logPath } = {}) {
    // A hot-reload replacement supersedes the old wrapper instead of stacking
    // retry budgets; a later dispose of the old instance cannot disable this one.
    disposeCurrent?.();
    const nativeFetch = globalThis.fetch;
    let active = true;
    const wrapper = async (input, init) => {
        const url = active ? commandCodeRequestUrl(input, init) : undefined;
        if (!url)
            return nativeFetch(input, init);
        const signal = init?.signal ?? input?.signal;
        for (let attempt = 1; ; attempt++) {
            try {
                const response = await nativeFetch(input, init);
                return url.pathname === '/provider/v1/responses' ? normalizeCommandCodeResponsesStream(response) : response;
            }
            catch (error) {
                const code = connectTimeoutCode(error);
                if (!active || signal?.aborted || !code || attempt >= UPSTREAM_ATTEMPTS)
                    throw error;
                if (logPath) {
                    const line = `${new Date().toISOString()} command-code native connect retry ${attempt + 1}/${UPSTREAM_ATTEMPTS}: ${code}`;
                    void appendPrivateLine(logPath, line).catch(() => {});
                }
            }
        }
    };
    globalThis.fetch = wrapper;
    const dispose = () => {
        active = false;
        if (globalThis.fetch === wrapper)
            globalThis.fetch = nativeFetch;
        if (disposeCurrent === dispose)
            disposeCurrent = undefined;
    };
    disposeCurrent = dispose;
    return dispose;
}
