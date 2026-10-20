import { QUOTA_TIMEOUT_MS } from '../oauth/quota-shared.js';

// Match the existing live-catalog TTL; do not add polling to the chat path.
export const MODEL_DISCOVERY_TTL_MS = 5 * 60_000;
export const positiveLimit = (value) => Number.isSafeInteger(value) && value > 0 ? value : undefined;
export const modelText = (value) => typeof value === 'string' ? value.trim() : '';
export function modelInput(values) {
    if (!Array.isArray(values) || !values.includes('text'))
        return undefined;
    return ['text', 'image'].filter((kind) => values.includes(kind));
}
export function modelEfforts(values, offValue = 'none') {
    if (!Array.isArray(values))
        return undefined;
    const supported = new Set(values.map((value) => typeof value === 'string' ? value : value?.effort ?? value?.value));
    const out = {};
    if (supported.has('none'))
        out.off = offValue;
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'])
        if (supported.has(level))
            out[level] = level;
    return Object.keys(out).length ? out : undefined;
}
export function mergeCatalogFloor(listed, floor) {
    const live = new Map(listed.map((row) => [row.id, row]));
    const known = new Set(floor.map((row) => row.id));
    return [
        ...listed.filter((row) => !known.has(row.id)),
        ...floor.map((row) => live.get(row.id) ?? row),
    ];
}
export function discoverySignal(signal) {
    const timeout = AbortSignal.timeout(QUOTA_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export async function readModelList(fetchFn, url, init = {}) {
    const response = await fetchFn(url, { ...init, signal: discoverySignal(init.signal) });
    return response?.ok ? response.json() : null;
}
