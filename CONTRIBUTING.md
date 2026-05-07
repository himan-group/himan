# Contributing

感谢你愿意改进 `himan`。本文说明提交 issue、PR 和本地验证的基本约定。

## 开始之前

- 用户安装和使用 CLI 请先看 [README.md](./README.md)。
- 本地开发、测试和发布流程请看 [docs/development.md](./docs/development.md)。
- 当前事实源以 README 和 [docs/codex/repo-map.md](./docs/codex/repo-map.md) 为准；规划类文档可能包含历史阶段说明。

## 提交 Issue

提交 bug 时请尽量包含：

- 使用的 `himan` 版本、Node.js 版本和操作系统。
- 执行的命令、输入参数和完整错误输出。
- 相关的 source repo 结构或最小复现步骤。
- 是否使用了 `--json`，以及对应的错误码。

提交功能请求时请说明：

- 要解决的用户场景。
- 期望的 CLI 命令或行为。
- 对已有 `rule` / `command` / `skill` 资源和 `himan.lock` 的兼容性影响。

## 提交 PR

建议流程：

1. Fork 或从功能分支开始修改。
2. 保持改动聚焦，避免把无关重构混进同一个 PR。
3. 如果改动用户可见行为，请同步更新 README 或相关 `docs/`。
4. 如果改动发布内容或用户可见能力，请更新 [CHANGELOG.md](./CHANGELOG.md) 的 `Unreleased` 段。
5. 提交 PR 前运行合适的验证命令。

常用验证：

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

发布敏感或跨模块改动建议运行：

```bash
pnpm run verify
```

## 代码约定

- TypeScript source imports use `.js` extensions because the package uses ESM and `moduleResolution: NodeNext`.
- Keep `src/bin/` entry files thin; command registration belongs in `src/cli/`.
- Keep lifecycle orchestration in `src/services/index.ts`.
- Put Git/source/resource/version mechanics in `src/adapters/`.
- Business failures should use `HimanError` and stable `errorCodes`.

## 文档约定

- README 面向 CLI 用户，避免放维护者细节。
- 开发、测试、发布和 CI 维护内容放在 [docs/development.md](./docs/development.md)。
- 规划文档需要清楚标注它是当前事实、历史规划，还是未来目标。
