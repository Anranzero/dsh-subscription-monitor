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
import type { AuthController } from '../controller.js';
/** Whether a zed login is in flight (the controller's busy check calls this). */
export declare function zedLoginBusy(): boolean;
/** Cancel the in-flight zed login (the controller's cancel wiring calls this). */
export declare function cancelZedLogin(): void;
/** padded: URL-safe base64 with its padding, as Rust's URL_SAFE writes it (index.mjs:349-352). */
/**
 * loginZed: the engine's own sign-in — it generates the RSA keypair, brings
 * its loopback server up and hands back the native_app_signin URL; its
 * callback decrypts the token and reads /me. The flow slot and the
 * save/discover completion stay here.
 */
export declare function loginZed(ctl: AuthController): Promise<{
    authorizeUrl: any;
    mode: "browser";
}>;
export declare function discoverZed(ctl: AuthController, session: any): Promise<readonly any[]>;
/**
 * The quota chain's identity write-back: keep the card's account name and the
 * plan slug current with what /users/me last said (upstream saves a plan that
 * changed with the sign-in, index.mjs:983-988). Ids never rename — the vault
 * key is the login's own name.
 */
export declare function rememberZedIdentity(ctl: AuthController, row: any, quota: any): Promise<void>;
