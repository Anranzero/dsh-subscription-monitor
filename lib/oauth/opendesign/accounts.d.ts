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
import type { AuthController } from '../controller.js';
export declare function discoverOpendesign(ctl: AuthController, session: any): Promise<any>;
/** The background half of a device login: poll → session → save → discover. */
export declare function completeOpendesignDevice(ctl: AuthController, attempt: any): Promise<void>;
/**
 * Start the device sign-in: reserve the attempt slot, ask the control plane
 * for a code + activation page, hand the URL back at once, then poll in the
 * background (WorkBuddy startWorkbuddyBrowser's shape; cancel() aborts the
 * poll through the shared attempt registry).
 */
export declare function loginOpendesign(ctl: AuthController): Promise<{
    authorizeUrl: any;
    verificationUri: any;
    userCode: any;
    mode: string;
}>;
/** A pasted `sk-amr-…` runtime key: model plane only, no allowance windows. */
export declare function useOpendesignKey(ctl: AuthController, key: any): Promise<{
    account: Record<string, unknown> | undefined;
}>;
/**
 * Quota's identity write-back. Opendesign ids never rename: the device login
 * saves the account's email at sign-in and the paste fallback is a stable
 * fingerprint, so only the plan label moves.
 */
export declare function rememberOpendesignIdentity(ctl: AuthController, row: any, quota: any): Promise<void>;
