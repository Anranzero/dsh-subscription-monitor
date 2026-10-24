# NOTICE

## Origin

The project originated from `dsh-plugin-oauth-subs` v0.0.124 by **xxww0098**.
Original copyright and MIT license terms are retained in [LICENSE](LICENSE).
Subsequent features, fixes and optimizations are developed and maintained as
`dsh-subscription-monitor` by the current maintainer.

Maintained repository: <https://github.com/Anranzero/dsh-subscription-monitor>

## Project development

Features and maintenance work include:

- **Manifest — only `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` are
  peers.** Both ship with the DSH host (`app.asar`), so `peerDependencies` is the
  right home for them; under a `link:` install the DSH linked-resolution layer
  intercepts peer-declared packages only.

  `undici` is deliberately **not** a peer. An earlier revision made it one with
  the range `^7.30.0 || ^8.0.0`, so the host's patched 8.11.2 build could be
  routed in. That build's file set differs from the registry package (it carries
  `lib/dispatcher/dispatcher1-wrapper.js`, a host patch), and when a copy missing
  that file landed in the plugin's resolution path, the plugin failed at import
  time — before `apply()` ran — so the loopback proxy never listened and every
  oauth model surfaced as `Connection error.` with no explanation. `undici` is a
  regular dependency again (`^7.30.0`), which pins resolution to the registry
  package; a local checkout needs one `pnpm install`. `lib/utils/outbound.js`
  also loads it through a guarded dynamic import: if the package is missing the
  plugin still loads, falls back to Node's built-in `fetch` / `Headers` /
  `WebSocket` for direct traffic, disables proxy settings with a clear message,
  and records the outcome in `data/dsh-plugin-oauth-subs/startup.log`.

- **Usage tab — merge by model name.** The per-model list grouped rows by
  `family/model`, so a model reached through two credentials (e.g. `grok-4.6` via
  `oauth-grok` and `oauth-cursor`) showed up as two rows, each holding half its
  tokens. Rows now group by model name and the row's sub-line names every credential
  that fed it.
- **New 统计 (Stats) tab.** App-usage view modelled on Zcode: one bordered metric
  strip (total tokens / peak tokens / sessions / active days / current streak /
  longest streak), a year-wide activity heatmap with a month axis and
  每日·每周·累计 toggle, a smooth area trend chart (top 3 models, hover with guide
  line + dots + tooltip), and a model-share donut carrying its own total.
- **统计 covers every model DSH ran**, not only this plugin's routes. The `usage`
  RPC takes an opt-in `includeAll` flag that keeps every provider under its own
  id instead of discarding it; the default answer (the 用量 tab) is unchanged.
- **Composer quota badge** (absorbed from `dsh-provider-quota-meter`, whose own
  composer chip covered only OpenCode and CommandCode). The active session's
  model provider is mapped to its family and that family's remaining share is
  shown in the input toolbar, for all 20+ families this plugin manages.
- **MiniMax API-key family.** A new `minimax` family (`lib/apikey/minimax/`):
  paste a key from the platform.minimax.cn console and the plugin owns the route
  (`oauth-minimax` → `openai-completions` on the loopback hop, forwarded to
  `https://api.minimax.cn/v1/chat/completions`). Catalog is the static floor from
  the official OpenAI-compatibility docs: `MiniMax-M3.1-Flash` and `MiniMax-M3`
  (1M context, 512K output, vision, `reasoning_effort` on M3.1-Flash) plus
  `MiniMax-M2.7` (200K). No quota meters: MiniMax publishes no balance endpoint,
  so the card names the account and leaves the strip empty rather than inventing
  a number.
- **Layout.** The shell's `max-width` went 1000px → 1280px and is now centred;
  the stats page reuses the same shell width instead of opting out.

## Maintenance

`lib/**/*.js` is the current maintained JavaScript source and the code DSH runs;
edit and commit it directly. Adjacent `.d.ts` files are type declarations.
The repository has no `src/` or TypeScript build configuration; the retained
build-related package scripts target the former layout. Follow [AGENTS.md](AGENTS.md)
for syntax checks and direct test commands, rather than requiring a TypeScript
rebuild or replacing current code with an older source snapshot.
The data directory remains `data/dsh-plugin-oauth-subs` for compatibility with
existing credentials and usage caches.

## Dependencies

`@deepseek-ai/schemastery` and `undici` are declared in `package.json` and installed
via the package manager; `node_modules/` is intentionally not committed.
