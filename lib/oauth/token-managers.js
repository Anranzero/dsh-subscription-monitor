/**
 * Per-family TokenManager wiring, extracted verbatim from controller.ts
 * (behavior-identical move): one factory builds the manager instances the
 * controller assigns to `this.tokens`. Everything those literals used to
 * close over from the constructor arrives through `deps`; family refresh
 * hooks, import predicates, and preempt constants stay imports from their own
 * family modules (the preempt values are single-sourced from the family
 * index constants — glm, kiro, ollama, and command-code have no exported
 * constant yet, so their literals stay).
 */
import { TokenManager } from './tokens.js';
import { CODEX_PERMANENT_REFRESH_CODES, CODEX_PREEMPT_MS, refreshCodex } from './codex/index.js';
import { codexImported } from './import-auth.js';
import { CHATGPT_PERMANENT_REFRESH_CODES, CHATGPT_PREEMPT_MS, refreshChatgpt } from './chatgpt/index.js';
import { GROK_PREEMPT_MS, refreshGrok } from './grok/index.js';
import { refreshGlm } from './glm/index.js';
import { refreshKiro } from './kiro/index.js';
import { ANTIGRAVITY_PREEMPT_MS, refreshAntigravity } from './antigravity/index.js';
import { CURSOR_PREEMPT_MS, refreshCursor } from './cursor/index.js';
import { cursorImported } from './cursor/import.js';
import { refreshOllama } from '../apikey/ollama/index.js';
import { KIMI_PREEMPT_MS, refreshKimi } from './kimi/index.js';
import { kimiImported } from './kimi/import.js';
import { DEVIN_PREEMPT_MS, refreshDevin } from './devin/index.js';
import { devinUserStatus } from './devin/transport.js';
import { CLINE_PREEMPT_MS } from './cline/index.js';
import { refreshClineEngine } from './cline/engine.js';
import { clineImported } from './cline/import.js';
import { WORKBUDDY_PREEMPT_MS, WORKBUDDY_SITES } from './workbuddy/index.js';
import { refreshWorkbuddyEngine } from './workbuddy/engine.js';
import { AUTOCLAW_PREEMPT_MS } from './autoclaw/index.js';
import { refreshAutoclawEngine } from './autoclaw/engine.js';
import { OPENDESIGN_PREEMPT_MS, refreshOpendesign } from './opendesign/index.js';
import { refreshKimiWork } from './kimi-work/index.js';
import { MIMO_PREEMPT_MS, refreshMimo } from './mimo/index.js';
import { refreshZed } from './zed/index.js';
import { refreshCommandCode } from '../apikey/command-code/index.js';
import { refreshMinimax } from '../apikey/minimax/index.js';
export function buildTokenManagers(deps) {
    const { authPath, fetchFn, cursorImport, onAuthChanged } = deps;
    return {
        codex: new TokenManager({
            displayName: 'ChatGPT (Codex)',
            preemptMs: CODEX_PREEMPT_MS,
            provider: 'codex',
            authPath,
            refresh: (session) => refreshCodex(session, fetchFn),
            permanentCodes: CODEX_PERMANENT_REFRESH_CODES,
            imported: codexImported,
            onRemoved: () => onAuthChanged?.('codex'),
        }),
        chatgpt: new TokenManager({
            displayName: 'ChatGPT (Sign in with ChatGPT)',
            preemptMs: CHATGPT_PREEMPT_MS,
            provider: 'chatgpt',
            authPath,
            refresh: (session) => refreshChatgpt(session, fetchFn),
            permanentCodes: CHATGPT_PERMANENT_REFRESH_CODES,
            onRemoved: () => onAuthChanged?.('chatgpt'),
        }),
        grok: new TokenManager({
            displayName: 'Grok (Subscription)',
            preemptMs: GROK_PREEMPT_MS,
            provider: 'grok',
            authPath,
            refresh: (session) => refreshGrok(session, fetchFn),
            onRemoved: () => onAuthChanged?.('grok'),
        }),
        glm: new TokenManager({
            displayName: 'GLM (Coding Plan)',
            preemptMs: 24 * 60 * 60_000,
            provider: 'glm',
            authPath,
            refresh: refreshGlm,
            onRemoved: () => onAuthChanged?.('glm'),
        }),
        kiro: new TokenManager({
            displayName: 'Kiro',
            preemptMs: 2 * 60_000,
            provider: 'kiro',
            authPath,
            refresh: (session) => refreshKiro(session, { fetchFn }),
            onRemoved: () => onAuthChanged?.('kiro'),
        }),
        antigravity: new TokenManager({
            displayName: 'Antigravity',
            preemptMs: ANTIGRAVITY_PREEMPT_MS,
            provider: 'antigravity',
            authPath,
            refresh: (session) => refreshAntigravity(session, fetchFn),
            onRemoved: () => onAuthChanged?.('antigravity'),
        }),
        cursor: new TokenManager({
            displayName: 'Cursor',
            preemptMs: CURSOR_PREEMPT_MS,
            provider: 'cursor',
            authPath,
            refresh: (session) => refreshCursor(session, fetchFn),
            imported: cursorImported(cursorImport),
            onRemoved: () => onAuthChanged?.('cursor'),
        }),
        ollama: new TokenManager({
            displayName: 'Ollama Cloud',
            preemptMs: 24 * 60 * 60_000,
            provider: 'ollama',
            authPath,
            refresh: refreshOllama,
            onRemoved: () => onAuthChanged?.('ollama'),
        }),
        kimi: new TokenManager({
            displayName: 'Kimi (Code Plan)',
            preemptMs: KIMI_PREEMPT_MS,
            provider: 'kimi',
            authPath,
            refresh: (session) => refreshKimi(session, fetchFn),
            imported: kimiImported,
            onRemoved: () => onAuthChanged?.('kimi'),
        }),
        devin: new TokenManager({
            displayName: 'Devin Agent',
            preemptMs: DEVIN_PREEMPT_MS,
            provider: 'devin',
            authPath,
            refresh: (session) => refreshDevin(session, { fetchFn, statusFn: devinUserStatus }),
            onRemoved: () => onAuthChanged?.('devin'),
        }),
        cline: new TokenManager({
            displayName: 'Cline',
            preemptMs: CLINE_PREEMPT_MS,
            provider: 'cline',
            authPath,
            refresh: (session) => refreshClineEngine(session, fetchFn),
            imported: clineImported,
            onRemoved: () => onAuthChanged?.('cline'),
        }),
        'command-code': new TokenManager({
            displayName: 'Command Code',
            preemptMs: 24 * 60 * 60_000,
            provider: 'command-code',
            authPath,
            refresh: refreshCommandCode,
            onRemoved: () => onAuthChanged?.('command-code'),
        }),
        // No `imported` hook: a desktop-source reference never touches the
        // refresh endpoint (the engine re-reads the app's file per hop —
        // spending its refresh token would sign the app out);
        // refreshWorkbuddyEngine verifies the file is still readable and still
        // this account, and a missing or sealed file reads as a permanent 401 so
        // the row is reaped instead of looping. The rotation hold covers the
        // browser logins.
        workbuddy: new TokenManager({
            displayName: 'WorkBuddy',
            preemptMs: WORKBUDDY_PREEMPT_MS,
            provider: 'workbuddy',
            authPath,
            refresh: (session) => refreshWorkbuddyEngine(WORKBUDDY_SITES.workbuddy, session, fetchFn),
            onRemoved: () => onAuthChanged?.('workbuddy'),
        }),
        // Xiaomi MiMo re-signs-on ahead of the 24h cookie jar's lapse (upstream
        // LEAD_MS 10min, index.mjs:25); MimoLapsedError carries 401 +
        // invalid_grant, so the shared isPermanentRefreshFailure reads a dead
        // account as permanent without a family permanentCodes list.
        mimo: new TokenManager({
            displayName: 'Xiaomi MiMo',
            preemptMs: MIMO_PREEMPT_MS,
            provider: 'mimo',
            authPath,
            refresh: (session) => refreshMimo(session, fetchFn),
            onRemoved: () => onAuthChanged?.('mimo'),
        }),
        'workbuddy-ai': new TokenManager({
            displayName: 'WorkBuddy AI',
            preemptMs: WORKBUDDY_PREEMPT_MS,
            provider: 'workbuddy-ai',
            authPath,
            refresh: (session) => refreshWorkbuddyEngine(WORKBUDDY_SITES['workbuddy-ai'], session, fetchFn),
            onRemoved: () => onAuthChanged?.('workbuddy-ai'),
        }),
        // No `imported` hook: a referenced session refresh re-reads the desktop
        // file inside refreshKimiWork itself (a local read, never an endpoint), and
        // a missing or switched-account file reads as a permanent 401 so the row is
        // reaped instead of looping (workbuddy above, same shape).
        'kimi-work': new TokenManager({
            displayName: 'Kimi Work',
            preemptMs: 24 * 60 * 60_000,
            provider: 'kimi-work',
            authPath,
            refresh: (session) => refreshKimiWork(session),
            onRemoved: () => onAuthChanged?.('kimi-work'),
        }),
        // Refresh is one-shot rotation here too; the shared rotation hold keeps a
        // concurrent preempt + 401 refresh from double-spending the token
        // (workbuddy above, same comment). Preempt leads the JWT exp by its
        // 10-minute skew (autoclaw/index.ts AUTOCLAW_PREEMPT_MS).
        autoclaw: new TokenManager({
            displayName: 'AutoClaw',
            preemptMs: AUTOCLAW_PREEMPT_MS,
            provider: 'autoclaw',
            authPath,
            refresh: (session) => refreshAutoclawEngine('autoclaw', session, fetchFn),
            onRemoved: () => onAuthChanged?.('autoclaw'),
        }),
        'autoclaw-cn': new TokenManager({
            displayName: 'AutoClaw CN (国内)',
            preemptMs: AUTOCLAW_PREEMPT_MS,
            provider: 'autoclaw-cn',
            authPath,
            refresh: (session) => refreshAutoclawEngine('autoclaw-cn', session, fetchFn),
            onRemoved: () => onAuthChanged?.('autoclaw-cn'),
        }),
        // Zed's stored pair never expires (refreshZed is an identity no-op, the
        // command-code never-expiring-credential reading); the model token the hop
        // mints per call is the thing that can go stale, and the hop handles that.
        zed: new TokenManager({
            displayName: 'Zed',
            preemptMs: 24 * 60 * 60_000,
            provider: 'zed',
            authPath,
            refresh: refreshZed,
            onRemoved: () => onAuthChanged?.('zed'),
        }),
        // Neither key expires (upstream index.mjs:71-86): refresh is the identity
        // function, so the TokenManager only gates sign-in state, never rotates.
        opendesign: new TokenManager({
            displayName: 'Open Design (Design Plan)',
            preemptMs: OPENDESIGN_PREEMPT_MS,
            provider: 'opendesign',
            authPath,
            refresh: refreshOpendesign,
            onRemoved: () => onAuthChanged?.('opendesign'),
        }),
        // A MiniMax API key never expires either, so the same identity-refresh
        // rule applies: the manager gates sign-in state only.
        minimax: new TokenManager({
            displayName: 'MiniMax',
            preemptMs: 24 * 60 * 60_000,
            provider: 'minimax',
            authPath,
            refresh: refreshMinimax,
            onRemoved: () => onAuthChanged?.('minimax'),
        }),
    };
}
