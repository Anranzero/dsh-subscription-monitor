/**
 * WorkBuddy's live model catalog. GET {endpoint}/v3/config after login — the
 * product config behind both builds' pickers.
 *
 * The read needs the CLI agent's User-Agent (`CLI/2.0.0 WorkBuddy/5.5.6`):
 * the bare WorkBuddy UA returns the IDE's config, whose agents list carries
 * no `cli` entry and the parse below yields nothing (magpie 0.1.24
 * liveModels). Rows come from the `cli` agent's model ids plus the
 * `data.models[]` detail of each; the static tables in src/catalog/models.json
 * (`workbuddy` / `workbuddy-ai`) are the offline floor.
 */
import { WORKBUDDY_CLI_USER_AGENT, WORKBUDDY_SITES, WORKBUDDY_UA_VERSION, readWorkbuddyDesktop, workbuddyConfigUrl, workbuddyDomainOf, workbuddyEnterpriseHeaders, } from './index.js';
import { WORKBUDDY_PLACEHOLDER } from './engine.js';
import { outboundFetch } from '../../utils/outbound.js';
import { createLiveCatalog } from '../../catalog/live-refresh.js';
import { catalogRows } from '../../catalog/index.js';
export const WORKBUDDY_CATALOG_TTL_MS = 5 * 60_000;
/**
 * WorkBuddy AI's GLM models take no images whatever the config says: on
 * 2026-10-13 the live config marked every model supportsImages, and a chat to
 * glm-5.3-flash / glm-5.3 / glm-5.2 answered that the model does not support
 * images — the server had taken the image out (magpie noImages, workbuddy
 * README 模型). The China build's GLM reads them.
 */
export const WORKBUDDY_AI_TEXT_ONLY = /^glm-/;
const DSH_EFFORT_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
function liveOf(site) {
    // One live instance per build: the two endpoints answer different plans.
    const live = createLiveCatalog({ fallback: () => catalogRows(site.id) });
    return live;
}
const liveCatalogs = {
    workbuddy: liveOf(WORKBUDDY_SITES.workbuddy),
    'workbuddy-ai': liveOf(WORKBUDDY_SITES['workbuddy-ai']),
};
export function resetWorkbuddyCatalogCache() {
    liveCatalogs.workbuddy.reset();
    liveCatalogs['workbuddy-ai'].reset();
}
export function workbuddyCatalogModels() {
    return liveCatalogs.workbuddy.models();
}
export function workbuddyAiCatalogModels() {
    return liveCatalogs['workbuddy-ai'].models();
}
function asPositiveInt(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n) || n <= 0)
        return undefined;
    return Math.trunc(n);
}
/** The shape WorkBuddy's config describes a model's SKU by, when it names one. */
const DETAIL_OF_MODEL_KEYS = ['credits', 'modelPromotions'];
/**
 * A model detail's credits multiple as magpie's creditsOf reads it — "x0.03",
 * "0.03", "X1.00" or a number; "x0.00" is free. Anything else (a word, a
 * negative, an infinity) is undefined: an unreadable multiple says neither
 * free nor rated, and the row carries no credits at all. magpie creditsOf,
 * and its freeCredits is exactly `creditsOf(c) === 0`.
 */
export function creditsOf(value) {
    if (value === null || value === undefined || value === '')
        return undefined;
    const text = String(value).trim().toLowerCase().replace(/^x/, '');
    const n = Number(text);
    return text !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
}
/**
 * A model id's own details: `data.models[]` answers it by id. A config that
 * keys its models by id (`models[id]`) is read too — the one shape magpie
 * never met, where a nested SKU object carries the credits and promotions —
 * so a free model is still labelled if WorkBuddy moves the details there.
 */
function detailsFor(models, id) {
    const list = Array.isArray(models) ? models : [];
    const hit = list.find((x) => x?.id === id);
    if (hit)
        return hit;
    const keyed = models && typeof models === 'object' && !Array.isArray(models) ? models[id] : undefined;
    if (!keyed || typeof keyed !== 'object')
        return undefined;
    if (DETAIL_OF_MODEL_KEYS.some((key) => keyed[key] !== undefined))
        return { id, ...keyed };
    // One level down (a SKU list under the id): the entry with the credits wins.
    return Object.values(keyed).find((x) => x && typeof x === 'object' && x.credits !== undefined);
}
/** The whole config's promotions, whichever level carries them. */
function promotionsOf(cfg) {
    if (Array.isArray(cfg?.modelPromotions))
        return cfg.modelPromotions;
    const models = cfg?.models && typeof cfg.models === 'object' && !Array.isArray(cfg.models) ? cfg.models : undefined;
    const nested = models && typeof models.modelPromotions !== 'undefined' ? models.modelPromotions : undefined;
    return Array.isArray(nested) ? nested : [];
}
/** A promotion's price: its discountedCredits ("0.50x", "0.00x"), else factor × the model's credits (magpie discountOf). */
function discountOf(promotion, base) {
    const said = creditsOf(String(promotion?.discount?.discountedCredits ?? '').trim().replace(/x$/i, ''));
    if (said !== undefined)
        return said;
    const factor = Number(promotion?.discount?.factor);
    return Number.isFinite(factor) && factor >= 0 && base !== undefined ? base * factor : undefined;
}
/** A promotion is on now: enabled, and inside its validFrom..validUntil (magpie running). */
function running(promotion, now) {
    if (!promotion || promotion.enabled === false)
        return false;
    const from = Date.parse(promotion.schedule?.validFrom ?? '');
    const until = Date.parse(promotion.schedule?.validUntil ?? '');
    return !(from > now) && !(until <= now);
}
/**
 * A model's credits now, as magpie keeps them (priceOf, magpie #121): the
 * detail's `credits` multiple, lowered by the config's `modelPromotions` for
 * whole days (Step-5-Preview's 独家限免). A promotion that holds only some
 * hours of the day (Hy4 preview free 23:00–8:00) is NOT counted: the list is
 * cached for minutes, so a list asked for at night would read "free" all day.
 * Undefined when the detail gives no readable multiple.
 */
export function workbuddyCreditsOf(details, promotions, now = Date.now()) {
    const base = creditsOf(details?.credits);
    if (base === undefined)
        return undefined;
    const mine = (Array.isArray(promotions) ? promotions : []).filter((p) => p?.kind === 'discount' && Array.isArray(p.modelIds) && p.modelIds.includes(details.id) && running(p, now));
    if (mine.some((p) => Array.isArray(p.schedule?.daily) && p.schedule.daily.length))
        return base;
    const off = mine.filter((p) => p.discount).map((p) => discountOf(p, base)).filter((rate) => rate !== undefined);
    return off.length > 0 ? Math.min(...off) : base;
}
/**
 * A model detail's reasoning ladder → DSH-keyed efforts. Keys are the DSH
 * closed set; the values keep WorkBuddy's own spellings (`none` is the value
 * of `off`, never a key). `off` needs the model's thinking to be
 * disengageable — `reasoning.canDisableThinking` unset-or-true and not
 * `onlyReasoning` — exactly magpie's gate. A vendor spelling outside the
 * closed set drops; an empty ladder is undefined (no efforts field).
 */
export function toWorkbuddyEfforts(details) {
    const reasoning = details?.reasoning;
    const offered = Array.isArray(reasoning?.supportedEfforts) ? reasoning.supportedEfforts : [];
    const efforts = {};
    for (const value of offered) {
        if (typeof value !== 'string' || !value)
            continue;
        const level = value === 'none' ? 'off' : value;
        if (!DSH_EFFORT_KEYS.includes(level))
            continue;
        efforts[level] = value;
    }
    // A model with one fixed effort and no ladder ("reasoning": {"effort":
    // "medium"}) takes that effort and nothing else. Live, 2026-10-17: the
    // ladder-less kimi-k2.6 / fast-model answer 0 reasoning tokens when
    // reasoning_effort is left out, and glm-5.1 refuses the request outright
    // (400 code 11150, "the reasoning effort value is not supported by the
    // current model"). So the row must advertise that one rung: without it DSH
    // has no level to send, and the model either stops thinking or errors.
    if (offered.length === 0) {
        const fixed = typeof reasoning?.effort === 'string' ? reasoning.effort.trim() : '';
        const level = fixed === 'none' ? 'off' : fixed;
        if (DSH_EFFORT_KEYS.includes(level)) {
            efforts[level] = fixed;
            const one = Object.fromEntries(DSH_EFFORT_KEYS.filter((key) => key in efforts).map((key) => [key, efforts[key]]));
            // A fixed 'none' is a non-reasoning model: no level beyond off is left,
            // which the catalog loader refuses as an efforts table.
            return Object.keys(one).some((key) => key !== 'off') ? one : undefined;
        }
        return undefined;
    }
    // The gate, not the list, carries 'none' (magpie prepends it): off exists
    // only when the model can drop its thinking entirely.
    const canOff = !details?.onlyReasoning && (reasoning?.canDisableThinking == null || reasoning.canDisableThinking !== false);
    if (canOff)
        efforts.off = 'none';
    else
        delete efforts.off;
    const ordered = Object.fromEntries(DSH_EFFORT_KEYS.filter((level) => level in efforts).map((level) => [level, efforts[level]]));
    return Object.keys(ordered).length > 0 ? ordered : undefined;
}
/**
 * /v3/config's JSON (the whole {code, msg, data} envelope or the data object
 * itself) → catalog rows: the `cli` agent's model ids, each with its
 * `data.models[]` detail — name (else the id), maxInputTokens →
 * contextWindow, maxOutputTokens → maxTokens (only when > 0), images via
 * supportsImages minus the AI build's text-only GLM rule, and the reasoning
 * ladder above. Same-name models take the magpie suffix (the `-sg` twin of
 * deepseek-v4.1-flash reads "Deepseek-V4.1-Flash (SG)"). Sorted by id.
 */
export function toWorkbuddyCatalogRows(site, payload) {
    const cfg = payload && typeof payload === 'object'
        && (Array.isArray(payload.agents) || Array.isArray(payload.models) || (payload.models && typeof payload.models === 'object'))
        ? payload
        : (payload?.data ?? {});
    const promotions = promotionsOf(cfg);
    const now = Date.now();
    const rows = [];
    const seen = new Set();
    for (const agent of Array.isArray(cfg.agents) ? cfg.agents : []) {
        if (agent?.name !== 'cli')
            continue;
        for (const rawId of Array.isArray(agent.models) ? agent.models : []) {
            const id = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : '';
            if (!id || seen.has(id))
                continue;
            seen.add(id);
            const d = detailsFor(cfg.models, id);
            const staticRow = catalogRows(site.id).find((row) => row.id === id);
            // maxInputTokens is the model's input window; without it (or a static
            // row to fall back on) the row has no sourced window at all — skip it
            // rather than invent one.
            const contextWindow = asPositiveInt(d?.maxInputTokens) ?? staticRow?.contextWindow;
            if (contextWindow === undefined)
                continue;
            const row = {
                id,
                name: typeof d?.name === 'string' && d.name.trim() ? d.name.trim() : id,
                contextWindow,
                input: d?.supportsImages === true && !(site.ai && WORKBUDDY_AI_TEXT_ONLY.test(id))
                    ? ['text', 'image']
                    : ['text'],
            };
            const maxTokens = asPositiveInt(d?.maxOutputTokens);
            if (maxTokens !== undefined)
                row.maxTokens = maxTokens;
            const reasoningEfforts = toWorkbuddyEfforts(d);
            if (reasoningEfforts)
                row.reasoningEfforts = reasoningEfforts;
            // The credits multiple at build time: the row's free tag reads it
            // (free now = 0). Undefined when the config gave none — never guessed.
            const credits = workbuddyCreditsOf(d, promotions, now);
            if (credits !== undefined)
                row.credits = credits;
            rows.push(row);
        }
    }
    // Tell apart models the config names alike, as magpie does: the later twin
    // keeps its id's suffix in the name (deepseek-v4.1-flash-sg → "… (SG)").
    const firstOfName = new Map();
    for (const row of rows) {
        const firstId = firstOfName.get(row.name);
        if (firstId === undefined) {
            firstOfName.set(row.name, row.id);
            continue;
        }
        const rest = row.id.startsWith(firstId + '-') ? row.id.slice(firstId.length + 1) : '';
        row.name = `${row.name} (${rest ? rest.toUpperCase() : row.id})`;
    }
    rows.sort((left, right) => left.id.localeCompare(right.id));
    return rows;
}
/**
 * Refresh one build's catalog behind its own live instance, as magpie's
 * liveModels asks: the account's chat header group with the User-Agent
 * swapped to the CLI agent's. A non-2xx answer, a non-zero code, or zero
 * rows falls back to the last good list (or the static floor). A desktop
 * reference row holds no tokens — the live file read answers for it, the
 * same file the engine itself re-reads per hop.
 */
export async function refreshWorkbuddyCatalog(site, session, options = {}) {
    const desktop = session?.source === 'desktop' ? readWorkbuddyDesktop(site) : undefined;
    const credential = desktop?.session ?? session;
    // A stored desktop reference holds the placeholder, not a credential — with
    // the desktop file gone (desktop null) there is nothing to sign /v3/config
    // with: the placeholder reads as empty and the static floor answers, the
    // same skip an unreadable (sealed) file takes via its empty session.
    const token = typeof credential?.accessToken === 'string' && credential.accessToken !== WORKBUDDY_PLACEHOLDER
        ? credential.accessToken.trim()
        : '';
    return liveCatalogs[site.id].refresh({
        credential: token,
        ttlMs: options.ttlMs ?? WORKBUDDY_CATALOG_TTL_MS,
        now: options.now,
        fetch: async () => {
            const fetchFn = options.fetchFn ?? outboundFetch;
            const response = await fetchFn(workbuddyConfigUrl(site), {
                headers: {
                    authorization: `Bearer ${token}`,
                    'X-User-Id': typeof credential?.uid === 'string' ? credential.uid : '',
                    'X-Domain': workbuddyDomainOf(site, credential),
                    'X-Product': 'SaaS',
                    'X-IDE-Type': 'WorkBuddy',
                    'X-IDE-Name': 'WorkBuddy',
                    'X-IDE-Version': WORKBUDDY_UA_VERSION,
                    'X-Agent-Purpose': 'conversation',
                    'X-Agent-Intent': 'craft',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...(site.ai ? { 'X-Agent-Type': 'main' } : {}),
                    ...workbuddyEnterpriseHeaders(credential),
                    'User-Agent': WORKBUDDY_CLI_USER_AGENT,
                    Accept: 'application/json',
                },
                signal: options.signal,
            });
            if (!response?.ok)
                return null;
            const parsed = await response.json().catch(() => null);
            if (Number(parsed?.code))
                return null;
            const rows = toWorkbuddyCatalogRows(site, parsed);
            return rows.length > 0 ? rows : null;
        },
    });
}
