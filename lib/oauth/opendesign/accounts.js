/**
 * Open Design account lifecycle for AuthController: the CLI-style device
 * login (start + poll, both owned here — the flow is not RFC 8628, so the
 * shared DeviceFlowManager does not fit; it rides `createFlowAttempts()` the
 * way WorkBuddy's browser poll does), pasted runtime keys, live catalog
 * discovery, and the quota chain's identity write-back.
 *
 * There is no local import on purpose: the OpenDesign desktop app keeps a
 * different (machine-issued) pair of keys in ~/.amr/config.json and the
 * upstream plugin never touches it (index.mjs:10-12, README:42-44).
 */
import { accountIdOf, listStoredSessions, publicSession, saveSession, updateAccountSession, } from '../store.js';
import { opendesignSession, parseOpendesignApiKey } from './index.js';
import { opendesignEngineAuthorize } from './engine.js';
import { opendesignCatalogModels } from './catalog.js';
import { catalogRouteSignature, notifyCatalogDiscovery } from '../catalog-sync.js';
/**
 * The one-attempt slot this family's device poll lives in. Declared here and
 * wired by the controller (`ctl.opendesignFlows = createFlowAttempts()`); the
 * cast keeps this file honest about the seam until that field lands.
 */
function flowsOf(ctl) {
    return ctl.opendesignFlows;
}
export async function discoverOpendesign(ctl, session) {
    if (!session || typeof ctl.opendesignDiscover !== 'function')
        return opendesignCatalogModels();
    try {
        return await ctl.opendesignDiscover(session, { fetchFn: ctl.fetchFn });
    }
    catch {
        return opendesignCatalogModels();
    }
}
/** The background half of a device login: poll → session → save → discover. */
export async function completeOpendesignDevice(ctl, attempt) {
    try {
        const wasSignedIn = (await listStoredSessions('opendesign', ctl.authPath)).length > 0;
        const before = catalogRouteSignature(opendesignCatalogModels());
        const session = await attempt.waitToken();
        await saveSession('opendesign', session, ctl.authPath);
        ctl.lastError.delete('opendesign');
        await discoverOpendesign(ctl, session);
        await notifyCatalogDiscovery(ctl, 'opendesign', { wasSignedIn, before, models: opendesignCatalogModels() });
        void ctl.quota.refresh('opendesign');
    }
    catch (error) {
        if (!(error instanceof Error && error.message === 'login cancelled')) {
            ctl.lastError.set('opendesign', error instanceof Error ? error.message : String(error));
        }
    }
    finally {
        ctl.finalizing.delete('opendesign');
    }
}
/**
 * Start the device sign-in: reserve the attempt slot, ask the control plane
 * for a code + activation page, hand the URL back at once, then poll in the
 * background (WorkBuddy startWorkbuddyBrowser's shape; cancel() aborts the
 * poll through the shared attempt registry).
 */
export async function loginOpendesign(ctl) {
    const flows = flowsOf(ctl);
    if (!flows)
        throw new Error('opendesign login is not wired into this controller');
    const slot = flows.begin('opendesign');
    let engine;
    try {
        engine = await opendesignEngineAuthorize({ fetchFn: ctl.fetchFn });
    }
    catch (error) {
        slot.abandon();
        throw error;
    }
    const attempt = slot.publish({
        authorizeUrl: engine.authorizeUrl,
        verificationUri: engine.authorizeUrl,
        ...(engine.userCode ? { userCode: engine.userCode } : {}),
        mode: 'device',
    });
    void engine.settle().then((session) => slot.settle(undefined, session), (error) => slot.settle(error instanceof Error ? error : new Error(String(error))));
    ctl.finalizing.add('opendesign');
    void completeOpendesignDevice(ctl, attempt);
    return {
        authorizeUrl: attempt.authorizeUrl,
        verificationUri: attempt.verificationUri,
        userCode: attempt.userCode,
        mode: 'device',
    };
}
/** A pasted `sk-amr-…` runtime key: model plane only, no allowance windows. */
export async function useOpendesignKey(ctl, key) {
    const wasSignedIn = (await listStoredSessions('opendesign', ctl.authPath)).length > 0;
    const before = catalogRouteSignature(opendesignCatalogModels());
    const session = opendesignSession({ runtimeKey: parseOpendesignApiKey(key), source: 'paste' });
    ctl.claim('opendesign');
    flowsOf(ctl)?.pending('opendesign')?.cancel();
    await saveSession('opendesign', session, ctl.authPath);
    ctl.lastError.delete('opendesign');
    await discoverOpendesign(ctl, session);
    await notifyCatalogDiscovery(ctl, 'opendesign', { wasSignedIn, before, models: opendesignCatalogModels() });
    void ctl.quota.refresh('opendesign');
    return { account: publicSession('opendesign', session) };
}
/**
 * Quota's identity write-back. Opendesign ids never rename: the device login
 * saves the account's email at sign-in and the paste fallback is a stable
 * fingerprint, so only the plan label moves.
 */
export async function rememberOpendesignIdentity(ctl, row, quota) {
    if (!quota || quota.status !== 'ready')
        return;
    const account = typeof quota.account === 'string' && quota.account.trim() ? quota.account.trim() : undefined;
    const planType = typeof quota.planType === 'string' && quota.planType.trim() ? quota.planType.trim() : undefined;
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
    const nextId = accountIdOf('opendesign', next);
    if (nextId !== row.id)
        return; // never expected: ids are stable; do not rename
    await updateAccountSession('opendesign', row, next, ctl.authPath);
}
