# Resource Placement Guide

本文定义 himan 资源的“规范落位”：新建资源应放在哪个目录、需要带什么管理标记，以及如何从“开发态”进入“托管态”。目标是让 agent（如 Codex）按指引落位资源，从源头减少无法被 himan 发现和管理的“影子资源”。

> 这份指南是 himan 分发资源（placement 类 skill/rule）的内容来源：把他部署到 himan source 后，agent 会在创建资源时自动遵循本文的路径约定与标记要求。

## 规范位置（canonical paths）

资源按 `agent × 类型` 落到约定目录；目录名必须是复数类型目录（`rules` / `commands` / `skills` / `configs`），资源名为 kebab-case 目录。

| agent | rule | command | skill | config |
| --- | --- | --- | --- | --- |
| cursor | `.cursor/rules/<name>` | `.cursor/commands/<name>` | `.cursor/skills/<name>` | 保留 |
| claude-code | `.claude/rules/<name>` | `.claude/commands/<name>` | `.claude/skills/<name>` | 保留 |
| codex | `.codex/rules/<name>` | `.agents/commands/<name>` | `.agents/skills/<name>` | `.codex/configs/<name>` |
| openclaw | `.openclaw/rules/<name>` | `.openclaw/commands/<name>` | `.openclaw/skills/<name>` | 保留 |
| copilot | `.github/copilot-instructions.md`（合并） | 不支持 | `.github/prompts/<name>.prompt.md` | 保留 |

用户级（全局）资源放在 `~` 下同名目录；项目级资源放在项目根目录下同名目录。

## 管理标记（himan.yaml）

每个资源目录必须带 `himan.yaml`，至少包含：

```yaml
name: my-resource
type: skill            # rule | command | skill | config
entry: SKILL.md        # 入口文件：rule/command 为 content.md，skill 为 SKILL.md，config 为 config.toml
version: 0.1.0
agents: [codex]        # 目标 agent
```

有标记但未登记的资源视为“开发态”，`system audit` 不会报影子资源；无标记的目录才会被识别为 unmanaged 影子资源，提示迁移或清理。

## 从开发态进入托管态

1. 用 `himan create <type> <name>` 在规范位置创建脚手架（自动写入 `himan.yaml` 标记与默认入口）。
2. 编辑入口文件完善内容。
3. 二选一登记：
   - Git source：`himan resource publish <type> <name>`（回写 source、打版本 tag、安装回项目）；
   - 私有本地 source：`himan system migrate <path>`（登记为托管、同步 store，原目录保留）。
4. 用 `himan system audit list` 确认资源显示为 managed。

## 不要做的事

- 不要直接往 agent 目录手工丢资源目录却不带 `himan.yaml`（会变成影子资源）。
- 不要把资源放到类型目录之外或使用非规范目录名（himan 扫描不到）。
- 不要直接编辑 `~/.himan/store/`（它是托管缓存的副本，可随时从 source 重建）。
