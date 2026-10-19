/**
 * AutoClaw account lifecycle for AuthController: the international build's
 * local-OAuth browser login (port pool → slider → authorize → state-checked
 * callback → token exchange), the CN build's phone-SMS two-step login, and
 * the family-owned attempt registry (`autoclawFlows` — the state lives here,
 * family-scoped; controller.cancel/logout reach it through
 * cancelAutoclawLogin, the registry wiring in families/controller/proxy/store
 * is landed).
 *
 * No local import: neither build has a CLI/IDE credential store to read
 * (upstream has none either); the magpie/OpenCode host files are their own
 * stores of this plugin's sessions, not an AutoClaw desktop source.
 *
 * Attribution: the flows are magpie 0.2.1 startLocalOAuth + phoneSmsMethod
 * (index.mjs:744-793, 799-1049); the SMS step split (send, then code) matches
 * magpie's prompts + `method: "code"`, with the pending phone kept here
 * between the two RPC calls (10 分钟内有效).
 */
import { createFlowAttempts } from '../flow.js';
import { listStoredSessions, publicSession, saveSession } from '../store.js';
import { notifyCatalogDiscovery } from '../catalog-sync.js';
import { autoclawEngineAuthorizeBrowser, autoclawEngineAuthorizeSms, } from './engine.js';
/**
 * The family's attempt registry (one slot per provider id — the shape
 * `workbuddyFlows` has in the controller, but the state stays family-owned:
 * shared cancel/logout wiring only references it).
 */
export const autoclawFlows = createFlowAttempts();
/** 取消一个进行中的本地登录（controller.cancel/logout 的家族接线调到这里）。 */
export function cancelAutoclawLogin(provider) {
    autoclawFlows.pending(provider)?.cancel();
}
// ---- 国际版：引擎本地网页 OAuth -----------------------------------------------
/**
 * Start the international browser login: reserve the attempt slot, let the
 * engine bring its local server up, then hand the guide URL back at once —
 * the engine's settle lands on the slot first, and the save/discover
 * completion awaits the slot's token promise (workbuddy shape), so a cancel
 * stops the save even if the browser page finishes afterwards.
 */
export async function loginAutoclaw(ctl, payload = {}) {
    const vendor = payload?.vendor === 'zai' ? 'zai' : 'google';
    const slot = autoclawFlows.begin('autoclaw');
    let engine;
    try {
        engine = await autoclawEngineAuthorizeBrowser({ vendor, fetchFn: ctl.fetchFn });
    }
    catch (error) {
        slot.abandon();
        throw error;
    }
    const attempt = slot.publish({ authorizeUrl: engine.authorizeUrl, mode: 'browser' });
    void engine.settle().then((session) => slot.settle(undefined, session), (error) => slot.settle(error instanceof Error ? error : new Error(String(error))));
    ctl.finalizing.add('autoclaw');
    void completeAutoclawBrowser(ctl, attempt);
    return { authorizeUrl: attempt.authorizeUrl, mode: 'browser' };
}
/**
 * The login's save-and-finish half: the slot's token promise gates the save —
 * a cancelled attempt rejects with 'login cancelled' before saveSession runs.
 */
export async function completeAutoclawBrowser(ctl, attempt) {
    try {
        const wasSignedIn = (await listStoredSessions('autoclaw', ctl.authPath)).length > 0;
        const session = await attempt.waitToken();
        await saveSession('autoclaw', session, ctl.authPath);
        ctl.lastError.delete('autoclaw');
        // 无活目录：只在首次登录（登录态翻转）时通知一次。
        await notifyCatalogDiscovery(ctl, 'autoclaw', { wasSignedIn, before: '', models: undefined });
        void ctl.quota.refresh('autoclaw');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== 'login cancelled')
            ctl.lastError.set('autoclaw', message);
    }
    finally {
        ctl.finalizing.delete('autoclaw');
    }
}
// ---- 国内版：引擎手机验证码两步 ------------------------------------------------
/**
 * CN 登录分两步（引擎 method 的 prompts + `method: "code"` 落在两 RPC 上）：
 * - `login('autoclaw-cn', { phone })` → 引擎 authorize 发码，返回
 *   `{ mode: 'code-sent', message }`（挂起态 10 分钟内有效，engine.ts）；
 * - `login('autoclaw-cn', { phone, code })` → 引擎 callback 兑换（数字验证码
 *   按数字发），拉 user-profile 取昵称/手机号落 vault。
 */
export async function loginAutoclawCn(ctl, payload = {}) {
    const outcome = await autoclawEngineAuthorizeSms({ phone: payload?.phone, code: payload?.code, fetchFn: ctl.fetchFn });
    if (outcome.mode === 'code-sent') {
        return { mode: outcome.mode, message: outcome.message };
    }
    const wasSignedIn = (await listStoredSessions('autoclaw-cn', ctl.authPath)).length > 0;
    await saveSession('autoclaw-cn', outcome, ctl.authPath);
    ctl.lastError.delete('autoclaw-cn');
    await notifyCatalogDiscovery(ctl, 'autoclaw-cn', { wasSignedIn, before: '', models: undefined });
    void ctl.quota.refresh('autoclaw-cn');
    return { account: publicSession('autoclaw-cn', outcome) };
}
