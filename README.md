# himan

`himan` 是面向个人和团队的 AI 资产（Resource）管理工具，并以 CLI 的方式调用。

适用场景是跨 agent、跨终端、跨项目复用和治理 AI 资产。

它管理 `rule`、`command`、`skill` 和 `config`，资产存放在 Git source 中，支持版本发布、安装，并通过 `himan.lock` 固定项目安装结果。

## 适合谁使用

- **多 agent 使用者**：同时使用 Cursor、Claude Code、Codex、OpenClaw，希望同一套资产在不同 agent 中保持一致。
- **多项目个人开发者**：希望把常用规则、命令、skill 和配置从单个项目中抽离出来，在多个项目间复用。
- **团队或平台维护者**：希望用 Git 评审、发布、归档和回滚 AI 资产，并让项目通过 `himan.lock` 获得稳定一致的安装结果。

## 为什么用 himan

- **以 Git 作为资产来源**：资产源头就是普通 Git 仓库，版本历史、权限、评审和备份沿用团队现有流程。
- **不绑定单一 agent**：同一套资产可安装到 Cursor、Claude Code、Codex、OpenClaw，不受某个 agent 目录结构限制。
- **安装结果可复现**：项目内写入 `himan.lock`，记录 source、精确版本、目标 agent 和安装模式；换机器后 `himan install` 即可恢复。
- **在真实项目中开发和验证**：`create` / `dev` 直接在当前项目的 agent 目录工作，验证后用 `publish` 回写 source、发布新版本并更新文档索引。
- **适合团队治理**：支持多 source、别名、归档、恢复、批量发布、递归安装 skill 依赖，以及 `doctor` 本地健康检查。

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

以下示例假设你已有一个可访问、可 push 的空 Git 仓库，用作 himan Git source。

```bash
# 1. 初始化 source，并设置当前项目默认 agent
himan init https://github.com/your-org/your-himan-source.git --agent codex

# 2. 创建 skill 空壳，并在当前项目 agent 目录里完善和验证
himan create skill api-review --description "Review API changes"

# 3. 用 coding agent 编写内容，推荐结合 himan-skill-metadata 生成元数据

# 4. 发布 patch 版本，写回 source，并安装回当前项目
himan publish skill api-review

# 5. 检查本机、source、agent、lock 和安装目标
himan doctor
```

`himan create` 只负责创建资产空壳；编写 `SKILL.md` 和维护 `himan.yaml` 通常交给 coding agent 完成。

如果 source 中已经有可用资产，也可以在初始化时直接安装：

```bash
himan init https://github.com/your-org/your-himan-source.git \
  --agent codex \
  --install skill/code-review
```

换一台机器或同事拉取包含 `himan.lock` 的项目后：

```bash
himan init https://github.com/your-org/your-himan-source.git --agent codex
himan install
```

`himan install` 无参数时会按当前项目的 `himan.lock` 恢复安装，而不是盲目使用最新版本。

## 核心概念

| 概念 | 说明 |
| --- | --- |
| `source` | 存放资产的 Git 仓库，目录通常包含 `rules/`、`commands/`、`skills/`、`configs/`。 |
| `resource` | himan 中的一份可复用、可安装资产，类型为 `rule`、`command`、`skill`、`config`。 |
| `agent` | 资产安装目标，支持 `cursor`、`claude-code`、`codex`、`openclaw`。 |
| `himan.lock` | 项目级锁文件，记录已安装资产的 source、版本、agent 和安装模式。 |
| Git tag | 资产版本以 `<type>/<name>@<semver>` 标记，例如 `skill/code-review@1.2.0`。 |

## 常用工作流

| 场景 | 命令 |
| --- | --- |
| 添加 source | `himan source add team https://github.com/your-org/himan-source.git --alias team` |
| 切换 source | `himan source use team` |
| 设置默认 agent | `himan agent use codex` |
| 安装资产 | `himan install skill code-review` |
| 递归安装 skill 依赖 | `himan install skill code-review -r --depth 2` |
| 评价资产 | `himan comment skill code-review 9 "Stable team default"` |
| 进入开发态 | `himan dev skill code-review` |
| 发布新版本 | `himan publish skill code-review --minor` |
| 批量发布 | `himan publish skill skill-a,skill-b` |
| 归档资产 | `himan resource archive skill old-workflow --reason "Replaced by new-workflow"` |

完整命令表见 [docs/command-reference.md](./docs/command-reference.md)。

## 资产仓库结构

```text
your-himan-source/
  README.md
  CHANGELOG.md
  rules/my-rule/content.md
  commands/my-command/content.md
  skills/my-skill/SKILL.md
  configs/my-config/config.toml
  archive/
```

每个资产目录可以放一个 `himan.yaml`，用于描述名称、类型、版本、入口、默认 agent、分类、依赖、`comment.score` / `comment.text` 评价和静态分析信息。

更多目录规范、安装目标、lock 行为、多 source、归档和发布细节见 [docs/user-guide.md](./docs/user-guide.md)。

## 配套观测工具

[`himan-tracker`](https://www.npmjs.com/package/@hi-man/himan-tracker) 是同一生态下的本地优先观测工具，目前可用于 Codex 数据采集，并面向 Claude Code 等 agent 扩展；它用来统计对话、运行时 token、耗时，以及 skill、MCP tool、Plugin 使用情况。

它适合回答这些问题：哪些 skill 真正在用、哪些资产长期未使用、token 成本趋势如何、团队智能体工作流是否值得继续投入。默认不采集 prompt、response、代码内容、stdout/stderr 或 shell 参数。

```bash
npm install -g @hi-man/himan-tracker
himan-tracker setup
himan-tracker summary --since 7d
himan-tracker server start --open
```

## 功能支持

| 能力 | 状态 |
| --- | --- |
| Git source | 已支持 |
| Registry source | 预留，暂未开放 |
| `rule` / `command` / `skill` 资产 | 已支持 |
| `config` 资产 | 已支持 Codex；Cursor、Claude Code、OpenClaw 暂未支持 |
| 项目级 `himan.lock` | 已支持 |
| 多 agent 安装 | 已支持 Cursor、Claude Code、Codex、OpenClaw |
| skill 依赖递归安装 | 已支持 |

## 文档

- [用户指南](./docs/user-guide.md)：概念、source 结构、安装目标、lock、发布、归档和 FAQ。
- [命令参考](./docs/command-reference.md)：完整命令速查。
- [错误码](./docs/error-codes.md)：稳定错误码和处理建议。
- [开发文档](./docs/development.md)：本仓库开发、测试和 npm 发布流程。

## 补充说明

- npm 包只承诺 CLI 使用，不提供稳定 Node.js 程序化 API。
