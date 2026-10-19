/**
 * Route ids and wire constants for OpenCode Go / Zen.
 *
 * They live in their own module so the live catalog (`catalog.js`) can key rows
 * by route without importing `models.js`, which imports that catalog back.
 */
export const OPENCODE_GO_BUILTIN_ROUTE_ID = 'opencode-go';
export const OPENCODE_GO_EXTRA_ROUTE_ID = 'opencode-go-flash';
export const OPENCODE_GO_RESPONSES_ROUTE_ID = 'opencode-go-responses';
export const OPENCODE_GO_MESSAGES_ROUTE_ID = 'opencode-go-messages';
export const OPENCODE_ZEN_CHAT_ROUTE_ID = 'opencode-zen-chat';
export const OPENCODE_ZEN_RESPONSES_ROUTE_ID = 'opencode-zen-responses';
export const OPENCODE_ZEN_MESSAGES_ROUTE_ID = 'opencode-zen-messages';
export const OPENCODE_GO_SESSION_HEADER = 'x-opencode-session';
export const OPENCODE_GO_SESSION_ID = 'dsh-opencode-go';
