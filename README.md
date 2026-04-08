# himan

himan（含义为"Hey, man"），AI Coding 时代的 Prompt / Agent 资产管理系统（CLI + Git source）

## 安装与运行

```bash
pnpm install
pnpm run build
```

之后任选其一执行命令：

- 已全局安装本包：`himan <子命令>`
- 本地开发：`pnpm run dev -- <子命令>`
- 或直接：`node dist/index.js <子命令>`

下文用 `himan` 代指上述入口。

## 一分钟上手

```bash
himan init https://github.com/your-org/your-himan-registry.git
himan list rule
himan install rule my-rule
himan dev rule my-rule
# 编辑项目下 .himan/dev/rule/my-rule/
himan publish rule my-rule --patch
```

- **rule / command / skill**：都支持 `create`、`list`、`history`、`install`、`dev`、`publish`、`uninstall`。
- 安装后项目链接位置：
  - `rule` -> `.cursor/rules/<name>`
  - `command` -> `.cursor/commands/<name>`
  - `skill` -> `.cursor/skills/<name>`
- 开发态目录：
  - `rule` -> `.himan/dev/rule/<name>`
  - `command` -> `.himan/dev/command/<name>`
  - `skill` -> `.himan/dev/skill/<name>`
- lock 文件：`install <type> <name[@version]>` 会写入 `himan.lock`；`himan install`（无参数）会按 lock 批量恢复安装。

版本以 Git tag 为准，格式：`rule/my-rule@1.0.0`。更多设计见 [docs/mvp](./docs/mvp/README.md)。

## 常用命令

### 1) source（数据源）

| 命令                          | 说明                                             |
| ----------------------------- | ------------------------------------------------ |
| `init <git_url>`              | 初始化默认源（当前为 Git）并写入 `~/.himan/config.json` |
| `source add <name> <git_url>` | 添加命名 Git 源                                    |
| `source use <name>`           | 切换默认源                                          |
| `source list [--json]`        | 查看已配置源（标记当前 default）                     |

### 2) resource（资源）

| 命令                             | 说明                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `list [type] [--json]`           | 列出当前 default source 的资源；`type` 为 `rule` / `command` / `skill`，默认 `rule` |
| `history <type> <name> [--json]` | 按 tag 查看版本历史                                                                 |
| `create <type> <name>`           | 脚手架；常用选项：`--description`、`--target a,b`、`--dry-run`、`--force`、`--json` |

### 3) project（当前项目）

| 命令                              | 说明                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `install [type] [name[@version]]` | 有参数时安装指定资源；**无参数**时按 `himan.lock` 批量安装 |
| `dev <type> <name>`               | 切换到开发态并把项目链接指向 `.himan/dev/...`              |
| `uninstall <type> <name>`         | 从项目移除安装链接，并同步删除 `himan.lock` 条目           |
| `publish <type> <name>`           | 默认 `--patch`；可选 `--minor` / `--major`（勿同时使用多个） |

`publish` 优先使用项目里 `.himan/dev` 对应目录，否则用源仓库里对应目录。需要可推送的 Git 权限。若该资源已在 lock 中，发布后会同步更新 lock 版本。

`--json` 模式下，失败时会输出机器可读错误 JSON（`stderr`）。错误码定义见 [docs/error-codes.md](./docs/error-codes.md)。

多源说明：当前是「**多来源可配置，单来源生效**」模型。业务命令（`list/install/history/dev/publish`）只作用于当前 default source；切换后再执行命令。

## 当前范围

- 源：**仅 Git**（`init`）。Registry 适配器已预留，尚未实现。

## FAQ

**Q: 为什么执行 `source add` 之后，`list` 结果没有变化？**  
A: `source add` 只是在本地新增一个可用来源，不会自动切换当前生效来源。当前模型是“多来源可配置，单来源生效（default）”。  
请执行：

```bash
himan source use <name>
himan source list
```

确认目标来源已成为 `(default)` 后，再执行 `list/install/history/dev/publish`。

**Q: `list` 和 `source list` 有什么区别？**  
A: `source list` 查看「我配置了哪些来源」；`list` 查看「当前 default source 里有哪些资源」。

## 开发与测试

```bash
pnpm test
```

## 发布 npm 包（维护者）

### 流程概览

1. **在分支上完成开发与合并前检查**  
   本地可执行 `pnpm run verify`（类型检查、单测、`build`），确认通过后再提 PR。

2. **更新 `package.json` 中的 `version`**  
   npm 不允许重复发布同一版本号。合并进 `master` 前，在 PR 里把版本改成 registry 上尚未存在的号。  
   - 手动改 `version` 字段，或  
   - 在分支上执行其一（只改版本号，**不会**发包）：`pnpm run version:patch` / `version:minor` / `version:major`（使用 `npm version … --no-git-tag-version`，需自行 `git add` / `commit` 版本变更）。  
   Git 标签约定：与 `version` 对应、带前缀 **`v`**（如 `1.2.0` → 标签 `v1.2.0`）。

3. **合并到 `master`**  
   推送合并后的 `master` 会触发 GitHub Actions 工作流 [`.github/workflows/publish-npm.yml`](.github/workflows/publish-npm.yml)：安装依赖后执行 **`pnpm run release`**（即再次 `verify` + `npm publish`）。  
   需在仓库 **Settings → Secrets → Actions** 中配置 **`NPM_TOKEN`**（npm 侧「Access Tokens」，建议 Automation / 具备发包权限的 granular token）。

4. **手动从 CI 再发一次（可选）**  
   在 GitHub **Actions → Publish to npm → Run workflow** 可手动运行同一流程（例如在修复密钥后重试）。

### 本地命令（与 CI 中的 `pnpm run release` 一致）

| 命令 | 作用 |
|------|------|
| `pnpm run verify` | 仅检查（类型 / 测试 / 构建） |
| `pnpm run release:dry` | 检查 + `npm publish --dry-run`（演练，不上传） |
| `pnpm run release:test` | 检查 + 将版本打成 `*-test.*` 预发布号并发布到 **`@test` 标签** |
| `pnpm run release` | 检查 + 发布 **latest**（维护者本地发包时用；**请写 `pnpm run release`**，勿用裸命令 `pnpm publish`，二者不是同一套流程） |
| `pnpm run version:patch` / `version:minor` / `version:major` | 仅提升 `package.json` 版本号，不发包 |

发测试标签后，安装示例：`npm i himan@test`。

### CI：合并前校验与合并后打 Git 标签

| 工作流 | 文件 | 说明 |
|--------|------|------|
| **PR version tag check** | [`.github/workflows/pr-master-version-tag.yml`](.github/workflows/pr-master-version-tag.yml) | 目标分支为 `master` 的 PR：读取 **PR 头提交**上的 `package.json` 的 `version`，若远端已存在同名标签 **`v{version}`**，则 **检查失败**（用于在合并前拦截重复版本）。 |
| **Tag version on master** | [`.github/workflows/push-master-version-tag.yml`](.github/workflows/push-master-version-tag.yml) | 向 `master` **推送**后（含合并 PR）：在 **当前推送提交**上创建并推送注释标签 **`v{version}`**。若标签已存在、创建或 `git push` 失败，仅输出 **告警**（`::warning::`），**工作流仍成功**，不撤销已发生的 merge；请按日志提示在本机补打标签并 `git push origin v{x.y.z}`。 |

**启用「合并前拦截」**：在 GitHub **Settings → Branches** 中为 `master` 配置分支保护，勾选 **Require status checks to pass before merging**，并勾选必选检查 **`PR version tag check / version-tag-available`**（名称以仓库里 Actions 界面为准）。

说明：来自 fork 的 PR 同样会跑上述 PR 检查；打标签工作流需要 **Actions 对仓库有写权限**（工作流内已设 `contents: write`）。若组织策略禁止 `GITHUB_TOKEN` 写标签，推送标签会失败，需按告警手动推送。
