/**
 * Kimi Work account lifecycle for AuthController: the local desktop sign-in
 * (read → probe → save the account reference), the read-only import, live
 * catalog discovery and startup auto-import. There is no browser flow, no
 * device code and no pasted key — the desktop file is the only way in, so
 * "login" and "import" are the same read (the upstream package's single
 * sign-in method with the loopback-paste shape collapsed into it).
 */
import { listStoredSessions, publicSession, saveSession, } from '../store.js';
import { KIMI_WORK_ACCOUNT_LABEL, kimiWorkSession, readKimiWorkDesktop, } from './index.js';
import { kimiWorkCatalogModels } from './catalog.js';
import { kimiWorkEngineAuthorize } from './engine.js';
import { catalogRouteSignature, notifyCatalogDiscovery } from '../catalog-sync.js';
import { signedOutOf } from '../account-marks.js';
export const KIMI_WORK_IMPORT_EMPTY = 'no local Kimi Work sign-in found';
/**
 * The controller seam this family reads. `kimiWorkDiscover` /
 * `kimiWorkAutoImport` are wired by the controller's own patch; the cast
 * keeps this file honest about the seam until those fields land.
 */
const controllerSeam = (ctl) => ctl;
/** Discover the live catalog through the controller seam; the static floor answers when there is none. */
export async function discoverKimiWork(ctl, session) {
    if (!session || typeof controllerSeam(ctl).kimiWorkDiscover !== 'function')
        return kimiWorkCatalogModels();
    try {
        return await controllerSeam(ctl).kimiWorkDiscover(session, { fetchFn: ctl.fetchFn });
    }
    catch {
        return kimiWorkCatalogModels();
    }
}
/** The reference session a valid desktop sign-in becomes (uid from the file, tokens never copied). */
function sessionFromDesktop(read) {
    return kimiWorkSession({ uid: read.uid, account: KIMI_WORK_ACCOUNT_LABEL });
}
/**
 * Sign in from the local desktop file: the upstream engine's authorize
 * callback reads it and proves the Work credential against the models
 * endpoint (index.mjs:89-100), then the shared tail saves the account
 * reference and refreshes the live catalog. The TS probe it replaced is
 * deleted (ruling 2026-10-18: 不回退、不旧兼容).
 */
export async function loginKimiWork(ctl) {
    const { uid } = await kimiWorkEngineAuthorize({ fetchFn: ctl.fetchFn });
    const wasSignedIn = (await listStoredSessions('kimi-work', ctl.authPath)).length > 0;
    const before = catalogRouteSignature(kimiWorkCatalogModels());
    const session = sessionFromDesktop({ uid });
    await saveSession('kimi-work', session, ctl.authPath);
    ctl.lastError.delete('kimi-work');
    await discoverKimiWork(ctl, session);
    await notifyCatalogDiscovery(ctl, 'kimi-work', { wasSignedIn, before, models: kimiWorkCatalogModels() });
    void ctl.quota.refresh('kimi-work');
    return { mode: 'desktop', account: publicSession('kimi-work', session) };
}
/** importFrom(): the same read-only desktop import; an unchanged account skips the rewrite. */
export async function importKimiWork(ctl) {
    const read = readKimiWorkDesktop();
    if (!read)
        throw new Error(KIMI_WORK_IMPORT_EMPTY);
    const session = sessionFromDesktop(read);
    const hit = (await listStoredSessions('kimi-work', ctl.authPath))
        .find((row) => row.session.uid === session.uid);
    if (hit) {
        return { source: hit.session.source, session: hit.session, skipped: true };
    }
    return { source: 'desktop', session };
}
/**
 * Harvest the desktop sign-in once per start (kimi/workbuddy
 * maybeAutoImport shape): the signed-out mark and any stored account say no;
 * a missing file stays silent.
 */
export async function maybeAutoImportKimiWork(ctl) {
    const seam = controllerSeam(ctl);
    if (!seam.kimiWorkAutoImport || seam.kimiWorkAutoImportTried)
        return;
    seam.kimiWorkAutoImportTried = true;
    if (await signedOutOf(ctl, 'kimi-work'))
        return;
    const rows = await listStoredSessions('kimi-work', ctl.authPath);
    if (rows.length > 0)
        return;
    const read = readKimiWorkDesktop();
    if (!read)
        return;
    try {
        const before = catalogRouteSignature(kimiWorkCatalogModels());
        const session = sessionFromDesktop(read);
        await saveSession('kimi-work', session, ctl.authPath);
        await discoverKimiWork(ctl, session);
        await notifyCatalogDiscovery(ctl, 'kimi-work', { wasSignedIn: false, before, models: kimiWorkCatalogModels() });
        void ctl.quota.refresh('kimi-work');
    }
    catch {
        // the save or the discovery refused: the next snapshot retries; the
        // desktop file itself was already read successfully
    }
}
