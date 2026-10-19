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
/** The plan's path for what the app's `/route` was asked (index.mjs:730). */
export declare function mimoTpRestOf(appUrl: any): string;
export declare function forwardMimo(response: any, { payload, stream, session, tokens, fetchFn, signal, startedAt, timeouts }: {
    payload: any;
    stream: any;
    session: any;
    tokens: any;
    fetchFn: any;
    signal: any;
    startedAt: any;
    timeouts: any;
}): Promise<void>;
