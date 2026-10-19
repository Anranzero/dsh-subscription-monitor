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
import { outboundFetch } from '../utils/outbound.js';
let originalFetch;
let routed = outboundFetch;
/** Exact hostnames → the family that declared them (diagnostics, closed set). */
const engineHosts = new Map();
function hostOf(input) {
    try {
        const url = typeof input === 'string' ? input
            : input instanceof URL ? input.href
                : typeof input?.url === 'string' ? input.url
                    : String(input);
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        return '';
    }
}
/** Point the engine lane at a fake (tests); production rides outboundFetch. */
export function configureEngineBridge({ fetchFn } = {}) {
    routed = typeof fetchFn === 'function' ? fetchFn : outboundFetch;
}
/** Install the router once; re-registration only grows the host set. */
function installEngineBridge() {
    if (originalFetch)
        return;
    originalFetch = globalThis.fetch;
    globalThis.fetch = async function engineBridgeFetch(input, init) {
        const host = hostOf(input);
        if (host && engineHosts.has(host))
            return routed(input, init);
        return originalFetch(input, init);
    };
}
/** Declare the endpoint hosts an engine family's package speaks to. */
export function registerEngineHosts(family, hosts) {
    installEngineBridge();
    for (const host of hosts) {
        const name = String(host).toLowerCase();
        if (name)
            engineHosts.set(name, family);
    }
}
/** Which family owns a host, for diagnostics and tests. */
export function engineHostOwner(host) {
    return engineHosts.get(String(host).toLowerCase());
}
/** Test seam: restore the original global fetch and forget every host. */
export function resetEngineBridge() {
    if (originalFetch)
        globalThis.fetch = originalFetch;
    originalFetch = undefined;
    routed = outboundFetch;
    engineHosts.clear();
}
