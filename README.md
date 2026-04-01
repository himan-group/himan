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
# 编辑项目下 .himan/dev/my-rule/
himan publish rule my-rule --patch
```

- **rule / command / skill**：都支持 `create`、`list`、`history`、`install`、`dev`、`publish`、`uninstall`。
- 安装后项目链接位置：
  - `rule` -> `.cursor/rules/<name>`
  - `command` -> `.cursor/commands/<name>`
  - `skill` -> `.cursor/skills/<name>`
- lock 文件：`install <type> <name[@version]>` 会写入 `himan.lock`；`himan install`（无参数）会按 lock 批量恢复安装。

版本以 Git tag 为准，格式：`rule/my-rule@1.0.0`。更多设计见 [docs/mvp](./docs/mvp/README.md)。

## 常用命令

| 命令                             | 说明                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `init <git_url>`                 | 克隆/更新源仓库，写入 `~/.himan/config.json`                                        |
| `source add <name> <git_url>`    | 添加命名 Git 源                                                                       |
| `source use <name>`              | 切换默认源                                                                             |
| `source list [--json]`           | 查看已配置源                                                                           |
| `list [type] [--json]`           | 列出资源；`type` 为 `rule` / `command` / `skill`，默认 `rule`                       |
| `history <type> <name> [--json]` | 按 tag 查看版本历史                                                                 |
| `install [type] [name[@version]]` | 有参数时安装指定资源；**无参数**时按 `himan.lock` 批量安装                         |
| `dev <type> <name>`                | 切换到开发态并把项目链接指向 `.himan/dev/...`                                      |
| `uninstall <type> <name>`          | 从项目移除安装链接，并同步删除 `himan.lock` 条目                                   |
| `create <type> <name>`           | 脚手架；常用选项：`--description`、`--target a,b`、`--dry-run`、`--force`、`--json` |
| `publish <type> <name>`          | 默认 `--patch`；可选 `--minor` / `--major`（勿同时使用多个）                        |

`publish` 优先使用项目里 `.himan/dev` 对应目录，否则用源仓库里对应目录。需要可推送的 Git 权限。若该资源已在 lock 中，发布后会同步更新 lock 版本。

## 当前范围

- 源：**仅 Git**（`init`）。Registry 适配器已预留，尚未实现。

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
