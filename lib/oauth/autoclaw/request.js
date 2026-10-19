/**
 * AutoClaw refusal classification — the proxy-side semantics that survive the
 * engine conversion. The body dialect rewrite (official system prefix,
 * max_tokens drop, FLAGGED identity lines) is the engine loader's now
 * (engine.ts; ruling 2026-10-18).
 */
import { UpstreamFailure } from '../upstream.js';
/** The 406's way out, as the engine's explained answer words it (index.mjs REFUSED_HINT). */
export const AUTOCLAW_REFUSED_HINT = 'AutoClaw refuses chats whose system prompt carries another agent\'s identity line (Claude Code, Codex, opencode, Cursor, Cline, Qwen Code, DeepSeek Harness); this plugin rewrites the ones it knows, so an unknown one needs another provider in this group';
export function classifyAutoclawFailure(status, parsed) {
    if (status !== 406)
        return undefined;
    const said = typeof parsed?.error?.message === 'string' && parsed.error.message ? parsed.error.message : '';
    // The international engine path already appends this hint in its explained()
    // 406 body (byte-identical, index.mjs REFUSED_HINT); append only what is
    // missing — CN managed bodies arrive bare.
    const base = said || '406 Not Acceptable';
    const message = said.includes(AUTOCLAW_REFUSED_HINT) ? base : `${base} — ${AUTOCLAW_REFUSED_HINT}`;
    return new UpstreamFailure(406, `autoclaw upstream 406`, {
        code: 'http',
        payload: {
            error: {
                message,
                type: 'permission_error',
                code: null,
            },
        },
    });
}
