# himan
himan（含义为"Hey, man"），AI Coding 时代的 Prompt / Agent 资产管理系统（CLI + Git-based Registry）

## 快速上手

当前 MVP 已实现并可用的资源类型：`rule`。

### 1) 安装依赖并构建

```bash
pnpm install
pnpm run build
```

### 2) 运行方式

- 开发模式（直接跑 TS）：
  - `pnpm run dev -- <command>`
- 构建后运行：
  - `node dist/index.js <command>`

示例：

```bash
node dist/index.js --help
node dist/index.js init https://github.com/lidetao/himan-test.git
```

## CLI 命令速查

### `init <git_repo>`

用途：初始化资源源仓库（clone/fetch），并写入本地配置。

参数：
- `git_repo`：Git 仓库地址

示例：

```bash
node dist/index.js init https://github.com/lidetao/himan-test.git
```

---

### `list [type] [--json]`

用途：列出当前源仓库中的资源。

参数：
- `type`：资源类型，当前仅支持 `rule`（默认值也是 `rule`）
- `--json`：JSON 输出

示例：

```bash
node dist/index.js list
node dist/index.js list rule --json
```

---

### `history <type> <name> [--json]`

用途：查看资源历史版本（基于 Git tag）。

参数：
- `type`：资源类型（`rule`）
- `name`：资源名（例如 `code-review`）
- `--json`：JSON 输出

示例：

```bash
node dist/index.js history rule code-review
node dist/index.js history rule code-review --json
```

---

### `install <type> <name[@version]>`

用途：安装资源到项目，并创建项目软链引用。

参数：
- `type`：资源类型（`rule`）
- `name[@version]`：资源名，可选指定版本（不指定则安装最新）

示例：

```bash
node dist/index.js install rule code-review
node dist/index.js install rule code-review@1.0.0
```

---

### `dev <type> <name>`

用途：切换资源到开发模式（复制到项目 `.himan/dev` 并切换软链）。

参数：
- `type`：资源类型（`rule`）
- `name`：资源名

示例：

```bash
node dist/index.js dev rule code-review
```

---

### `create <type> <name> [options]`

用途：在资源仓库创建资源骨架，支持 `rule/command/skill`。

参数：
- `type`：资源类型（`rule | command | skill`）
- `name`：资源名（kebab-case，例如 `code-review`）

选项：
- `--description <text>`：资源描述
- `--target <list>`：目标平台，逗号分隔（如 `cursor,claude`）
- `--entry <file>`：自定义入口文件名
- `--template <name>`：模板名（当前支持 `basic`）
- `--force`：目录已存在时覆盖
- `--dry-run`：仅预览，不写入文件
- `--json`：JSON 输出

示例：

```bash
node dist/index.js create rule code-review --description "enforce standards"
node dist/index.js create command sync-docs --target cursor,claude --json
node dist/index.js create skill bug-analysis --dry-run --json
```

---

### `publish <type> <name> [--patch|--minor|--major]`

用途：发布资源改动，自动提交、打 tag、推送，并同步到本地 store。

参数：
- `type`：资源类型（`rule | command | skill`）
- `name`：资源名
- `--patch|--minor|--major`：版本升级类型（默认 `--patch`）

示例：

```bash
node dist/index.js publish rule code-review --patch
node dist/index.js publish command release-note --minor
node dist/index.js publish rule code-review --minor
```

发布来源优先级：
- 优先发布项目内 `.himan/dev/<name>`（dev 工作流）
- 若不存在 dev 目录，则发布仓库内 `create` 产物目录（如 `commands/<name>`）

> 使用 `publish` 时请确保本地 Git 环境具备提交与推送权限。

## 典型使用流程

```bash
node dist/index.js init <repo>
node dist/index.js list rule
node dist/index.js install rule code-review
node dist/index.js dev rule code-review
# 修改 .himan/dev/code-review/*
node dist/index.js publish rule code-review --patch
```

## npm 包发布

发布前准备：
- 登录 npm：`npm login`（或配置 `NPM_TOKEN`）
- 确认包名可用且具备发布权限

发布命令：
- 发布校验（不上传）：`pnpm run release:dry-run`
- 发布测试版（`test` tag）：`pnpm run release:test`
- 发布正式版（`latest` tag）：`pnpm run release:latest`

说明：
- `release:test` 会先执行类型检查、测试和构建，再自动把版本提升为 `x.y.z-test.n` 并以 `test` tag 发布。
- 测试版安装方式：`npm i himan@test`
- 正式发布前，建议先执行 `npm version patch|minor|major`（按计划升正式版本），再执行 `pnpm run release:latest`。
