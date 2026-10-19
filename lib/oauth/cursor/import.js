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
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cursorAccessStillValid, cursorSession } from './index.js';
import { ImportedLoginStale } from '../tokens.js';
import { decodeJwtPayload } from '../../utils/jwt.js';
const execFileAsync = promisify(execFile);
const KEYCHAIN_TIMEOUT_MS = 2000;
export const CURSOR_IMPORT_EMPTY = 'cursor-import-empty';
/** Windows account that owns this WSL session — never Public / Default / others. */
export function windowsUsernameFromEnv(env = process.env) {
    const profile = typeof env.USERPROFILE === 'string' ? env.USERPROFILE.trim() : '';
    if (profile) {
        const normalized = profile.replace(/\\/g, '/');
        const match = /\/Users\/([^/]+)/i.exec(normalized);
        const fromProfile = match?.[1]?.trim();
        if (fromProfile && fromProfile !== 'Public' && fromProfile !== 'Default' && !fromProfile.startsWith('.')) {
            return fromProfile;
        }
    }
    const username = typeof env.USERNAME === 'string' ? env.USERNAME.trim() : '';
    if (username && username !== 'Public' && username !== 'Default' && !username.startsWith('.')) {
        return username;
    }
    return undefined;
}
export function cursorVscdbPaths({ platform = process.platform, env = process.env, home = homedir() } = {}) {
    const paths = [];
    if (platform === 'darwin') {
        paths.push(join(home, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb'));
    }
    else if (platform === 'win32') {
        if (env.APPDATA)
            paths.push(join(env.APPDATA, 'Cursor/User/globalStorage/state.vscdb'));
    }
    else {
        paths.push(join(home, '.config/Cursor/User/globalStorage/state.vscdb'));
        const wsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP || existsSync('/mnt/c/Users'));
        if (wsl) {
            const windowsUser = windowsUsernameFromEnv(env);
            if (windowsUser) {
                paths.push(join('/mnt/c/Users', windowsUser, 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb'));
            }
        }
    }
    return paths;
}
async function defaultReadVscdb(dbPath) {
    let DatabaseSync;
    try {
        ;
        ({ DatabaseSync } = await import('node:sqlite'));
    }
    catch {
        return {};
    }
    if (!existsSync(dbPath))
        return {};
    let db;
    try {
        db = new DatabaseSync(dbPath, { readOnly: true });
        const accessRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'").get();
        const refreshRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/refreshToken'").get();
        const emailRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/cachedEmail'").get();
        return {
            accessToken: typeof accessRow?.value === 'string' ? accessRow.value.trim() : undefined,
            refreshToken: typeof refreshRow?.value === 'string' ? refreshRow.value.trim() : undefined,
            cachedEmail: typeof emailRow?.value === 'string' && emailRow.value.trim()
                ? emailRow.value.trim()
                : undefined,
        };
    }
    catch {
        return {};
    }
    finally {
        try {
            db?.close();
        }
        catch { /* already closed */ }
    }
}
export async function readCursorVscdbTokens({ platform = process.platform, env = process.env, home = homedir(), paths, readDb = defaultReadVscdb, now = Date.now(), } = {}) {
    const dbPaths = paths ?? cursorVscdbPaths({ platform, env, home });
    const fallback = {};
    for (const dbPath of dbPaths) {
        const tokens = await readDb(dbPath);
        const access = typeof tokens.accessToken === 'string' ? tokens.accessToken.trim() : undefined;
        const refresh = typeof tokens.refreshToken === 'string' ? tokens.refreshToken.trim() : undefined;
        const cachedEmail = typeof tokens.cachedEmail === 'string' && tokens.cachedEmail.trim()
            ? tokens.cachedEmail.trim()
            : undefined;
        const hit = { accessToken: access, refreshToken: refresh, ...(cachedEmail ? { cachedEmail } : {}) };
        if (cursorAccessStillValid(access, now))
            return hit;
        if (!fallback.refreshToken && refresh) {
            fallback.refreshToken = refresh;
            if (cachedEmail)
                fallback.cachedEmail = cachedEmail;
        }
        if (!fallback.accessToken && access) {
            fallback.accessToken = access;
            if (cachedEmail && !fallback.cachedEmail)
                fallback.cachedEmail = cachedEmail;
        }
    }
    return fallback;
}
export async function readCursorKeychainTokens({ platform = process.platform, execFileFn = execFileAsync, } = {}) {
    if (platform !== 'darwin')
        return {};
    const run = (service) => execFileFn('security', ['find-generic-password', '-s', service, '-a', 'cursor-user', '-w'], { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS });
    const [accessResult, refreshResult] = await Promise.allSettled([
        run('cursor-access-token'),
        run('cursor-refresh-token'),
    ]);
    const tokens = {};
    if (accessResult.status === 'fulfilled') {
        const raw = String(accessResult.value?.stdout ?? '').trim();
        if (raw)
            tokens.accessToken = raw;
    }
    if (refreshResult.status === 'fulfilled') {
        const raw = String(refreshResult.value?.stdout ?? '').trim();
        if (raw)
            tokens.refreshToken = raw;
    }
    return tokens;
}
/**
 * cursor-agent keeps its sign-in off the Keychain in auth.json: darwin
 * `~/.cursor/auth.json`, else `$XDG_CONFIG_HOME/cursor/auth.json`, Windows
 * `%APPDATA%\Cursor\auth.json` (magpie packages/cursor index.mjs authFile /
 * cliToken — the Keychain read falls back to it). Read-only, same as the
 * Keychain: the CLI owns renewal.
 */
export function cursorAuthFilePaths({ platform = process.platform, env = process.env, home = homedir() } = {}) {
    if (platform === 'win32') {
        const appData = typeof env.APPDATA === 'string' && env.APPDATA.trim() ? env.APPDATA.trim() : join(home, 'AppData', 'Roaming');
        return [join(appData, 'Cursor', 'auth.json')];
    }
    if (platform === 'darwin')
        return [join(home, '.cursor', 'auth.json')];
    const configHome = typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME.trim() : join(home, '.config');
    return [join(configHome, 'cursor', 'auth.json')];
}
async function defaultReadAuthFile(path) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        const access = typeof parsed?.accessToken === 'string' ? parsed.accessToken.trim() : '';
        const refresh = typeof parsed?.refreshToken === 'string' ? parsed.refreshToken.trim() : '';
        return access ? { accessToken: access, ...(refresh ? { refreshToken: refresh } : {}) } : {};
    }
    catch {
        return {};
    }
}
export async function readCursorAuthFileTokens({ platform = process.platform, env = process.env, home = homedir(), paths, readFileFn = defaultReadAuthFile, } = {}) {
    for (const path of paths ?? cursorAuthFilePaths({ platform, env, home })) {
        const tokens = await readFileFn(path);
        if (tokens?.accessToken)
            return tokens;
    }
    return {};
}
/** The stale-login hint names the client that owns each store. */
const CURSOR_CLI = 'cursor-agent (or open Cursor)';
export async function resolveCursorLocalCredentials({ env = process.env, platform = process.platform, home = homedir(), execFileFn = execFileAsync, readVscdbFn, readAuthFileFn, now = Date.now(), } = {}) {
    const envToken = typeof env.CURSOR_ACCESS_TOKEN === 'string' ? env.CURSOR_ACCESS_TOKEN.trim() : '';
    if (envToken) {
        return cursorSession({ accessToken: envToken, refreshToken: envToken, source: 'env' });
    }
    const readDb = readVscdbFn
        ?? ((dbPath) => defaultReadVscdb(dbPath));
    // The CLI's own stores — Keychain first, auth.json where the CLI keeps it
    // off a Mac — then the IDE's vscdb, all read in parallel, zero network.
    const [keychain, authFile, vscdb] = await Promise.all([
        readCursorKeychainTokens({ platform, execFileFn }),
        readCursorAuthFileTokens({ platform, env, home, readFileFn: readAuthFileFn }),
        readCursorVscdbTokens({ platform, env, home, readDb, now }),
    ]);
    if (cursorAccessStillValid(keychain.accessToken, now)) {
        return cursorSession({
            accessToken: keychain.accessToken,
            refreshToken: keychain.refreshToken,
            source: 'cli_keychain',
        });
    }
    if (cursorAccessStillValid(authFile.accessToken, now)) {
        return cursorSession({
            accessToken: authFile.accessToken,
            refreshToken: authFile.refreshToken,
            source: 'cli_keychain',
        });
    }
    if (cursorAccessStillValid(vscdb.accessToken, now)) {
        return cursorSession({
            accessToken: vscdb.accessToken,
            refreshToken: vscdb.refreshToken,
            account: vscdb.cachedEmail,
            source: 'ide_vscdb',
        });
    }
    if (keychain.accessToken || authFile.accessToken || vscdb.accessToken)
        throw new ImportedLoginStale('Cursor', CURSOR_CLI);
    return undefined;
}
export async function importCursorAuth(options = {}) {
    const session = await resolveCursorLocalCredentials(options);
    if (!session) {
        throw Object.assign(new Error(CURSOR_IMPORT_EMPTY), { code: CURSOR_IMPORT_EMPTY });
    }
    return { source: session.source, session };
}
/** Reread the store an imported login came from — the same readers as import, zero network. */
export async function rereadCursorImport(session, { platform = process.platform, env = process.env, home = homedir(), execFileFn = execFileAsync, readVscdbFn = defaultReadVscdb, readAuthFileFn, } = {}) {
    if (session.source === 'cli_keychain') {
        // Validity first, the same order the import read: a still-valid Keychain
        // entry, then auth.json — a stale Keychain leftover must not shadow a
        // live auth.json login. Both stale falls back to whichever store still
        // holds a token, so the caller reports the login as stale.
        const [keychain, authFile] = await Promise.all([
            readCursorKeychainTokens({ platform, execFileFn }),
            readCursorAuthFileTokens({ platform, env, home, readFileFn: readAuthFileFn }),
        ]);
        const now = Date.now();
        if (cursorAccessStillValid(keychain.accessToken, now)) {
            return cursorSession({ ...keychain, source: session.source });
        }
        if (cursorAccessStillValid(authFile.accessToken, now)) {
            return cursorSession({ ...authFile, source: session.source });
        }
        const tokens = keychain.accessToken ? keychain : authFile;
        return tokens.accessToken ? cursorSession({ ...tokens, source: session.source }) : undefined;
    }
    const tokens = await readCursorVscdbTokens({ platform, env, home, readDb: readVscdbFn });
    return tokens.accessToken ? cursorSession({ ...tokens, source: session.source }) : undefined;
}
/** Keychain (CLI) and state.vscdb (IDE) imports; `options` injects the readers in tests. */
export function cursorImported(options = {}) {
    return {
        cli: CURSOR_CLI,
        is: (session) => session?.source === 'cli_keychain' || session?.source === 'ide_vscdb',
        reread: (session) => rereadCursorImport(session, options),
        identity: (session) => decodeJwtPayload(session?.accessToken)?.sub,
    };
}
