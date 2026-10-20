// Process-local aggregate diagnostics: no content, account or conversation identifiers.
const totals = { requests: 0, failures: 0, websocket: 0, sse: 0, reused: 0, delta: 0, fallback: 0 };
let last;
export function recordCodexTiming(report) {
    totals.requests += 1;
    if (!report.success)
        totals.failures += 1;
    if (report.transport === 'websocket' || report.transport === 'sse')
        totals[report.transport] += 1;
    if (report.wsReused)
        totals.reused += 1;
    if (report.wsDelta)
        totals.delta += 1;
    if (report.wsFallback)
        totals.fallback += 1;
    last = { ...report, stagesMs: { ...report.stagesMs } };
}
export function codexTimingSnapshot() {
    return { ...totals, ...(last ? { last: { ...last, stagesMs: { ...last.stagesMs } } } : {}) };
}
