/**
 * Zed subscription (Zed Pro / trial / student / business) — the models Zed
 * hosts (Anthropic's, OpenAI's, xAI's), asked through cloud.zed.dev the way
 * the Zed editor asks them.
 *
 * Pinned attribution: **@magpie-community/opencode-zed-auth 0.1.8**
 * (.local/upstream-magpie/packages/zed, MIT; `index.mjs` line refs below),
 * itself ported from magpie's built-in Zed account, which was read from Zed's
 * source (github.com/zed-industries/zed, 1.23.0). Copy, don't invent:
 *
 * - Sign-in: RSA-2048 key + loopback port; zed.dev/native_app_signin carries
 *   the port and the key's public half; the browser comes back with user_id
 *   and an access_token encrypted to the key (index.mjs:396-445).
 * - The pair `Authorization: <user_id> <access_token>` serves every /client/*
 *   call and lasts until Zed refuses it — Zed has no refresh token
 *   (index.mjs:24-26, 157-169).
 * - POST /client/llm_tokens trades the pair for a short-lived model token,
 *   minted again on a 401 or x-zed-expired-token / x-zed-outdated-token
 *   (index.mjs:216-246, 152).
 * - GET /models lists what the account may call; POST /completions takes
 *   {provider, model, provider_request} and streams newline-delimited JSON,
 *   each line the provider's own stream event or a status (index.mjs:17-21).
 *
 * DSH speaks a closed api union (openai-completions / openai-responses /
 * anthropic-messages), so this family serves the three Zed vendors that match
 * it (anthropic → Messages, open_ai → Responses, x_ai → Completions) on three
 * routes; Zed's google models (generateContent wire) stay out — see README.
 */
export declare const ZED_SITE = "https://zed.dev";
export declare const ZED_CLOUD = "https://cloud.zed.dev";
/** The Zed release the requests say they come from (index.mjs VERSION). */
export declare const ZED_VERSION = "1.23.0";
export declare const ZED_SIGN_IN_SUCCEEDED = "https://zed.dev/native_app_signin_succeeded";
/** How long a sign-in waits for the browser (index.mjs SIGN_IN_TIMEOUT). */
export declare const ZED_SIGN_IN_TIMEOUT_MS: number;
/** Zed has no refresh token: the stored pair is permanent until Zed refuses it (index.mjs:24-26). */
export declare const ZED_NEVER_EXPIRES: number;
/**
 * The TokenManager's refresh hook: an identity no-op, exactly command-code's
 * permanent-key shape (`src/apikey/command-code/index.ts` refreshCommandCode).
 * A sign-in Zed refuses surfaces as the hop's 401, not a refresh loop.
 */
export declare function refreshZed(session: any): Promise<any>;
/** The vendor names Zed's /models and /completions speak (index.mjs NPM keys). */
export type ZedVendor = 'anthropic' | 'open_ai' | 'x_ai' | 'google';
/** Zed userAgent: Zed/<version> (<os>; <arch>) in Rust's names (index.mjs:66-70). */
export declare function zedUserAgent(): string;
export declare function zedUsersMeUrl(): string;
export declare function zedLlmTokensUrl(): string;
export declare function zedModelsUrl(): string;
export declare function zedCompletionsUrl(): string;
export declare function zedSignInUrl(port: number, publicKey: string, systemId: string): string;
/** Wire plan slugs → Settings-card labels (index.mjs planName, 199-202). */
export declare const ZED_PLAN_NAMES: Readonly<{
    zed_pro: "Pro";
    zed_pro_trial: "Pro Trial";
    zed_business: "Business";
    zed_student: "Student";
    zed_vip: "VIP";
    zed_free: "Free";
    '': "Free";
}>;
/** The parsed refresh half of a stored session (index.mjs stateOf, 207-212). */
export interface ZedState {
    access: string;
    userId: string;
    systemId: string;
    org: string;
    plan: string;
}
/**
 * stateOf: the stored sign-in as the wire needs it. Zed has no refresh token,
 * so the vault's `refreshToken` slot carries the rest of the pair's context
 * (user id, machine id, organization, plan) as JSON — exactly the shape
 * magpie keeps in OpenCode's oauth entry (index.mjs:23-27, 207-212).
 */
export declare function zedStateOf(session: any): ZedState | null;
/**
 * cloud(): one /client/* read with the account's pair (index.mjs:157-169) —
 * `Authorization: <user_id> <access_token>`, x-zed-system-id when the sign-in
 * carried one, Zed's own User-Agent.
 */
export declare function zedCloud(method: string, path: string, state: ZedState, body: unknown, timeoutMs: number, fetchFn?: any, signal?: AbortSignal): Promise<any>;
/** The message in an error body: {code, message} else the body, else the status name (index.mjs:98-109). */
export declare function zedFailureMessage(status: number, body: unknown): any;
/**
 * stale: a model request was turned away for its model token, which a new one
 * would fix (index.mjs:152).
 */
export declare function zedTokenStale(status: number, headers: {
    get(name: string): string | null;
}): boolean;
/** Test isolation: drop every minted token and in-flight mint. */
export declare function resetZedModelTokens(): void;
/**
 * modelToken: a live model token for `state`, minted anew when `renew` is set
 * (the last one was refused) or none is kept. POST /client/llm_tokens with the
 * organization the models are called under (index.mjs:223-246).
 */
export declare function zedModelToken(state: ZedState, renew: boolean, fetchFn?: any): Promise<string>;
export declare const ZED_MODELS: readonly any[];
