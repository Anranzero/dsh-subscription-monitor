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
/** A loaded engine module: the namespace plus the pinned version it came from. */
export interface LoadedEngine {
    module: any;
    version: string;
    dir: string;
}
/** Set the data dir engines cache under (the controller constructor does this once). */
export declare function configureUpstreamEngine(authPath: any): void;
export declare function upstreamEngineConfiguredFor(): string | undefined;
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
export declare function loadUpstreamEngine(family: string, { authPath, fetchFn, now, entry }?: any): Promise<LoadedEngine>;
/**
 * The plugin surface a family adapter may drive: the sign-in method, the
 * wire loader and the usage read. Runs against the adapter's own plugin
 * instance (it injected readSession/fetchImpl), so `_internal` drift fails
 * here — before any hop trusts the engine.
 */
export declare function assertEnginePlugin(family: string, plugin: any): void;
/** Test seam: drop the configured dir, cached modules and the failure latch. */
export declare function resetUpstreamEngineCache(): void;
/** The version string a loaded engine's own package.json carries (状态行用). */
export declare function enginePackageVersion(dir: string): Promise<any>;
