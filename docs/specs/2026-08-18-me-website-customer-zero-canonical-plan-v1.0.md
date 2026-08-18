# Magic Engine 官网 Customer Zero — Canonical Plan v1.0

> 日期：2026-08-18  
> Product Owner：Ray  
> 状态：**产品方案冻结 / 文档-only**。本文不授权代码、schema、migration、生产写入、deploy、merge 或外部付费调用。  
> 适用范围：`magicengine.com.au` 作为 Magic Engine 2.0 的第一个 Website / GEO Customer Zero。  
> 上游契约：
> - [ME2 WP00 契约冻结 v1.0](./2026-08-10-me2-wp00-contract-freeze-v1.0.md)
> - [ME2 GEO 测量契约 v1.0](./2026-08-10-me2-geo-measurement-contract-v1.0.md)
> - [ME2 页面优化共享能力契约 v1.0](./2026-08-10-me2-page-optimization-capability-v1.0.md)
> - [ME2 执行内核 v1](./2026-08-08-me2-execution-kernel-v1.md)
>
> **本文是 Magic Engine 官网 Customer Zero 的唯一产品 Canonical Plan。** 任何 Claude Code / Codex / Agent / Issue / PR 若与本文冲突，应先停下并回到 Product Owner 重新确认，不得自行“补全产品设计”。

---

## 1. 这个项目到底是什么

这不是“一次官网 SEO/GEO 优化项目”。

它是：

> **把 Magic Engine 自己的官网 `magicengine.com.au` 当成 Magic Engine 的第一个真实客户，用 Magic Engine 自己完成从发现问题、提出方案、受控修改、发布、复测、验证到学习的完整 Growth Loop。**

这个 Customer Zero 同时承担三个目标：

1. **真实增长**：让 Magic Engine 官网的 SEO、GEO / AI Search visibility、搜索流量、品牌实体一致性与转化表现真实改善。
2. **产品验证**：验证 Magic Engine 2.0 的 Website / GEO Growth Loop 是否真的可端到端工作，而不是停在 report / recommendation。
3. **平台沉淀**：把本次服务自己的过程中验证过的能力沉淀为可复用 Module / Capability / Evidence / Measurement / Verification 资产，供未来客户复用。

Customer Zero 的意义不是为 Magic Engine 写一套特例；它是第一个真实生产环境。

---

## 2. 冻结原则

### 2.1 不新增 Website/GEO/SEO 专属 Agent

本项目**不创建**：

- Website Growth Agent
- GEO Agent
- SEO Agent
- Page Agent

沿用 ME2 已冻结边界：

- **Agent**：负责 AI 推理、解释、假设、建议。
- **Domain Module**：把 Evidence 变成 Finding / Prescription / ActionCandidate / VerificationDefinition。
- **Measurement**：负责观测身份、原始证据、可比性与指标事实。
- **Shared Capability**：负责精确干活，例如 page snapshot / draft / diff / apply / verify / rollback。
- **Kernel**：负责授权、动作治理、成本、幂等、审计与 lineage。
- **Attribution / Flywheel**：负责结果归因与学习投影。

AI 可以推理；软件必须负责记忆和事实。

### 2.2 不为 Customer Zero 另造一套 runtime

官网 Customer Zero 必须尽量复用现有：

- GSC / GA4 / GEO / keyword / site audit 数据能力
- Growth Module contract
- Page Optimization capability
- Kernel
- GitHub / CMS / provider adapters
- Attribution / Flywheel

若某条能力不存在，可以补 Capability 或 adapter；不得因为 ME 官网是自己的站就绕过平台契约。

### 2.3 先证明一个闭环，再扩大范围

第一轮只允许选择 **1–3 个 canonical pages** 作为实验页面。

不做“全站大改”。

原因：只有小范围、可归因、可回滚的 intervention，才能验证完整 loop。

---

## 3. 官网 Customer Zero 的主闭环

Canonical Loop：

```text
Goal
  ↓
Discovery
  ↓
Evidence
  ↓
Finding
  ↓
Prescription
  ↓
PageOptimizationRequest / ActionCandidate
  ↓
Snapshot + Draft + Diff + Validation
  ↓
Human Review + Kernel Authorization
  ↓
GitHub Draft PR
  ↓
Merge + Cloudflare Release Receipt
  ↓
Measurement
  ↓
Verification
  ↓
Outcome / Attribution
  ↓
Learning
  ↓
Case Study
  ↓
Next Growth Cycle
```

Domain Module 的概念契约保持：

```text
Evidence → Finding → Prescription → ActionCandidate → VerificationDefinition
```

任何一段都不能跳过 Evidence 或 Verification 来制造“成功”。

---

## 4. Evidence Library — Customer Zero 的长期知识地基

### 4.1 Evidence Library 不是什么

它不是普通 CMS 内容库，也不是“放几份文档的文件夹”。

它是：

> **Magic Engine 对一个企业“什么是真的、证据是什么、什么页面正在使用、什么实验验证过”的长期可追溯知识资产。**

### 4.2 Evidence Library 至少管理四类资产

#### A. Approved Facts / Claims

例如：

- legal entity
- founder
- brand aliases
- service markets
- product capabilities
- pricing / package facts
- approved customer / case facts
- legal / compliance redlines
- 可公开与不可公开的事实边界

每个 claim 必须有状态，例如：

- approved
- provisional
- disputed
- expired
- forbidden_for_public_use

#### B. Source Evidence

每一个 Claim 必须能指回来源，例如：

- current repository / production evidence
- approved legal/company documents
- Product Owner approval
- GSC / GA4 observations
- GEO / AI Search raw responses and citations
- customer-approved facts
- page snapshots
- deployment / release receipts
- measured experiment outcomes

**没有 source evidence 的 claim 不能因为模型“看起来合理”就进入官网。**

#### C. Page Usage / Claim Lineage

系统必须知道：

> 某个 claim 现在被哪些页面 / schema / FAQ / case study 使用。

例如：

```text
Claim: legalName = Magic Engine AI Technology Limited
  → about.html
  → footer entity line
  → Organization JSON-LD
  → llms.txt
```

这样事实变化时，系统能知道影响范围，而不是靠人工全站搜索。

#### D. Experiment / Outcome Evidence

每次优化需要留下：

- 为什么改
- 改哪一页
- before snapshot
- linked Finding / Prescription
- approved evidence
- diff
- who approved
- release timestamp / commit / PR / deployment receipt
- expected metric
- attribution window
- T+ measurements
- outcome
- attribution status (`own / defer / unattributable`)

**Case Study 应从这些真实 lineage 自动生成，而不是事后人工“写故事”。**

### 4.3 Evidence Library 与 Measurement 的边界

二者不是同一个东西。

**Measurement** 回答：

> “我们观测到了什么？”

例如：某 query、某 engine、某 model、某 locale、某 sample 的原始答案与 citation。

**Evidence Library** 回答：

> “基于哪些可追溯证据，我们现在能支持什么事实、claim、页面修改或 outcome 叙述？”

Measurement 是 Evidence Library 的重要证据来源之一，但 Evidence Library 还包括法律事实、公司事实、Product Owner approval、page snapshot、release receipt、客户批准材料等。

---

## 5. Website / GEO Domain 负责什么

官网 Customer Zero 不是“自动发博客系统”。

Website / SEO / GEO 相关 Domain Module 的职责是：

1. 收集或读取可信 Evidence。
2. 找出具体 Finding。
3. 判断它是否 actionable。
4. 生成 evidence-backed Prescription。
5. 给出期望变化的 metric 与 VerificationDefinition。
6. 产生 provider-neutral 的 PageOptimizationRequest / ActionCandidate。

它**不负责**：

- 自己直接写 `website/*.html`
- 自己 merge PR
- 自己 deploy
- 自己授权
- 自己宣布“优化成功”

一个合格 Prescription 应类似：

> 在锁定的 GEO query cohort 中，Magic Engine 在 X 类 intent 下出现率/引用率弱；相关竞争结果长期引用 Y 类信息，而当前 canonical page 缺少该信息。建议只修改 `/features` 的指定 section，并以 `qualified mention rate` / `direct owned-page citation rate` / 对应 GSC metric 作为验证指标。

而不是：

> “Publish 3 blogs.”

Generic recommendation 可以存在，但不能替代 evidence-backed prescription。

---

## 6. Page Optimization — 官网如何被修改

Magic Engine 官网目前按 **GitHub-backed / static-site PR-first** 模式处理。

Customer Zero v1 **不要求迁移到 headless CMS**。

页面优化统一走 Shared Page Optimization Capability：

```text
resolve
→ snapshot
→ draft
→ diff
→ validate
→ review
→ authorize
→ apply
→ verify
→ rollback
→ emit lineage
```

### 6.1 Customer Zero v1 的 GitHub 发布策略

```text
Finding / Prescription
  ↓
PageOptimizationRequest
  ↓
Before snapshot
  ↓
AI draft
  ↓
Human-readable diff
  ↓
Evidence / claim validation
  ↓
Human approval
  ↓
Kernel authorization
  ↓
Create branch + Draft PR
  ↓
Human review
  ↓
Merge
  ↓
Cloudflare Pages deploy
  ↓
Deployment receipt captured
```

### 6.2 v1 明确不做

- 不 auto merge
- 不让 AI 直接写 main
- 不绕过 PR 直接上线
- 不因为是自家官网而跳过 snapshot / diff / validation / authorization / rollback
- 不为了自动化而先引入新 CMS

**“PR-first”不是没有自动化。**

真正的自动化目标是让系统自己：

- 发现问题
- 准备 evidence
- 生成修改
- 生成 diff
- 做 deterministic validation
- 创建 Draft PR
- 记录 release lineage

人在 v1 中主要承担 Approve / Reject。

---

## 7. Measurement — 改前与改后必须能诚实比较

GEO / AI Search before-after 不允许用模糊的“感觉变好了”。

必须遵守现有 GEO Measurement Contract：

- immutable QuerySetVersion
- stable query_key
- engine family
- model/version
- locale / market / language
- sample identity
- raw response / citation evidence
- parser / rules identity
- coverage / failure honesty

若 cohort 不可比，必须输出：

```text
not_comparable
```

不能为了 Case Study 强行算出 uplift。

官网第一轮推荐复测节奏：

- baseline：改前锁定
- T+7：传播 / crawl 后第一读
- T+14：中期读
- T+28：主要 attribution read

具体 cadence 可按 metric family 调整，但任何调整必须在 intervention 发生之前写进 VerificationDefinition。

---

## 8. Verification / Attribution / Learning

### 8.1 Execution 完成不等于成功

例如：

- PR merged = execution completed
- Cloudflare deploy success = release completed
- 页面 live verify 通过 = technical verification passed

这些都**不等于增长成功**。

增长成功必须看预先声明的 metric 在 matched cohort / attribution window 内是否发生符合预期的变化。

### 8.2 Outcome 必须诚实分类

沿用：

- `own`
- `defer`
- `unattributable`

不能为了“证明 Magic Engine 有效”把模糊结果硬归功给某个 action。

### 8.3 Learning 不是自动篡改事实

Learning 可以沉淀：

- 哪类 Finding 更值得优先做
- 哪类页面 intervention 更有效
- 哪个渠道 / metric 的传播时间更长
- 哪些 claim / content patterns 容易提高 AI citation / recommendation
- 哪些操作反复无效

但学习结果必须与原始 Evidence / Outcome lineage 分开；历史事实不可重写。

---

## 9. Case Study 是系统产物，不是额外营销作文

Customer Zero 的最终 Case Study 应由系统自动/半自动从以下资产生成：

- baseline
- raw evidence
- Finding
- Prescription
- before snapshot
- approved diff
- PR / commit / release receipt
- post-release measurements
- attribution result
- uncertainty / exclusions
- learning record

Case Study 必须能 drill down 到 evidence。

禁止：

- 只展示成功指标、隐藏失败 coverage
- 把 `not_measured` 当 0
- 把 `not_comparable` cohort 强行比较
- 把相关性写成因果性
- 为了营销叙述补写没有证据的 claim

---

## 10. Customer Zero v1 — 第一轮实验范围

第一轮目标不是“优化整个 Magic Engine 官网”。

目标是跑通 **一个可验证、可回滚、可复现的完整 Growth Loop**。

### 10.1 选择 1–3 个 canonical pages

页面必须满足：

- 有明确 canonical identity
- 有 baseline
- 有一个具体可行动 Finding
- 有可支持的 approved evidence
- 修改范围可控
- 没有与其它 live experiment 冲突
- rollback 可验证

### 10.2 第一个实验的最低闭环

```text
Baseline
→ Evidence Library
→ Finding
→ Prescription
→ PageOptimizationRequest
→ Snapshot
→ Draft
→ Diff
→ Validation
→ Human Review
→ Kernel Authorization
→ GitHub Draft PR
→ Merge
→ Cloudflare Release Receipt
→ T+ Measurement
→ Verification
→ Outcome / Attribution
→ Learning
→ Case Study record
```

### 10.3 第一轮工程成功标准

**不要求 GEO 一定上涨。**

第一轮工程成功是：

- 每一个结论可追溯到 raw evidence
- before / after comparability 可机器判定
- Domain Module 没有直接写页面
- Page Optimization 可被 GEO 之外的 domain 复用
- 没有 Kernel authorization 就不能 release
- before snapshot / diff / rollback 都存在且可验证
- deployment / release receipt 被记录
- outcome 诚实归为 own / defer / unattributable
- Customer Zero 配置删除后不需要修改 shared runtime code

### 10.4 第一轮业务成功标准

至少一个预先声明的业务 / visibility metric 出现可信的方向性改善，例如：

- qualified AI mention rate
- recommendation rate
- direct owned-page citation rate
- relevant GSC impressions / clicks / CTR
- relevant organic inquiry signal

任何指标必须有相应 baseline 与 attribution 规则。

---

## 11. 当前仓库审计与产品方案的关系

Claude Code / Codex 对 repository / production 的盘点非常重要，但它的角色是：

> **Current State / Gap Analysis evidence provider**

不是产品架构的最终决定者。

### 11.1 Repo audit 可以回答

- 今天已经有什么
- 哪条链已经通
- 哪条链真实断了
- 哪些资产可复用
- 哪些数据已经存在
- 哪些 migration / production state 需要核实
- 哪个实现与本文冲突

### 11.2 Repo audit 不得自行决定

- 新增一层平台架构
- 新建 Agent
- 将 magicengine.com.au 迁移 CMS
- 改写 Customer Zero 的目标
- 把 generic execution queue 当新 canonical
- 为了适配现有代码改变 Product Contract

发现现有实现与本文冲突时：

> **停下 → 报告冲突 → 等 Product Owner 决策。**

不得“为了让代码好接”自行重定义产品。

---

## 12. Customer Zero 的分层归属

| 对象 | Canonical ownership |
|---|---|
| Magic Engine 公司事实 / approved claims / evidence | **Evidence Library** |
| GEO raw observations / comparability / metrics | **Measurement** |
| SEO/GEO 网站问题判断 | **Domain Module** |
| evidence-backed recommendation | **Prescription** |
| 页面具体修改、snapshot、diff、apply、verify、rollback | **Shared Page Optimization Capability** |
| GitHub / provider 实际写入 | **Capability Adapter** |
| 授权 / 风险 / cost / idempotency / audit | **Kernel** |
| Cloudflare deployment receipt | **Release / Execution lineage** |
| before-after attribution | **Flywheel / Attribution** |
| 经验沉淀 | **Learning / Memory** |
| 可对外叙述的结果 | **Case Study projection from evidence** |

---

## 13. 明确排除项

Customer Zero v1 暂不包含：

- CRM / CTS sales workflow
- Sales next-best-action
- IP phone / call transcription
- WhatsApp / Messenger outbound automation
- Tourism Playbook
- Real Estate Playbook
- 全站自动改写
- auto merge / auto deploy
- headless CMS migration
- 新 Website/GEO/SEO/Page Agent
- 为了 Case Study 强行做自动归因

这些可以未来做，但不得混入当前 Website/GEO Customer Zero。

---

## 14. 对所有 Coding Agent 的执行规则

任何 Claude Code / Codex 窗口收到本项目任务后，必须：

1. 先读本文。
2. 再读上游 WP00 / GEO Measurement / Page Optimization / Kernel 契约。
3. 先基于 current `main` 和已 apply production evidence 做事实盘点。
4. 明确区分：
   - repository fact
   - production fact
   - existing spec
   - Product Owner decision
   - recommendation
   - unresolved question
5. 如果本文与 current implementation 冲突，**只报告，不自行纠正产品方案**。
6. 未得到明确 `GO BUILD` 前：
   - 不写 runtime code
   - 不改 schema / migration
   - 不 deploy
   - 不 merge
   - 不对外写
   - 不新增 Agent

### 14.1 下一阶段允许的分析任务

在 Product Owner 给出 `GO BUILD` 之前，Coding Agent 只允许做：

- Current State audit
- Gap Mapping
- Evidence Library inventory
- Customer Zero first 1–3 page experiment readiness
- 最小缺口列表
- 与现有 WP / PR / branch 的冲突分析

输出必须优先用产品语言。

---

## 15. 下一步唯一正确动作

下一步不是直接 Build。

下一步是基于 **current `main` + applied production truth**，对照本文输出：

1. **Current State vs Canonical Plan Gap Map**
2. **Evidence Library：今天已有 / 缺失 / 可复用资产**
3. **第一个 1–3 page Customer Zero experiment 所需最小组件**
4. **哪些 gap 是补 adapter / capability，哪些是缺 measurement / verification，哪些只是 operational receipt**
5. **只给 1–3 个最小 Build Slice 建议，不执行**

完成这一步后，由 Product Owner 再决定是否发出：

```text
GO BUILD — ME Website Customer Zero Slice 1
```

---

## 16. 一句话北极星

> **Magic Engine 必须先能用自己服务好自己：从真实证据发现官网增长问题，提出有依据的修改，经过受控授权发布，再用可比较的数据验证结果，并把整个过程沉淀成可复用的产品能力和真实 Case Study。**

以及平台原则：

> **AI reasons. Software remembers. Evidence decides what we may claim.**
