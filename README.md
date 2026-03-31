# himan
himan（含义为"Hey, man"），AI Coding 时代的 Prompt / Agent 资产管理系统（CLI + Git-based Registry）

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
