/**
 * The MiMo chat hop: OpenAI Completions passthrough with the app's Token Plan
 * reroute.
 *
 * A request goes to the app's `/route` with the session cookies. An account
 * the app refuses for having no membership (403 `membership_required`) is
 * asked at its Token Plan instead — the plan's own endpoint, its `tp-` key,
 * the plan's names for the models — for an hour, then the app is asked first
 * again (index.mjs:716-773). A 401 from either side is handed to the shared
 * refresh hook (the TokenManager signs the account on again with the same
 * passToken); the app's other answers, and the plan's, go through as they
 * are, exactly as magpie's built-in MiMo account passed them through.
 */
import { UpstreamFailure, pumpBody, upstreamRequest, waitForDrain } from '../upstream.js';
import { forcedRefresh } from '../tokens.js';
import { mimoChatUrl, mimoUpstreamHeaders, parseMimoStored } from './index.js';
import { mimoMembershipRequired, mimoHopFailure, mimoTpModelOf } from './request.js';
import { clearMimoOnPlan, forgetMimoPlanKey, mimoPlanKeyOf, mimoPrefersPlan, noteMimoOnPlan, } from './platform.js';
/** The plan's path for what the app's `/route` was asked (index.mjs:730). */
export function mimoTpRestOf(appUrl) {
    return new URL(String(appUrl)).pathname.replace(/^.*?\/route(?=\/|$)/, '');
}
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'upgrade']);
const WIRE_ONLY = new Set(['content-encoding', 'content-length']);
function forwardedHeaders(upstreamHeaders) {
    const headers = { 'cache-control': 'no-store' };
    upstreamHeaders.forEach((value, key) => {
        const name = key.toLowerCase();
        if (HOP_BY_HOP.has(name) || WIRE_ONLY.has(name))
            return;
        headers[key] = value;
    });
    return headers;
}
function retryAfterOf(upstreamHeaders) {
    return {
        retryAfter: upstreamHeaders?.get?.('retry-after')?.trim() || undefined,
        retryAfterMs: upstreamHeaders?.get?.('retry-after-ms')?.trim() || undefined,
    };
}
/** Stream (or hand over) one upstream answer to the client, byte for byte. */
async function pipeMimo(response, upstream, attempt, signal) {
    response.writeHead(upstream.status, forwardedHeaders(upstream.headers));
    if (!upstream.body) {
        if (!response.writableEnded && !response.destroyed)
            response.end();
        return;
    }
    await pumpBody(upstream.body, attempt, async (value) => {
        if (!response.write(value))
            await waitForDrain(response, signal);
    });
    if (!response.writableEnded && !response.destroyed)
        response.end();
}
export async function forwardMimo(response, { payload, stream, session, tokens, fetchFn, signal, startedAt, timeouts }) {
    await upstreamRequest({ family: 'mimo', signal, startedAt, stream, response, timeouts }).run((attempt) => attemptMimo(response, { payload, stream, session, fetchFn, attempt }), { refresh: forcedRefresh(tokens, () => session, (next) => { session = next; }) });
}
async function attemptMimo(response, { payload, stream, session, fetchFn, attempt }) {
    const { signal } = attempt;
    const parsed = parseMimoStored(session);
    if (!parsed) {
        throw new UpstreamFailure(403, 'mimo session is not a Xiaomi-account sign-in', {
            code: 'http',
            payload: { error: { message: 'Xiaomi MiMo: sign in with a Xiaomi account first', type: 'api_error' } },
        });
    }
    const who = String(parsed.creds.userId);
    const url = mimoChatUrl(session);
    const body = Buffer.from(JSON.stringify(payload));
    const headers = {
        ...mimoUpstreamHeaders(session),
        'content-type': 'application/json',
        ...(stream ? { accept: 'text/event-stream' } : {}),
    };
    // An account the app refused an hour ago goes straight to its Token Plan
    // (index.mjs:739-744); no plan behind it and the app is asked first again.
    if (mimoPrefersPlan(who)) {
        if (await askPlan(response, { parsed, url, body, stream, fetchFn, attempt }))
            return;
        clearMimoOnPlan(who);
    }
    const upstream = await fetchFn(url, { method: 'POST', headers, body, signal });
    if (upstream.status >= 400) {
        const text = await upstream.text();
        let parsedBody;
        try {
            parsedBody = text ? JSON.parse(text) : null;
        }
        catch {
            parsedBody = null;
        }
        if (upstream.status === 401) {
            // The shared hook signs the account on again and this attempt replays.
            throw new UpstreamFailure(401, 'mimo upstream 401', { code: 'http', payload: parsedBody ?? undefined });
        }
        if (mimoMembershipRequired(upstream.status, parsedBody) !== undefined) {
            if (await askPlan(response, { parsed, url, body, stream, fetchFn, attempt })) {
                noteMimoOnPlan(who);
                return;
            }
            const failure = mimoHopFailure(upstream.status, parsedBody);
            throw new UpstreamFailure(failure.status, 'mimo upstream 403 membership_required', {
                code: 'http',
                payload: failure.payload,
            });
        }
        throw new UpstreamFailure(upstream.status, `mimo upstream ${upstream.status}`, {
            code: 'http',
            payload: parsedBody ?? undefined,
            ...retryAfterOf(upstream.headers),
        });
    }
    await pipeMimo(response, upstream, attempt, signal);
}
/**
 * toPlan (index.mjs:720-738): this request at the account's Token Plan — its
 * endpoint, its `tp-` key, the plan's name for the model. False when there is
 * no live plan with a key; the caller falls back to the app's own answer. A
 * 401 from the plan (the key was reset at the platform) is answered to the
 * client as the plan answered it, and the key is read again next time.
 */
async function askPlan(response, { parsed, url, body, stream, fetchFn, attempt }) {
    const tp = await mimoPlanKeyOf(parsed.creds, fetchFn);
    if (!tp)
        return false;
    const { signal } = attempt;
    let json;
    try {
        json = JSON.parse(body.toString('utf8'));
    }
    catch {
        json = {};
    }
    const planBody = Buffer.from(JSON.stringify({ ...json, model: mimoTpModelOf(json?.model) }));
    const upstream = await fetchFn(tp.base + mimoTpRestOf(url), {
        method: 'POST',
        headers: {
            authorization: `Bearer ${tp.key}`,
            'content-type': 'application/json',
            ...(stream ? { accept: 'text/event-stream' } : {}),
        },
        body: planBody,
        signal,
    });
    if (upstream.status === 401)
        forgetMimoPlanKey(String(parsed.creds.userId));
    await pipeMimo(response, upstream, attempt, signal);
    return true;
}
