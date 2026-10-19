# NOTICE

## Origin

This repository is a **local fork of `dsh-plugin-oauth-subs`** (v0.0.124), originally
published by **xxww0098** at `https://github.com/xxww0098/dsh-plugin-oauth-subs`.

That upstream repository has since been **removed by its author**. This copy was taken
from an installed package before the removal, and is redistributed here under the
original MIT license (see `LICENSE`, which retains the upstream copyright notice).

All credit for the plugin's design and implementation belongs to the original author.
This fork exists because installing the plugin from its original source is no longer
possible.

## Local changes in this fork

Changes made on top of upstream v0.0.124, all confined to `lib/ui/client.js`:

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
- **Layout.** The shell's `max-width` went 1000px → 1280px and is now centred;
  the stats page reuses the same shell width instead of opting out.

Not changed: the server half, the OAuth families, the loopback proxy, the quota
logic, or any upstream behaviour.

## Dependencies

`@deepseek-ai/schemastery` and `undici` are declared in `package.json` and installed
via the package manager; `node_modules/` is intentionally not committed.
