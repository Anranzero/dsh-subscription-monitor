/**
 * MiMo Completions hop body edits.
 *
 * Two edits before the app's `/route`, one classification after it:
 * - `applyMimoThinking`: no MiMo model advertises a reasoning control
 *   (upstream index.mjs:28-32 has none), and the app itself never sends one —
 *   DSH effort fields are stripped, never forwarded.
 * - `applyMimoStreamUsage`: `stream_options.include_usage` on streams. The
 *   upstream plugin does not set it, but the wire is plain OpenAI
 *   Completions and every Completions family in this repo asks (kimi / cline /
 *   workbuddy request.ts); DSH's usage page reads the frame. Live-verify on
 *   the maintainer's account (README 活测).
 * - `mimoMembershipRequired`: the app's 403 for an account with no
 *   membership (index.mjs:761) — the transport reroutes it to the Token Plan
 *   and, failing that, answers it as a 400 explanation so the host does not
 *   file "未订阅" as a dead login (403 → AUTH).
 */
/** TP_MODELS (index.mjs:35) — the Token Plan's names for the app's models. */
export const MIMO_TP_MODELS = Object.freeze({
    'mimo-pro': 'mimo-v2.6-pro',
    'mimo-flash': 'mimo-v2.6-flash',
});
/** Any other model id passes through to the Token Plan as it is (index.mjs:34). */
export function mimoTpModelOf(modelId) {
    const id = typeof modelId === 'string' ? modelId : '';
    return MIMO_TP_MODELS[id] ?? id;
}
/**
 * No MiMo model advertises reasoning (upstream's model table has no effort
 * field), so an effort DSH sends is dropped, not translated — inventing a
 * vendor spelling here is the one thing this function must never do.
 */
export function applyMimoThinking(payload = {}) {
    const next = { ...payload };
    delete next.reasoning_effort;
    delete next.reasoning;
    delete next.thinking;
    return next;
}
/** Completions SSE omits usage unless the vendor is asked. Do not override an explicit value. */
export function applyMimoStreamUsage(payload = {}) {
    if (!payload || payload.stream !== true)
        return payload;
    const current = payload.stream_options;
    if (current && typeof current === 'object' && Object.hasOwn(current, 'include_usage'))
        return payload;
    return {
        ...payload,
        stream_options: current && typeof current === 'object'
            ? { ...current, include_usage: true }
            : { include_usage: true },
    };
}
/**
 * The app's refusal of an account with no membership: HTTP 403 whose body
 * carries `error.code === "membership_required"` (index.mjs:755-767; the
 * reporter's body, usage.test.mjs:312). Returns the vendor's own message.
 */
export function mimoMembershipRequired(status, parsed) {
    if (status !== 403)
        return undefined;
    const error = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.error : undefined;
    if (error && typeof error === 'object' && error.code === 'membership_required') {
        return typeof error.message === 'string' && error.message ? error.message : 'membership_required';
    }
    return undefined;
}
/**
 * The hop's refusal classification for failures that must not reach the host
 * as-is: `membership_required` (with no Token Plan behind it) becomes a 400
 * explanation — 403 would read as a dead login. Everything else keeps its
 * status and body.
 */
export function mimoHopFailure(status, parsed) {
    const membership = mimoMembershipRequired(status, parsed);
    if (membership !== undefined) {
        return {
            status: 400,
            payload: {
                error: {
                    message: `Xiaomi MiMo: ${membership} (this account has no MiMo membership and no Token Plan key; subscribe in the MiMo app or at platform.xiaomimimo.com)`,
                    type: 'invalid_request_error',
                    code: 'membership_required',
                },
            },
        };
    }
    return undefined;
}
