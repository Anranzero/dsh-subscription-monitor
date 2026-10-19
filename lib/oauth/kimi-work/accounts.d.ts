/**
 * Kimi Work account lifecycle for AuthController: the local desktop sign-in
 * (read → probe → save the account reference), the read-only import, live
 * catalog discovery and startup auto-import. There is no browser flow, no
 * device code and no pasted key — the desktop file is the only way in, so
 * "login" and "import" are the same read (the upstream package's single
 * sign-in method with the loopback-paste shape collapsed into it).
 */
import type { AuthController } from '../controller.js';
export declare const KIMI_WORK_IMPORT_EMPTY = "no local Kimi Work sign-in found";
/** Discover the live catalog through the controller seam; the static floor answers when there is none. */
export declare function discoverKimiWork(ctl: AuthController, session: any): Promise<any>;
/**
 * Sign in from the local desktop file: the upstream engine's authorize
 * callback reads it and proves the Work credential against the models
 * endpoint (index.mjs:89-100), then the shared tail saves the account
 * reference and refreshes the live catalog. The TS probe it replaced is
 * deleted (ruling 2026-10-18: 不回退、不旧兼容).
 */
export declare function loginKimiWork(ctl: AuthController): Promise<{
    mode: string;
    account: Record<string, unknown> | undefined;
}>;
/** importFrom(): the same read-only desktop import; an unchanged account skips the rewrite. */
export declare function importKimiWork(ctl: AuthController): Promise<{
    source: unknown;
    session: import("../store.js").StoredSession;
    skipped: boolean;
} | {
    source: string;
    session: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        uid: string;
        account: string;
        source: any;
    };
    skipped?: undefined;
}>;
/**
 * Harvest the desktop sign-in once per start (kimi/workbuddy
 * maybeAutoImport shape): the signed-out mark and any stored account say no;
 * a missing file stays silent.
 */
export declare function maybeAutoImportKimiWork(ctl: AuthController): Promise<void>;
