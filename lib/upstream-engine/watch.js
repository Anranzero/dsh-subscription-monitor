/**
 * The engines' auto-follow watch — self-update's shape (15-minute interval,
 * unref'd, one immediate pass; self-update.ts:90-101) pointed at the npm
 * registry instead of GitHub releases: upstream has no releases, publishing
 * is GitHub Actions OIDC → npm, so dist-tags is the only version signal
 * (feasibility study 2026-10-17). Engines nobody initialized are skipped —
 * the watch costs nothing until a pilot family actually loads one.
 */
import { writePrivateText } from '../utils/private-text.js';
import { readEngineManifest, refreshEngine } from './packages.js';
/** Same cadence the About card advertises for self-update (update-prefs.ts:13). */
export const ENGINE_WATCH_INTERVAL_MS = 15 * 60_000;
/** One pass: refresh every initialized engine, record the aggregate state. */
export async function runEngineWatch(ctl, { fetchFn } = {}) {
    const paths = ctl.enginePaths;
    if (!paths)
        return { skipped: true };
    const fetch = fetchFn ?? ctl.fetchFn;
    const manifest = await readEngineManifest(paths.manifest);
    const families = Object.keys(manifest?.engines ?? {});
    if (families.length === 0)
        return { skipped: true };
    const engines = {};
    for (const family of families) {
        engines[family] = await refreshEngine(family, paths, { fetchFn: fetch });
    }
    ctl.engineState = { at: new Date().toISOString(), engines };
    await writePrivateText(paths.state, `${JSON.stringify(ctl.engineState, null, 2)}\n`).catch(() => undefined);
    return ctl.engineState;
}
export function startEngineWatch(ctl, { intervalMs = ENGINE_WATCH_INTERVAL_MS } = {}) {
    if (ctl.engineWatchTimer)
        return;
    void runEngineWatch(ctl).catch(() => undefined);
    ctl.engineWatchTimer = setInterval(() => void runEngineWatch(ctl).catch(() => undefined), intervalMs);
    ctl.engineWatchTimer.unref?.();
}
export function stopEngineWatch(ctl) {
    if (!ctl.engineWatchTimer)
        return;
    clearInterval(ctl.engineWatchTimer);
    ctl.engineWatchTimer = undefined;
}
