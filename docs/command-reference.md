# Command Reference

`himan` 只有一个 CLI 入口，命令按 `repo`、`resource`、`project`、`agent`、`system` 分组。部分旧版顶层生命周期命令仍兼容，但新文档统一使用分组命令；`source` 是 `repo` 的兼容别名，`himan setup` / `himan doctor` 是 `system` 组的顶层别名。

## Quick Commands

```bash
himan --help
himan repo --help
himan system --help
himan resource --help
himan project --help
himan agent --help
```

## Top-level

| 命令 | 说明 |
| --- | --- |
| `himan setup [git_repo] [--agent a,b] [--install type/name[@version],...] [--mode link\|copy] [--json]` | 本机环境设置向导（等价 `himan system setup`）：选择/初始化 source、设置默认 agent、选择初始安装与安装模式，执行前输出确认摘要；`himan init` 保留为 legacy 别名。 |
| `himan doctor [--json]` | 等价 `himan system doctor`：检查 Node/Git、Himan home、当前 source、资源扫描、默认 agent、项目 lock、归档引用和安装目标。 |

## System

| 命令 | 说明 |
| --- | --- |
| `himan system setup [git_repo] [--agent a,b] [--install refs] [--mode link\|copy] [--json]` | 本机环境设置向导；顶层 `himan setup` 等价，`himan init` 为 legacy 别名。TTY 下缺少参数时逐项提示并在执行前确认；非 TTY 缺失必填参数时报错；`--json` 不进入交互。 |
| `himan system doctor [--json]` | 检查 Himan 运行时与项目健康；顶层 `himan doctor` 等价。 |
| `himan system audit [stats\|list\|issues] [--scope global\|project\|all] [--agent agent] [--json]` | 机器级资源盘点：`stats` 输出统计（不带子命令时默认）、`list` 输出每条资源明细、`issues` 只列异常（warn/error 级别，存在 error 时退出码非 0）。扫描用户级 agent 目录与当前项目，区分 managed / unmanaged / drifted，并检查重复、版本漂移、lock target 缺失、store 孤儿缓存。 |
| `himan system migrate <path> [--type rule\|command\|skill\|config] [--agent a,b] [--dry-run] [--json]` | 把未托管的本地资源目录迁移为 himan 托管：识别类型、生成 `himan.yaml`（含静态分析）、写入私有本地 source 并同步 store；原目录保留不动。迁移后可 `himan install <type> <name> --source local`。 |

`system cleanup` 属于规划中的系统治理能力，尚未实现。

## Repo（原 Source）

| 命令 | 说明 |
| --- | --- |
| `himan repo add <name> <git_repo> [--alias alias]` | 添加命名 Git source；未传 `--alias` 时别名默认等于 `name`。 |
| `himan repo use <source> [--alias alias]` | 按配置名或别名切换默认 source；可同时设置目标 source 别名。 |
| `himan repo alias <source> <alias>` | 设置或修改 source 别名。 |
| `himan repo rename <source> <new-name> [--alias alias]` | 重命名本地 source 配置名；可同时修改别名。 |
| `himan repo list [--json]` | 查看已配置 source、别名和当前 source。 |
| `himan repo init-docs [--source alias] [--force] [--repair-history] [--dry-run] [--json]` | 为 source 生成或修复仓库级 `README.md` / `CHANGELOG.md`。 |
| `himan repo clone <from> <to> [--branch b] [--target-branch b] [--add-source name] [--use] [--dry-run] [--json]` | 将 Git source 分支和 himan 管理的资源 tag 复制到空目标 Git 仓库。 |
| `himan repo sync <from> <to> [--target-branch b] [--add-source name] [--use] [--dry-run] [--json]` | 将最新资源快照同步到目标 Git 仓库并创建对应最新 tag。 |

`himan source ...` 仍可用，行为与 `himan repo ...` 一致（兼容别名）。

## Resource

| 命令 | 说明 |
| --- | --- |
| `himan resource list [type] [--source alias] [--agent a,b] [--brief] [--comment] [--archived] [--include-archived] [--json]` | 默认列出当前 source 的 active 资源和评分；同分类内按评分从高到低排序，未评分资源排最后；未传 `type` 时按类型分组；`--comment` 额外展示短评。 |
| `himan resource history <type> <name> [--source alias] [--json]` | 按 Git tag 查看资源版本历史。 |
| `himan resource create <type> <name> [--description text] [--agent a,b] [--entry file] [--template name] [--force] [--dry-run] [--json]` | 在当前项目 agent 目标目录创建资源脚手架。 |
| `himan resource comment <type> <name> <score> [text...] [--source alias] [--clear-text] [--dry-run] [--json]` | 写入或修改资源 `comment.score` 和可选 `comment.text`；评分为 1-10，短评最多 64 个单词或汉字。 |
| `himan resource dev <type> <name>` | 切换到开发态；项目资源原地编辑，全局资源先复制到当前项目目标目录。 |
| `himan resource publish [type] [name[,name...]] [--patch\|--minor\|--major] [--source alias] [-g\|--global] [--all]` | 发布单个、多个或全部当前项目资源；默认 patch。 |
| `himan resource archive <type> <name> [--reason text] [--dry-run] [--json]` | 将当前 source 中的资源移动到 `archive/<plural>/<name>`。 |
| `himan resource restore <type> <name> [--dry-run] [--json]` | 将归档资源恢复回 active 类型目录。 |
| `himan resource rename <type> <old-name> <new-name> [--dry-run] [--no-project] [--json]` | 重命名当前 source 中的资源；当前不推荐作为日常操作。 |

支持的 `type`：`rule`、`command`、`skill`、`config`。

`himan comment <type> <name> <score> [text...]` 是 `himan resource comment ...` 的顶层简写。

`himan resource list --installed` 已弃用：查看当前项目已安装资源请使用 `himan project list`。

## Project

| 命令 | 说明 |
| --- | --- |
| `himan project list [type] [--agent a,b] [--json]` | 查看当前项目 `himan.lock` 中记录的已安装资源。 |
| `himan project install [type] [name[@version]] [--source alias] [--agent a,b] [--mode link\|copy] [-g\|--global] [--include-archived] [-r\|--recursive] [--depth n]` | 有参数时安装单个资源；无参数时按 `himan.lock` 恢复安装。 |
| `himan project uninstall <type> <name> [-g\|--global]` | 默认从项目移除安装目标并删除 `himan.lock` 条目；传 `-g` 时从用户级 agent 目录移除，不修改项目 lock。 |

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
