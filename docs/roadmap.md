# himan 当前产品 Roadmap

> 状态说明：本文只描述当前产品优先级与近期排期方向，不是当前 CLI 行为的完整事实源。当前实现请优先参考仓库根目录 [README.md](../README.md)、[v1.0 当前进展](./v1.0/README.md) 和 [repository map](./repository-map.md)。长期阶段路线图见 [docs/global/README.md](./global/README.md)。

## 1. 说明

本文按当前仓库已实现能力与产品缺口，整理近期更适合排期执行的 `P0 / P1 / P2` roadmap。

- `P0`：优先补齐团队治理闭环，降低发布风险
- `P1`：提升发现、升级、依赖管理体验
- `P2`：推进平台化与智能化能力

---

## 2. P0：先补齐团队治理闭环

目标：
- 把当前以 Git source 为中心的 CLI，从“个人可用”推进到“团队可控可审查”
- 优先降低错误发布、不可审计发布、source 文档漂移等治理风险

范围：
- PR 驱动发布
  - 支持用分支 / PR 替代直接 push/tag 的发布路径
  - 让 source README / CHANGELOG 更新、版本变更和资源发布进入现有代码评审流程
- 更严格的 publish preflight
  - 扩展 `himan.yaml` schema 校验、entry 存在校验、依赖可解析校验、agent/type 兼容性校验
  - 增加 source managed block 完整性、重复 tag、脏工作区等发布前阻断检查
- 发布失败可恢复与可诊断性增强
  - 输出更明确的失败阶段、恢复建议和机器可读结果
  - 保证 publish 相关副作用的顺序和幂等性更清晰

预期结果：
- 发布流程从“可用”升级为“可审查、可阻断、可恢复”
- `himan` 更适合作为团队共享资源仓库的默认发布入口

---

## 3. P1：再提升发现、升级和依赖管理体验

目标：
- 解决“资源越来越多以后怎么找、怎么升级、怎么排查依赖”的问题
- 让多 source、多 skill 依赖的日常使用成本明显下降

范围：
- 跨 source 聚合检索
  - 在当前“多 source 可配置、单 source 生效”基础上，补齐聚合 list/search/filter 能力
  - 支持按 `source`、`type`、`agent`、category、score 等维度筛选
- 升级与差异命令
  - 增加 `outdated`、`upgrade`、版本 diff 等能力
  - 让项目能清楚知道哪些已安装资源有新版本、升级后会发生什么变化
- 依赖图与诊断
  - 为 skill 递归依赖补齐 tree / why / conflict 诊断
  - 帮助用户理解依赖来源、循环依赖和冲突风险
- 扩展 `config` 资源覆盖面
  - 在 Codex 之外，逐步评估 Cursor、Claude Code、OpenClaw、Copilot 的配置资源支持
- 新增 `subagent` 资源类型（提示词定义的子代理）
  - Codex：`~/.codex/agents/*.toml` / `.codex/agents/*.toml`
  - Claude Code：`~/.claude/agents/*.md` / `.claude/agents/*.md`
  - 其他 agent 存放约定待调研；需求详情见 `docs/v1.0/issues/2026-08-25_subagent-resource.md`
- 规划新 agent 支持：WorkBuddy / deepseek-harness（Agent Skills 标准兼容）；OpenClaw 保留为 Claw 生态入口；Copilot 保留但以后可能废弃

预期结果：
- `himan` 不只是“能装”，而是“容易发现、容易升级、容易排障”
- 多 source 和 skill 依赖能力从基础可用提升到日常可运营

---

## 4. P2：最后做平台化与智能化能力

目标：
- 在 Git source 模式跑稳之后，再进入平台化和差异化建设
- 避免过早投入高成本基础设施，先由真实使用规模驱动演进

范围：
- Registry source / 托管索引
  - 把当前预留未实现的 registry source 从接口占位推进到真正可用
  - 提供统一元数据、分发和检索入口
- 权限与策略控制
  - 组织级读写权限、审核 gate、发布策略、breaking change guard
  - 为团队 PromptOps 治理提供标准控制面
- 使用分析与推荐
  - 结合 `himan-tracker` 等生态能力补 usage analytics
  - 在真实使用数据基础上再做 ranking、推荐、废弃提示和影响分析

预期结果：
- `himan` 从 CLI 工具演进为团队级 Prompt / Agent 资产平台
- 平台化能力和智能能力建立在稳定的 Git 工作流之上，而不是替代它
