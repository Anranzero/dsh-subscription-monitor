/**
 * MiniMax account lifecycle for AuthController: paste-only login (there is no
 * browser flow), account model discovery, and MINIMAX_API_KEY auto-import.
 * Functions take the controller as their first argument, the same shape every
 * other apikey family uses.
 */
import { errorCode, errorMessage } from '../../utils/http.js';
import { listStoredSessions, publicSession, saveSession } from '../../oauth/store.js';
import { minimaxSession } from './index.js';
import { minimaxCatalogModels, refreshMinimaxCatalog } from './catalog.js';
export const MINIMAX_IMPORT_EMPTY = 'MINIMAX_IMPORT_EMPTY';
/** The env name the host-side llm-pi-ai provider used before this family existed. */
export const MINIMAX_ENV_KEYS = Object.freeze(['MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY']);
export function loginMinimax() {
    throw new Error('MiniMax uses the API-key form, not browser login');
}
export async function discoverMinimax(ctl, session) {
    if (!session)
        return minimaxCatalogModels();
    return refreshMinimaxCatalog(session, { fetchFn: ctl.fetchFn });
}
export async function useMinimaxKey(ctl, key) {
    const session = minimaxSession({ accessToken: key, source: 'paste' });
    ctl.claim('minimax');
    await saveSession('minimax', session, ctl.authPath);
    ctl.lastError.delete('minimax');
    void ctl.quota.refresh('minimax');
    return { account: publicSession('minimax', session) };
}
export async function importMinimax(ctl) {
    const existing = await listStoredSessions('minimax', ctl.authPath);
    const raw = MINIMAX_ENV_KEYS.map((name) => process.env[name]).find((value) => typeof value === 'string' && value.trim());
    if (!raw)
        throw new Error(MINIMAX_IMPORT_EMPTY);
    const session = minimaxSession({ accessToken: raw, source: 'env' });
    const hit = existing.find((row) => row.session.accessToken === session.accessToken);
    if (hit)
        return { source: hit.session.source, session: hit.session, skipped: true };
    await saveSession('minimax', session, ctl.authPath);
    void ctl.quota.refresh('minimax');
    return { source: 'env', session };
}
export async function maybeAutoImportMinimax(ctl) {
    if (ctl.minimaxAutoImportTried)
        return;
    ctl.minimaxAutoImportTried = true;
    const rows = await listStoredSessions('minimax', ctl.authPath);
    if (rows.length > 0)
        return;
    try {
        await importMinimax(ctl);
    }
    catch (error) {
        // An absent env var is the normal case; other faults stay off the banner.
        if (errorCode(error) !== MINIMAX_IMPORT_EMPTY && errorMessage(error) !== MINIMAX_IMPORT_EMPTY) {
            // intentionally quiet
        }
    }
}
