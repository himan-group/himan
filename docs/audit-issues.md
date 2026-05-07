# himan 项目审查问题清单

记录日期：2026-05-07

本文记录当前仓库文档、代码、发布配置和验证流程中发现的问题，作为后续逐项修复的跟踪清单。

## 验证记录

- 通过：`./node_modules/.bin/tsc -p tsconfig.json --noEmit`
- 通过：`./node_modules/.bin/vitest run tests/adapters tests/state tests/utils`
- 通过：`./node_modules/.bin/vitest run tests/adapters/repo-manager.test.ts`
- 通过：`./node_modules/.bin/vitest run tests/adapters`
- 通过：`./node_modules/.bin/vitest run tests/adapters/git-source-adapter.test.ts tests/state/index-cache-store.test.ts`
- 通过：`./node_modules/.bin/vitest run tests/adapters tests/state`
- 通过：`./node_modules/.bin/vitest run tests/services/service-factory-lock.test.ts tests/state/state-store.test.ts`
- 通过：`./node_modules/.bin/vitest run tests/adapters tests/state tests/services tests/utils`
- 通过：`./node_modules/.bin/vitest run tests/adapters/repo-manager.test.ts tests/adapters/git-source-adapter.test.ts`
- 通过：`npm --cache /private/tmp/himan-npm-cache run build`
- 阻塞：`pnpm run typecheck`、`pnpm test` 在当前环境因 `pnpm` 自身 `fetch failed` 失败。
- 阻塞：`./node_modules/.bin/vitest run tests/cli/commands.integration.test.ts` 未进入业务断言，卡在 `beforeAll` 中的 `pnpm run build`，最终因 build 状态码非 0 失败。
- 通过：`npm --cache /private/tmp/himan-npm-cache pack --dry-run --json`，用于确认 npm 包内容。

## 问题清单

### 1. README 不符合公开 npm CLI 包的基本使用预期

- 状态：已处理（2026-05-07）。README 已补充环境要求、npm 安装、一次性运行、本地源码开发、四个 CLI 入口和快速上手前置条件。
- 位置：`README.md`
- 现状：
  - 只说明源码安装：`pnpm install`、`pnpm run build`。
  - 没有说明 `npm install -g @hi-man/himan`、`npx` 或 `pnpm dlx` 等用户安装方式。
  - 没有在 README 中明确 Node 版本和 pnpm 版本要求。
  - “也支持两个独立入口”下实际列了 `himan-source`、`himan-resource`、`himan-project` 三个入口。
- 影响：新用户无法直接判断如何安装和运行公开包；README 作为 npm 首页时不够标准。
- 建议：补充 Requirements、Installation、Quick Start、CLI Reference；修正入口数量描述。

### 2. README 链接了不会随 npm 包发布的 docs 文件

- 状态：已处理（2026-05-07）。README 引用的 `docs/mvp`、`docs/error-codes.md` 和 `.nvmrc` 已纳入 npm 包；`.github/workflows` 链接已改为 GitHub 绝对链接。
- 位置：`package.json` 的 `files`、`README.md` 中指向 `docs/` 和 `.github/workflows/` 的链接。
- 现状：`npm pack --dry-run` 确认发布包只包含 `dist`、`README.md`、`LICENSE`、`package.json`，不包含 `docs/` 或 `.github/`。
- 影响：用户从 npm 包或安装目录查看 README 时，相对链接不可用。
- 建议：
  - 将必要用户文档纳入 npm 包 `files`；或
  - 将 README 链接改成 GitHub 绝对链接；或
  - 把 npm README 限定为自包含内容。

### 3. 缺少 CHANGELOG

- 状态：已处理（2026-05-07）。已新增 `CHANGELOG.md`，纳入 npm 包，并在 README release 流程中要求版本变更同步更新 changelog。
- 位置：仓库根目录。
- 现状：没有 `CHANGELOG.md` 或等价发布说明文件。
- 影响：当前 release 流程要求每次合并前修改版本，但没有用户可读的变更记录、破坏性变更说明或迁移说明。
- 建议：新增 `CHANGELOG.md`，采用 Keep a Changelog 或简化格式，并让 release 流程要求同步更新。

### 4. `himan.lock` 可复现安装与实现不一致

- 状态：已处理（2026-05-07）。`himan.lock` 的 source 现在记录当前 source alias，并保留 source 类型、repo 和 repoId；`himan install` 无参数恢复时直接使用 lock 中记录的 source，而不是当前 default source，恢复过程中也不会把 lock source 覆盖成当前 default source。
- 位置：`src/services/index.ts`、`src/state/project-lock-store.ts`、`docs/v1.0/impl.md`
- 现状：
  - lock 记录 `source`，但无参 `install` 逐条调用 `install()`，实际使用当前 default source。
  - lock 中没有 source alias；文档描述“记录源别名”与类型定义不一致。
- 影响：切换 default source 后，`himan install` 可能从错误来源恢复资源，削弱 lock 的可复现性。
- 建议：明确 lock 恢复策略。可以按 lock.source 临时选择 source，或把 source alias/repoId 记录到每个资源条目并用于恢复。

### 5. Git source 更新只 fetch，不更新工作区

- 状态：已处理（2026-05-07）。缓存仓库已有工作区时会先 `fetch --tags --prune`，再在 working tree 干净且当前分支存在 upstream 时执行 fast-forward 更新；若存在未提交本地改动，则保留当前工作区，避免覆盖 `create` 到 `publish` 之间的资源编辑。
- 位置：`src/adapters/git/repo-manager.ts`
- 现状：已有缓存 repo 时只执行 `git fetch --tags --prune`，没有 `pull`、`reset` 或 checkout 更新工作区。
- 影响：`history` 可看到新 tag，但 `list`、`create`、`publish` 基于 working tree，可能仍读取旧资源目录。
- 建议：定义缓存 repo 的更新语义。若 default branch 是读取源，应在安全前提下更新 working tree；若不能自动更新，应提供显式 `source sync` 或文档说明。

### 6. `list` 索引缓存可能返回陈旧元数据

- 状态：已处理（2026-05-07）。`list` 缓存失效条件已从类型目录 mtime 改为资源目录下 `himan.yaml` 文件内容 hash；修改已有资源元数据、添加或删除资源元数据文件时会刷新 `~/.himan/index.json`，旧的 mtime 缓存条目会自然失效并重建。
- 位置：`src/adapters/source/git-source-adapter.ts`
- 现状：缓存失效只比较类型目录的 `mtimeMs`。修改已有资源目录内的 `himan.yaml` 时，父级类型目录 mtime 可能不变。
- 影响：`list` 可能返回旧的 description、entry、agents。
- 建议：缓存键改为 repo HEAD、相关目录文件 hash、resource dir mtime 聚合，或在 fetch/publish/create 后显式失效。

### 7. publish preflight 与错误码治理不足

- 状态：已处理（2026-05-07）。`publish` 发布前会校验 `himan.yaml` 存在且为对象，`name/type/entry` 与命令参数匹配，入口文件存在且位于资源目录内；无可提交变更时返回稳定错误码 `E_PUBLISH_NO_CHANGES`，元数据非法时返回 `E_INVALID_RESOURCE_METADATA`。
- 位置：`src/adapters/source/git-source-adapter.ts`、`src/adapters/git/repo-manager.ts`、`docs/v1.0/impl.md`
- 现状：
  - 文档要求 preflight、元数据校验、入口存在性校验，但代码尚未实现完整校验。
  - 缺失 `himan.yaml` 时仍可能提交和打 tag。
  - “No changes to publish.” 使用普通 `Error`，最终会表现为 `E_UNKNOWN`。
- 影响：发布失败和非法发布的诊断性不足，不符合文档中的稳定错误码策略。
- 建议：新增发布前校验，业务失败统一使用 `HimanError` 和稳定错误码。

### 8. 文档之间存在过期或冲突内容

- 状态：已处理（2026-05-07）。已修正 `create-resource.md` 的三类型能力说明、MVP/v1.0 文档中的多 agent 安装路径，并为 MVP、v1.0、global roadmap 增加事实源/历史规划状态说明。
- 位置：`docs/mvp/create-resource.md`、`docs/mvp/README.md`、`docs/v1.0/impl.md`、`README.md`
- 现状：
  - `create-resource.md` 仍写“仅 rule 另有 install/dev”，但当前三类资源均支持。
  - v1.0 文档的运行态安装路径只列 `.cursor`，README 已说明支持 cursor、claude-code、codex、openclaw。
  - MVP、v1.0、global roadmap 混合了历史规划与当前状态，但标识不够清晰。
- 影响：读者难以判断哪个文档是当前事实来源。
- 建议：给规划文档标注状态，根 README 和 `docs/codex/repo-map.md` 作为当前事实来源；修正明显过期内容。

### 9. CI 缺少 PR 阶段的 typecheck/test/build 验证

- 状态：已处理（2026-05-07）。已新增 `.github/workflows/pr-verify.yml`，面向 `master` PR 运行 `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build`；开发文档也已补充建议把 `PR verify / verify` 纳入分支保护必选检查。
- 位置：`.github/workflows/`
- 现状：
  - PR 工作流只检查版本 tag 是否可用。
  - `pnpm run release` 只在 push 到 `master` 后执行，失败时已经合并。
- 影响：代码问题可能合并后才在发布流程暴露。
- 建议：新增 PR CI workflow，执行 `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm test`、`pnpm run build`，并加入分支保护。

### 10. `dist` 发布前不清理，可能夹带陈旧构建产物

- 状态：已处理（2026-05-07）。已新增 `clean` 与 `prebuild` 脚本，`build` 前会删除 `dist`；dry-run 包验证不再包含旧的 `dist/utils/agent-targets.js`、`dist/bin/index*.js`、`dist/version.js` 等残留文件。
- 位置：`package.json`、`.gitignore`、`dist/`
- 现状：
  - `dist` 被 gitignore，但 `package.json` 的 `files` 会发布 `dist`。
  - `build` 脚本只执行 `tsc -p tsconfig.json`，不会清理旧文件。
  - 当前 `npm pack --dry-run` 可见一些 `src/` 中已不存在的旧 dist 文件，例如 `dist/utils/agent-targets.js`、`dist/bin/index*.js`。
- 影响：本地发布或复用旧工作区发布时，包内可能出现无关旧文件。
- 建议：新增 `clean` 脚本，并让 `build` 或 `release` 先清理 `dist`；或使用独立临时目录构建发布包。

### 11. 缺少公开协作与安全文档

- 状态：已处理（2026-05-07）。已新增 `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`，覆盖贡献流程、安全漏洞报告和社区协作行为准则。
- 位置：仓库根目录或 `.github/`
- 现状：没有 `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`。
- 影响：公开项目的贡献流程、安全漏洞报告路径和社区规则不明确。
- 建议：按项目开放程度补充最小版本，至少提供 `CONTRIBUTING.md` 和 `SECURITY.md`。

### 12. `package.json` 元数据偏少

- 状态：已处理（2026-05-07）。已补充 `engines.node` 与 `keywords`，并在 README 中说明当前仅承诺 CLI 使用、不提供稳定的 Node.js 程序化 API。
- 位置：`package.json`
- 现状：
  - 没有 `engines` 字段，虽然 `.nvmrc` 固定 Node `22.22.1`。
  - 没有 `keywords`。
  - CLI 包可接受无 `exports`/`main`，但如果希望支持程序化 API，应明确导出策略。
- 影响：npm 用户和包管理器无法提前判断 Node 兼容范围，包检索信息也较弱。
- 建议：补充 `engines.node`、`keywords`；确认是否仅 CLI 包，若是则在 README 中说明不承诺库 API。

## 建议处理顺序

1. 先修文档事实源：README、过期 docs、CHANGELOG。
2. 再修发布与验证：PR CI、dist clean、package files。
3. 再修核心行为：source 更新、lock source 恢复、index 失效。
4. 最后补齐 publish preflight 和稳定错误码。
