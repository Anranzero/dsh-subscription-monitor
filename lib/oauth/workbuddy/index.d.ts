/**
 * WorkBuddy / WorkBuddy AI (Tencent CodeBuddy's desktop-agent plans) OAuth.
 *
 * Attribution: **@magpie-community/opencode-workbuddy-auth 0.1.24**
 * (github.com/magpie-community/plugins, packages/workbuddy; MIT) — loaded at
 * runtime as the upstream engine (engine.ts; docs/oauth.md「上游引擎」).
 * One package, two named exports:
 *
 * | provider id | build | endpoint |
 * |---|---|---|
 * | workbuddy | WorkBuddy, the China build (CodeBuddy plan) | https://copilot.tencent.com |
 * | workbuddy-ai | WorkBuddy AI, the international build | https://www.workbuddy.ai |
 *
 * The engine owns the wire: browser sign-in, the one-time token rotation,
 * the chat hop (sign group, conversation ids, body fit) and the usage read.
 * What this module still holds is the family's non-wire facts both sides
 * share — the two sites' identity, the catalog read's endpoints and header
 * seeds, the desktop file reader (the engine reads it too, but the catalog
 * read and the diagnostics need it on our side) and the vault-facing
 * constants. Sign-in is the desktop app's own browser flow; the desktop
 * sign-in itself is a reference (the engine re-reads the file per hop —
 * nothing is copied, WorkBuddy 5.6+ keeps it sealed anyway).
 */
/** The version WorkBuddy's sign-in page is opened with (APP_VERSION). */
export declare const WORKBUDDY_APP_VERSION = "2.0.0";
/** WorkBuddy/<this> is the User-Agent the API takes (UA_VERSION); without it error 10085. */
export declare const WORKBUDDY_UA_VERSION = "5.5.6";
export declare const WORKBUDDY_USER_AGENT = "WorkBuddy/5.5.6";
/** The /v3/config product-config read needs the CLI agent's UA, not the bare one. */
export declare const WORKBUDDY_CLI_USER_AGENT = "CLI/2.0.0 WorkBuddy/5.5.6";
/** A token this close to its end is refreshed before a request (the engine's LEAD_MS era; the vault refresh mirrors it). */
export declare const WORKBUDDY_PREEMPT_MS = 60000;
export declare const WORKBUDDY_SOURCES: readonly string[];
export interface WorkbuddySite {
    id: 'workbuddy' | 'workbuddy-ai';
    name: string;
    endpoint: string;
    /** The desktop app's sign-in file stem (authID). */
    authID: string;
    /** The sign-in page's platform query value. */
    platform: string;
    /** WorkBuddy AI alone sends X-Agent-Type: main. */
    ai: boolean;
}
/** makePlugin(SITES[...]) — the two builds differ only in these fields. */
export declare const WORKBUDDY_SITES: Record<"workbuddy" | "workbuddy-ai", WorkbuddySite>;
export declare function workbuddySiteOf(id: string): WorkbuddySite;
export declare function workbuddyApiBase(site: WorkbuddySite): string;
export declare function workbuddyChatUrl(site: WorkbuddySite): string;
/** The product config (live model list) — /v3, not /v2. */
export declare function workbuddyConfigUrl(site: WorkbuddySite): string;
export declare function workbuddySourceLabel(source: any): "OAuth" | "desktop" | undefined;
/** wbDomain: the account's own domain, else the API host (CN accounts carry www.workbuddy.cn). */
export declare function workbuddyDomainOf(site: WorkbuddySite, session: any): string;
/**
 * X-Enterprise-Id / X-Tenant-Id name the enterprise (team) an account signed
 * in as, exactly as WorkBuddy's own auth interceptor sends them; without them
 * the backend answers as the personal plan. A personal account has none.
 */
export declare function workbuddyEnterpriseHeaders(session: any): {
    'X-Enterprise-Id': string;
    'X-Tenant-Id': string;
} | {
    'X-Enterprise-Id'?: undefined;
    'X-Tenant-Id'?: undefined;
};
export declare function workbuddyDesktopFile(site: WorkbuddySite, { home }?: {
    home?: string | undefined;
}): string;
export interface WorkbuddyDesktopRead {
    session: Record<string, unknown>;
    name: string | undefined;
    encrypted: boolean;
}
/**
 * readWorkbuddyDesktop: the app's sign-in as it keeps it now. null for none;
 * `encrypted` names the WorkBuddy 5.6+ at-rest seal ({$wbEncrypted, envelope})
 * that only the app opens. The engine re-reads this file on every hop for a
 * desktop-source account — a vault row for one never holds its tokens.
 */
export declare function readWorkbuddyDesktop(site: WorkbuddySite, { home }?: {
    home?: string;
}): WorkbuddyDesktopRead | null;
export declare function workbuddyDesktopReason(site: WorkbuddySite, { home }?: {
    home?: string;
}): string;
/** Wire plan spellings → the card's name (plan.ts maps the rest). */
export declare const WORKBUDDY_PLAN_NAMES: Readonly<{
    free: "Free";
    pro: "Pro";
    enterprise: "Enterprise";
}>;
/** Offline floors (magpie 0.1.24's CN_MODELS / AI_MODELS); rows live in src/catalog/models.json. */
export declare const WORKBUDDY_MODELS: readonly any[];
export declare const WORKBUDDY_AI_MODELS: readonly any[];
