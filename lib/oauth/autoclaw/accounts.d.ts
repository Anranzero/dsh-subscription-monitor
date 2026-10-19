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
import type { AuthController } from '../controller.js';
/**
 * The family's attempt registry (one slot per provider id — the shape
 * `workbuddyFlows` has in the controller, but the state stays family-owned:
 * shared cancel/logout wiring only references it).
 */
export declare const autoclawFlows: {
    isBusy(provider: any): boolean;
    pending(provider: any): any;
    begin: (provider: any) => {
        signal: AbortSignal;
        settle: (error: any, value?: any) => void;
        abandon(): void;
        owns(attempt: any): boolean;
        publish(fields: any): any;
    };
};
/** 取消一个进行中的本地登录（controller.cancel/logout 的家族接线调到这里）。 */
export declare function cancelAutoclawLogin(provider: string): void;
/**
 * Start the international browser login: reserve the attempt slot, let the
 * engine bring its local server up, then hand the guide URL back at once —
 * the engine's settle lands on the slot first, and the save/discover
 * completion awaits the slot's token promise (workbuddy shape), so a cancel
 * stops the save even if the browser page finishes afterwards.
 */
export declare function loginAutoclaw(ctl: AuthController, payload?: any): Promise<{
    authorizeUrl: string;
    mode: "browser";
}>;
/**
 * The login's save-and-finish half: the slot's token promise gates the save —
 * a cancelled attempt rejects with 'login cancelled' before saveSession runs.
 */
export declare function completeAutoclawBrowser(ctl: AuthController, attempt: any): Promise<void>;
/**
 * CN 登录分两步（引擎 method 的 prompts + `method: "code"` 落在两 RPC 上）：
 * - `login('autoclaw-cn', { phone })` → 引擎 authorize 发码，返回
 *   `{ mode: 'code-sent', message }`（挂起态 10 分钟内有效，engine.ts）；
 * - `login('autoclaw-cn', { phone, code })` → 引擎 callback 兑换（数字验证码
 *   按数字发），拉 user-profile 取昵称/手机号落 vault。
 */
export declare function loginAutoclawCn(ctl: AuthController, payload?: any): Promise<{
    mode: "code-sent";
    message: string;
    account?: undefined;
} | {
    account: Record<string, unknown> | undefined;
    mode?: undefined;
    message?: undefined;
}>;
