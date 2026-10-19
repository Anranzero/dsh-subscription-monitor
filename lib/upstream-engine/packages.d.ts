/**
 * Upstream engine packages: the pinned manifest, the npm-registry download
 * with metadata-bound sha512 integrity, and the version swap the watcher
 * drives. This is the pilot lane's supply side (docs/oauth.md「上游引擎试点」):
 * only `@magpie-community/*` names, only registry.npmjs.org tarballs, every
 * tarball hash-checked against the registry metadata that named it. The rest
 * of the repo still vendors nothing — a downloaded package is runtime payload
 * under the plugin data dir, never source.
 *
 * Layout (0700, next to auth.json like update-prefs.json):
 *   <dataDir>/upstream-engines/manifest.json   pinned { npm, version, integrity }
 *   <dataDir>/upstream-engines/state.json      watcher's last pass
 *   <dataDir>/upstream-engines/cache/<name>/<version>/index.mjs …
 */
import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { outboundFetch } from '../utils/outbound.js';
/** The one npm scope engines may come from (docs/oauth.md pilot carve-out). */
export declare const ENGINE_NPM_SCOPE = "@magpie-community/";
/** The one registry tarballs may come from; the packument must live there too. */
export declare const ENGINE_REGISTRY = "https://registry.npmjs.org";
/** Cache versions kept on disk for a one-line manifest rollback (README「回退」). */
export declare const KEEP_VERSIONS = 3;
/**
 * The audited seed: the version this repo reviewed in the local clone
 * (.local/upstream-magpie). The integrity is learned from the registry on
 * first bootstrap and pinned from then on — auto-follow then verifies each
 * new version against the metadata that named it.
 */
export declare const ENGINE_SEEDS: Readonly<Record<string, {
    npm: string;
    version: string;
}>>;
export interface EnginePaths {
    root: string;
    manifest: string;
    state: string;
    cache: string;
}
export declare function enginePaths(authPath: string): EnginePaths;
export interface EngineEntry {
    npm: string;
    version: string;
    integrity?: string;
}
export interface EngineManifest {
    engines: Record<string, EngineEntry>;
}
export declare function readEngineManifest(path: any): Promise<EngineManifest | undefined>;
export declare function writeEngineManifest(path: any, manifest: EngineManifest): Promise<void>;
export declare function engineCacheDir(paths: EnginePaths, npm: string, version: string): string;
/** The abbreviated packument the registry serves for install metadata. */
export declare function fetchPackument(npm: any, { fetchFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
}): Promise<any>;
/** dist-tags → the latest version string, when the registry names one. */
export declare function latestOf(packument: any): any;
/** One version's {tarball, integrity} — both must exist and the tarball must come from the pinned registry. */
export declare function versionMeta(packument: any, npm: string, version: string): {
    tarball: any;
    integrity: any;
};
/**
 * Download one version into the cache atomically: stage a sibling tmp dir,
 * verify the tarball hash against the metadata that named it, require the
 * entry file plus a matching package.json (the module reads its own
 * package.json at import — kimi-work/index.mjs:9), then rename into place.
 * An existing dir for the version is left untouched.
 */
export declare function installEngineVersion({ npm, version, tarball, integrity, paths, fetchFn, spawnFn, mkdirFn, writeFileFn, renameFn, rmFn, readFileFn }?: any): Promise<string>;
/** Keep the newest KEEP_VERSIONS versions on disk; older dirs are dead weight after a rollback window. */
export declare function pruneEngineVersions(npm: any, paths: any, { keep, readdirFn, rmFn }?: {
    keep?: number | undefined;
    readdirFn?: typeof readdir | undefined;
    rmFn?: typeof rm | undefined;
}): Promise<string[]>;
/**
 * The entry a family runs, initializing the manifest on first use: a seed
 * version is pinned, downloaded (hash-checked against its registry metadata)
 * and recorded. Never called speculatively — the watcher skips an
 * uninitialized manifest, so nothing lands on disk until an engine is asked for.
 */
export declare function ensureEngineEntry(family: string, paths: EnginePaths, { fetchFn, spawnFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
    spawnFn?: typeof spawn | undefined;
}): Promise<{
    entry: EngineEntry;
    manifest: EngineManifest;
}>;
/**
 * One auto-follow pass for one engine (the pilot's waived gate, maintainer
 * ruling 2026-10-17): when the registry's `latest` moves, download the new
 * version under the same integrity rules and repoint the manifest. Any
 * failure keeps the pinned version running and reports `{status:'error'}`.
 */
export declare function refreshEngine(family: string, paths: EnginePaths, { fetchFn, spawnFn }?: {
    fetchFn?: typeof outboundFetch | undefined;
    spawnFn?: typeof spawn | undefined;
}): Promise<{
    status: string;
    from?: string;
    to?: string;
    error?: string;
}>;
