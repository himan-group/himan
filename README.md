# himan

`himan` 是一个面向 AI Coding 团队的 Prompt / Agent 资产管理 CLI。它把 `rule`、`command`、`skill` 和 Codex `config` 当成可版本化、可安装、可发布的工程资产，用 Git 做 source，用 `himan.lock` 做项目级可复现安装。

## 为什么用 himan

- **Git-first**：资源源头就是普通 Git 仓库，版本历史、权限、评审和备份沿用团队现有流程。
- **Agent-neutral**：同一套资源可安装到 Cursor、Claude Code、Codex、OpenClaw，不被单一 agent 的目录结构绑定。
- **可复现安装**：项目内写入 `himan.lock`，记录 source、精确版本、目标 agent 和安装模式；换机器后 `himan install` 即可恢复。
- **开发即验证**：`create` / `dev` 直接在当前项目的 agent 目录工作，验证后用 `publish` 回写 source、打资源 tag、更新文档索引。
- **团队资产治理**：支持多 source、别名、归档、恢复、批量发布、递归安装 skill 依赖，以及 `doctor` 本地健康检查。

## 安装

要求 Node.js `>=22 <23` 和 Git。

```bash
npm install -g @hi-man/himan
himan --help
```

也可以临时运行：

```bash
npx @hi-man/himan --help
pnpm dlx @hi-man/himan --help
```

## 3 分钟入门

以下示例假设你已有一个可访问、可 push 的 himan Git source。

```bash
# 1. 初始化 source，设置当前项目默认 agent，并安装一个资源
himan init https://github.com/your-org/your-himan-source.git \
  --agent codex \
  --install skill/code-review

# 2. 检查本机、source、agent、lock 和安装目标
himan doctor

# 3. 查看 source 中可用资源
himan resource list

# 4. 创建新 skill，在当前项目 agent 目录里直接编辑和验证
himan create skill api-review --description "Review API changes"

# 5. 发布 patch 版本，写回 source，并重新安装到当前项目
himan publish skill api-review
```

换一台机器或同事拉取项目后：

```bash
himan init https://github.com/your-org/your-himan-source.git --agent codex
himan install
```

`himan install` 无参数时会按当前项目的 `himan.lock` 恢复安装，而不是盲目使用最新版本。

## 核心概念

| 概念 | 说明 |
| --- | --- |
| `source` | 存放资源的 Git 仓库，目录通常包含 `rules/`、`commands/`、`skills/`、`configs/`。 |
| `resource` | 一份可安装资产，类型为 `rule`、`command`、`skill`、`config`；`config` 当前仅支持 Codex。 |
| `agent` | 资源安装目标，支持 `cursor`、`claude-code`、`codex`、`openclaw`。 |
| `himan.lock` | 项目级锁文件，记录已安装资源的 source、版本、agent 和安装模式。 |
| Git tag | 资源版本以 `<type>/<name>@<semver>` 标记，例如 `skill/code-review@1.2.0`。 |

## 常用工作流

```bash
# source
himan source add team https://github.com/your-org/himan-source.git --alias team
himan source use team
himan source init-docs

# agent
himan agent use codex
himan agent current

# install
himan install skill code-review
himan install skill code-review -r --depth 2
himan install rule secure-coding --mode link

# develop and publish
himan dev skill code-review
himan publish skill code-review --minor
himan publish skill skill-a,skill-b
himan publish --all

# lifecycle
himan resource archive skill old-workflow --reason "Replaced by new-workflow"
himan resource restore skill old-workflow
```

完整命令表见 [docs/command-reference.md](./docs/command-reference.md)。

## Source 仓库长什么样

```text
your-himan-source/
  README.md
  CHANGELOG.md
  rules/my-rule/content.md
  commands/my-command/content.md
  skills/my-skill/SKILL.md
  configs/my-codex-config/config.toml
  archive/
```

每个资源目录可以放一个 `himan.yaml` 描述名称、类型、版本、入口、默认 agent、分类、依赖和静态分析信息。没有 `himan.yaml` 时，`rule` / `command` 默认入口是 `content.md`，`skill` 默认入口是 `SKILL.md`，`config` 默认入口是 `config.toml`。

更多目录规范、安装目标、lock 行为、多 source、归档和发布细节见 [docs/user-guide.md](./docs/user-guide.md)。

## 与 himan-tracker 配套

[`@hi-man/himan-tracker`](https://www.npmjs.com/package/@hi-man/himan-tracker) 是同一生态下的本地优先观测工具，目前可用于 Codex 数据采集，并面向 Claude Code 等 agent 扩展；它用来统计对话、runtime token、耗时，以及 skill / MCP tool / plugin 使用情况。

它适合回答这些问题：哪些 skill 真正在用、哪些资源长期未使用、token 成本趋势如何、团队 AI 工作流是否值得继续投入。默认不采集 prompt、response、代码内容、stdout/stderr 或 shell 参数。

```bash
npm install -g @hi-man/himan-tracker
himan-tracker setup
himan-tracker summary --since 7d
himan-tracker server start --open
```

## 文档

- [User Guide](./docs/user-guide.md)：概念、source 结构、安装目标、lock、发布、归档和 FAQ。
- [Command Reference](./docs/command-reference.md)：完整命令速查。
- [Error Codes](./docs/error-codes.md)：稳定错误码和处理建议。
- [Development](./docs/development.md)：本仓库开发、测试和 npm 发布流程。

## 当前范围

- 运行时 source 目前仅实现 Git；Registry adapter 已预留但未开放。
- npm 包只承诺 CLI 使用，不提供稳定 Node.js 程序化 API。
- `config` 资源当前仅支持 Codex。
