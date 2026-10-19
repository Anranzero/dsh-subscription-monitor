/**
 * MiMo account lifecycle for AuthController: the Xiaomi-account browser
 * sign-in (long-poll ticket → passToken → server sign-on → region move),
 * identity write-back, and the background half that saves the session.
 *
 * Attribution: the flow is magpie 0.1.9's `startSignIn` / `waitPoll` /
 * `signedInWith` (index.mjs:299-355) — the plugin opens Xiaomi's sign-in page
 * (QR for the phone app, or the password), waits on the ticket until Xiaomi
 * says the account is in, and the passToken signs it on at the MiMo server.
 * Nothing is pasted back. No PKCE, no loopback, no device code.
 */
import { mimoSession, mimoSignInPage, mimoSignInWith, waitMimoPoll, } from './index.js';
import { saveSession, updateAccountSession } from '../store.js';
/**
 * Start the Xiaomi-account sign-in: reserve the attempt slot (the
 * controller's `mimoFlows` registry, the workbuddy pattern), mint the
 * sign-in page, hand its URL back at once — the ticket poll and the
 * save/quota completion run in the background.
 */
export async function loginMimo(ctl) {
    // The registry field lands with the shared controller wiring (families.ts
    // row + controller branch); until then this stays untyped on purpose.
    const flows = ctl.mimoFlows;
    if (!flows)
        throw new Error('mimo login flows are not wired in this build');
    const slot = flows.begin('mimo');
    let page;
    try {
        page = await mimoSignInPage({ fetchFn: ctl.fetchFn });
    }
    catch (error) {
        slot.abandon();
        throw error;
    }
    const attempt = slot.publish({ authorizeUrl: page.url, mode: 'browser' });
    void pollMimoSignIn(page, slot, { fetchFn: ctl.fetchFn });
    ctl.finalizing.add('mimo');
    void completeMimoBrowser(ctl, attempt);
    return { authorizeUrl: attempt.authorizeUrl, mode: 'browser' };
}
/** The background half of the sign-in: the ticket poll, then the server sign-on. */
async function pollMimoSignIn(page, slot, { fetchFn }) {
    try {
        const poll = await waitMimoPoll(page, fetchFn, slot.signal);
        const { creds, cookies } = await mimoSignInWith(poll, page.device, fetchFn);
        slot.settle(undefined, mimoSession({ creds, cookies, issuedAt: Date.now() }));
    }
    catch (error) {
        slot.settle(error instanceof Error ? error : new Error(String(error)));
    }
}
/** The sign-in's save half, once the poll settles a session. */
export async function completeMimoBrowser(ctl, attempt) {
    try {
        const session = await attempt.waitToken();
        await saveSession('mimo', session, ctl.authPath);
        ctl.lastError.delete('mimo');
        // No live catalog: the picker's rows are the pinned static table, so a
        // discovery step (workbuddy's) has nothing to re-read here.
        void ctl.quota.refresh('mimo');
    }
    catch (error) {
        if (!(error instanceof Error && error.message === 'login cancelled')) {
            ctl.lastError.set('mimo', error instanceof Error ? error.message : String(error));
        }
    }
    finally {
        ctl.finalizing.delete('mimo');
    }
}
/**
 * Quota's identity write-back. `planType` keeps only what the quota parser
 * already chose from the wire (the subscription's title / tier / code, the
 * free offer, or the Token Plan's own name); ids never rename — the vault key
 * is the Xiaomi user id, stable from sign-in on.
 */
export async function rememberMimoIdentity(ctl, row, quota) {
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
    await updateAccountSession('mimo', row, next, ctl.authPath);
}
