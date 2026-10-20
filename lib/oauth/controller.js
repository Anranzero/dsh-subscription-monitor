/**
 * Auth controller behind the Settings page RPC: owns the per-family token
 * managers, quota store and flow managers, builds the Settings snapshot, and
 * syncs routes to the host. The work behind each entry point lives in plain
 * functions that take the controller: login.ts (flows, keys, imports),
 * account-quota.ts, self-update.ts, account-marks.ts, and each family's
 * accounts.ts (auto-import, identity, catalog discovery, login completion).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createFlowAttempts, OAuthFlowManager } from './flow.js';
import { DeviceFlowManager } from './grok/device-flow.js';
import { GlmCliFlowManager } from './glm/cli-flow.js';
import { KiroIdcFlowManager } from './kiro/idc-flow.js';
import { accountIdOf, asVault, deleteSession, getSession, listStoredSessions, loadStore, PROVIDER_IDS, publicSession, purgeRetiredSessions, switchAccount, } from './store.js';
import { GLM_MODELS } from './glm/index.js';
import { CursorPollFlowManager } from './cursor/pkce-flow.js';
import { refreshCursorCatalog } from './cursor/catalog.js';
import { refreshOllamaCatalog } from '../apikey/ollama/catalog.js';
import { catalogCredits, catalogPricing, catalogRateTimeOfDay, creditsOfRows } from '../catalog/index.js';
import { MODEL_DISCOVERY_TTL_MS } from '../catalog/discovery.js';
import { kiroCatalogModels, refreshKiroCatalog } from './kiro/catalog.js';
import { configureKimiIdentity } from './kimi/index.js';
import { refreshKimiCatalog } from './kimi/catalog.js';
import { refreshDevinCatalog } from './devin/catalog.js';
import { refreshClineCatalog } from './cline/catalog.js';
import { refreshCommandCodeCatalog } from '../apikey/command-code/catalog.js';
import { opencodeGoFilePath, OpencodeGoStore } from '../apikey/opencode-go/store.js';
import { APIKEY_FAMILY_IDS, buildProviders, catalogProviders, describeCatalog, describeProviders, MODEL_FAMILY_IDS, } from './models.js';
import { ensureOpencodeGoRoute, ensureOpencodeZenRoute, filterProviders, peekPiAiProviders, removeHarnessModels, syncHarnessModels } from './harness-sync.js';
import { familyCatalogInputs, OAUTH_FAMILIES } from './families.js';
import { catalogRouteSignature } from './catalog-sync.js';
import { ModelSwitch } from './model-switch.js';
import { buildTokenManagers } from './token-managers.js';
import { QuotaStore } from './quota.js';
import { DEFAULT_PROFILE, installRelease, localUpdateInfo } from '../utils/update.js';
import { readUpdatePrefs, readUpdateState, updatePrefsPath, updateStatePath } from '../utils/update-prefs.js';
import { configureUpstreamEngine } from '../upstream-engine/engine.js';
import { enginePaths as enginePathsFor, readEngineManifest } from '../upstream-engine/packages.js';
import { runEngineWatch, startEngineWatch, stopEngineWatch } from '../upstream-engine/watch.js';
import { outboundFetch } from '../utils/outbound.js';
import { completeCommandCode, maybeAutoImportCommandCode } from '../apikey/command-code/accounts.js';
import { maybeAutoImportOllama } from '../apikey/ollama/accounts.js';
import { clearOpencodeGo, hasOpencodeGoKey, logoutOpencodeGo, opencodeGoSnapshot, opencodeZenInUse, refreshOpencodeGoQuota, saveOpencodeGo, switchOpencodeGo, } from '../apikey/opencode-go/accounts.js';
import { refreshOpencodeGoCatalog } from '../apikey/opencode-go/catalog.js';
import { markSignedOut } from './account-marks.js';
import { accountsWithQuota, consumeReset, ensureAccountQuota, refreshQuota } from './account-quota.js';
import { completeClineDevice, maybeAutoImportCline } from './cline/accounts.js';
import { revokeChatgptAccounts } from './chatgpt/accounts.js';
import { refreshChatgptCatalog } from './chatgpt/catalog.js';
import { completeCursor, maybeAutoImportCursor, resolveCursorIdentities, } from './cursor/accounts.js';
import { maybeAutoImportDevin } from './devin/accounts.js';
import { completeGlm, resolveGlmIdentities, upgradeGlmLegacyBearers } from './glm/accounts.js';
import { completeKimiDevice, maybeAutoImportKimi } from './kimi/accounts.js';
import { maybeAutoImportWorkbuddy } from './workbuddy/accounts.js';
import { maybeAutoImportKimiWork } from './kimi-work/accounts.js';
import { cancelZedLogin } from './zed/accounts.js';
import { cancelAutoclawLogin } from './autoclaw/accounts.js';
import { completeOpendesignDevice } from './opendesign/accounts.js';
import { opendesignCatalogModels, refreshOpendesignCatalog } from './opendesign/catalog.js';
import { refreshWorkbuddyCatalog } from './workbuddy/catalog.js';
import { refreshKimiWorkCatalog } from './kimi-work/catalog.js';
import { completeKiroIdc } from './kiro/accounts.js';
import { completeDevice, completePkce, importFrom, login, useKey } from './login.js';
import { checkUpdate, fetchChangelog, runAutoUpdate, setAutoUpdate, startAutoUpdateWatch, stopAutoUpdateWatch, } from './self-update.js';
/** How often the background sweep re-checks stored credential expiry. */
export const TOKEN_SWEEP_INTERVAL_MS = 60_000;
const routeOwners = globalThis[Symbol.for('dsh-subscription-monitor.route-owners')] ??= new Map();
export class AuthController {
    identityTried = new Map();
    #snapshotRun;
    #revalidateQuotaNext = false;
    #syncQueue = Promise.resolve();
    #catalogRun;
    #disposed = false;
    #disposeRun;
    #owner = { settled: () => this.#disposeRun ?? this.#syncQueue };
    constructor({ authPath, prefix, origin, settings, patchPath, credentials, grokLogin = 'device', onAuthChanged, models, fetchFn = outboundFetch, quotaTtlMs, profile, readFileFn, updateEnv, installReleaseFn = installRelease, cursorAutoImport, cursorImport, cursorDiscover, ollamaAutoImport, ollamaDiscover, kiroDiscover, kimiAutoImport, kimiDiscover, devinAutoImport, devinImport, devinDiscover, clineDiscover, clineAutoImport, commandCodeAutoImport, commandCodeImport, commandCodeDiscover, chatgptDiscover, workbuddyAutoImport, workbuddyDiscover, kimiWorkAutoImport, kimiWorkDiscover, opendesignDiscover }) {
        this.authPath = authPath;
        this.prefix = prefix;
        this.origin = origin;
        this.settings = settings;
        this.routeOwnerKey = `${authPath ?? ''}\n${prefix ?? ''}`;
        this.#syncQueue = (routeOwners.get(this.routeOwnerKey)?.settled?.() ?? Promise.resolve()).catch(() => undefined);
        routeOwners.set(this.routeOwnerKey, this.#owner);
        this.patchPath = patchPath;
        this.credentials = credentials;
        this.grokLogin = grokLogin;
        this.profile = profile || DEFAULT_PROFILE;
        this.readFileFn = readFileFn;
        this.updateEnv = updateEnv;
        this.installReleaseFn = installReleaseFn;
        this.prefsFile = updatePrefsPath(authPath);
        this.stateFile = updateStatePath(authPath);
        // The engines' cache root follows the outbound singleton pattern, so the
        // proxy and quota paths reach it without new shared-dispatcher params.
        configureUpstreamEngine(authPath);
        this.enginePaths = typeof authPath === 'string' && authPath ? enginePathsFor(authPath) : undefined;
        this.prefsReady = Promise.all([
            readUpdatePrefs(this.prefsFile),
            readUpdateState(this.stateFile),
        ]).then(([prefs, state]) => {
            this.autoUpdate = prefs.autoUpdate;
            this.updateState = state;
        });
        // Any login-state change re-arms the throttled identity discovery.
        this.onAuthChanged = (provider) => {
            this.identityTried.clear();
            void this.warmCatalogs().catch(() => undefined);
            return onAuthChanged?.(provider);
        };
        this.models = models ?? new ModelSwitch();
        this.loginsReady = (async () => {
            await this.models.ready;
            // Retired families have no logout button: delete their tokens from
            // auth.json instead of leaving them there for good. Only a configured
            // path — an instance without one must never reach for the default dir.
            if (typeof authPath === 'string' && authPath)
                await purgeRetiredSessions(authPath).catch(() => []);
            await this.#seedSeenLogins();
            // Seed keys before the proxy exists; these route URLs are never published.
            const catalog = catalogProviders({ prefix: this.prefix, origin: '', ...await this.#catalogInputs() });
            await this.models.rememberDiscovered(catalog, catalog, await peekPiAiProviders(this.settings));
        })();
        this.flows = new OAuthFlowManager();
        this.devices = new DeviceFlowManager();
        this.glmFlows = new GlmCliFlowManager();
        this.kiroFlows = new KiroIdcFlowManager();
        this.cursorFlows = new CursorPollFlowManager();
        // WorkBuddy's browser sign-in is a plain poll flow (glmFlows' one-slot
        // registry without a manager class): login attempts live in accounts.ts.
        this.workbuddyFlows = createFlowAttempts();
        // Xiaomi MiMo's browser sign-in is the same single-slot poll registry (the
        // long-poll attempt lives in the family's accounts.ts).
        this.mimoFlows = createFlowAttempts();
        // Open Design's device authorization is a JSON poll, not RFC 8628 (the
        // attempt lives in the family's accounts.ts, same as WorkBuddy's).
        this.opendesignFlows = createFlowAttempts();
        // node:test sets NODE_TEST_CONTEXT; do not harvest the agent/IDE login into unit snapshots.
        this.cursorAutoImport = cursorAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.cursorImport = cursorImport && typeof cursorImport === 'object' ? cursorImport : {};
        this.cursorAutoImportTried = false;
        this.cursorDiscover = typeof cursorDiscover === 'function'
            ? cursorDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : refreshCursorCatalog);
        this.ollamaAutoImport = ollamaAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.ollamaAutoImportTried = false;
        this.ollamaDiscover = typeof ollamaDiscover === 'function'
            ? ollamaDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : refreshOllamaCatalog);
        this.kiroDiscover = typeof kiroDiscover === 'function'
            ? kiroDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshKiroCatalog(session, { fetchFn })));
        this.kimiAutoImport = kimiAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.kimiAutoImportTried = false;
        this.kimiDiscover = typeof kimiDiscover === 'function'
            ? kimiDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshKimiCatalog(session, { fetchFn })));
        this.devinAutoImport = devinAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.devinImport = devinImport && typeof devinImport === 'object' ? devinImport : {};
        this.devinAutoImportTried = false;
        this.devinDiscover = typeof devinDiscover === 'function'
            ? devinDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshDevinCatalog(session, { fetchFn })));
        this.chatgptDiscover = typeof chatgptDiscover === 'function'
            ? chatgptDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshChatgptCatalog(session, { fetchFn })));
        this.clineDiscover = typeof clineDiscover === 'function'
            ? clineDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshClineCatalog(session, { fetchFn })));
        this.clineAutoImport = clineAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.clineAutoImportTried = false;
        // The Command Code CLI's auth.json is its only credential store — harvest
        // it once like cursor's IDE import, so an installed CLI means instant login.
        this.commandCodeDiscover = typeof commandCodeDiscover === 'function'
            ? commandCodeDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshCommandCodeCatalog(session, { fetchFn })));
        this.commandCodeAutoImport = commandCodeAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.commandCodeImport = commandCodeImport && typeof commandCodeImport === 'object' ? commandCodeImport : {};
        this.commandCodeAutoImportTried = false;
        this.workbuddyAutoImport = workbuddyAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.workbuddyAutoImportTried = false;
        this.workbuddyDiscover = typeof workbuddyDiscover === 'function'
            ? workbuddyDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((site, session, { fetchFn } = {}) => refreshWorkbuddyCatalog(site, session, { fetchFn })));
        // Kimi Work's only credential is the desktop file; the auto-import harvests
        // it once like workbuddy's, and the discover hook refreshes the live catalog.
        this.kimiWorkAutoImport = kimiWorkAutoImport ?? !process.env.NODE_TEST_CONTEXT;
        this.kimiWorkAutoImportTried = false;
        this.kimiWorkDiscover = typeof kimiWorkDiscover === 'function'
            ? kimiWorkDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshKimiWorkCatalog(session, { fetchFn })));
        // Open Design has no local credential to harvest; the discover hook only
        // refreshes the live catalog for a signed-in account.
        this.opendesignDiscover = typeof opendesignDiscover === 'function'
            ? opendesignDiscover
            : (process.env.NODE_TEST_CONTEXT ? undefined : ((session) => refreshOpendesignCatalog(session, { fetchFn })));
        configureKimiIdentity(typeof authPath === 'string' ? dirname(authPath) : undefined);
        this.lastError = new Map();
        this.finalizing = new Set();
        this.claims = new Map();
        this.tokens = buildTokenManagers({
            authPath: this.authPath,
            fetchFn,
            cursorImport: this.cursorImport,
            // Resolves this.onAuthChanged at fire time, like the inline closures did.
            onAuthChanged: (provider) => this.onAuthChanged?.(provider),
        });
        this.quota = new QuotaStore({
            tokens: this.tokens,
            fetchFn,
            ttlMs: quotaTtlMs,
            snapshotPath: typeof authPath === 'string' && authPath ? join(dirname(authPath), 'quota-snapshot.json') : undefined,
        });
        this.fetchFn = fetchFn;
        this.opencodeGo = (typeof authPath === 'string' && authPath)
            ? new OpencodeGoStore({ path: opencodeGoFilePath(authPath), fetchFn })
            : undefined;
        this.opencodeGoAdopted = false;
    }
    claim(provider) {
        const next = (this.claims.get(provider) ?? 0) + 1;
        this.claims.set(provider, next);
        return next;
    }
    /**
     * Grandfather every family already signed in when this plugin instance
     * started. The login default (a family that signs in starts with every row
     * off) must only hit logins that happen while this code runs, so an upgrade
     * never turns an existing install's models off.
     */
    async #seedSeenLogins() {
        let families;
        try {
            const store = await loadStore(this.authPath);
            families = PROVIDER_IDS.filter((family) => asVault(family, store[family]).activeId !== undefined);
        }
        catch {
            // An unreadable store cannot say what was signed in; seed nothing rather
            // than guess (a broken store fails loggedIn() on this same sync anyway).
            return;
        }
        await this.models.seedSeenLogins(families);
    }
    async loggedIn() {
        // Driven by PROVIDER_IDS (same order the hand-written literal kept) so a
        // new family cannot be missed; sequential awaits like the literal had.
        const out = {};
        for (const family of PROVIDER_IDS) {
            out[family] = (await getSession(family, this.authPath)) !== undefined;
        }
        return out;
    }
    async status(provider) {
        const session = await getSession(provider, this.authPath);
        const detail = this.lastError.get(provider);
        const pub = publicSession(provider, session);
        const activeId = session ? accountIdOf(provider, session) : undefined;
        return {
            loggedIn: session !== undefined,
            busy: this.flows.isBusy(provider) || this.devices.isBusy(provider) || this.glmFlows.isBusy(provider) || this.kiroFlows.isBusy(provider) || this.cursorFlows.isBusy(provider) || this.workbuddyFlows.isBusy(provider) || this.mimoFlows.isBusy(provider) || this.opendesignFlows.isBusy(provider) || this.finalizing.has(provider),
            ...pub,
            quota: this.quota.peek(provider, activeId),
            ...(detail === undefined ? {} : { detail }),
        };
    }
    async #glmModels() {
        void (await getSession('glm', this.authPath));
        return GLM_MODELS;
    }
    /**
     * The one model-list bag every llm-pi-ai projection consumes — catalog(),
     * #buildSnapshot's catalogProviders and buildProviders — straight off the
     * family registry (familyCatalogInputs), so no family can be missed at one
     * site. GLM's rows stay the explicit async seat: resolved behind the glm
     * session read above, never read synchronously from the registry.
     */
    async #catalogInputs() {
        return familyCatalogInputs({ glmModels: await this.#glmModels() });
    }
    async catalog() {
        // Un-overridden build: describeCatalog applies `contexts` itself so rows
        // keep their catalog default and ceiling next to the effective window,
        // and setContext can cap edits at the row's own maximum.
        return catalogProviders({
            prefix: this.prefix,
            origin: this.origin(),
            ...await this.#catalogInputs(),
        });
    }
    /**
     * Refresh only saved logins / keys, outside the chat request path. Concurrent
     * startup, login and timer calls share one run; each catalog retains its TTL.
     */
    async warmCatalogs() {
        if (this.#catalogRun)
            return this.#catalogRun;
        const run = this.#warmCatalogs().finally(() => {
            if (this.#catalogRun === run)
                this.#catalogRun = undefined;
        });
        this.#catalogRun = run;
        return run;
    }
    async #warmCatalogs() {
        await this.loginsReady;
        if (this.#disposed)
            return;
        if (typeof this.authPath !== 'string' || !this.authPath)
            return;
        const configured = await this.loggedIn();
        const families = [...OAUTH_FAMILIES.values()].filter((family) => family.quota?.discover && family.catalogModels);
        const before = await this.catalog();
        await Promise.allSettled([...families.map(async (family) => {
            if (!configured[family.id])
                return;
            const tokens = this.tokens[family.id];
            if (!tokens)
                return;
            let session;
            try {
                session = await tokens.session(undefined);
            }
            catch {
                return; // not signed in
            }
            await family.quota.discover.run(this, session);
        }), this.#refreshOpencodeCatalog()]);
        const catalog = await this.catalog();
        if (this.#disposed)
            return;
        await this.models.rememberDiscovered({}, catalog);
        const changed = Object.keys(catalog).some((id) => catalogRouteSignature(catalog[id].models) !== catalogRouteSignature(before[id]?.models));
        if (changed && this.settings)
            await this.sync(undefined, { recover: false }).catch(() => undefined);
    }
    startCatalogWatch({ intervalMs = MODEL_DISCOVERY_TTL_MS } = {}) {
        if (this.catalogWatchTimer)
            return;
        this.catalogWatchTimer = setInterval(() => void this.warmCatalogs().catch(() => undefined), intervalMs);
        this.catalogWatchTimer.unref?.();
    }
    stopCatalogWatch() {
        if (!this.catalogWatchTimer)
            return;
        clearInterval(this.catalogWatchTimer);
        this.catalogWatchTimer = undefined;
    }
    /**
     * RPC payload for the Settings page. The Settings half is a classic script
     * that reads this as plain JSON. Leaving the return type to inference made
     * the emitted `snapshot` / `switchAccount` / `setModels` declarations ~25k
     * lines each (they all return this method), roughly doubling the published
     * `lib/`. The callers are untyped on purpose — do not "restore" the inferred
     * type without re-checking `lib/` size.
     */
    snapshot(fresh = false, opts = {}) {
        // Concurrent polls share one build; cleared on settle so a failure never
        // pins. A post-mutation caller passes `fresh` so it never joins a build
        // that started before its write — later polls join the fresh one.
        // `revalidateQuota` is sticky on purpose: the page sends it when the user
        // (re)enters the quota view, and if a build is already running the flag
        // survives until the next build picks it up — at most one poll later.
        if (opts.revalidateQuota)
            this.#revalidateQuotaNext = true;
        if (fresh || !this.#snapshotRun) {
            const run = this.#buildSnapshot().finally(() => {
                if (this.#snapshotRun === run)
                    this.#snapshotRun = undefined;
            });
            this.#snapshotRun = run;
        }
        return this.#snapshotRun;
    }
    async #buildSnapshot() {
        const revalidateQuota = this.#revalidateQuotaNext;
        this.#revalidateQuotaNext = false;
        await this.models.ready;
        await this.prefsReady;
        await this.#refreshOpencodeCatalog();
        await resolveGlmIdentities(this);
        await upgradeGlmLegacyBearers(this);
        await maybeAutoImportCursor(this);
        await resolveCursorIdentities(this);
        await maybeAutoImportOllama(this);
        await maybeAutoImportKimi(this);
        await maybeAutoImportDevin(this);
        await maybeAutoImportCline(this);
        await maybeAutoImportCommandCode(this);
        await maybeAutoImportWorkbuddy(this);
        await maybeAutoImportKimiWork(this);
        const loggedIn = await this.loggedIn();
        const origin = this.origin();
        const opencodeGoApiKeySet = await hasOpencodeGoKey(this);
        const catalogInputs = await this.#catalogInputs();
        const catalog = catalogProviders({
            prefix: this.prefix,
            origin,
            ...catalogInputs,
        });
        await this.loginsReady;
        await this.models.rememberDiscovered({}, catalog);
        const selected = this.models.selectedForSync(catalog);
        const providers = filterProviders(buildProviders({
            prefix: this.prefix,
            origin,
            loggedIn,
            contexts: this.models.contexts,
            ...catalogInputs,
        }), selected);
        // Every family at once: the cold read is the slowest upstream, not the sum.
        await Promise.all(PROVIDER_IDS.map((family) => (loggedIn[family] ? ensureAccountQuota(this, family, revalidateQuota) : this.quota.clear(family))));
        const enabledKeys = this.models.enabledKeys(catalog);
        const opencodeGo = await this.opencodeGoSnapshot();
        // Account rows per OAuth family, in PROVIDER_IDS order.
        const familyAccounts = await Promise.all(PROVIDER_IDS.map((family) => accountsWithQuota(this, family)));
        // Same shape the hand-written literal produced: one status read per family
        // (sequential, in PROVIDER_IDS order) so a new family cannot be missed;
        // opencode-go is an apikey family outside PROVIDER_IDS and stays explicit.
        const accounts = {};
        for (let index = 0; index < PROVIDER_IDS.length; index++) {
            const family = PROVIDER_IDS[index];
            const rows = familyAccounts[index];
            accounts[family] = { ...(await this.status(family)), activeId: rows.find((row) => row.active)?.id, accounts: rows };
        }
        accounts['opencode-go'] = opencodeGo;
        return {
            origin,
            profile: this.profile,
            grokLogin: this.grokLogin,
            catalog: describeCatalog(catalog, {
                enabledKeys,
                awaitingPick: this.models.awaitingPick,
                contexts: this.models.contexts,
                rates: Object.fromEntries([
                    ...kiroCatalogModels().filter((model) => model.rate).map((model) => [`kiro/${model.id}`, model.rate]),
                    ...opendesignCatalogModels().filter((model) => model.rate).map((model) => [`opendesign/${model.id}`, model.rate]),
                ]),
                pricing: catalogPricing(),
                // WorkBuddy's live rows carry their own credits multiple (the static
                // floor is only a fallback); other families have none at all.
                credits: {
                    ...catalogCredits(),
                    ...creditsOfRows('workbuddy', catalogInputs.workbuddyModels),
                    ...creditsOfRows('workbuddy-ai', catalogInputs.workbuddyAiModels),
                },
                pricingTimeOfDay: catalogRateTimeOfDay(),
                loggedIn: {
                    ...loggedIn,
                    ...Object.fromEntries(APIKEY_FAMILY_IDS.map((family) => [family, opencodeGoApiKeySet])),
                },
            }),
            providers: describeProviders(providers),
            selected: enabledKeys,
            efforts: { ...this.models.efforts },
            accounts,
            opencodeGo,
            update: localUpdateInfo(process.platform, {
                profile: this.profile,
                env: this.updateEnv ?? process.env,
                readFileFn: this.readFileFn,
            }),
            autoUpdate: this.autoUpdate === true,
            autoUpdateState: this.updateState,
            // Upstream-engine pilot (kimi-work): present once an engine initialized;
            // absent otherwise so nothing renders for non-pilot users.
            upstreamEngines: this.engineState,
        };
    }
    opencodeGoSnapshot(options) {
        return opencodeGoSnapshot(this, options);
    }
    /** Zen counts as in use only when a Zen wallet row exists (mirrors the UI gate). */
    async #zenInUse() {
        return opencodeZenInUse(await this.opencodeGoSnapshot().catch(() => undefined));
    }
    /**
     * Refresh the OpenCode Go picker from the account's own /models list. The
     * live store keeps a 10-minute TTL, so the common call is a cache hit; a
     * failure leaves the curated rows in place.
     */
    async #refreshOpencodeCatalog() {
        const store = this.opencodeGo;
        const id = store?.keyedId?.();
        const key = id ? store.keyOf(id) : undefined;
        if (typeof key !== 'string' || !key)
            return;
        await refreshOpencodeGoCatalog({ accessToken: key }, { fetchFn: this.fetchFn }).catch(() => undefined);
    }
    saveOpencodeGo(payload) {
        return saveOpencodeGo(this, payload);
    }
    switchOpencodeGo(id) {
        return switchOpencodeGo(this, id);
    }
    logoutOpencodeGo(id) {
        return logoutOpencodeGo(this, id);
    }
    clearOpencodeGo(field, id) {
        return clearOpencodeGo(this, field, id);
    }
    refreshOpencodeGoQuota(id) {
        return refreshOpencodeGoQuota(this, id);
    }
    refreshQuota(provider, accountId) {
        return refreshQuota(this, provider, accountId);
    }
    consumeReset(provider, accountId, creditId) {
        return consumeReset(this, provider, accountId, creditId);
    }
    checkUpdate(payload) {
        return checkUpdate(this, payload);
    }
    changelog() {
        return fetchChangelog(this);
    }
    setAutoUpdate(payload) {
        return setAutoUpdate(this, payload);
    }
    runAutoUpdate() {
        return runAutoUpdate(this);
    }
    startAutoUpdateWatch(options) {
        return startAutoUpdateWatch(this, options);
    }
    stopAutoUpdateWatch() {
        return stopAutoUpdateWatch(this);
    }
    /** Upstream-engine pilot: the pinned versions + the watcher's last pass (RPC `engineStatus`). */
    async engineStatus() {
        const paths = this.enginePaths;
        if (!paths)
            return { engines: {}, state: undefined };
        const manifest = await readEngineManifest(paths.manifest).catch(() => undefined);
        let state = this.engineState;
        if (!state) {
            const text = await readFile(paths.state, 'utf8').catch(() => undefined);
            try {
                state = text ? JSON.parse(text) : undefined;
            }
            catch {
                state = undefined;
            }
        }
        return { engines: manifest?.engines ?? {}, state };
    }
    runEngineWatch(options) {
        return runEngineWatch(this, options);
    }
    startEngineWatch(options) {
        return startEngineWatch(this, options);
    }
    stopEngineWatch() {
        return stopEngineWatch(this);
    }
    /**
     * Background credential sweep — CLIProxyAPI's authAutoRefreshLoop shape.
     * TokenManager refreshes lazily on request; without a sweep the first call
     * after an idle stretch pays the refresh RTT, and a refresh token that died
     * while idle only surfaces mid-request. Each family's own preemptMs decides
     * whether a stored login is due, so the sweep stays provider-agnostic.
     */
    startTokenSweep({ intervalMs = TOKEN_SWEEP_INTERVAL_MS } = {}) {
        if (this.tokenSweepTimer)
            return;
        void this.sweepTokensOnce();
        this.tokenSweepTimer = setInterval(() => void this.sweepTokensOnce(), intervalMs);
        this.tokenSweepTimer.unref?.();
    }
    stopTokenSweep() {
        if (!this.tokenSweepTimer)
            return;
        clearInterval(this.tokenSweepTimer);
        this.tokenSweepTimer = undefined;
    }
    async sweepTokensOnce() {
        for (const provider of PROVIDER_IDS) {
            const manager = this.tokens[provider];
            if (!manager)
                continue;
            let rows;
            try {
                rows = await listStoredSessions(provider, this.authPath);
            }
            catch {
                continue;
            }
            for (const row of rows) {
                if (!row)
                    continue;
                // account() refreshes only inside the family's preempt window; a
                // transient failure serves the still-valid token instead of throwing.
                await manager.account(row.id).catch(() => undefined);
            }
        }
    }
    login(provider, options) {
        return login(this, provider, options);
    }
    completePkce(provider, attempt, claim) {
        return completePkce(this, provider, attempt, claim);
    }
    completeKimiDevice(attempt) {
        return completeKimiDevice(this, attempt);
    }
    completeClineDevice(attempt) {
        return completeClineDevice(this, attempt);
    }
    completeOpendesignDevice(attempt) {
        return completeOpendesignDevice(this, attempt);
    }
    completeDevice(provider, attempt) {
        return completeDevice(this, provider, attempt);
    }
    completeGlm(attempt) {
        return completeGlm(this, attempt);
    }
    completeCursor(attempt) {
        return completeCursor(this, attempt);
    }
    completeKiroIdc(attempt) {
        return completeKiroIdc(this, attempt);
    }
    completeCommandCode(attempt, claim) {
        return completeCommandCode(this, attempt, claim);
    }
    useKey(provider, key, extra) {
        return useKey(this, provider, key, extra);
    }
    async manual(provider, input) {
        const attempt = this.flows.pending(provider);
        if (attempt === undefined)
            throw new Error(`no ${provider} login attempt is in progress`);
        attempt.manual(input);
    }
    async cancel(provider) {
        this.claim(provider);
        this.flows.pending(provider)?.cancel();
        this.devices.pending(provider)?.cancel();
        this.glmFlows.pending(provider)?.cancel();
        this.kiroFlows.pending(provider)?.cancel();
        this.cursorFlows.pending(provider)?.cancel();
        this.workbuddyFlows.pending(provider)?.cancel();
        this.mimoFlows.pending(provider)?.cancel();
        this.opendesignFlows.pending(provider)?.cancel();
        cancelAutoclawLogin(provider);
        if (provider === 'zed')
            cancelZedLogin();
    }
    async logout(provider, id) {
        if (provider === 'opencode-go')
            return this.logoutOpencodeGo(id);
        this.claim(provider);
        this.flows.pending(provider)?.cancel();
        this.devices.pending(provider)?.cancel();
        this.glmFlows.pending(provider)?.cancel();
        this.kiroFlows.pending(provider)?.cancel();
        this.cursorFlows.pending(provider)?.cancel();
        this.workbuddyFlows.pending(provider)?.cancel();
        this.mimoFlows.pending(provider)?.cancel();
        this.opendesignFlows.pending(provider)?.cancel();
        cancelAutoclawLogin(provider);
        if (provider === 'zed')
            cancelZedLogin();
        // Sign in with ChatGPT: end the renewable session remotely first (siwc
        // profiles-and-sessions); an unconfirmed revocation still signs out.
        const revoked = provider === 'chatgpt' ? await revokeChatgptAccounts(this, id) : true;
        await deleteSession(provider, this.authPath, id);
        // "Signed out" gates auto-import from local CLI/IDE logins, so it means the
        // family is EMPTY — leaving one of two accounts must not mark the family.
        // (store.saveSession clears the mark again when any login lands.)
        if ((await listStoredSessions(provider, this.authPath)).length === 0)
            await markSignedOut(this, provider);
        this.lastError.delete(provider);
        if (!revoked) {
            this.lastError.set(provider, 'Signed out locally. Remote revocation could not be confirmed; disconnect the app in ChatGPT Settings → Apps.');
        }
        this.quota.clear(provider, id);
        // The cached reading is mirrored to quota-snapshot.json behind a 2s
        // debounce; a reload right after logout would otherwise restore this
        // account's plan and numbers from disk.
        await this.quota.flush();
        this.onAuthChanged?.(provider);
        if (await getSession(provider, this.authPath))
            void ensureAccountQuota(this, provider);
    }
    async switchAccount(provider, id) {
        if (provider === 'opencode-go') {
            await this.switchOpencodeGo(id);
            return this.snapshot(true);
        }
        await switchAccount(provider, id, this.authPath);
        this.lastError.delete(provider);
        this.onAuthChanged?.(provider);
        return this.snapshot(true);
    }
    importFrom(provider) {
        return importFrom(this, provider);
    }
    async setModels(payload = {}) {
        await this.models.ready;
        const catalog = await this.catalog();
        if (Array.isArray(payload.selected)) {
            await this.models.setEnabled(payload.selected, catalog);
        }
        else if (payload.resetContexts === true) {
            // 恢复默认窗口: drop every custom input-context override at once.
            await this.models.resetContexts();
        }
        else if (typeof payload.contextKey === 'string') {
            // Custom input-context window (null resets to the catalog default);
            // not an enable choice, so selectionExplicit stays as it was.
            await this.models.setContext(payload.contextKey, payload.context ?? null, catalog);
        }
        else if (typeof payload.key === 'string') {
            await this.models.toggle(payload.key, payload.on !== false, catalog);
        }
        else if (MODEL_FAMILY_IDS.includes(payload.family)) {
            await this.models.setFamily(payload.family, payload.on !== false, catalog);
        }
        else if (typeof payload.all === 'boolean') {
            await this.models.setAll(payload.all, catalog);
        }
        else if ('effort' in payload) {
            // Default effort for `families` (null clears); no families = every family (全部).
            await this.models.setEffort(payload.effort, payload.families ?? undefined);
        }
        else {
            throw new Error('models payload needs selected, key, family, all, or effort');
        }
        // A context override on a disabled row only persists to models.json —
        // filterProviders drops it from the route write, so syncing would
        // produce a byte-identical settings file while paying a seconds-long
        // host reconcile. The override lands the next time the row is enabled.
        const dormantContextEdit = typeof payload.contextKey === 'string'
            && !this.models.isEnabled(payload.contextKey);
        if (!dormantContextEdit && this.settings && typeof this.settings.mutate === 'function') {
            // Picker already wrote the switch; do not re-enable a deliberate 全关.
            // Mutate failures must reach the RPC so the picker can show them.
            await this.sync(undefined, { recover: false });
        }
        return this.snapshot(true);
    }
    // Startup, onAuthChanged, and the RPC can all call sync() concurrently;
    // queue the whole body (same shape as installQueue in utils/update.ts) so
    // their settings mutates and compaction read-modify-writes never interleave.
    // Each queued call still runs its own full sync; the swallowed catch keeps
    // one rejection from poisoning the queue.
    async sync(selected, options = {}) {
        if (this.#disposed)
            return;
        const pending = this.#syncQueue.then(() => this.#performSync(selected, options));
        this.#syncQueue = pending.then(() => undefined, () => undefined);
        return pending;
    }
    async #performSync(selected, options = {}) {
        if (this.#disposed)
            return;
        if (this.settings === undefined || typeof this.settings.mutate !== 'function') {
            throw new Error('settings service is not mounted; cannot sync llm-pi-ai routes');
        }
        await this.models.ready;
        await this.loginsReady;
        await this.#refreshOpencodeCatalog();
        const catalog = await this.catalog();
        await this.models.rememberDiscovered({}, catalog);
        if (selected !== undefined) {
            await this.models.setEnabled(selected, catalog);
        }
        const loggedIn = await this.loggedIn();
        if (selected === undefined) {
            // 登录默认: a family that signs in while this runs keeps every row off
            // until the user picks for it (families signed in at startup are seeded,
            // so an upgrade never turns an existing install's models off).
            await this.models.applyLoginDefaults(catalog, loggedIn);
            if (options.recover !== false) {
                await this.models.recoverEmptyLoggedInFamilies(catalog, loggedIn);
            }
        }
        const opencodeGoKeySet = await hasOpencodeGoKey(this);
        // Planned only: its writes ride the family-route mutate below, so one sync
        // costs the host one llm-pi-ai reconcile (a few seconds), not two.
        const { mutations: opencodeGoMutations = [], ...opencodeGoRoute } = await ensureOpencodeGoRoute(this.settings, {
            selected: this.models.selectedForSync(catalog),
            apiKeySet: opencodeGoKeySet,
            contexts: this.models.contexts,
            efforts: this.models.efforts,
            apply: false,
        });
        if (opencodeGoKeySet && opencodeGoRoute.status !== 'pending' && opencodeGoRoute.status !== 'present') {
            throw new Error(`OpenCode Go model sync failed: ${opencodeGoRoute.status}`);
        }
        // OpenCode Zen rides the same credential/vault/account as Go; its three
        // routes are planned here and land in the one mutate below.
        // Zen's three routes exist only once a Zen wallet read proves the product
        // is in use: the Models page hides the Zen entry without one, so syncing
        // its catalog would put models in DSH that the user never picked and has
        // no switch to turn off.
        const zenSelected = (await this.#zenInUse()) ? this.models.selectedForSync(catalog) : [];
        const { mutations: opencodeZenMutations = [], ...opencodeZenRoute } = await ensureOpencodeZenRoute(this.settings, {
            selected: zenSelected,
            apiKeySet: opencodeGoKeySet,
            contexts: this.models.contexts,
            efforts: this.models.efforts,
            apply: false,
        });
        if (opencodeGoKeySet && opencodeZenRoute.status !== 'pending' && opencodeZenRoute.status !== 'present') {
            throw new Error(`OpenCode Zen model sync failed: ${opencodeZenRoute.status}`);
        }
        if (this.#disposed)
            return;
        const synced = await syncHarnessModels({
            settings: this.settings,
            patchPath: this.patchPath,
            prefix: this.prefix,
            origin: this.origin(),
            loggedIn,
            selected: this.models.selectedForSync(catalog),
            // Every other family's rows are read from the registry inside
            // syncHarnessModels; glmModels is its one caller-resolved (async) seat.
            glmModels: await this.#glmModels(),
            contexts: this.models.contexts,
            efforts: this.models.efforts,
            extraMutations: [...opencodeGoMutations, ...opencodeZenMutations],
        });
        return {
            ...synced,
            opencodeGoRoute: opencodeGoMutations.length ? { ...opencodeGoRoute, status: 'written' } : opencodeGoRoute,
            opencodeZenRoute: opencodeZenMutations.length ? { ...opencodeZenRoute, status: 'written' } : opencodeZenRoute,
        };
    }
    /** Drain queued writes before withdrawing routes; a replacement instance wins on reload. */
    dispose() {
        if (this.#disposeRun)
            return this.#disposeRun;
        this.#disposed = true;
        this.stopCatalogWatch();
        this.stopTokenSweep();
        this.#disposeRun = (async () => {
            await this.loginsReady.catch(() => undefined);
            await this.#catalogRun?.catch(() => undefined);
            await this.#syncQueue;
            const isCurrent = () => routeOwners.get(this.routeOwnerKey) === this.#owner;
            if (!isCurrent())
                return [];
            let origin;
            try { origin = this.origin(); }
            catch { return []; } // The proxy never started, so no routes were written.
            try {
                return await removeHarnessModels({ settings: this.settings, prefix: this.prefix, origin, isCurrent });
            }
            finally {
                if (isCurrent())
                    routeOwners.delete(this.routeOwnerKey);
            }
        })();
        return this.#disposeRun;
    }
}
