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
import type { AuthController } from '../controller.js';
/**
 * Start the Xiaomi-account sign-in: reserve the attempt slot (the
 * controller's `mimoFlows` registry, the workbuddy pattern), mint the
 * sign-in page, hand its URL back at once — the ticket poll and the
 * save/quota completion run in the background.
 */
export declare function loginMimo(ctl: AuthController): Promise<{
    authorizeUrl: any;
    mode: string;
}>;
/** The sign-in's save half, once the poll settles a session. */
export declare function completeMimoBrowser(ctl: AuthController, attempt: any): Promise<void>;
/**
 * Quota's identity write-back. `planType` keeps only what the quota parser
 * already chose from the wire (the subscription's title / tier / code, the
 * free offer, or the Token Plan's own name); ids never rename — the vault key
 * is the Xiaomi user id, stable from sign-in on.
 */
export declare function rememberMimoIdentity(ctl: AuthController, row: any, quota: any): Promise<void>;
