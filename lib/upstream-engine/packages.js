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
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { outboundFetch } from '../utils/outbound.js';
import { readPrivateText, writePrivateText } from '../utils/private-text.js';
/** The one npm scope engines may come from (docs/oauth.md pilot carve-out). */
export const ENGINE_NPM_SCOPE = '@magpie-community/';
/** The one registry tarballs may come from; the packument must live there too. */
export const ENGINE_REGISTRY = 'https://registry.npmjs.org';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_TARBALL_BYTES = 5 * 1024 * 1024;
/** Cache versions kept on disk for a one-line manifest rollback (README「回退」). */
export const KEEP_VERSIONS = 3;
/**
 * The audited seed: the version this repo reviewed in the local clone
 * (.local/upstream-magpie). The integrity is learned from the registry on
 * first bootstrap and pinned from then on — auto-follow then verifies each
 * new version against the metadata that named it.
 */
export const ENGINE_SEEDS = Object.freeze({
    'kimi-work': { npm: '@magpie-community/opencode-kimi-work-auth', version: '0.1.4' },
    // One package, two families: the named WorkBuddyAuthPlugin /
    // WorkBuddyAIAuthPlugin exports drive the China and international builds.
    workbuddy: { npm: '@magpie-community/opencode-workbuddy-auth', version: '0.1.24' },
    'workbuddy-ai': { npm: '@magpie-community/opencode-workbuddy-auth', version: '0.1.24' },
    opendesign: { npm: '@magpie-community/opencode-opendesign-auth', version: '0.1.6' },
    // One package, two families again: AutoclawAuthPlugin / AutoclawCnAuthPlugin.
    autoclaw: { npm: '@magpie-community/opencode-autoclaw-auth', version: '0.2.1' },
    'autoclaw-cn': { npm: '@magpie-community/opencode-autoclaw-auth', version: '0.2.1' },
    zed: { npm: '@magpie-community/opencode-zed-auth', version: '0.1.8' },
    cline: { npm: '@magpie-community/opencode-cline-auth', version: '0.1.8' },
    // The api-key family: browser sign-in loopback, plan-aware hop (Provider
    // API passthrough; Go keys on /alpha/generate) and the allowance read.
    'command-code': { npm: '@magpie-community/opencode-commandcode-auth', version: '0.1.13' },
});
export function enginePaths(authPath) {
    const root = join(dirname(authPath), 'upstream-engines');
    return { root, manifest: join(root, 'manifest.json'), state: join(root, 'state.json'), cache: join(root, 'cache') };
}
function validNpmName(npm) {
    return typeof npm === 'string' && npm.startsWith(ENGINE_NPM_SCOPE) && /^@[\w.-]+\/[\w.-]+$/.test(npm);
}
function validVersion(version) {
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version);
}
export async function readEngineManifest(path) {
    const text = await readPrivateText(path, 'upstream engine manifest').catch(() => undefined);
    if (text === undefined)
        return undefined;
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    const engines = {};
    const rows = raw?.engines ?? {};
    for (const [family, entry] of Object.entries(rows)) {
        if (!validNpmName(entry?.npm) || !validVersion(entry?.version))
            continue;
        engines[family] = { npm: entry.npm, version: entry.version, ...(entry.integrity ? { integrity: entry.integrity } : {}) };
    }
    return { engines };
}
export function writeEngineManifest(path, manifest) {
    return writePrivateText(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
export function engineCacheDir(paths, npm, version) {
    return join(paths.cache, npm.replace(/^@/, '').replace('/', '-'), version);
}
/** The abbreviated packument the registry serves for install metadata. */
export async function fetchPackument(npm, { fetchFn = outboundFetch } = {}) {
    const url = `${ENGINE_REGISTRY}/${npm.replace('/', '%2F')}`;
    const response = await fetchFn(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
    if (!response?.ok)
        throw new Error(`registry ${response?.status ?? 'unavailable'} for ${npm}`);
    return await response.json();
}
/** dist-tags → the latest version string, when the registry names one. */
export function latestOf(packument) {
    const tag = packument?.['dist-tags']?.latest;
    return validVersion(tag) ? tag : undefined;
}
/** One version's {tarball, integrity} — both must exist and the tarball must come from the pinned registry. */
export function versionMeta(packument, npm, version) {
    const dist = packument?.versions?.[version]?.dist;
    const integrity = typeof dist?.integrity === 'string' ? dist.integrity : '';
    const tarball = typeof dist?.tarball === 'string' ? dist.tarball : '';
    if (!integrity.startsWith('sha512-') || !tarball) {
        throw new Error(`registry metadata for ${npm}@${version} has no sha512 tarball`);
    }
    if (new URL(tarball).origin !== ENGINE_REGISTRY) {
        throw new Error(`tarball for ${npm}@${version} is not on ${ENGINE_REGISTRY}`);
    }
    return { tarball, integrity };
}
function extractTar(spawnFn, archive, dest) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            // npm packs unpack under a single `package/` root; drop it.
            child = spawnFn('tar', ['-xf', archive, '-C', dest, '--strip-components=1'], { stdio: ['ignore', 'ignore', 'pipe'] });
        }
        catch (error) {
            reject(error);
            return;
        }
        let stderr = '';
        child.stderr?.on?.('data', (chunk) => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`tar exited ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
        });
    });
}
function sha512Matches(buffer, integrity) {
    const expected = integrity.slice('sha512-'.length);
    const actual = createHash('sha512').update(buffer).digest('base64');
    return actual === expected;
}
async function engineDirReady(dir) {
    const info = await stat(join(dir, 'index.mjs')).catch(() => undefined);
    return info?.isFile() === true;
}
/**
 * Download one version into the cache atomically: stage a sibling tmp dir,
 * verify the tarball hash against the metadata that named it, require the
 * entry file plus a matching package.json (the module reads its own
 * package.json at import — kimi-work/index.mjs:9), then rename into place.
 * An existing dir for the version is left untouched.
 */
export async function installEngineVersion({ npm, version, tarball, integrity, paths, fetchFn = outboundFetch, spawnFn = spawn, mkdirFn = mkdir, writeFileFn = writeFile, renameFn = rename, rmFn = rm, readFileFn = readFile } = {}) {
    if (!validNpmName(npm) || !validVersion(version))
        throw new Error(`refused engine ${npm}@${version}`);
    const target = engineCacheDir(paths, npm, version);
    if (await engineDirReady(target))
        return target;
    const parent = dirname(target);
    await mkdirFn(parent, { recursive: true, mode: 0o700 });
    const stage = join(parent, `.${version}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
    const wait = new AbortController();
    const timer = setTimeout(() => wait.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetchFn(tarball, {
            headers: { 'user-agent': 'dsh-plugin-oauth-subs' },
            signal: wait.signal,
        });
        if (!response?.ok)
            throw new Error(`tarball ${response?.status ?? 'unavailable'}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_TARBALL_BYTES)
            throw new Error(`tarball over ${MAX_TARBALL_BYTES} bytes`);
        if (!sha512Matches(buffer, integrity))
            throw new Error('tarball sha512 does not match registry metadata');
        await mkdirFn(stage, { recursive: true, mode: 0o700 });
        const archive = join(stage, 'package.tgz');
        await writeFileFn(archive, buffer, { mode: 0o600 });
        await extractTar(spawnFn, archive, stage);
        await rmFn(archive, { force: true });
        if (!await engineDirReady(stage))
            throw new Error('tarball has no index.mjs');
        const shipped = JSON.parse(await readFileFn(join(stage, 'package.json'), 'utf8'));
        if (shipped?.version !== version)
            throw new Error(`tarball package.json says ${shipped?.version}, wanted ${version}`);
        try {
            await renameFn(stage, target);
        }
        catch (error) {
            // A concurrent install won the rename; keep theirs, drop ours.
            if (await engineDirReady(target))
                await rmFn(stage, { recursive: true, force: true });
            else
                throw error;
        }
        return target;
    }
    finally {
        clearTimeout(timer);
        await rmFn(stage, { recursive: true, force: true }).catch(() => undefined);
    }
}
function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0))
            return (a[i] ?? 0) - (b[i] ?? 0);
    }
    return 0;
}
/** Keep the newest KEEP_VERSIONS versions on disk; older dirs are dead weight after a rollback window. */
export async function pruneEngineVersions(npm, paths, { keep = KEEP_VERSIONS, readdirFn = readdir, rmFn = rm } = {}) {
    const parent = dirname(engineCacheDir(paths, npm, '0.0.0'));
    const rows = await readdirFn(parent).catch(() => []);
    const versions = rows.filter((name) => validVersion(name)).sort(compareVersions).reverse();
    const removed = [];
    for (const stale of versions.slice(keep)) {
        await rmFn(join(parent, stale), { recursive: true, force: true }).catch(() => undefined);
        removed.push(stale);
    }
    return removed;
}
/**
 * The entry a family runs, initializing the manifest on first use: a seed
 * version is pinned, downloaded (hash-checked against its registry metadata)
 * and recorded. Never called speculatively — the watcher skips an
 * uninitialized manifest, so nothing lands on disk until an engine is asked for.
 */
export async function ensureEngineEntry(family, paths, { fetchFn = outboundFetch, spawnFn = spawn } = {}) {
    const manifest = await readEngineManifest(paths.manifest) ?? { engines: {} };
    const existing = manifest.engines[family];
    const seed = ENGINE_SEEDS[family];
    const base = existing ?? (seed ? { npm: seed.npm, version: seed.version } : undefined);
    if (!base)
        throw new Error(`no upstream engine registered for ${family}`);
    if (await engineDirReady(engineCacheDir(paths, base.npm, base.version))) {
        if (!existing) {
            manifest.engines[family] = base;
            await writeEngineManifest(paths.manifest, manifest);
        }
        return { entry: base, manifest };
    }
    const packument = await fetchPackument(base.npm, { fetchFn });
    const meta = versionMeta(packument, base.npm, base.version);
    await installEngineVersion({ npm: base.npm, version: base.version, tarball: meta.tarball, integrity: meta.integrity, paths, fetchFn, spawnFn });
    const entry = { npm: base.npm, version: base.version, integrity: meta.integrity };
    manifest.engines[family] = entry;
    await writeEngineManifest(paths.manifest, manifest);
    return { entry, manifest };
}
/**
 * One auto-follow pass for one engine (the pilot's waived gate, maintainer
 * ruling 2026-10-17): when the registry's `latest` moves, download the new
 * version under the same integrity rules and repoint the manifest. Any
 * failure keeps the pinned version running and reports `{status:'error'}`.
 */
export async function refreshEngine(family, paths, { fetchFn = outboundFetch, spawnFn = spawn } = {}) {
    try {
        const manifest = await readEngineManifest(paths.manifest);
        const entry = manifest?.engines[family];
        if (!manifest || !entry)
            return { status: 'skipped' };
        const packument = await fetchPackument(entry.npm, { fetchFn });
        const latest = latestOf(packument);
        if (!latest || latest === entry.version)
            return { status: 'current', from: entry.version, to: entry.version };
        const meta = versionMeta(packument, entry.npm, latest);
        await installEngineVersion({ npm: entry.npm, version: latest, tarball: meta.tarball, integrity: meta.integrity, paths, fetchFn, spawnFn });
        manifest.engines[family] = { npm: entry.npm, version: latest, integrity: meta.integrity };
        await writeEngineManifest(paths.manifest, manifest);
        await pruneEngineVersions(entry.npm, paths).catch(() => undefined);
        return { status: 'updated', from: entry.version, to: latest };
    }
    catch (error) {
        return { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
}
