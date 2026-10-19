/**
 * OpenCode Go live catalog.
 *
 * The curated rows in `catalog/models.json` are the offline floor and the only
 * place protocol, effort ladders and `compat` dialects are recorded. The
 * account's own `GET https://opencode.ai/zen/go/v1/models` names what the
 * subscription can serve *now*, so this module refreshes that membership and
 * appends ids the floor does not have yet — the same shape Command Code uses.
 *
 * A live-added id carries only what the vendor list says (`id`, `name`,
 * `context_length`) plus, when models.dev has a row, its window and protocol
 * (`provider.npm`: `@ai-sdk/openai` → /responses, `@ai-sdk/anthropic` →
 * /messages, everything else → /chat/completions). Nothing is invented: an id
 * with no window from either source stays out, and a failed/empty read leaves
 * the floor in place.
 */
import { catalogRows } from '../../catalog/index.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
import { outboundFetch } from '../../utils/outbound.js';
import {
    OPENCODE_GO_EXTRA_ROUTE_ID,
    OPENCODE_GO_MESSAGES_ROUTE_ID,
    OPENCODE_GO_RESPONSES_ROUTE_ID,
} from './route-ids.js';
export const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/zen/go/v1/models';
export const OPENCODE_GO_MODELS_DEV_URL = 'https://models.dev/api.json';
export const OPENCODE_GO_CATALOG_TTL_MS = 10 * 60_000;
/** The three protocols, in the order the picker groups them. */
const ROUTE_ORDER = Object.freeze([
    OPENCODE_GO_EXTRA_ROUTE_ID,
    OPENCODE_GO_RESPONSES_ROUTE_ID,
    OPENCODE_GO_MESSAGES_ROUTE_ID,
]);
function floorEntries() {
    return [
        ...catalogRows('opencode-go-flash').map((row) => ({ route: OPENCODE_GO_EXTRA_ROUTE_ID, row })),
        ...catalogRows('opencode-go-responses').map((row) => ({ route: OPENCODE_GO_RESPONSES_ROUTE_ID, row })),
        ...catalogRows('opencode-go-messages').map((row) => ({ route: OPENCODE_GO_MESSAGES_ROUTE_ID, row })),
    ];
}
const live = createLiveCatalog({ fallback: floorEntries });
export function resetOpencodeGoCatalogCache() {
    live.reset();
}
/** Curated rows, or the refreshed list once a read landed. */
export function opencodeGoCatalogRows() {
    const stored = live.stored();
    return (stored?.length ? stored : floorEntries()).map((entry) => ({ route: entry.route, row: { ...entry.row } }));
}
/** Rows for one wire-protocol route. */
export function opencodeGoRouteModels(routeId) {
    return opencodeGoCatalogRows().filter((entry) => entry.route === routeId).map((entry) => entry.row);
}
function positive(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
/** The protocol a models.dev row speaks, from its SDK provider. */
function routeOfModelsDev(row) {
    const npm = row?.provider?.npm;
    if (npm === '@ai-sdk/openai')
        return OPENCODE_GO_RESPONSES_ROUTE_ID;
    if (npm === '@ai-sdk/anthropic')
        return OPENCODE_GO_MESSAGES_ROUTE_ID;
    return OPENCODE_GO_EXTRA_ROUTE_ID;
}
/**
 * The refreshed catalog: every curated row (its protocol and dialects stay
 * curated), then each live-only id appended under the protocol its models.dev
 * row names — or /chat/completions when models.dev has nothing for it.
 */
export function mergeOpencodeGoModels(listed, modelsDev = {}) {
    const entries = floorEntries();
    const known = new Set(entries.map((entry) => entry.row.id));
    for (const item of listed ?? []) {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        if (!id || known.has(id))
            continue;
        const meta = modelsDev?.[id];
        const contextWindow = positive(meta?.limit?.context) ?? positive(item?.context_length);
        if (contextWindow === undefined)
            continue;
        const name = (typeof item?.name === 'string' && item.name.trim())
            || (typeof meta?.name === 'string' && meta.name.trim())
            || id;
        const input = Array.isArray(meta?.modalities?.input)
            ? ['text', 'image'].filter((kind) => meta.modalities.input.includes(kind))
            : undefined;
        known.add(id);
        entries.push({
            route: routeOfModelsDev(meta),
            row: {
                id,
                name,
                contextWindow,
                ...(input?.includes('text') ? { input } : {}),
            },
        });
    }
    const rank = (entry) => ROUTE_ORDER.indexOf(entry.route);
    return entries.sort((a, b) => rank(a) - rank(b) || 0);
}
async function readModelsDev(fetchFn, signal) {
    try {
        const response = await fetchFn(OPENCODE_GO_MODELS_DEV_URL, { headers: { accept: 'application/json' }, signal });
        if (!response?.ok)
            return {};
        const payload = await response.json();
        const bucket = payload?.['opencode-go']?.models;
        return bucket && typeof bucket === 'object' ? bucket : {};
    }
    catch {
        return {};
    }
}
/**
 * Refresh the Go picker from the account's keyed list. An empty credential or a
 * failed read returns the floor and keeps the previous published rows.
 */
export async function refreshOpencodeGoCatalog(session, options = {}) {
    const key = typeof session?.accessToken === 'string' ? session.accessToken.trim() : '';
    return live.refresh({
        credential: key,
        ttlMs: options.ttlMs ?? OPENCODE_GO_CATALOG_TTL_MS,
        now: options.now,
        fetch: async () => {
            const fetchFn = options.fetchFn ?? outboundFetch;
            const response = await fetchFn(OPENCODE_GO_MODELS_URL, {
                headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
                signal: options.signal,
            });
            if (!response?.ok)
                return null;
            const payload = await response.json();
            const listed = Array.isArray(payload?.data) ? payload.data : [];
            if (listed.length === 0)
                return null;
            return mergeOpencodeGoModels(listed, await readModelsDev(fetchFn, options.signal));
        },
    });
}
