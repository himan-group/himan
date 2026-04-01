# himan

himan（含义为"Hey, man"），AI Coding 时代的 Prompt / Agent 资产管理系统（CLI + Git-based Registry）

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
# 编辑项目下 .himan/dev/my-rule/
himan publish rule my-rule --patch
```

- **rule**：支持 `create`、`list`、`history`、`install`、`dev`、`publish`；安装后软链到项目的 `.cursor/rules/<name>`。
- **command / skill**：支持 `create`、`list`、`history`、`publish`（写入 `~/.himan/store`，暂无项目内安装命令）。

版本以 Git tag 为准，格式：`rule/my-rule@1.0.0`。更多设计见 [docs/mvp](./docs/mvp/README.md)。

## 常用命令

| 命令                             | 说明                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `init <git_url>`                 | 克隆/更新源仓库，写入 `~/.himan/config.json`                                        |
| `list [type] [--json]`           | 列出资源；`type` 为 `rule` / `command` / `skill`，默认 `rule`                       |
| `history <type> <name> [--json]` | 按 tag 查看版本历史                                                                 |
| `install rule <name>[@version]`  | 仅 **rule**；不指定版本则装最新                                                     |
| `dev rule <name>`                | 仅 **rule**；复制到 `.himan/dev` 并切软链                                           |
| `create <type> <name>`           | 脚手架；常用选项：`--description`、`--target a,b`、`--dry-run`、`--force`、`--json` |
| `publish <type> <name>`          | 默认 `--patch`；可选 `--minor` / `--major`（勿同时使用多个）                        |

`publish` 优先使用项目里 `.himan/dev/<name>`，否则用源仓库里对应目录。需要可推送的 Git 权限。

## 当前范围

- 源：**仅 Git**（`init`）。Registry 适配器已预留，尚未实现。
- `install` / `dev`：**仅 rule**。`command` / `skill` 只做仓库内管理与发布进 store。

## 开发与测试

```bash
pnpm test
```

## 发布 npm 包（维护者）

```bash
pnpm run release:dry-run   # 检查 + dry-run 发布
pnpm run release:test      # 测试 tag
pnpm run release:latest    # latest
```

测试版安装：`npm i himan@test`。
