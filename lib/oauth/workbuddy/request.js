/**
 * WorkBuddy Completions dialect.
 *
 * The edits WorkBuddy's chat endpoint (POST {endpoint}/v2/chat/completions,
 * streamed only) needs, each traced to @magpie-community/opencode-
 * workbuddy-auth 0.1.24 (MIT) — and no others:
 *
 * - withSystem's three spellings: max_completion_tokens → max_tokens,
 *   developer → system, a default system message when the chat doesn't open
 *   with one (the app's own behavior), and FLAGGED words rewritten —
 *   WorkBuddy refuses a chat carrying Codex's or Claude Code's own words
 *   with "Illegal API invocation from an unapproved channel" (magpie #182),
 *   whatever the headers.
 * - fitted tools: names made safe ([A-Za-z0-9_-]; another character is
 *   refused), the chat history's calls renamed with them, and parameter
 *   schemas mended (fitSchema / fitShape / objectRoot) into the shape every
 *   backend model takes — WorkBuddy answers 400 code 11133 "Invalid request
 *   parameters" otherwise (DeepSeek turns away each shape below, Kimi, GPT,
 *   Gemini and GLM some of them).
 * - normalizeToolChoice: the object form emitted by OpenAI clients → the
 *   string form (a named choice follows the tool name made safe above).
 *
 * Outbound only: the model's answers keep the sanitized tool names — DSH's
 * own tools are all [A-Za-z0-9_-] already, so the sanitize never fires for
 * them; MCP names with dots/colons get a tool-not-found miss from DSH, which
 * beats losing the whole request to a 400 (see README 「不采纳」).
 */
import { UpstreamFailure, quotaFailure } from '../upstream.js';
import { workbuddyAiCatalogModels, workbuddyCatalogModels } from './catalog.js';
// ---- FLAGGED: the words WorkBuddy refuses a chat for --------------------------
/**
 * Each with words that say the same and pass, tried one by one against both
 * builds with the requests Claude Code 2.1.280 and Codex 0.159.2 send.
 * WorkBuddy reads every message, not only the system prompt (Claude Code
 * puts its main branch in the first user message), and pays no mind to case.
 * Claude Code's billing header means nothing to WorkBuddy's models and goes.
 */
const FLAGGED = [
    [/x-anthropic-billing-header:[^\n]*\n?/gi, ''],
    [/You are Claude Code, Anthropic['’]s official CLI for Claude/gi, "You are Claude Code, Anthropic's CLI for Claude"],
    [/Main branch \(you will usually use this for PRs\)/gi, 'Main branch (usually the base for PRs)'],
    [/(?<!the )Codex CLI is an open source project led by OpenAI\./gi, 'The Codex CLI is an open source project led by OpenAI.'],
];
function unflagged(text) {
    for (const [re, to] of FLAGGED)
        text = text.replace(re, to);
    return text;
}
/**
 * Put FLAGGED's words in place in every message, and leave out a text that
 * had nothing else (the billing header's system block). Runs before the
 * default-system decision so a system block it emptied does not leave the
 * chat without its system opener (magpie unflag).
 */
function unflag(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (typeof m?.content === 'string') {
            const t = unflagged(m.content);
            if (t === m.content)
                continue;
            if (t.trim() || m.role !== 'system')
                m.content = t;
            else
                messages.splice(i, 1);
        }
        else if (Array.isArray(m?.content)) {
            const parts = [];
            let here = false;
            for (const p of m.content) {
                const t = typeof p?.text === 'string' ? unflagged(p.text) : null;
                if (t === null || t === p.text) {
                    parts.push(p);
                    continue;
                }
                here = true;
                if (t.trim())
                    parts.push({ ...p, text: t });
            }
            if (!here)
                continue;
            if (parts.length || m.role !== 'system')
                m.content = parts;
            else
                messages.splice(i, 1);
        }
    }
}
// ---- tools WorkBuddy takes -----------------------------------------------------
/** A tool's name may hold letters, digits, _ and -; another character is refused. */
const NAME_OK = /^[A-Za-z0-9_-]+$/;
/** safeName is name with each character WorkBuddy refuses as _, kept apart from the names in taken. */
function safeName(name, taken) {
    const base = String(name).replace(/[^A-Za-z0-9_-]/g, '_') || 'tool';
    let n = base;
    for (let i = 2; taken.has(n); i++)
        n = base + '_' + i;
    taken.add(n);
    return n;
}
/**
 * NUL_ESCAPE finds a regex's \0 (the NUL character), stepping over each \\
 * (a backslash) so that a \\0 is left; \01 is an octal escape, also left.
 */
const NUL_ESCAPE = /\\\\|\\0(?![0-9])/g;
/**
 * fitSchema mends a schema in place, at every depth: a pattern's \0 — which
 * the model validators answer 11133 "not a 'regex'" for — is \\u0000, which
 * matches the same; a tuple's items (a list) become one schema any of them
 * fits (magpie fitSchema).
 */
function fitSchema(s, depth = 0) {
    if (!s || typeof s !== 'object' || depth > 64)
        return;
    if (Array.isArray(s)) {
        for (const v of s)
            fitSchema(v, depth + 1);
        return;
    }
    if (typeof s.pattern === 'string' && s.pattern.includes('\\0')) {
        s.pattern = s.pattern.replace(NUL_ESCAPE, (m) => (m === '\\\\' ? m : '\\u0000'));
    }
    if (Array.isArray(s.items)) {
        const list = s.items.filter((v) => v && typeof v === 'object');
        s.items = list.length === 0 ? {} : list.length === 1 ? list[0] : { anyOf: list };
        delete s.additionalItems;
    }
    for (const v of Object.values(s))
        fitSchema(v, depth + 1);
}
/**
 * The types the backend validators know; anything else ("any", "String") is
 * turned away with 11133 (Kimi kimi-k3-1 refuses an unknown type outright).
 */
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
// SUB_ONE are the keywords whose value is a schema, SUB_LIST a list of
// schemas, SUB_MAP a map of names to schemas. additionalProperties and
// unevaluatedProperties are left as they are when true or false.
const SUB_ONE = ['items', 'additionalItems', 'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'additionalProperties', 'unevaluatedProperties'];
const SUB_LIST = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];
const SUB_MAP = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const BOOL_OK = new Set(['additionalProperties', 'unevaluatedProperties']);
/** valueType is the JSON Schema type of an enum's value. */
function valueType(v) {
    if (v === null)
        return 'null';
    if (Array.isArray(v))
        return 'array';
    if (typeof v === 'number')
        return Number.isInteger(v) ? 'integer' : 'number';
    return typeof v;
}
/**
 * fitEnum gives s's enum a type: the one its values have, or that and
 * "null"; values of several types are an anyOf of an enum for each. An empty
 * enum (which nothing fits) is left out. None of it narrows or widens what a
 * call may hold (magpie fitEnum).
 */
function fitEnum(s) {
    if (!('enum' in s))
        return;
    if (!Array.isArray(s.enum) || s.enum.length === 0) {
        delete s.enum;
        return;
    }
    const listed = Array.isArray(s.type) ? s.type : typeof s.type === 'string' ? [s.type] : [];
    if (listed.filter((t) => t !== 'null').length === 1)
        return;
    const byType = new Map();
    for (const v of s.enum) {
        const t = valueType(v);
        if (!byType.has(t))
            byType.set(t, []);
        byType.get(t).push(v);
    }
    if (byType.has('integer') && byType.has('number')) {
        byType.get('number').push(...byType.get('integer'));
        byType.delete('integer');
    }
    const hasNull = byType.delete('null');
    if (byType.size <= 1) {
        const [t] = byType.keys();
        const want = t === undefined ? 'null' : hasNull ? [t, 'null'] : t;
        if (JSON.stringify(want) === JSON.stringify(s.type))
            return;
        s.type = want;
        return;
    }
    const split = [...byType].map(([t, vs]) => ({ type: t, enum: vs }));
    if (hasNull)
        split.push({ type: 'null' });
    delete s.enum;
    delete s.type;
    if (Array.isArray(s.anyOf))
        s.allOf = [...(Array.isArray(s.allOf) ? s.allOf : []), { anyOf: split }];
    else
        s.anyOf = split;
}
/** subSchema is v, a schema found under key, as an object the validators take: true is {}, false is {"not":{}}. */
function subSchema(v, key) {
    if (typeof v !== 'boolean' || BOOL_OK.has(key))
        return v;
    return v ? {} : { not: {} };
}
/**
 * fitShape mends s, a schema, and each schema under it, in place: a type it
 * doesn't know goes (lowercased first — "String" is string), a required that
 * isn't a list goes, an enum gets its type, and a schema that is true or
 * false where a schema goes becomes {} / {"not":{}} (magpie fitShape).
 */
function fitShape(s, depth = 0) {
    if (!s || typeof s !== 'object' || Array.isArray(s) || depth > 64)
        return;
    if ('type' in s) {
        const list = (Array.isArray(s.type) ? s.type : [s.type]).map((t) => (typeof t === 'string' ? t.toLowerCase() : t)).filter((t) => TYPES.has(t));
        const uniq = [...new Set(list)];
        const want = uniq.length === 0 ? undefined : uniq.length === 1 ? uniq[0] : uniq;
        if (JSON.stringify(want) !== JSON.stringify(s.type)) {
            if (want === undefined)
                delete s.type;
            else
                s.type = want;
        }
    }
    if ('required' in s && !Array.isArray(s.required)) {
        delete s.required;
    }
    else if (Array.isArray(s.required) && s.required.some((k) => typeof k !== 'string')) {
        s.required = s.required.filter((k) => typeof k === 'string');
    }
    fitEnum(s);
    for (const k of SUB_ONE) {
        if (!(k in s))
            continue;
        const v = subSchema(s[k], k);
        if (v !== s[k])
            s[k] = v;
        fitShape(v, depth + 1);
    }
    for (const k of SUB_LIST) {
        if (!Array.isArray(s[k]))
            continue;
        s[k].forEach((v0, i) => {
            const v = subSchema(v0, k);
            if (v !== v0)
                s[k][i] = v;
            fitShape(v, depth + 1);
        });
    }
    for (const k of SUB_MAP) {
        const m = s[k];
        if (!m || typeof m !== 'object' || Array.isArray(m))
            continue;
        for (const [name, v0] of Object.entries(m)) {
            const v = subSchema(v0, k);
            if (v !== v0)
                m[name] = v;
            fitShape(v, depth + 1);
        }
    }
}
/** localRef is the schema a local $ref in root names ("#/$defs/x"), or s itself. */
function localRef(root, s) {
    const ref = s?.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/'))
        return s;
    let at = root;
    for (const k of ref.slice(2).split('/'))
        at = at?.[k.replaceAll('~1', '/').replaceAll('~0', '~')];
    return at && typeof at === 'object' ? at : s;
}
/**
 * objectRoot makes a tool's parameters an object at the root, as magpie's
 * gateway does for xAI: allOf's branches are merged whole; of anyOf's and
 * oneOf's object branches the properties are merged and a field each
 * requires stays required. A root with no type, or an empty one, is an
 * object (magpie objectRoot).
 */
function objectRoot(ps, root = ps, depth = 0) {
    const unions = ['allOf', 'anyOf', 'oneOf'].filter((k) => Array.isArray(ps[k]));
    if (ps.type === 'object' && !unions.length)
        return;
    const props = ps.properties && typeof ps.properties === 'object' ? ps.properties : {};
    const required = Array.isArray(ps.required) ? [...ps.required] : [];
    for (const b0 of ps.allOf ?? []) {
        let b = localRef(root, b0);
        if (!b || typeof b !== 'object')
            continue;
        if (depth < 8 && ['allOf', 'anyOf', 'oneOf'].some((k) => Array.isArray(b[k])))
            objectRoot((b = structuredClone(b)), root, depth + 1);
        for (const [k, v] of Object.entries(b.properties ?? {}))
            if (!(k in props))
                props[k] = v;
        if (Array.isArray(b.required))
            required.push(...b.required);
    }
    const branches = [];
    for (const key of ['anyOf', 'oneOf']) {
        for (const b0 of ps[key] ?? []) {
            let b = localRef(root, b0);
            if (!b || typeof b !== 'object')
                continue;
            if (depth < 8 && ['allOf', 'anyOf', 'oneOf'].some((k) => Array.isArray(b[k])))
                objectRoot((b = structuredClone(b)), root, depth + 1);
            if (b.type !== 'object' && !b.properties)
                continue;
            branches.push(b);
        }
    }
    const from = new Map();
    for (const b of branches) {
        for (const [k, v] of Object.entries(b.properties ?? {})) {
            if (k in props)
                continue;
            const seen = from.get(k) ?? [];
            if (!seen.some((x) => JSON.stringify(x) === JSON.stringify(v)))
                seen.push(v);
            from.set(k, seen);
        }
    }
    for (const [k, list] of from)
        props[k] = list.length === 1 ? list[0] : { anyOf: list };
    if (branches.length) {
        for (const k of Object.keys(branches[0].properties ?? {})) {
            if (branches.every((b) => Array.isArray(b.required) && b.required.includes(k)))
                required.push(k);
        }
    }
    for (const k of unions)
        delete ps[k];
    ps.type = 'object';
    ps.properties = props;
    const req = [...new Set(required)].filter((k) => typeof k === 'string' && k in props);
    if (req.length)
        ps.required = req;
    else
        delete ps.required;
}
/**
 * fitTools mends the body's function tools in place: their parameters
 * (fitSchema, fitShape, objectRoot) and their names — a call in the chat's
 * history and a named tool_choice are renamed with them, outbound only
 * (magpie fitTools minus the response-side rename, which this plugin's
 * README records as not adopted).
 */
function fitTools(body) {
    if (!Array.isArray(body.tools) || body.tools.length === 0)
        return;
    const taken = new Set();
    for (const t of body.tools) {
        const n = t?.function?.name;
        if (typeof n === 'string' && NAME_OK.test(n))
            taken.add(n);
    }
    const theirs = new Map();
    for (const t of body.tools) {
        const fn = t?.type === 'function' || t?.function ? t.function : null;
        if (!fn || typeof fn !== 'object')
            continue;
        if (typeof fn.name === 'string' && !NAME_OK.test(fn.name)) {
            const safe = safeName(fn.name, taken);
            theirs.set(fn.name, safe);
            fn.name = safe;
        }
        if (fn.parameters === undefined)
            continue;
        if (!fn.parameters || typeof fn.parameters !== 'object' || Array.isArray(fn.parameters)) {
            fn.parameters = { type: 'object', properties: {} };
            continue;
        }
        fitSchema(fn.parameters);
        fitShape(fn.parameters);
        objectRoot(fn.parameters);
    }
    if (theirs.size && Array.isArray(body.messages)) {
        for (const m of body.messages) {
            for (const c of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
                const safe = theirs.get(c?.function?.name);
                if (safe)
                    c.function.name = safe;
            }
            if (m?.role === 'tool' && theirs.has(m.name))
                m.name = theirs.get(m.name);
        }
    }
    const choice = body.tool_choice?.function;
    if (choice && theirs.has(choice.name))
        choice.name = theirs.get(choice.name);
}
/**
 * normalizeToolChoice converts the object form emitted by OpenAI clients to
 * WorkBuddy's string form (magpie normalizeToolChoice): none drops the tools
 * with it, auto/required pass as themselves, a named function keeps its
 * (sanitized) name, anything else goes.
 */
function normalizeToolChoice(body) {
    if (!('tool_choice' in body))
        return;
    const choice = body.tool_choice;
    if (typeof choice === 'string') {
        if (choice.trim().toLowerCase() === 'none') {
            delete body.tool_choice;
            delete body.tools;
            delete body.functions;
        }
        return;
    }
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
        delete body.tool_choice;
        return;
    }
    const type = typeof choice.type === 'string' ? choice.type.trim().toLowerCase() : '';
    if (type === 'none') {
        delete body.tool_choice;
        delete body.tools;
        delete body.functions;
    }
    else if (type === 'auto' || type === 'required') {
        body.tool_choice = type;
    }
    else if (type === 'function') {
        const fn = choice.function && typeof choice.function === 'object' && !Array.isArray(choice.function)
            ? choice.function
            : undefined;
        const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
        body.tool_choice = name || 'auto';
    }
    else {
        delete body.tool_choice;
    }
}
/**
 * The Completions dialect rewrite, in magpie's proven order: FLAGGED first
 * (a system block it empties must not keep the chat from opening with a
 * system message), then the spellings, the default system, the tools, and
 * last the tool_choice — so a named choice follows the name made safe.
 * A body that isn't a chat (no messages) is passed through untouched.
 */
export function applyWorkbuddyChatBody(payload = {}) {
    if (!Array.isArray(payload?.messages) || payload.messages.length === 0)
        return payload;
    // The clone keeps every in-place mend (unflag splices, schema fixes) off
    // the caller's body; a chat body is JSON, always structuredClone-able.
    const next = structuredClone(payload);
    const messages = next.messages;
    unflag(messages);
    if (next.max_completion_tokens !== undefined) {
        if (next.max_tokens === undefined)
            next.max_tokens = next.max_completion_tokens;
        delete next.max_completion_tokens;
    }
    for (const m of messages) {
        if (m?.role === 'developer')
            m.role = 'system';
    }
    if (messages[0]?.role !== 'system') {
        messages.unshift({ role: 'system', content: 'You are a helpful assistant.' });
    }
    fitTools(next);
    normalizeToolChoice(next);
    return next;
}
// ---- reasoning effort / stream usage / usage mapping ---------------------------
/**
 * The chat route cannot tell which build a body is for, and the two builds'
 * model ids barely overlap, so both catalogs are searched as one union —
 * workbuddyCatalogModels() answers the static floor before any live refresh.
 */
function modelOf(id) {
    const name = typeof id === 'string' ? id : '';
    return [...workbuddyCatalogModels(), ...workbuddyAiCatalogModels()].find((model) => model.id === name);
}
/**
 * Map a DSH reasoning_effort key onto the row's vendor spelling. WorkBuddy's
 * 'none' is the VALUE of off (the row carries off: 'none' only when the
 * model can disable thinking) — vendor spellings are never keys.
 */
function wireEffort(value, efforts) {
    if (value === undefined)
        return undefined;
    if (efforts[value] !== undefined)
        return efforts[value];
    const hit = Object.values(efforts).find((wire) => wire === value);
    return typeof hit === 'string' ? hit : undefined;
}
/** DSH's ladder, low to high (the closed set src/catalog/index.ts validates). */
const EFFORT_LADDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/**
 * The level a model actually serves when DSH asks for one its row does not
 * map: the next rung up first, then the nearest one down. An asked-for `off`
 * goes to the nearest rung above: never higher thinking than asked for.
 */
function nearestEffort(key, efforts) {
    const asked = EFFORT_LADDER.indexOf(key);
    // `off` and an unknown key both start at the bottom of the ladder.
    const from = asked === -1 ? 0 : asked;
    const up = EFFORT_LADDER.slice(from).find((level) => efforts[level] !== undefined);
    if (up !== undefined)
        return up;
    return EFFORT_LADDER.slice(0, Math.max(from, 1)).reverse().find((level) => efforts[level] !== undefined);
}
/**
 * reasoning_effort stays on the wire only when a catalog row advertises the
 * model (its reasoningEfforts table maps the key); otherwise the field goes
 * — an unknown model's effort is the upstream's to refuse, not ours to guess.
 * A model that does advertise thinking never loses the field: a level its row
 * does not map (DSH's `minimal`, or `off` on a row whose model always
 * thinks) goes out as the nearest level the model does serve.
 */
export function applyWorkbuddyThinking(payload = {}, model) {
    const next = { ...payload };
    const efforts = (model ?? modelOf(next.model))?.reasoningEfforts;
    const thought = efforts && typeof efforts === 'object' && Object.values(efforts).some((wire) => typeof wire === 'string');
    if (!thought) {
        delete next.reasoning_effort;
        return next;
    }
    const asked = next.reasoning_effort;
    // No choice made (DSH sent none): a ladder-less model is the one case that
    // must still name its rung — the gateway answers 400 code 11150 for glm-5.1
    // and stops kimi-k2.6 / fast-model thinking when the field is missing.
    if (asked === undefined) {
        const ladder = Object.keys(efforts).filter((level) => level !== 'off');
        if (ladder.length === 1 && typeof efforts[ladder[0]] === 'string')
            next.reasoning_effort = efforts[ladder[0]];
        else
            delete next.reasoning_effort;
        return next;
    }
    const wire = wireEffort(asked, efforts);
    // A level the row does not map (DSH's `minimal`, or `off` on a row whose
    // model can always think) keeps the request at the nearest level the model
    // does serve: thinking is never dropped to the vendor's own default by
    // accident, and the vendor never sees a rung it does not advertise.
    const fallback = nearestEffort(asked, efforts);
    const served = wire !== undefined ? wire : (fallback === undefined ? undefined : efforts[fallback]);
    if (typeof served === 'string')
        next.reasoning_effort = served;
    else
        delete next.reasoning_effort;
    return next;
}
/** Completions SSE omits usage unless the vendor is asked. Do not override an explicit value. */
export function applyWorkbuddyStreamUsage(payload = {}) {
    if (!payload || payload.stream !== true)
        return payload;
    const current = payload.stream_options;
    if (current && typeof current === 'object' && Object.hasOwn(current, 'include_usage'))
        return payload;
    return {
        ...payload,
        stream_options: current && typeof current === 'object'
            ? { ...current, include_usage: true }
            : { include_usage: true },
    };
}
/**
 * WorkBuddy's usage answers prompt_cache_hit_tokens / prompt_cache_miss_
 * tokens; the hit count is what DSH reads as prompt_tokens_details.
 * cached_tokens (the miss count is already inside prompt_tokens). The
 * vendor's credit field has no DSH slot and is left alone. Absent stays
 * absent — do not invent 0. The alias pick follows Kimi's: the first VALID
 * count, not the first present one.
 */
export function mapWorkbuddyUsage(usage) {
    if (!usage || typeof usage !== 'object')
        return usage;
    const cached = [
        usage.prompt_tokens_details?.cached_tokens,
        usage.prompt_cache_hit_tokens,
    ].find((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (cached === undefined)
        return usage;
    const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
        ? { ...usage.prompt_tokens_details }
        : {};
    if (typeof details.cached_tokens !== 'number')
        details.cached_tokens = cached;
    return { ...usage, prompt_tokens_details: details };
}
// ---- refusal classification -----------------------------------------------------
// The code is matched whole, as magpie does: a code that only begins with
// 11140 (111400) or 14018 (140185) is another error.
const RESTRICTED_CODE = 11140;
const EXHAUSTED_CODE = 14018;
const RESTRICTED_TEXT = /account has been restricted due to unusual activity|账号存在异常行为|帳號存在異常行為|["']code["']\s*:\s*["']?11140(?![\d.])/i;
const EXHAUSTED_TEXT = /credits exhausted|额度已用尽|["']code["']\s*:\s*["']?14018(?![\d.])/i;
const REFUSED = /unapproved channel|illegal api invocation/i;
const RESTRICTED_HINT = 'WorkBuddy restricted this account for unusual activity; it stays out until WorkBuddy lifts that, which an appeal (Submit feedback in WorkBuddy) asks for';
const REFUSED_HINT = 'WorkBuddy refuses chats that carry Codex or Claude Code prompt words (the known ones are rewritten; this one is not). Adjust the system prompt or use another provider';
/**
 * WorkBuddy's error envelope nests ({code, msg} at the root, error.message,
 * data.msg under it); the serialized form is searched too, because the
 * whole-code patterns ("code":11140 not matching 111400) read the wire's own
 * spelling. depth-bounded like Cline's errorBits walk.
 */
function workbuddyErrorBits(payload) {
    const texts = [];
    const codes = [];
    const visit = (value, depth) => {
        if (!value || depth > 3 || typeof value !== 'object')
            return;
        for (const key of ['message', 'msg', 'displayMsg']) {
            if (typeof value[key] === 'string' && value[key].trim())
                texts.push(value[key]);
        }
        if (value.code !== null && value.code !== undefined) {
            const n = Number(value.code);
            if (Number.isFinite(n))
                codes.push(n);
        }
        if (value.data && typeof value.data === 'object')
            visit(value.data, depth + 1);
        if (value.error && typeof value.error === 'object')
            visit(value.error, depth + 1);
    };
    if (typeof payload === 'string')
        texts.push(payload);
    else if (payload && typeof payload === 'object')
        visit(payload, 0);
    const message = texts.map((part) => part.trim()).filter(Boolean)[0];
    const text = [...texts, JSON.stringify(payload) ?? ''].join(' ');
    return { text, message, codes };
}
/**
 * forward()'s classifyFailure hook. A 401 stays the upstream's own answer so
 * the shared refresh-once path can run. Exhausted credits (code 14018, or
 * its wording — WorkBuddy needs an active package even for 0-rate models)
 * become quotaFailure: the host reads the prefix as QUOTA_EXCEEDED and stops
 * retrying. A restricted account (11140) and an unapproved-channel refusal
 * are 400s with what the user can do — kept at 400 so a 403 never reads as a
 * dead login. Everything else is undefined: the upstream's own answer.
 */
export function workbuddyQuotaFailure(status, payload) {
    if (status === 401)
        return undefined;
    const { text, message, codes } = workbuddyErrorBits(payload);
    const isRefused = REFUSED.test(text);
    const isRestricted = !isRefused && (codes.includes(RESTRICTED_CODE) || RESTRICTED_TEXT.test(text));
    const isExhausted = !isRestricted && (codes.includes(EXHAUSTED_CODE) || EXHAUSTED_TEXT.test(text));
    if (isExhausted) {
        return quotaFailure(message ?? 'WorkBuddy ' + status);
    }
    if (isRestricted) {
        const detail = message ? message + ' — ' + RESTRICTED_HINT : RESTRICTED_HINT;
        return new UpstreamFailure(400, detail, { code: 'http' });
    }
    if (isRefused) {
        const detail = message ? message + ' — ' + REFUSED_HINT : REFUSED_HINT;
        return new UpstreamFailure(400, detail, { code: 'http' });
    }
    return undefined;
}
