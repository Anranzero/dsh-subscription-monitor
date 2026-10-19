/**
 * Zed account lifecycle for AuthController: Zed's own browser sign-in (an
 * RSA-2048 key, a loopback port, zed.dev/native_app_signin, the access token
 * encrypted back to the key), the session builder, live catalog discovery and
 * the quota chain's identity write-back.
 *
 * Attribution: magpie 0.1.8 `signIn` / `signedInWith` / `decrypt`
 * (index.mjs:349-445) — Zed's sign-in as the editor runs it, ported as-is:
 * the key pair is made per attempt, the public half rides the URL as
 * URL-safe base64 with padding (Rust's URL_SAFE), and the token arrives
 * RSA-OAEP-SHA256-encrypted, with PKCS#1 v1.5 as the older padding Node
 * refuses to decrypt directly (index.mjs:356-369). The attempt bookkeeping is
 * the shared createFlowAttempts slot (workbuddy's shape): login returns the
 * authorize URL at once, the mint + whoami + save run in the background.
 */
import { zedEngineAuthorize } from './engine.js';
import { refreshZedCatalog, zedCatalogModels } from './catalog.js';
import { createFlowAttempts } from '../flow.js';
import { listStoredSessions, saveSession, updateAccountSession } from '../store.js';
import { catalogRouteSignature, notifyCatalogDiscovery } from '../catalog-sync.js';
/** One zed login attempt at a time; the module owns its slot (workbuddy's createFlowAttempts shape). */
const zedFlows = createFlowAttempts();
/** Whether a zed login is in flight (the controller's busy check calls this). */
export function zedLoginBusy() {
    return zedFlows.isBusy('zed');
}
/** Cancel the in-flight zed login (the controller's cancel wiring calls this). */
export function cancelZedLogin() {
    zedFlows.pending('zed')?.cancel();
}
/** padded: URL-safe base64 with its padding, as Rust's URL_SAFE writes it (index.mjs:349-352). */
/**
 * loginZed: the engine's own sign-in — it generates the RSA keypair, brings
 * its loopback server up and hands back the native_app_signin URL; its
 * callback decrypts the token and reads /me. The flow slot and the
 * save/discover completion stay here.
 */
export async function loginZed(ctl) {
    const slot = zedFlows.begin('zed');
    let engine;
    try {
        engine = await zedEngineAuthorize({ fetchFn: ctl.fetchFn });
    }
    catch (error) {
        slot.abandon();
        throw error;
    }
    const attempt = slot.publish({ authorizeUrl: engine.authorizeUrl, mode: 'browser' });
    void completeZedBrowser(ctl, slot, engine.settle, attempt);
    return { authorizeUrl: attempt.authorizeUrl, mode: 'browser' };
}
/**
 * The sign-in's background half: wait out the engine callback (its own
 * timeout/cancel semantics), save, discover, and release the attempt slot.
 */
async function completeZedBrowser(ctl, slot, settle, attempt) {
    ctl.finalizing.add('zed');
    try {
        const wasSignedIn = (await listStoredSessions('zed', ctl.authPath)).length > 0;
        const before = catalogRouteSignature(zedCatalogModels());
        const session = await settle();
        await saveSession('zed', session, ctl.authPath);
        ctl.lastError.delete('zed');
        if (attempt === undefined || slot.owns(attempt))
            slot.settle(undefined, session);
        await refreshZedCatalog(session, { fetchFn: ctl.fetchFn });
        await notifyCatalogDiscovery(ctl, 'zed', { wasSignedIn, before, models: zedCatalogModels() });
        void ctl.quota.refresh('zed');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === undefined || slot.owns(attempt))
            slot.settle(error instanceof Error ? error : new Error(message));
        if (message !== 'login cancelled')
            ctl.lastError.set('zed', message);
    }
    finally {
        ctl.finalizing.delete('zed');
    }
}
export async function discoverZed(ctl, session) {
    if (!session)
        return zedCatalogModels();
    try {
        return await refreshZedCatalog(session, { fetchFn: ctl.fetchFn });
    }
    catch {
        return zedCatalogModels();
    }
}
/**
 * The quota chain's identity write-back: keep the card's account name and the
 * plan slug current with what /users/me last said (upstream saves a plan that
 * changed with the sign-in, index.mjs:983-988). Ids never rename — the vault
 * key is the login's own name.
 */
export async function rememberZedIdentity(ctl, row, quota) {
    if (!quota || quota.status !== 'ready')
        return;
    const account = typeof quota.account === 'string' && quota.account.trim() ? quota.account.trim() : undefined;
    const planType = typeof quota.planType === 'string' && quota.planType.trim() ? quota.planType.trim() : undefined;
    if (!account && !planType)
        return;
    if ((!account || row.session.account === account) && (!planType || row.session.planType === planType))
        return;
    const next = { ...row.session };
    if (account)
        next.account = account;
    if (planType)
        next.planType = planType;
    await updateAccountSession('zed', row, next, ctl.authPath);
}
