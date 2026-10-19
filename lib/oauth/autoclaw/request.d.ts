/**
 * AutoClaw refusal classification — the proxy-side semantics that survive the
 * engine conversion. The body dialect rewrite (official system prefix,
 * max_tokens drop, FLAGGED identity lines) is the engine loader's now
 * (engine.ts; ruling 2026-10-18).
 */
import { UpstreamFailure } from '../upstream.js';
/** The 406's way out, as the engine's explained answer words it (index.mjs REFUSED_HINT). */
export declare const AUTOCLAW_REFUSED_HINT = "AutoClaw refuses chats whose system prompt carries another agent's identity line (Claude Code, Codex, opencode, Cursor, Cline, Qwen Code, DeepSeek Harness); this plugin rewrites the ones it knows, so an unknown one needs another provider in this group";
export declare function classifyAutoclawFailure(status: any, parsed: any): UpstreamFailure | undefined;
