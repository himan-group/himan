# User Guide

本文承接 README 中不适合展开的细节：source 仓库结构、安装目标、lock 行为、多 source、发布、归档和常见问题。

## 环境要求

- Node.js `>=20 <23 || >=24`；本仓库开发环境由 [.nvmrc](../.nvmrc) 固定为 `22.22.1`。
- Git；Git source 的初始化、扫描、安装、发布和版本查询都依赖本机 Git。

## 资源类型

| 类型      | 默认入口      | 用途                                     |
| --------- | ------------- | ---------------------------------------- |
| `rule`    | `content.md`  | Agent 规则或长期约束。                   |
| `command` | `content.md`  | 可复用命令模板。                         |
| `skill`   | `SKILL.md`    | 带工作流说明、依赖和上下文约束的能力包。 |
| `config`  | `config.toml` | Codex 配置资源；当前仅支持 Codex。       |

## Source 仓库结构

himan Git source 是一个普通 Git 仓库，推荐把仓库级说明放在根目录 `README.md` 和 `CHANGELOG.md`，不要把这些说明塞进最终安装给 agent 消费的资源目录。

```text
your-himan-source/
  README.md
  CHANGELOG.md
  rules/
    my-rule/
      himan.yaml
      content.md
  commands/
    my-command/
      himan.yaml
      content.md
  skills/
    my-skill/
      himan.yaml
      SKILL.md
  configs/
    my-config/
      himan.yaml
      config.toml
  archive/
    rules/
    commands/
    skills/
    configs/
```

- `README.md`：source 入口文档，建议记录资源索引、推荐安装方式、默认 agent 策略和维护约定。
- `CHANGELOG.md`：source 级变更记录，建议记录新增、变更、废弃、归档和重要发布。
- `himan.yaml`：可选元数据；存在时用于扫描、校验、读取入口、默认 agent、分类、评价、依赖和静态分析。
- `archive/`：source 级软下线目录；默认资源列表、README 索引和 `source sync` active 快照不会包含归档资源。

示例 `himan.yaml`：

```yaml
name: my-skill
type: skill
version: 0.1.0
entry: SKILL.md
description: Review API changes.
comment:
  score: 9
  text: Stable team default.
agents:
  - codex
analysis:
  dependencies:
    skills:
      - common-code-review
```

`comment.score` 是 1-10 分评价；`comment.text` 是可选短评，最多 64 个单词或汉字。`analysis` 是静态构建信息，不记录运行时 token 或执行耗时。`himan create skill` 会为新 skill scaffold 生成基础分析信息。

## 初始化与 source 管理

```bash
himan system setup https://github.com/your-org/himan-source.git --agent codex
himan repo add team https://github.com/your-org/himan-source.git --alias team
himan repo use team
himan repo list
```

`himan setup` / `himan doctor` 是顶层简写（等价 `himan system setup` / `himan system doctor`），`himan init` 保留为 legacy 别名；`source` 是 `repo` 命令组的兼容别名。

source 的配置名是本地内部 key，别名是日常命令使用的稳定引用。显式资源命令默认作用于当前 current source，也可以在 `list`、`history`、`install <type> ...`、`publish` 中用 `--source <alias>` 指定 source。

资源评价可通过 `himan comment <type> <name> <score> [text...]` 写入 source 元数据，也可使用完整形式 `himan resource comment ...`；`resource list` 默认展示评分，同分类内按评分从高到低排序，未评分资源排最后，传 `--comment` 时额外展示短评。

无参数 `himan install` 会按 `himan.lock` 中记录的 source 恢复安装，不受当前 default source 切换影响。lock 的顶层 `source` 是默认 source；通过 `--source <alias>` 安装或发布到其他 source 时，lock 会在 `sources` 中记录额外 source，并让对应资源条目用 `source` 引用它。

## Agent 与安装目标

支持的 agent：

- `cursor`
- `claude-code`
- `codex`
- `openclaw`
- `copilot`

默认 agent 解析顺序：当前项目 `.himan/config.json`、全局 `~/.himan/config.json`、资源 metadata、内置默认 `codex`。

```bash
himan agent use codex
himan agent use cursor,claude-code -g
himan agent current
```

项目级安装目标：

| Agent         | `rule`                                                             | `command`                   | `skill`                                                              | `config`                                            |
| ------------- | ------------------------------------------------------------------ | --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| `cursor`      | `.cursor/rules/<name>`                                             | `.cursor/commands/<name>`   | `.cursor/skills/<name>`                                              | 不支持                                              |
| `claude-code` | `.claude/rules/<name>`                                             | `.claude/commands/<name>`   | `.claude/skills/<name>`                                              | 不支持                                              |
| `codex`       | `.codex/rules/<name>`                                              | `.agents/commands/<name>`   | `.agents/skills/<name>`                                              | `.codex/configs/<name>` 并激活 `.codex/config.toml` |
| `openclaw`    | `.openclaw/rules/<name>`                                           | `.openclaw/commands/<name>` | `.openclaw/skills/<name>`                                            | 不支持                                              |
| `copilot`     | `.github/copilot/rules/<name>` → `.github/copilot-instructions.md` | 不支持                      | `.github/copilot/skills/<name>` → `.github/prompts/<name>.prompt.md` | 不支持                                              |

加 `-g` / `--global` 时安装到用户 home 下对应目录，例如 `~/.cursor/...`、`~/.claude/...`、`~/.agents/...`、`~/.codex/...`、`~/.openclaw/...`、`~/.github/copilot/...`。全局安装不写当前项目的 `himan.lock`。

## 安装、lock 与恢复

```bash
himan install skill code-review
himan install skill code-review@1.2.0
himan install skill code-review -r --depth 2
himan install rule secure-coding --mode link
himan install
```

- 默认安装模式是 `copy`；可用 `--mode link` 创建软链。
- 单资源安装会写入当前项目 `himan.lock`，记录 source、精确版本、agent 和安装模式；未显式记录 `source` 的资源使用 lock 顶层默认 source。
- `himan install` 无参数时按 lock 批量恢复安装。
- `install skill <name> -r` 会安装 `himan.yaml` 中声明的 skill 依赖；`--depth` 控制递归层数，默认 `1`。
- 归档资源直接安装会失败；需要显式传 `--include-archived`，但 lock 中已有记录的归档资源仍可被无参数安装恢复。

## 创建、开发与发布

```bash
himan create skill api-review --description "Review API changes"
himan resource dev skill api-review
himan resource publish skill api-review
himan resource publish skill api-review --minor
himan resource publish skill skill-a,skill-b
himan resource publish --all
```

顶层简写仍可用：

```bash
himan dev skill api-review
himan publish skill api-review
himan publish skill api-review --minor
himan publish skill skill-a,skill-b
himan publish --all
```

`create` 默认在当前项目的 agent 目标目录创建资源脚手架，供你直接在真实 agent 环境里验证。`dev` 会优先编辑项目内已有资源；如果资源只存在于用户级全局安装目录，会先复制到当前项目目标目录。

`publish` 会把项目目录里的资源同步回 source，创建或更新资源版本 tag，并自动维护 source 根目录文档：

- `README.md`：更新受控区；其中 `<!-- himan:resources:start -->` 和 `<!-- himan:resources:end -->` 之间维护资源索引，没有 marker 时会追加受控索引区；同时也会维护带 `@hi-man/himan` npm 地址和常用命令的 `Use With Himan` 说明区。
- `CHANGELOG.md`：按日期 release heading 记录发布、归档等 source 级变更。
- 发布成功后默认把新版本安装回当前项目并更新 `himan.lock`；传 `-g` / `--global` 时安装到用户级目录且不写当前项目 lock。

单资源内容与最新已发布版本一致时，发布会以 `E_PUBLISH_NO_CHANGES` 停止；批量发布会把这类资源记为 skipped 后继续。

## Source 文档初始化

```bash
himan repo init-docs
himan repo init-docs --dry-run
himan repo init-docs --force
himan repo init-docs --repair-history
```

`repo init-docs` 为当前 default source 生成仓库级 `README.md` 和 `CHANGELOG.md`。默认只创建缺失文件；`--force` 会覆盖已有文件，重建 README 里的 `Use With Himan` 说明区和资源索引；`--repair-history` 会修复这些受控 README 区块以及历史 publish 记录。

## 归档、恢复与重命名

```bash
himan resource archive skill old-review --reason "Replaced by api-review"
himan resource restore skill old-review
himan resource rename skill old-name new-name --dry-run
```

`archive` 是 source 级软下线：移动资源目录到 `archive/<plural>/<name>`，从默认列表、README 资源索引和 source sync active 快照中移除，但不删除已有 Git tag、本地 store、项目安装目录或 `himan.lock`。

`restore` 会把归档资源恢复回 active 类型目录。

`rename` 暂不推荐作为日常操作。它会移动 source 目录、更新 metadata、维护 README / CHANGELOG，并默认迁移当前项目安装目标和 lock；已有历史 tag 不会被改写。

## 本地状态与数据

| 路径                                      | 说明                          |
| ----------------------------------------- | ----------------------------- |
| `~/.himan/config.json`                    | source 配置和全局默认 agent。 |
| `~/.himan/repos/`                         | Git source 缓存。             |
| `~/.himan/store/<type>/<name>/<version>/` | 不可变资源快照。              |
| `~/.himan/index.json`                     | source 扫描缓存。             |
| `<project>/himan.lock`                    | 当前项目已安装资源锁。        |
| `<project>/.himan/config.json`            | 当前项目默认 agent。          |

## FAQ

**Q: `source add` 之后为什么 `resource list` 没变化？**  
A: `source add` 只新增一个可用来源，不会自动切换。执行 `himan repo use <source-or-alias>` 后再查看，或在单次资源命令中传 `--source <alias>`。

**Q: `resource list` 和 `source list` 有什么区别？**  
A: `source list` 查看本机配置了哪些来源；`resource list` 查看当前 source 里有哪些资源。

**Q: 为什么无参数 `himan install` 不使用当前 default source？**  
A: 无参数安装是 lock 恢复，必须按项目锁定的 source 和版本恢复，避免 default source 被切换后产生不可复现安装。

**Q: 应该用 `copy` 还是 `link`？**  
A: 团队项目默认建议 `copy`，更稳定、可离线；需要在 source 或 store 中快速调试资源时再用 `--mode link`。
