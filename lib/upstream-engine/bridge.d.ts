/**
 * URL-scoped global-fetch bridge: the engine packages other than kimi-work
 * take no `fetchImpl` — their logins, refreshes, config reads and wire calls
 * all speak the bare global `fetch`. Swapping `globalThis.fetch` for a
 * router gives those packages the injection point they lack: requests to a
 * registered engine host ride the outbound lane (proxy-card compliance,
 * `outbound.ts` 全仓唯一出口), everything else passes through to the
 * original global fetch untouched — DSH, other plugins and this repo's own
 * local-host tests never notice the bridge exists.
 *
 * Hosts are a closed set: each family adapter registers the exact endpoint
 * hostnames its audited package talks to (rules.md 闭集). The bridge never
 * routes by prefix or wildcard — a host is either declared or it goes
 * direct-through. `configureEngineBridge` is the test seam: hermetic suites
 * point the engine lane at their fake without touching anyone else's fetch.
 */
/** Point the engine lane at a fake (tests); production rides outboundFetch. */
export declare function configureEngineBridge({ fetchFn }?: any): void;
/** Declare the endpoint hosts an engine family's package speaks to. */
export declare function registerEngineHosts(family: string, hosts: readonly string[]): void;
/** Which family owns a host, for diagnostics and tests. */
export declare function engineHostOwner(host: string): string | undefined;
/** Test seam: restore the original global fetch and forget every host. */
export declare function resetEngineBridge(): void;
