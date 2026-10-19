/**
 * Upstream engine loading: dynamic-import a pinned, hash-verified package
 * from the cache (packages.ts) and hand the family adapter its module
 * namespace. `_internal` is not a promised-stable surface upstream, so every
 * load asserts the shape the adapters rely on and a failure fails the
 * operation — never guessed around, never fallen back (ruling 2026-10-18:
 * 不回退、不旧兼容).
 *
 * The cache root follows the outbound.ts singleton pattern: the plugin's
 * composition root configures the data dir once (configureUpstreamEngine),
 * so the proxy and quota paths — which have no authPath of their own — reach
 * the engines without threading a new parameter through shared dispatchers.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outboundFetch } from '../utils/outbound.js';
import { ensureEngineEntry, engineCacheDir, enginePaths } from './packages.js';
let configuredAuthPath;
/** Set the data dir engines cache under (the controller constructor does this once). */
export function configureUpstreamEngine(authPath) {
    configuredAuthPath = typeof authPath === 'string' && authPath ? authPath : undefined;
}
export function upstreamEngineConfiguredFor() {
    return configuredAuthPath;
}
const loaded = new Map();
const failedAt = new Map();
const FAILURE_RETRY_MS = 60_000;
/**
 * Import the family's pinned engine, bootstrapping the download on first
 * use. Imports cache by cache dir, so an auto-followed version is a new key
 * (and in-flight hops keep their old module until they finish). A failed
 * load is remembered for a minute — meanwhile the operation fails with the
 * engine's own error; there is no other lane (ruling 2026-10-18).
 *
 * `entry` picks the module's plugin factory — packages differ (kimi-work
 * exposes `_internal.createPlugin`, workbuddy the named `WorkBuddyAuthPlugin`
 * exports); the default follows OpenCode's default-export convention. A
 * module whose entry is not callable is a contract break: refused here, so
 * the latch covers it for every adapter at once.
 */
export async function loadUpstreamEngine(family, { authPath = configuredAuthPath, fetchFn = outboundFetch, now = Date.now, entry = (module) => module?.default } = {}) {
    if (typeof authPath !== 'string' || !authPath)
        throw new Error(`upstream engine ${family} needs the plugin data dir`);
    const paths = enginePaths(authPath);
    // The latch gates every lane of the load — download included — so a recent
    // failure answers before any registry or disk work runs.
    const lastFailure = failedAt.get(family) ?? 0;
    if (now() - lastFailure < FAILURE_RETRY_MS) {
        throw new Error(`upstream engine ${family} failed to load recently; the operation fails until the next retry window`);
    }
    try {
        const { entry: entryMeta } = await ensureEngineEntry(family, paths, { fetchFn });
        const dir = engineCacheDir(paths, entryMeta.npm, entryMeta.version);
        const key = `${family}@${dir}`;
        const hit = loaded.get(key);
        if (hit)
            return hit;
        const module = await import(pathToFileURL(join(dir, 'index.mjs')).href);
        if (module === null || typeof module !== 'object') {
            throw new Error(`upstream engine ${family}@${entryMeta.version} did not export a module namespace`);
        }
        if (typeof entry(module) !== 'function') {
            throw new Error(`upstream engine ${family}@${entryMeta.version} exports no plugin entry`);
        }
        const engine = { module, version: entryMeta.version, dir };
        loaded.set(key, engine);
        failedAt.delete(family);
        return engine;
    }
    catch (error) {
        failedAt.set(family, now());
        throw error instanceof Error ? error : new Error(String(error));
    }
}
/**
 * The plugin surface a family adapter may drive: the sign-in method, the
 * wire loader and the usage read. Runs against the adapter's own plugin
 * instance (it injected readSession/fetchImpl), so `_internal` drift fails
 * here — before any hop trusts the engine.
 */
export function assertEnginePlugin(family, plugin) {
    const auth = plugin?.auth;
    if (typeof auth?.methods?.[0]?.authorize !== 'function'
        || typeof auth?.loader !== 'function'
        || typeof auth?.usage !== 'function') {
        throw new Error(`upstream engine ${family} does not speak the auth.plugin contract`);
    }
}
/** Test seam: drop the configured dir, cached modules and the failure latch. */
export function resetUpstreamEngineCache() {
    configuredAuthPath = undefined;
    loaded.clear();
    failedAt.clear();
}
/** The version string a loaded engine's own package.json carries (状态行用). */
export async function enginePackageVersion(dir) {
    try {
        const shipped = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
        return typeof shipped?.version === 'string' ? shipped.version : undefined;
    }
    catch {
        return undefined;
    }
}
