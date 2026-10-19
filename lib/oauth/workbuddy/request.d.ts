/**
 * WorkBuddy Completions dialect.
 *
 * The edits WorkBuddy's chat endpoint (POST {endpoint}/v2/chat/completions,
 * streamed only) needs, each traced to @magpie-community/opencode-
 * workbuddy-auth 0.1.24 (MIT) — and no others:
 *
 * - withSystem's three spellings: max_completion_tokens → max_tokens,
 *   developer → system, a default system message when the chat doesn't open
 *   with one (the app's own behavior), and FLAGGED words rewritten —
 *   WorkBuddy refuses a chat carrying Codex's or Claude Code's own words
 *   with "Illegal API invocation from an unapproved channel" (magpie #182),
 *   whatever the headers.
 * - fitted tools: names made safe ([A-Za-z0-9_-]; another character is
 *   refused), the chat history's calls renamed with them, and parameter
 *   schemas mended (fitSchema / fitShape / objectRoot) into the shape every
 *   backend model takes — WorkBuddy answers 400 code 11133 "Invalid request
 *   parameters" otherwise (DeepSeek turns away each shape below, Kimi, GPT,
 *   Gemini and GLM some of them).
 * - normalizeToolChoice: the object form emitted by OpenAI clients → the
 *   string form (a named choice follows the tool name made safe above).
 *
 * Outbound only: the model's answers keep the sanitized tool names — DSH's
 * own tools are all [A-Za-z0-9_-] already, so the sanitize never fires for
 * them; MCP names with dots/colons get a tool-not-found miss from DSH, which
 * beats losing the whole request to a 400 (see README 「不采纳」).
 */
import { UpstreamFailure } from '../upstream.js';
/**
 * The Completions dialect rewrite, in magpie's proven order: FLAGGED first
 * (a system block it empties must not keep the chat from opening with a
 * system message), then the spellings, the default system, the tools, and
 * last the tool_choice — so a named choice follows the name made safe.
 * A body that isn't a chat (no messages) is passed through untouched.
 */
export declare function applyWorkbuddyChatBody(payload?: any): any;
/**
 * reasoning_effort stays on the wire only when a catalog row advertises the
 * model (its reasoningEfforts table maps the key); otherwise the field goes
 * — an unknown model's effort is the upstream's to refuse, not ours to guess.
 * A model that does advertise thinking never loses the field: a level its row
 * does not map (DSH's `minimal`, or `off` on a row whose model always
 * thinks) goes out as the nearest level the model does serve.
 */
export declare function applyWorkbuddyThinking(payload?: any, model?: any): any;
/** Completions SSE omits usage unless the vendor is asked. Do not override an explicit value. */
export declare function applyWorkbuddyStreamUsage(payload?: any): any;
/**
 * WorkBuddy's usage answers prompt_cache_hit_tokens / prompt_cache_miss_
 * tokens; the hit count is what DSH reads as prompt_tokens_details.
 * cached_tokens (the miss count is already inside prompt_tokens). The
 * vendor's credit field has no DSH slot and is left alone. Absent stays
 * absent — do not invent 0. The alias pick follows Kimi's: the first VALID
 * count, not the first present one.
 */
export declare function mapWorkbuddyUsage(usage: any): any;
/**
 * forward()'s classifyFailure hook. A 401 stays the upstream's own answer so
 * the shared refresh-once path can run. Exhausted credits (code 14018, or
 * its wording — WorkBuddy needs an active package even for 0-rate models)
 * become quotaFailure: the host reads the prefix as QUOTA_EXCEEDED and stops
 * retrying. A restricted account (11140) and an unapproved-channel refusal
 * are 400s with what the user can do — kept at 400 so a 403 never reads as a
 * dead login. Everything else is undefined: the upstream's own answer.
 */
export declare function workbuddyQuotaFailure(status: any, payload: any): UpstreamFailure | undefined;
