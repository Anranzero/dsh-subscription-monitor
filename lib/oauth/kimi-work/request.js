/**
 * Kimi Work Completions hop.
 *
 * The wire takes the plain OpenAI `reasoning_effort` field with the
 * gateway's own advertised value (the upstream package's model variants each
 * carry `reasoningEffort: <effort>`, the lowercased `REASONING_EFFORT_*`
 * spelling) — NOT the `thinking` object the Kimi Code hop uses. Map the DSH
 * key onto the row's advertised value; a level the row does not map goes out
 * as the nearest advertised rung (never a rung the model does not serve), and
 * a model that does not reason loses the field.
 */
import { kimiWorkCatalogModels } from './catalog.js';
import { KIMI_WORK_MODELS } from './index.js';
function modelOf(id) {
    const name = typeof id === 'string' ? id : '';
    return kimiWorkCatalogModels().find((model) => model.id === name)
        ?? KIMI_WORK_MODELS.find((model) => model.id === name);
}
function advertisedEfforts(model) {
    const raw = model?.reasoningEfforts;
    if (!raw || typeof raw !== 'object')
        return undefined;
    return raw;
}
function wireEffort(value, efforts) {
    if (value === undefined)
        return undefined;
    if (efforts[value] !== undefined)
        return efforts[value];
    const hit = Object.values(efforts).find((wire) => wire === value);
    return typeof hit === 'string' ? hit : undefined;
}
/** DSH's ladder, low to high (the closed set src/catalog/index.ts validates). */
const EFFORT_LADDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/**
 * The rung a model actually serves when DSH asks for one its row does not
 * map: the next rung up first, then the nearest one down. An asked-for `off`
 * starts at the ladder bottom and takes the first advertised rung — the
 * least thinking that model can do, since its row offers no `off` (the
 * gateway never gets an unadvertised value).
 */
function nearestEffort(key, efforts) {
    const asked = EFFORT_LADDER.indexOf(key);
    const from = asked === -1 ? 0 : asked;
    const up = EFFORT_LADDER.slice(from).find((level) => efforts[level] !== undefined);
    if (up !== undefined)
        return up;
    return EFFORT_LADDER.slice(0, Math.max(from, 1)).reverse().find((level) => efforts[level] !== undefined);
}
export function applyKimiWorkThinking(payload = {}, model) {
    const next = { ...payload };
    const asked = next.reasoning_effort;
    delete next.reasoning_effort;
    const efforts = advertisedEfforts(model ?? modelOf(next.model));
    if (!efforts)
        return next;
    const wire = asked === undefined ? undefined : wireEffort(asked, efforts);
    if (wire !== undefined) {
        next.reasoning_effort = wire;
        return next;
    }
    if (asked === undefined)
        return next;
    const fallback = nearestEffort(asked, efforts);
    if (fallback !== undefined)
        next.reasoning_effort = efforts[fallback];
    return next;
}
/** Map vendor cache-read aliases. Absent field stays absent — do not invent 0. */
export function mapKimiWorkUsage(usage) {
    if (!usage || typeof usage !== 'object')
        return usage;
    // Pick the first alias that is actually a valid count: ?? would stop at a
    // present-but-invalid value (e.g. the string "123") and skip a valid later one.
    const cached = [
        usage.prompt_tokens_details?.cached_tokens,
        usage.cached_tokens,
        usage.cache_read_input_tokens,
        usage.cache_read_tokens,
    ].find((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (cached === undefined)
        return usage;
    const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
        ? { ...usage.prompt_tokens_details }
        : {};
    if (typeof details.cached_tokens !== 'number')
        details.cached_tokens = cached;
    return { ...usage, prompt_tokens_details: details };
}
