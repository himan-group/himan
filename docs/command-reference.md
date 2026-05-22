# Command Reference

`himan` 只有一个 CLI 入口，命令按 `source`、`resource`、`project`、`agent`、`doctor` 分组。部分旧版顶层生命周期命令仍兼容，但新文档统一使用分组命令。

## Quick Commands

```bash
himan --help
himan source --help
himan resource --help
himan project --help
himan agent --help
```

## Top-level

| 命令 | 说明 |
| --- | --- |
| `himan init <git_repo> [--agent a,b] [--install type/name[@version],...] [--mode link\|copy] [--json]` | 初始化 Git source；可同时写当前项目默认 agent 并安装选定资源。 |
| `himan doctor [--json]` | 检查 Node/Git、Himan home、当前 source、资源扫描、默认 agent、项目 lock、归档引用和安装目标。 |

## Source

| 命令 | 说明 |
| --- | --- |
| `himan source add <name> <git_repo> [--alias alias]` | 添加命名 Git source；未传 `--alias` 时别名默认等于 `name`。 |
| `himan source use <source> [--alias alias]` | 按配置名或别名切换默认 source；可同时设置目标 source 别名。 |
| `himan source alias <source> <alias>` | 设置或修改 source 别名。 |
| `himan source rename <source> <new-name> [--alias alias]` | 重命名本地 source 配置名；可同时修改别名。 |
| `himan source list [--json]` | 查看已配置 source、别名和当前 source。 |
| `himan source init-docs [--source alias] [--force] [--repair-history] [--dry-run] [--json]` | 为 source 生成或修复仓库级 `README.md` / `CHANGELOG.md`。 |
| `himan source clone <from> <to> [--branch b] [--target-branch b] [--add-source name] [--use] [--dry-run] [--json]` | 将 Git source 分支和 himan 管理的资源 tag 复制到空目标 Git 仓库。 |
| `himan source sync <from> <to> [--target-branch b] [--add-source name] [--use] [--dry-run] [--json]` | 将最新资源快照同步到目标 Git 仓库并创建对应最新 tag。 |
| `himan source init <git_repo>` | 与顶层 `himan init` 等价，便于统一使用 `himan source ...` 入口。 |

## Resource

| 命令 | 说明 |
| --- | --- |
| `himan resource list [type] [--source alias] [--agent a,b] [--brief] [--installed] [--archived] [--include-archived] [--json]` | 默认列出当前 source 的 active 资源；未传 `type` 时按类型分组；`--installed` 改为查看当前项目已安装资源。 |
| `himan resource history <type> <name> [--source alias] [--json]` | 按 Git tag 查看资源版本历史。 |
| `himan resource create <type> <name> [--description text] [--agent a,b] [--entry file] [--template name] [--force] [--dry-run] [--json]` | 在当前项目 agent 目标目录创建资源脚手架。 |
| `himan resource archive <type> <name> [--reason text] [--dry-run] [--json]` | 将当前 source 中的资源移动到 `archive/<plural>/<name>`。 |
| `himan resource restore <type> <name> [--dry-run] [--json]` | 将归档资源恢复回 active 类型目录。 |
| `himan resource rename <type> <old-name> <new-name> [--dry-run] [--no-project] [--json]` | 重命名当前 source 中的资源；当前不推荐作为日常操作。 |

支持的 `type`：`rule`、`command`、`skill`、`config`。

## Project

| 命令 | 说明 |
| --- | --- |
| `himan project list [type] [--agent a,b] [--json]` | 查看当前项目 `himan.lock` 中记录的已安装资源。 |
| `himan project install [type] [name[@version]] [--source alias] [--agent a,b] [--mode link\|copy] [-g\|--global] [--include-archived] [-r\|--recursive] [--depth n]` | 有参数时安装单个资源；无参数时按 `himan.lock` 恢复安装。 |
| `himan project dev <type> <name>` | 切换到开发态；项目资源原地编辑，全局资源先复制到当前项目目标目录。 |
| `himan project uninstall <type> <name>` | 从项目移除安装目标，并删除 `himan.lock` 条目。 |
| `himan project publish [type] [name[,name...]] [--patch\|--minor\|--major] [--source alias] [-g\|--global] [--all]` | 发布单个、多个或全部当前项目资源；默认 patch。 |

常用简写在顶层也可用：

```bash
himan list
himan install skill code-review
himan dev skill code-review
himan publish skill code-review
```

## Agent

| 命令 | 说明 |
| --- | --- |
| `himan agent list [--json]` | 查看支持的 agent。 |
| `himan agent use <agent[,agent]> [--project\|-g\|--global] [--json]` | 设置当前项目或全局默认 agent；默认写当前项目。 |
| `himan agent current [--json]` | 查看当前项目、全局和最终生效的默认 agent。 |
| `himan agent clear [--project\|-g\|--global] [--json]` | 清除当前项目或全局默认 agent；默认清当前项目。 |

支持的 agent：`cursor`、`claude-code`、`codex`、`openclaw`。

## Publish Examples

```bash
himan publish skill risk-check
himan publish skill risk-check --minor
himan publish skill skill-a,skill-c
himan publish skill --all
himan publish --all
himan publish skill risk-check -g
```

发布源优先使用当前项目 agent 目标目录。发布成功后默认安装到当前项目并更新 `himan.lock`；传 `-g` / `--global` 时安装到用户级目录且不写当前项目 lock。

## JSON And Errors

支持 `--json` 的命令在失败时会向 `stderr` 输出机器可读错误 JSON。稳定错误码见 [error-codes.md](./error-codes.md)。
