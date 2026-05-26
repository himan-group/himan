# Development

本文面向 `himan` 仓库开发者和 npm 包维护者。用户安装和使用 CLI 请优先阅读 [README.md](../README.md)。

## 环境要求

- Node.js 22.x；本仓库开发环境由 [.nvmrc](../.nvmrc) 固定为 `22.22.1`。
- pnpm 10.32.1；包管理器版本由 [package.json](../package.json) 固定。
- Git；测试和发布流程会使用本地 Git。

## 本地源码开发

```bash
pnpm install
pnpm run build
pnpm cli --help
node dist/bin/himan.js --help
```

## 开发与测试

```bash
pnpm test
```

常用脚本：

| 命令 | 作用 |
|------|------|
| `pnpm run clean` | 删除 `dist/` |
| `pnpm cli <subcommand>` | 从源码运行主 CLI |
| `pnpm run build` | 清理并编译 TypeScript 到 `dist/` |
| `pnpm run typecheck` | 运行 TypeScript 类型检查，不输出文件 |
| `pnpm test` | 运行 Vitest 一次 |
| `pnpm run verify` | 依次运行 typecheck、test、build |

## 发布 npm 包（维护者）

### 流程概览

1. **在分支上完成开发与合并前检查**  
   本地可执行 `pnpm run verify`（类型检查、单测、`build`），确认通过后再提 PR。PR 会自动运行同一组核心校验。

2. **更新 `package.json` 中的 `version` 与 `CHANGELOG.md`**  
   npm 不允许重复发布同一版本号。合并进 `master` 前，在 PR 里把用户可见变更先记录到 [CHANGELOG.md](../CHANGELOG.md) 的 `[Unreleased]`，再把版本改成 registry 上尚未存在的号。
   - 手动改 `version` 字段，或  
   - 在分支上执行其一（改版本号并把 `[Unreleased]` 归档到新版本，**不会**发包）：`pnpm run version:patch` / `version:minor` / `version:major`（使用 `npm version … --no-git-tag-version`，随后执行 `scripts/release-changelog.mjs`；需自行 `git add` / `commit` 版本和 changelog 变更）。
   Git 标签约定：与 `version` 对应、带前缀 **`v`**（如 `1.2.0` → 标签 `v1.2.0`）。

3. **合并到 `master`**  
   PR 合并到 `master` 或推送到 `master` 会触发 GitHub Actions 工作流 [`.github/workflows/publish-npm.yml`](https://github.com/himan-group/himan/blob/master/.github/workflows/publish-npm.yml)：安装依赖后执行 **`pnpm run release`**（即再次 `verify` + `npm publish`）。发布前 workflow 会检查当前 `package.json` 版本是否已存在于 npm；若已发布则跳过，避免重复触发时失败。
   npm 发布认证使用 **Trusted Publishing**，不使用长期 `NPM_TOKEN`。需在 npmjs.com 的 `@hi-man/himan` 包设置中添加 Trusted Publisher：
   - Provider: GitHub Actions
   - Organization or user: `himan-group`
   - Repository: `himan`
   - Workflow filename: `publish-npm.yml`
   workflow 已授予 OIDC 所需的 `id-token: write` 权限，并在发布前升级 npm CLI 到支持 Trusted Publishing 的版本。

4. **手动从 CI 再发一次（可选）**  
   在 GitHub **Actions → Publish to npm → Run workflow** 可手动运行同一流程（例如在修复密钥后重试）。

### 本地命令（与 CI 中的 `pnpm run release` 一致）

| 命令 | 作用 |
|------|------|
| `pnpm run verify` | 仅检查（类型 / 测试 / 构建） |
| `pnpm run release:dry` | 检查 + `npm publish --dry-run`（演练，不上传） |
| `pnpm run release:test` | 检查 + 将版本打成 `*-test.*` 预发布号并发布到 **`@test` 标签** |
| `pnpm run release` | 检查 + 发布 **latest**（维护者本地发包时用；**请写 `pnpm run release`**，勿用裸命令 `pnpm publish`，二者不是同一套流程） |
| `pnpm run changelog:release` | 把 `CHANGELOG.md` 的 `[Unreleased]` 归档到当前 `package.json` 版本 |
| `pnpm run version:patch` / `version:minor` / `version:major` | 提升 `package.json` 版本号，并调用 `changelog:release`；不发包 |

发测试标签后，安装示例：`npm i @hi-man/himan@test`。

### CI：PR 校验、发布与合并后打 Git 标签

| 工作流 | 文件 | 说明 |
|--------|------|------|
| **PR verify** | [`.github/workflows/pr-verify.yml`](https://github.com/himan-group/himan/blob/master/.github/workflows/pr-verify.yml) | `dev` 分支 push，以及目标分支为 `dev` 或 `master` 的 PR：安装依赖后依次运行 `pnpm run typecheck`、`pnpm run test`、`pnpm run build`。 |
| **PR version tag check** | [`.github/workflows/pr-master-version-tag.yml`](https://github.com/himan-group/himan/blob/master/.github/workflows/pr-master-version-tag.yml) | 目标分支为 `master` 的 PR：读取 **PR 头提交**上的 `package.json` 的 `version`，若远端已存在同名标签 **`v{version}`**，则 **检查失败**（用于在合并前拦截重复版本）。 |
| **Tag version on master** | [`.github/workflows/push-master-version-tag.yml`](https://github.com/himan-group/himan/blob/master/.github/workflows/push-master-version-tag.yml) | PR 合并到 `master` 或向 `master` **推送**后：在合并/推送提交上创建并推送注释标签 **`v{version}`**。若标签已存在、创建或 `git push` 失败，仅输出 **告警**（`::warning::`），**工作流仍成功**，不撤销已发生的 merge；请按日志提示在本机补打标签并 `git push origin v{x.y.z}`。 |

**启用「合并前拦截」**：在 GitHub **Settings → Branches** 中为 `master` 配置分支保护，勾选 **Require status checks to pass before merging**，并勾选必选检查 **`PR verify / verify`** 和 **`PR version tag check / version-tag-available`**（名称以仓库里 Actions 界面为准）。

说明：来自 fork 的 PR 同样会跑上述 PR 检查；打标签工作流需要 **Actions 对仓库有写权限**（工作流内已设 `contents: write`）。若组织策略禁止 `GITHUB_TOKEN` 写标签，推送标签会失败，需按告警手动推送。
