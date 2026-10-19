/**
 * The engines' auto-follow watch — self-update's shape (15-minute interval,
 * unref'd, one immediate pass; self-update.ts:90-101) pointed at the npm
 * registry instead of GitHub releases: upstream has no releases, publishing
 * is GitHub Actions OIDC → npm, so dist-tags is the only version signal
 * (feasibility study 2026-10-17). Engines nobody initialized are skipped —
 * the watch costs nothing until a pilot family actually loads one.
 */
import type { AuthController } from '../oauth/controller.js';
/** Same cadence the About card advertises for self-update (update-prefs.ts:13). */
export declare const ENGINE_WATCH_INTERVAL_MS: number;
/** One pass: refresh every initialized engine, record the aggregate state. */
export declare function runEngineWatch(ctl: AuthController, { fetchFn }?: any): Promise<any>;
export declare function startEngineWatch(ctl: AuthController, { intervalMs }?: {
    intervalMs?: number | undefined;
}): void;
export declare function stopEngineWatch(ctl: AuthController): void;
