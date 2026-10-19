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
export declare const MIMO_TP_MODELS: Readonly<{
    'mimo-pro': "mimo-v2.6-pro";
    'mimo-flash': "mimo-v2.6-flash";
}>;
/** Any other model id passes through to the Token Plan as it is (index.mjs:34). */
export declare function mimoTpModelOf(modelId: any): any;
/**
 * No MiMo model advertises reasoning (upstream's model table has no effort
 * field), so an effort DSH sends is dropped, not translated — inventing a
 * vendor spelling here is the one thing this function must never do.
 */
export declare function applyMimoThinking(payload?: any): any;
/** Completions SSE omits usage unless the vendor is asked. Do not override an explicit value. */
export declare function applyMimoStreamUsage(payload?: any): any;
/**
 * The app's refusal of an account with no membership: HTTP 403 whose body
 * carries `error.code === "membership_required"` (index.mjs:755-767; the
 * reporter's body, usage.test.mjs:312). Returns the vendor's own message.
 */
export declare function mimoMembershipRequired(status: any, parsed: any): any;
/**
 * The hop's refusal classification for failures that must not reach the host
 * as-is: `membership_required` (with no Token Plan behind it) becomes a 400
 * explanation — 403 would read as a dead login. Everything else keeps its
 * status and body.
 */
export declare function mimoHopFailure(status: any, parsed: any): {
    status: number;
    payload: {
        error: {
            message: string;
            type: string;
            code: string;
        };
    };
} | undefined;
