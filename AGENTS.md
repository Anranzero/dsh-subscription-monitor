# AGENTS.md

本文件说明 **dsh-subscription-monitor** 当前的开发方式和维护约定。

## 当前源码与验证方式

- **`lib/**/*.js` 是当前直接维护、提交并由 DSH 执行的 JavaScript 源码。允许直接修改 `lib/`；界面入口是 `lib/ui/client.js`。** `lib/` 的目录名和相邻的 `.d.ts` 类型声明，不代表这些文件在当前仓库中只读或需要重新生成。
- 当前仓库没有 `src/`、`tsconfig.json` 或 `tsconfig.ui.json`。`package.json` 中的 `build`、`dev-build`、`dev`、`test`、`typecheck`、`prepublishOnly` 仍关联旧 TypeScript 构建流程，不适合作为当前验证入口；不要要求先找到 `src/` 或先构建才能修改代码。
- 直接修改当前文件并验证。缓存、旧发布包或其他版本中的 TypeScript 文件不能作为覆盖当前 `lib/` 的依据；恢复 TypeScript 构建属于单独的迁移任务。
- `.d.ts` 是类型声明；修改公开接口时同步核对对应声明。`test/` 和 `scripts/` 中已有的 TypeScript 文件不代表存在完整的 TypeScript 构建工程。

修改 JavaScript 后，对涉及的文件执行 `node --check`。行为改动运行直接相关的现有测试；需要完整回归时执行：

```sh
node --experimental-test-module-mocks --experimental-strip-types --test 'test/*.test.ts'
```

纯文档修改检查差异、链接和路径即可，不要求运行模型请求、构建或完整测试。

## codebase-memory-mcp
若当前会话提供 `codebase-memory-mcp`，理解代码库、查找符号、追踪调用链时优先使用；服务不可用时直接使用 `rg` 和文件阅读，不以安装或索引服务作为维护前置条件。

## 文档索引

| 文档 | 管什么 | 什么时候读 |
|---|---|---|
| [`NOTICE.md`](NOTICE.md) | 项目归属、维护方式与依赖说明 | 了解项目维护背景 |
| [`README.zh.md`](README.zh.md)、[`README.md`](README.md) | 安装、功能、数据位置和诊断入口 | 使用与排查 |
| [`lib/oauth/`](lib/oauth/)、[`lib/apikey/`](lib/apikey/) | 各家族当前的登录、模型、路由和额度实现 | 改家族相关行为 |
| [`lib/catalog/`](lib/catalog/) | 模型目录、参数和费率 | 改模型与参数 |
| [`lib/ui/client.js`](lib/ui/client.js) | 当前直接维护的界面代码 | 改 UI |
| [`test/`](test/)、[`scripts/`](scripts/) | 行为测试与分析脚本；构建类脚本适用范围见上文 | 验证与诊断 |

以上以仓库实际存在的文件为准。旧注释中的 `src/`、`docs/` 等路径不构成当前开发的前置依赖。

## 始终成立

- 按上面的当前维护方式修改 `lib/`，保留已有改动、代码风格、编码和换行，不顺手重构。
- 家族专属代码和缓存留在该家目录里，不同家族之间不共用缓存或会话标识。
- 模型参数都要有出处，不发明数字。
- 故障和验证结论记入相关说明或 PR，区分静态检查、测试与实际请求的结果。
- 一个任务一个 PR；不改版本号、不打 tag、不发布，这些由维护者做。
