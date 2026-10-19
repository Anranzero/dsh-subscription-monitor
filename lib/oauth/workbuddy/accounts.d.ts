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
import { type WorkbuddySite } from './index.js';
import type { AuthController } from '../controller.js';
/** The sign-in's save-and-finish half, once the poll settles a session. */
export declare function completeWorkbuddyBrowser(ctl: AuthController, site: WorkbuddySite, attempt: any): Promise<void>;
export declare function loginWorkbuddy(ctl: AuthController): Promise<{
    authorizeUrl: any;
    mode: "browser";
}>;
export declare function loginWorkbuddyAi(ctl: AuthController): Promise<{
    authorizeUrl: any;
    mode: "browser";
}>;
export declare function importWorkbuddy(ctl: AuthController): Promise<{
    source: unknown;
    session: import("../store.js").StoredSession;
    skipped: boolean;
} | {
    source: string;
    session: any;
    skipped?: undefined;
}>;
export declare function importWorkbuddyAi(ctl: AuthController): Promise<{
    source: unknown;
    session: import("../store.js").StoredSession;
    skipped: boolean;
} | {
    source: string;
    session: any;
    skipped?: undefined;
}>;
export declare function discoverWorkbuddy(ctl: AuthController, session: any): Promise<any>;
export declare function discoverWorkbuddyAi(ctl: AuthController, session: any): Promise<any>;
export declare function rememberWorkbuddyIdentity(ctl: AuthController, row: any, quota: any): Promise<void>;
export declare function rememberWorkbuddyAiIdentity(ctl: AuthController, row: any, quota: any): Promise<void>;
/**
 * Harvest the desktop app's sign-in once per start for whichever build is
 * signed in locally (cline/kimi maybeAutoImport shape): the signed-out mark
 * and any stored account say no; a missing or sealed file stays silent.
 */
export declare function maybeAutoImportWorkbuddy(ctl: AuthController): Promise<void>;
export declare function pickWorkbuddyHumanAccount(...values: any[]): string | undefined;
