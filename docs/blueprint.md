下面是把我们整段讨论收敛成一个可执行技术方案 + 明确 MVP 范围的版本。我会按“产品定义 → 架构 → 数据规范 → CLI 设计 → 发布流程 → MVP 切割 → 演进路径”来组织，确保你可以直接进入实现阶段。

⸻

一、产品定义（统一认知）

产品定位

himan = AI Coding 时代的 Prompt / Agent 资产管理系统（CLI + Git-based Registry）

⸻

解决的问题

问题	现状
资源分散	rules / commands / skills 分布在多个 repo
不可复用	复制粘贴
无版本治理	prompt 被覆盖
无团队协同	无法统一规范


⸻

核心能力
	1.	资源集中管理（基于 Git）
	2.	本地可查询 & 安装
	3.	版本控制（资源级）
	4.	开发 → 发布闭环

⸻

二、总体架构设计

⸻

1️⃣ 分层架构

           ┌──────────────────────┐
           │   GitHub / GitLab    │  ← 资源仓库（source of truth）
           └─────────┬────────────┘
                     │
           ┌─────────▼────────────┐
           │    ~/.himan/repos    │  ← 本地仓库缓存
           └─────────┬────────────┘
                     │
           ┌─────────▼────────────┐
           │    ~/.himan/store    │  ← 版本缓存（immutable）
           └─────────┬────────────┘
                     │
     ┌───────────────▼───────────────┐
     │         项目目录               │
     │ .cursor / .claude / .himan    │
     └───────────────────────────────┘


⸻

2️⃣ 核心设计原则

✅ 原则 1：资源不可变（immutable）

store 中的内容不能修改


⸻

✅ 原则 2：开发态与运行态分离

状态	位置	是否可编辑
store	~/.himan/store	❌
dev	project/.himan/dev	✅


⸻

✅ 原则 3：项目只持有“引用”

通过软链引用资源


⸻

三、资源规范（必须定义）

⸻

1️⃣ 仓库结构

repo/
  rules/
    code-review/
      himan.yaml
      content.md

  commands/
  skills/


⸻

2️⃣ himan.yaml

name: code-review
type: rule
version: 1.2.0

entry: content.md

description: enforce code review standards

tags:
  - frontend

targets:
  - cursor
  - claude


⸻

3️⃣ 资源版本策略（关键）

使用 Git Tag：

rule/code-review@1.0.0
rule/code-review@1.1.0

👉 实现“资源级版本”

⸻

四、CLI 设计（最终版）

⸻

1️⃣ 初始化

himan init <git_repo>

行为：
	•	clone 到：

~/.himan/repos/<repo-id>


⸻

2️⃣ 列表查询

himan list
himan list rule
himan list command

增强：

himan list --json


⸻

3️⃣ 历史版本（资源级）

himan history rule code-review

实现：

git tag --list "rule/code-review@*"


⸻

4️⃣ 安装资源

himan install rule code-review
himan install rule code-review@1.2.0


⸻

安装逻辑：
	1.	checkout tag
	2.	写入 store：

~/.himan/store/rule/code-review/1.2.0

	3.	创建软链：

.cursor/rules/code-review -> store


⸻

5️⃣ 卸载

himan uninstall rule code-review


⸻

6️⃣ dev 模式（关键能力）

himan dev rule code-review

行为：

.himan/dev/code-review

并替换软链

⸻

7️⃣ 发布（核心闭环）

himan publish rule code-review --patch


⸻

五、发布流程（核心设计）

⸻

流程图

dev 修改
   ↓
diff 检测
   ↓
版本计算（semver）
   ↓
同步 repo
   ↓
commit
   ↓
tag（资源级）
   ↓
push
   ↓
更新本地 store


⸻

关键步骤

⸻

1️⃣ 版本计算

--patch / --minor / --major


⸻

2️⃣ Git 操作

git add .
git commit
git tag rule/code-review@1.2.1
git push origin main --tags


⸻

3️⃣ 本地同步

store 新版本


⸻

六、MVP 功能范围（非常关键）

👉 目标：1 周内可做出来 + 可用

⸻

🎯 MVP 只做“rule”，不做 command/skill

👉 降低复杂度

⸻

🎯 MVP 功能点

⸻

✅ 1. init

himan init <repo>


⸻

✅ 2. list

himan list rule


⸻

✅ 3. history

himan history rule <name>

（基于 git tag）

⸻

✅ 4. install

himan install rule code-review[@version]


⸻

✅ 5. dev

himan dev rule code-review


⸻

✅ 6. publish（必须有）

himan publish rule code-review --patch


⸻

❌ MVP 不做

功能	原因
skills / commands	先收敛
多 repo	简化
registry	太重
AI search	非核心
PR 自动化	第二阶段
lock 文件	第二阶段


⸻

七、核心数据结构（本地）

⸻

~/.himan

~/.himan/
  repos/
  store/
    rule/
      code-review/
        1.0.0/
        1.1.0/


⸻

项目内

project/
  .cursor/rules/
  .himan/dev/


⸻

八、关键技术点

⸻

1️⃣ Git 操作
	•	clone
	•	fetch
	•	tag
	•	checkout / archive

⸻

2️⃣ 软链

ln -s


⸻

3️⃣ semver

Node：

semver


⸻

4️⃣ diff

git diff


⸻

九、演进路线（非常重要）

⸻

阶段 1（MVP）
	•	单 repo
	•	rule only
	•	tag 版本
	•	本地 CLI

⸻

阶段 2
	•	lock 文件
	•	多 repo
	•	PR 发布
	•	index.json

⸻

阶段 3
	•	registry（远程）
	•	权限控制
	•	团队协作

⸻

阶段 4（差异化）
	•	AI 搜索
	•	prompt ranking
	•	usage analytics

⸻

十、最终一句话总结

himan 的本质不是“工具”，而是：

👉 Prompt 的包管理系统 + DevOps 流程
