/**
 * WorkBuddy account lifecycle for AuthController. The engine owns the wire:
 * login is the package's browser authorize (its callback is the poll), the
 * desktop import is the package's desktop method — a reference (source +
 * uid), never a token copy, because the engine re-reads the app's file on
 * every hop. What stays here is the vault lifecycle: the flow slot, the
 * save/discover/catalog-notification completion, the identity write-back and
 * the startup auto-import. One family folder, two builds — every function
 * here fans out through WORKBUDDY_SITES.
 */
import { WORKBUDDY_PLAN_NAMES, WORKBUDDY_SITES, } from './index.js';
import { workbuddyEngineAuthorizeBrowser, workbuddyEngineAuthorizeDesktop, } from './engine.js';
import { accountIdOf, listStoredSessions, saveSession, updateAccountSession, } from '../store.js';
import { workbuddyAiCatalogModels, workbuddyCatalogModels } from './catalog.js';
import { catalogRouteSignature, notifyCatalogDiscovery } from '../catalog-sync.js';
import { signedOutOf } from '../account-marks.js';
/** This build's catalog read (the two builds answer different plans). */
function siteCatalog(site) {
    return site.ai ? workbuddyAiCatalogModels : workbuddyCatalogModels;
}
/**
 * Start one build's browser sign-in: reserve the attempt slot, let the
 * engine mint the sign-in page, hand the URL back at once — its callback
 * (the token/account poll) and the save/discover completion run in the
 * background (kimi completeKimiDevice's shape; cancel() aborts the poll
 * through the shared attempt registry).
 */
async function startWorkbuddyBrowser(ctl, site) {
    const slot = ctl.workbuddyFlows.begin(site.id);
    let engine;
    try {
        engine = await workbuddyEngineAuthorizeBrowser(site, { fetchFn: ctl.fetchFn });
    }
    catch (error) {
        slot.abandon();
        throw error;
    }
    const attempt = slot.publish({ authorizeUrl: engine.authorizeUrl, mode: 'browser' });
    void engine.settle().then((session) => slot.settle(undefined, session), (error) => slot.settle(error instanceof Error ? error : new Error(String(error))));
    ctl.finalizing.add(site.id);
    void completeWorkbuddyBrowser(ctl, site, attempt);
    return { authorizeUrl: attempt.authorizeUrl, mode: 'browser' };
}
/** The sign-in's save-and-finish half, once the poll settles a session. */
export async function completeWorkbuddyBrowser(ctl, site, attempt) {
    try {
        const wasSignedIn = (await listStoredSessions(site.id, ctl.authPath)).length > 0;
        const before = catalogRouteSignature(siteCatalog(site)());
        const session = await attempt.waitToken();
        await saveSession(site.id, session, ctl.authPath);
        ctl.lastError.delete(site.id);
        await discoverWorkbuddySite(ctl, site, session);
        await notifyCatalogDiscovery(ctl, site.id, { wasSignedIn, before, models: siteCatalog(site)() });
        void ctl.quota.refresh(site.id);
    }
    catch (error) {
        if (!(error instanceof Error && error.message === 'login cancelled')) {
            ctl.lastError.set(site.id, error instanceof Error ? error.message : String(error));
        }
    }
    finally {
        ctl.finalizing.delete(site.id);
    }
}
export async function loginWorkbuddy(ctl) {
    return startWorkbuddyBrowser(ctl, WORKBUDDY_SITES.workbuddy);
}
export async function loginWorkbuddyAi(ctl) {
    return startWorkbuddyBrowser(ctl, WORKBUDDY_SITES['workbuddy-ai']);
}
async function importWorkbuddyDesktop(ctl, site) {
    const existing = await listStoredSessions(site.id, ctl.authPath);
    const session = await workbuddyEngineAuthorizeDesktop(site, { fetchFn: ctl.fetchFn });
    const incomingId = accountIdOf(site.id, session);
    const hit = existing.find((row) => row.id === incomingId);
    if (hit) {
        return { source: hit.session.source, session: hit.session, skipped: true };
    }
    return { source: 'desktop', session };
}
export async function importWorkbuddy(ctl) {
    return importWorkbuddyDesktop(ctl, WORKBUDDY_SITES.workbuddy);
}
export async function importWorkbuddyAi(ctl) {
    return importWorkbuddyDesktop(ctl, WORKBUDDY_SITES['workbuddy-ai']);
}
/** Discover this build's live catalog through the controller seam; the static floor answers when there is none. */
async function discoverWorkbuddySite(ctl, site, session) {
    if (!session || typeof ctl.workbuddyDiscover !== 'function')
        return siteCatalog(site)();
    try {
        return await ctl.workbuddyDiscover(site, session, { fetchFn: ctl.fetchFn });
    }
    catch {
        return siteCatalog(site)();
    }
}
export async function discoverWorkbuddy(ctl, session) {
    return discoverWorkbuddySite(ctl, WORKBUDDY_SITES.workbuddy, session);
}
export async function discoverWorkbuddyAi(ctl, session) {
    return discoverWorkbuddySite(ctl, WORKBUDDY_SITES['workbuddy-ai'], session);
}
/**
 * Quota's identity write-back. planType keeps only the plan names the wire
 * spells (WORKBUDDY_PLAN_NAMES' values — the engine's usage read chose
 * Pro/Free/Enterprise), trimmed as sent; anything else is dropped, not
 * invented. Ids never rename: a login saves its account name at sign-in, so
 * the vault key is stable and only the label moves.
 */
async function rememberWorkbuddyRow(ctl, site, row, quota) {
    if (!quota || quota.status !== 'ready')
        return;
    const account = typeof quota.account === 'string' && quota.account.trim() ? quota.account.trim() : undefined;
    const raw = typeof quota.planType === 'string' && quota.planType.trim() ? quota.planType.trim() : undefined;
    const planType = raw !== undefined && Object.values(WORKBUDDY_PLAN_NAMES).includes(raw) ? raw : undefined;
    if (!account && !planType)
        return;
    if ((!account || row.session.account === account)
        && (!planType || row.session.planType === planType))
        return;
    const next = { ...row.session };
    if (account)
        next.account = account;
    if (planType)
        next.planType = planType;
    await updateAccountSession(site.id, row, next, ctl.authPath);
}
export async function rememberWorkbuddyIdentity(ctl, row, quota) {
    await rememberWorkbuddyRow(ctl, WORKBUDDY_SITES.workbuddy, row, quota);
}
export async function rememberWorkbuddyAiIdentity(ctl, row, quota) {
    await rememberWorkbuddyRow(ctl, WORKBUDDY_SITES['workbuddy-ai'], row, quota);
}
/**
 * Harvest the desktop app's sign-in once per start for whichever build is
 * signed in locally (cline/kimi maybeAutoImport shape): the signed-out mark
 * and any stored account say no; a missing or sealed file stays silent.
 */
export async function maybeAutoImportWorkbuddy(ctl) {
    if (!ctl.workbuddyAutoImport || ctl.workbuddyAutoImportTried)
        return;
    ctl.workbuddyAutoImportTried = true;
    for (const site of Object.values(WORKBUDDY_SITES)) {
        if (await signedOutOf(ctl, site.id))
            continue;
        const rows = await listStoredSessions(site.id, ctl.authPath);
        if (rows.length > 0)
            continue;
        try {
            const session = await workbuddyEngineAuthorizeDesktop(site, { fetchFn: ctl.fetchFn });
            const before = catalogRouteSignature(siteCatalog(site)());
            await saveSession(site.id, session, ctl.authPath);
            await discoverWorkbuddySite(ctl, site, session);
            await notifyCatalogDiscovery(ctl, site.id, { wasSignedIn: false, before, models: siteCatalog(site)() });
            void ctl.quota.refresh(site.id);
        }
        catch {
            // no desktop sign-in, or the app sealed it (5.6+) — the common case
        }
    }
}
/**
 * First readable sign-in name (nickname, then phone number). `wb-` vault keys
 * and uuid blobs stay unpicked; a bare uid that slipped into a name slot is
 * indistinguishable from a nickname, so it passes — the callers only ever put
 * nickname/phone there and the uid fallback stays the last resort.
 */
const WORKBUDDY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function pickWorkbuddyHumanAccount(...values) {
    for (const value of values) {
        const next = typeof value === 'string' ? value.trim() : '';
        if (next && !next.startsWith('wb-') && !WORKBUDDY_UUID_RE.test(next))
            return next;
    }
    return undefined;
}
