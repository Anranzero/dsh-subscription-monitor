/**
 * User-owned local Cursor login reuse. This is not a second OAuth.
 *
 * Resolution (Import click / empty-roster auto-import):
 *   1. CURSOR_ACCESS_TOKEN env (no refresh)
 *   2. macOS Keychain + cursor-agent auth.json + IDE state.vscdb concurrently
 *   3. Take a still-valid local access token (Keychain, then auth.json, then
 *      vscdb) with zero network
 *   4. Else the local login is stale (ImportedLoginStale). The refresh token
 *      is the CLI's / IDE's own: imports are read-only (decision 4), never
 *      exchanged here or later — TokenManager rereads via `cursorImported`
 *
 * Never scan sibling OS profiles. WSL uses only the current Windows user.
 * Adapted from MIT Rahularya01/pi-cursor src/auth/cli-credentials.ts and
 * magpie packages/cursor (authFile / cliToken) — not copied.
 */
import { execFile } from 'node:child_process';
export declare const CURSOR_IMPORT_EMPTY = "cursor-import-empty";
/** Windows account that owns this WSL session — never Public / Default / others. */
export declare function windowsUsernameFromEnv(env?: NodeJS.ProcessEnv): string | undefined;
export declare function cursorVscdbPaths({ platform, env, home }?: {
    platform?: NodeJS.Platform | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    home?: string | undefined;
}): any[];
export declare function readCursorVscdbTokens({ platform, env, home, paths, readDb, now, }?: any): Promise<any>;
export declare function readCursorKeychainTokens({ platform, execFileFn, }?: {
    platform?: NodeJS.Platform | undefined;
    execFileFn?: typeof execFile.__promisify__ | undefined;
}): Promise<any>;
/**
 * cursor-agent keeps its sign-in off the Keychain in auth.json: darwin
 * `~/.cursor/auth.json`, else `$XDG_CONFIG_HOME/cursor/auth.json`, Windows
 * `%APPDATA%\Cursor\auth.json` (magpie packages/cursor index.mjs authFile /
 * cliToken — the Keychain read falls back to it). Read-only, same as the
 * Keychain: the CLI owns renewal.
 */
export declare function cursorAuthFilePaths({ platform, env, home }?: any): string[];
export declare function readCursorAuthFileTokens({ platform, env, home, paths, readFileFn, }?: any): Promise<any>;
export declare function resolveCursorLocalCredentials({ env, platform, home, execFileFn, readVscdbFn, readAuthFileFn, now, }?: any): Promise<{
    cachedEmail?: string | undefined;
    planType?: any;
    source: any;
    account?: string | undefined;
    accessToken: any;
    refreshToken: any;
    expiresAt: number;
} | undefined>;
export declare function importCursorAuth(options?: any): Promise<{
    source: any;
    session: {
        cachedEmail?: string | undefined;
        planType?: any;
        source: any;
        account?: string | undefined;
        accessToken: any;
        refreshToken: any;
        expiresAt: number;
    };
}>;
/** Reread the store an imported login came from — the same readers as import, zero network. */
export declare function rereadCursorImport(session: any, { platform, env, home, execFileFn, readVscdbFn, readAuthFileFn, }?: any): Promise<{
    cachedEmail?: string | undefined;
    planType?: any;
    source: any;
    account?: string | undefined;
    accessToken: any;
    refreshToken: any;
    expiresAt: number;
} | undefined>;
/** Keychain (CLI) and state.vscdb (IDE) imports; `options` injects the readers in tests. */
export declare function cursorImported(options?: any): {
    cli: string;
    is: (session: any) => boolean;
    reread: (session: any) => Promise<{
        cachedEmail?: string | undefined;
        planType?: any;
        source: any;
        account?: string | undefined;
        accessToken: any;
        refreshToken: any;
        expiresAt: number;
    } | undefined>;
    identity: (session: any) => any;
};
