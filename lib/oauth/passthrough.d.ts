/**
 * Passthrough hop for families that speak the host wire as-is: one POST per
 * attempt, the pre-output commit gate that keeps a silent failed stream
 * retryable, usage rewriting on completions SSE (per-family rows in
 * families.ts), and the forwarded-header filter. The route's headersOf
 * receives the family applyCache extras bag as its third argument
 * (WorkBuddy's conversation headers derive from it). Timing and retries
 * belong to upstream.ts.
 */
export declare function forward(request: any, response: any, { url, fallbackUrl, session, tokens, headersOf, fetchFn, family, wire, maxRequestBodyBytes, upstreamTimeouts, startedAt, signal, classifyFailure, encodeBody, captureSse }: any): Promise<void>;
