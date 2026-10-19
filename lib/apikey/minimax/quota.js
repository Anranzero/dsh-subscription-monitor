/**
 * MiniMax quota: there is nothing to read. The published API exposes chat,
 * models, files and video, but no balance or plan endpoint — the only balance
 * signal is the `1008 Insufficient balance` error on a failed call.
 *
 * So this family reports a ready card with no meters. That is deliberately
 * different from "not signed in": the account, its source and the last read
 * time still show, the strip is simply empty.
 */
import { minimaxSourceLabel } from './index.js';
export async function fetchMinimaxQuota(session) {
    return {
        planType: minimaxSourceLabel(session?.source),
        account: typeof session?.account === 'string' ? session.account : undefined,
        rows: [],
    };
}
