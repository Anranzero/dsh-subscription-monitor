/**
 * Command Code IS the upstream engine (maintainer sign-off 2026-10-18:
 * 全过, 不回退、不旧兼容). The pinned @magpie-community/opencode-commandcode-auth
 * drives the Studio browser sign-in (POST+CORS loopback on a random port),
 * the plan-aware hop (Provider API passthrough for paid plans, /alpha/generate
 * with the CLI's JSONL protocol for Go keys, GO_NO_API self-detection) and
 * the allowance read (billing/subscriptions + billing/credits). The TS paths
 * it replaced (transport.ts's JSONL hop, request.ts's wire mapping, quota.ts's
 * four reads) are deleted.
 *
 * Division that survives the engine:
 * - the vault: key session shape, paste/env/CLI-file imports (copy-only —
 *   metadata.cli is never set, so the engine's liveKey never re-reads
 *   ~/.commandcode/auth.json), the whoami identity write-back;
 * - the closed-set catalog (catalog.ts — the engine's plan-trimmed
 *   provider.models list is NOT adopted, checklist item 4's exemption);
 * - the strip-only cache (cache.ts — the engine's Go body has no threadId);
 * - the refusal classification (failure.ts commandCodeFailure — proxy
 *   semantics; reads both the raw Provider body and the engine's
 *   normalized {error:{message}} answers).
 *
 * The package's egress (api.commandcode.ai) speaks the bare global fetch —
 * the host rides the URL-scoped bridge. client.auth.set persists the plan
 * the usage read saw — our write-back client updates the vault row by key.
 */
import { assertEnginePlugin, loadUpstreamEngine, upstreamEngineConfiguredFor } from '../../upstream-engine/engine.js';
import { registerEngineHosts } from '../../upstream-engine/bridge.js';
import { listStoredSessions, updateAccountSession } from '../../oauth/store.js';
import { outboundFetch } from '../../utils/outbound.js';
import { COMMAND_CODE_PLAN_CREDITS, commandCodeDefaultAccount, commandCodePlanInfo } from './index.js';
const COMMAND_CODE_ENGINE_HOSTS = ['api.commandcode.ai'];
/**
 * The engine's auth shape for one of our stored sessions. The key is the
 * whole credential (type 'api'); metadata.plan is the DISPLAY name the
 * engine matches ('Go', 'Pro'…) and planId the vault's id form.
 */
export function engineAuthOf(session) {
    const planId = typeof session?.planType === 'string' ? session.planType.trim() : '';
    const plan = planId ? commandCodePlanInfo(planId)?.name ?? planId : '';
    return {
        type: 'api',
        key: typeof session?.accessToken === 'string' ? session.accessToken : '',
        ...(plan ? { metadata: { plan, planId } } : {}),
    };
}
/**
 * The vault planId an engine display name ('Go' → 'individual-go') stands
 * for. Two plans share a name ('Pro' is both individual-pro and
 * individual-pro-v1) — when the name alone can't tell them apart, preferId
 * (the id the engine's write-back resolved, or the one the session already
 * holds) breaks the tie; without a usable preference the insertion order
 * stands. Unknown names and the engine's 'No plan' placeholder map to
 * nothing — the vault keeps whichever planId it already had.
 */
function planIdOfName(name, preferId) {
    const text = typeof name === 'string' ? name.trim() : '';
    if (!text || text === 'No plan')
        return undefined;
    const wanted = text.toLowerCase();
    const wanted$ = typeof preferId === 'string' ? preferId.trim() : '';
    const matches = Object.keys(COMMAND_CODE_PLAN_CREDITS)
        .filter((id) => String(commandCodePlanInfo(id)?.name ?? '').toLowerCase() === wanted);
    if (matches.length > 1 && wanted$ && matches.includes(wanted$))
        return wanted$;
    if (matches.length > 0)
        return matches[0];
    const info = commandCodePlanInfo(text);
    return info && COMMAND_CODE_PLAN_CREDITS[info.id] !== undefined ? info.id : undefined;
}
/** A successful sign-in result merged onto a vault session. */
export function sessionFromEngineResult(result, base = {}) {
    const metadata = result?.metadata && typeof result.metadata === 'object' ? result.metadata : {};
    const key = typeof result?.key === 'string' ? result.key : base.accessToken;
    const session = {
        ...base,
        accessToken: key,
        refreshToken: key,
        expiresAt: Number.MAX_SAFE_INTEGER,
        account: typeof metadata.email === 'string' && metadata.email.trim()
            ? metadata.email.trim()
            : typeof base.account === 'string' && base.account ? base.account : commandCodeDefaultAccount(key),
        source: 'browser',
    };
    if (typeof metadata.userId === 'string' && metadata.userId.trim())
        session.userId = metadata.userId.trim();
    if (typeof metadata.keyName === 'string' && metadata.keyName.trim())
        session.userName = metadata.keyName.trim();
    const planId = planIdOfName(metadata.plan, base?.planType);
    if (planId)
        session.planType = planId;
    return session;
}
/**
 * planIds the engine's auth.set write-back resolved, by key. usage()'s answer
 * carries only the display name ('Pro'), while its write-back carries the
 * subscription's real planId — the quota read prefers what landed here.
 */
const engineWrittenPlanIds = new Map();
let pendingPlugin;
/** The engine plugin, built once per data dir. */
function commandCodeEnginePlugin({ fetchFn = outboundFetch } = {}) {
    const authPath = upstreamEngineConfiguredFor();
    if (!authPath)
        return Promise.reject(new Error('command-code engine needs the plugin data dir'));
    registerEngineHosts('command-code', COMMAND_CODE_ENGINE_HOSTS, {
        // The host's native clients must not be captured by the engine bridge.
        directPaths: ['/provider/v1/chat/completions', '/provider/v1/messages', '/provider/v1/responses'],
    });
    if (!pendingPlugin) {
        pendingPlugin = (async () => {
            const engine = await loadUpstreamEngine('command-code', { authPath, fetchFn, entry: (module) => module?.CommandCodePlugin });
            const plugin = await engine.module.CommandCodePlugin({ client: engineClientFor() });
            assertEnginePlugin('command-code', plugin);
            return { plugin, version: engine.version };
        })();
        pendingPlugin.catch(() => { pendingPlugin = undefined; });
    }
    return pendingPlugin;
}
/** Test seam: drop the cached plugin (production never resets). */
export function resetCommandCodeEnginePlugin() {
    pendingPlugin = undefined;
}
function engineClientFor() {
    return {
        auth: {
            set: async ({ body } = {}) => {
                const authPath = upstreamEngineConfiguredFor();
                if (!authPath || !body || typeof body !== 'object')
                    return;
                const key = typeof body.key === 'string' ? body.key : '';
                const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
                if (!key && !metadata.planId && !metadata.plan)
                    return;
                const planId = typeof metadata.planId === 'string' && metadata.planId.trim()
                    ? metadata.planId.trim()
                    : planIdOfName(metadata.plan);
                // recorded even when no vault row matches: the engine resolved the
                // real id, and the quota read for this key prefers it
                if (key && planId)
                    engineWrittenPlanIds.set(key, planId);
                if (!planId)
                    return;
                try {
                    const rows = await listStoredSessions('command-code', authPath);
                    const hit = key ? rows.find((row) => row.session?.accessToken === key) : rows.find((row) => row.active);
                    if (!hit || hit.session.planType === planId)
                        return;
                    await updateAccountSession('command-code', hit, { ...hit.session, planType: planId }, authPath);
                }
                catch { /* a failed write-back leaves the engine's in-memory plan serving */ }
            },
        },
    };
}
/**
 * The Studio browser sign-in: the engine starts its own loopback server
 * (POST+CORS, random port) and Studio posts the key straight to it —
 * settle IS the finished session material (whoami ran inside the engine).
 */
export async function commandCodeEngineAuthorize({ fetchFn = outboundFetch } = {}) {
    const { plugin } = await commandCodeEnginePlugin({ fetchFn });
    const method = plugin.auth.methods.find((m) => m?.type === 'oauth' && /browser/i.test(String(m?.label ?? '')))
        ?? plugin.auth.methods[0];
    const started = await method.authorize();
    if (!started?.url)
        throw new Error('Command Code gave no sign-in page');
    const callback = started.callback;
    const settle = async () => {
        const result = await callback();
        if (result?.type !== 'success' || !result?.key) {
            throw new Error(result?.error ?? 'the Command Code sign-in failed');
        }
        return sessionFromEngineResult(result);
    };
    return { authorizeUrl: started.url, mode: 'browser', settle };
}
/**
 * The hop's fetchFn: forward()'s `fetchFn(url, init)` shape feeds the engine
 * loader — it signs both header ways, routes Go keys to /alpha/generate (CLI
 * JSONL translation inside) and passes everything else through the Provider
 * API as it came.
 */
export async function commandCodeEngineFetch({ session, fetchFn = outboundFetch } = {}) {
    const { plugin } = await commandCodeEnginePlugin({ fetchFn });
    const loader = await plugin.auth.loader(() => Promise.resolve(engineAuthOf(session)));
    if (typeof loader?.fetch !== 'function')
        throw new Error('the command-code engine loader returned no fetch function');
    return async (url, init = {}) => loader.fetch(url, init);
}
/**
 * fetchQuota: the engine's allowance read (billing/subscriptions +
 * billing/credits) with its windows already computed — {name, used (0-100),
 * span?, display?, resetsAt?} plus plan/until/renew, or a bare balance when
 * the key has no plan. The plan the read saw is written back by the engine
 * itself (our client persists planId onto the vault row).
 */
export async function fetchCommandCodeQuotaEngine(session, fetchFn = outboundFetch) {
    const { plugin } = await commandCodeEnginePlugin({ fetchFn });
    const key = typeof session?.accessToken === 'string' ? session.accessToken : '';
    engineWrittenPlanIds.delete(key);
    const usage = await plugin.auth.usage(() => Promise.resolve(engineAuthOf(session)));
    if (usage?.error)
        throw new Error(String(usage.error));
    const rows = [];
    for (const w of Array.isArray(usage?.windows) ? usage.windows : []) {
        if (!w || typeof w !== 'object')
            continue;
        const usedPercent = typeof w.used === 'number' && Number.isFinite(w.used) ? Math.max(0, Math.min(100, w.used)) : undefined;
        if (usedPercent === undefined)
            continue;
        const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim() : '';
        const resetAt = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN;
        const at = Number.isFinite(resetAt) && resetAt > 0 ? { resetAt } : {};
        if (/^5 hours$/i.test(name)) {
            rows.push({ key: 'primary', kind: 'primary', label: '5-hour', usedPercent, remainingPercent: Math.round((100 - usedPercent) * 10) / 10, ...at });
            continue;
        }
        if (/^weekly$/i.test(name)) {
            rows.push({ key: 'weekly', kind: 'weekly', label: 'Weekly', usedPercent, remainingPercent: Math.round((100 - usedPercent) * 10) / 10, ...at });
            continue;
        }
        if (/^credits$/i.test(name) && typeof w.display === 'string') {
            // money(pool-left) + ' / ' + money(pool) — the engine already did the
            // pool math; the dollars are parsed back out of its display string.
            const dollars = w.display.split('/').map((part) => Number(String(part).trim().replace(/^\$/, '').replace('-', '')));
            const [used, total] = [dollars[0], dollars[1]];
            const row = {
                key: 'credits',
                kind: 'credits',
                label: 'Credits',
                unit: 'usd',
                usedPercent,
                remainingPercent: Math.round((100 - usedPercent) * 10) / 10,
            };
            if (Number.isFinite(used))
                row.used = Math.round(used * 100) / 100;
            if (Number.isFinite(total))
                row.total = Math.round(total * 100) / 100;
            rows.push({ ...row, ...at });
            continue;
        }
        // A window the mapping doesn't know still shows, unnamed kind and all.
        rows.push({ key: 'window', kind: 'primary', product: name || 'Command Code', usedPercent, remainingPercent: Math.round((100 - usedPercent) * 10) / 10, ...at });
    }
    const balance = typeof usage?.balance === 'string' && /^\$/.test(usage.balance.trim())
        ? Number(usage.balance.trim().replace(/^\$/, ''))
        : NaN;
    if (!rows.some((row) => row.key === 'credits') && Number.isFinite(balance)) {
        rows.push({ key: 'credits', kind: 'credits', label: 'Credits', unit: 'usd', remaining: Math.round(balance * 100) / 100 });
    }
    const until = typeof usage?.until === 'string' ? Date.parse(usage.until) : NaN;
    if (Number.isFinite(until) && until > 0) {
        const credits = rows.find((row) => row.key === 'credits');
        if (credits)
            credits.resetAt ??= until;
    }
    return {
        // The display name alone can't tell individual-pro from
        // individual-pro-v1: the write-back's planId (set during the usage call
        // above) wins; no write-back means the read confirmed the session's own
        // id, which then stands over the insertion order.
        planType: planIdOfName(usage?.plan, engineWrittenPlanIds.get(key) ?? session?.planType),
        rows,
    };
}
