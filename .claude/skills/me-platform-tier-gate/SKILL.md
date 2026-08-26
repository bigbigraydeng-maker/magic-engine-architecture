---
name: me-platform-tier-gate
description: Magic Engine 平台层级门 · 跟班式产品经理。**任何时候**出现下列语言信号必须立即介入（不问上下文是编码 / 设计 / 讨论 / 客户方案 / 纯对话）：(a) 出现 `module` `adaptor` `connector` `capability` `SDK` `component` `interface` `service` `library` `pillar` `支柱` `能力线` `智能层` `分析层` `XX Intelligence` 等能力名词；(b) 出现 `复用` `抽象` `通用化` `边界` `拆出来` `合进去` `新加一个` `我们能不能做 X` `要不要有 Y 能力` `这个属于` `这是 [xxx] 层的东西吗` 等边界追问；(c) 出现 `ME 通用` `平台通用` `跨行业` `ME 地产版` `ME 旅游版` `ME 电商版` `ME XX 版` 等垂直版本词（版本名从 `docs/registry/product-versions.md` 动态推导）；(d) 客户新需求判断 "ME 要不要自己做"；(e) Build vs Connect vs Buy 决策；(f) 讨论 ME 底层 / kernel / 共享 runtime 变动；(g) 客户方案 / 交付文档 / PR 描述里出现能力名词；(h) 动 `src/lib/` 共享目录、新增无 `client_id` 语义的表 / schema；(i) 讨论 KOL / agency / 中介 / 外包等外部执行域。命中任一 → **必须先介入判定层级 · 登记候选 · PM 明确"继续"才能进入下一步**（禁止边谈边写代码 / 边讨论边写方案）。输出可选 Inline 模式（3 句话轻量）或 Full Report（8 段完整 Tier Classification）。
---

# Magic Engine 平台层级门（me-platform-tier-gate · v2 跟班式 PM 模式）

## 存在的原因

**原始事故（2026-08-27 · 触发 v1 建立）**：主 agent 在给 HBay 客户做方案时，因客户提了 KOL 种草需求，就提议给 ME 新增"第七条能力线 · KOL 智能层"——把外部执行连接（KOL/agency）抬到与 SEO / AI 可见度同级的平台底层能力。PM 抓住，v1 skill 设立。

事故的根因不是分类错，是**默认方向错 + 触发时机失灵 + 话术能绕过既有约束**：
- agent 没自认为在做"平台决策"，只是顺手写"能力线"；既有的 Domain Semantics Gate / Reuse Statement 在决策时刻没被触发
- 一旦包装成"智能层""XX Intelligence"，任何外部执行域都能"通过"既有的软性判据
- 分类拿不准时缺省选择往上抬（听起来更 impressive），而不是往下压（更保守 / 更 reuse-friendly）

**v1 → v2 升级动机（2026-08-27 同日）**：v1 落仓半天内 PM 发现更深层问题——开发过程中会**持续**遇到能力边界 / 新增能力 / module / adaptor 归属问题，而 v1 只在"提议新增能力线"这一刻触发。真实开发节奏是**边讨论边推进**，不是"某一刻停下来做决策"——所以事故会以"顺手写下去"的形式反复发生。

**v2 的四个核心升级**：

1. **触发扩面**：从"命中特定关键词"扩到**语言级触发**——`module` `adaptor` `复用` `边界` `ME 通用 vs 版本` 等日常词汇都触发
2. **输出双模式**：日常介入用 **Inline 3 句话轻量模式**（不打断节奏），只有真需要新增 L1 或涉及 3+ 客户共享逻辑才用 Full Report
3. **登记双门槛**：Low bar 让 PM 一句"记"就轻量登记候选，High bar 走完整 schema——让"随时登记"无摩擦，避免因怕麻烦而漏登
4. **对话协议**：**先谈清 → 后登记 → PM 明确"继续" → 才能进入实现或方案下一段**。禁止"边谈边继续实现" / "边讨论边继续写方案"——这是事故根因

**"跟班式 PM" 隐喻**：像产品经理跟在开发旁边，随时轻量追问"这个是新能力还是复用？归哪个版本？边界在哪？"——3 句话搞定的事不写 3 页 Report，但**任何**触及边界的对话都主动介入。

---

## 触发条件（v2 · 三类触发 + 一条硬约束）

### A. 硬产出物触发（v1 遗留 · 客户方案 / 代码 / PR）
以下产出物特征命中任一，**必须**立即输出 Tier Classification（默认 Inline 模式，重大决策用 Full）：
- 客户方案 / 交付文档 / PR 描述 / commit message 中出现："能力线"、"支柱"、"pillar"、"平台能力"、"智能层"、"分析层"、"XX Intelligence"、"新增能力"、"加一条"
- 提议动 `src/lib/` 共享目录、新增 `src/lib/<domain>/` 子目录、或引入没有 `client_id` 语义的新表 / schema
- Reuse Statement 里将要出现新的 Capability 名
- 讨论 KOL / agency / 外包 / 中介 / 第三方执行方
- 客户提出一个新需求且 ME 现有 6 支柱不能直接覆盖
- 讨论从既有 Client Configuration 或 Playbook 抽取共享逻辑到平台层

### B. 语言级触发（v2 新增 · 日常对话 / 讨论 / 编码思考）
**任何**场景（包括纯对话、纯思考、代码 review、架构讨论、方案协作、客户对话）中出现下列词汇必须介入：

**能力 / 组件名词**：
- `module` · `adaptor` · `connector` · `capability` · `SDK` · `component` · `interface` · `service` · `library`
- `支柱` · `pillar` · `能力线` · `智能层` · `分析层` · `XX Intelligence`

**边界追问语言**：
- `复用` · `抽象` · `通用化` · `边界` · `拆出来` · `合进去` · `挂在哪`
- `新加一个 X` · `我们能不能做 Y` · `要不要有 Z 能力`
- `这个属于哪层` · `这是 XX 层的东西吗` · `跟 YY 是什么关系`

**垂直版本词**（从 [`docs/registry/product-versions.md`](../../../docs/registry/product-versions.md) 动态推导）：
- `ME 通用` · `平台通用` · `跨行业`
- `ME 地产版` · `ME 旅游版` · `ME 电商版` · `ME XX 版`
- **未来 PM 在 registry 加新版本时，skill 自动跟进新触发词，不需改 skill 本身**

**跨行业 / 跨客户信号**：
- `其他客户能不能也用` · `CTS 也需要这个吗` · `Roman 那边有类似的吗`

### C. PM 主动触发
PM 在对话里说 `tier` / `层级门` / `分层` / `跟班` / `跑 gate` 等词 → 强制走一次判定，即使当前话题不明显命中 A/B。

### 硬约束：什么时候必须停下来等 PM

命中任一触发条件后，agent **必须**：
1. 输出 Tier Classification（Inline 或 Full）—— 这一步永远做

**是否停下来等 PM"继续"，按判定结果分档**：

| 判定结果 | 是否停等 PM |
|---|---|
| **Inline 归位既有 L1 / L2 / L3 · 无红线冲突 · 无需登记候选** | ❌ 不停等 · 直接继续原任务（Inline 3 句话过后即可推进）|
| **Inline 建议 Low bar 登记候选**（潜在 L1/L2）| ✅ 停等 PM 一句 `记` / `跳` / `跑 full` |
| **触发商业决策 / 新支柱 / 新版本 / 不可逆动作** | ✅ 停等 PM 拍板 |
| **升 Full Report**（真 L1 候选 / 跨 3+ 客户 / 动 shared runtime / 新支柱申请）| ✅ 停等 PM 一句 `继续` 或 `继续 X` |
| **触发红线（红线 1-7 任一 ✗）** | ✅ 停等 PM 或按红线自动改口再继续 |

**为什么这样分档**：v2 v1 版本把"命中触发就必停"写得过宽，会把普通代码 review 里出现的 `module` / `interface` / `service` / `library` 这种日常开发词也当作硬停信号——**违反 CLAUDE.md §2 "PM 不决策架构与接口"** 铁律，也让 skill 从"跟班"变成"路障"。分档后：日常触发 Inline 走 3 句话继续；只有真需要 PM 拍板（登记候选、商业决策、L1 晋升、红线冲突）才停等。

**禁止**：跳过 Tier Classification 输出、直接写代码 / 直接写客户方案下一段。事故根因是"没做判定就顺手继续"，不是"做完判定还要等 PM"。

---

## 四级分层（含判据）

### L1 Capability（平台能力，进 ME 底盘）
- **是什么**：ME 智能层底盘，跨所有客户 / 所有行业复用；垂直版本共享
- **判据**（必须全部通过）：
  1. 换客户测试通过（语义级 · 见红线 4）
  2. 换行业测试通过（语义级 · 见红线 5）
  3. 是 ME 智能层输出，不是外部执行手
  4. 归属明确：ME 6 支柱之一（SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品）——支柱名从 [`docs/registry/pillars.md`](../../../docs/registry/pillars.md) 动态读取（未来 PM 加第 7 支柱时 skill 自动跟进），或平台基础设施（Kernel / Measurement Contract / Growth Contract / Attribution / Memory / Verification 机制）
- **例**：AI 可见度追踪、竞品监控引擎、内容归因引擎、6 支柱打分器、Measurement Contract、Client-scoped Memory

### L2 Industry Playbook / Profile / Version（行业剧本 / 垂直版本）
- **是什么**：一个行业 / 一个 ME 垂直版本内所有客户复用；跨行业 / 跨版本不复用
- **判据**：换客户测试通过 + 换行业测试**不通过**
- **禁止装的东西**：单客户事实、单客户名、单客户业务数字——一律下沉 L4（见红线 7）
- **绑定 ME 垂直版本**：ME 地产版 / ME 旅游版 / ME 电商版 都属于 L2 Playbook 一种具体形态。归属的版本从 [`docs/registry/product-versions.md`](../../../docs/registry/product-versions.md) 里选择或申请新增（新增是 PM 拍板项）
- **例**：Beverage Playbook（瓶装水行业 6 支柱权重 + 内容模板 + 决策规则）、ME 地产版核心引擎、ME 旅游版核心引擎

### L3 Connector（外部连接 · Codex 复审修正 · 与 ME_PRODUCT_DEFINITION §7 对齐）
- **是什么**：ME 与外部系统之间受治理、可插拔的 Read / Act / Listen / Verify 边界，作为 adapter 挂在既有 Capability 下（定义见 [ME_PRODUCT_DEFINITION.md §7](../../../docs/strategy/ME_PRODUCT_DEFINITION.md)）
- **判据**：对接外部系统的 Discover / Read / Act / Listen / Verify / Govern 中至少一项 + provider-specific 逻辑留在 adapter 内、不泄漏进 shared runtime + 可挂可摘（不同客户可以有不同 connector 组合）——不要求"不受 ME 控制"，受治理的执行 / 验证同样属于 L3
- **例**：DataForSEO Connector（受治理只读）、Meta Ads Connector（执行获授权动作）、Publer Connector、KOL agency 名单库

### L4 Client Configuration（客户配置）
- **是什么**：单客户独有；通过配置注入既有 Capability 或 Playbook
- **判据**：只服务一个客户 + 通过配置 / approved evidence / private memory 注入
- **例**：HBay 的 "25 万年" 表述（未证实需下架）、CTS 6 城 baker IP、Roman 的 30 天 rebrand 红线、HBay VI 视觉手册 v1（单客户先做 · 未来跨客户升 L2 候选）

---

## 每层 owner 与仲裁链（Codex 复审修正 · 纯技术分歧不升 PM）

分类系统没有 owner = 分类没有落点 = 每次分歧要现场重新协商 = 治理只在无争议时生效。为此显式绑定每层 owner：

| 层 | 提案 owner | 复审 owner | 分歧仲裁 |
|---|---|---|---|
| **L1 Capability** | 提案 agent | **子牙（架构）+ 魏征（挑刺）** 双审 | 子牙 + 魏征联合拍板；仅涉及商业决策或新增支柱时升级 PM |
| **L2 Playbook / Profile / Version** | 行业负责 FDE | **华佗（分析视角）** | 华佗拍板；仅涉及商业决策或新增支柱时升级 PM |
| **L3 Connector** | 提案 agent | **鲁班（执行视角）** + 该 Connector 域负责人 | 该 Connector 域负责人拍板；仅涉及商业决策或新增支柱时升级 PM |
| **L4 Client Configuration** | 当值 FDE | 无强制复审（客户配置属客户私域）| 当值 FDE 拍板；仅涉及跨客户共享风险或商业决策时升级 PM |

**分歧仲裁链**（写死流程）：

```
agent 提案层级 X
     ↓
复审 owner 判定 Y ≠ X
     ↓
该层 owner 拍板（agent 与复审 owner 之间的分歧由 owner 断）
     ↓
纯技术分类不确定（架构落点拿不准）→ 该层技术 owner（子牙 / 魏征 / 华佗 / 鲁班 / 该 Connector 域负责人）继续仲裁到底，不升级 PM——PM 不决策架构与接口（见 CLAUDE.md §2 PM 角色边界）
     ↓
涉及商业决策 / 涉及新增支柱
     ↓
抛 PM
```

**每层 owner 的职责**：
- 定期扫本层实际实现，看有没有本该属于其他层的东西溜进来
- L1 owner 额外负责扫 [`docs/registry/platform-candidates.md`](../../../docs/registry/platform-candidates.md)，评估晋升成熟度
- 写不出 owner 的层 = 承认这层今天治理不起来，要么先删要么标 TODO 记进 ROADMAP

---

## 红线（触碰即拒 / 必改层，不接受"下不为例"）

### 红线 1 · 禁止"包装升级"
禁止以任何名义——包括"智能层""分析层""XX Intelligence""XX Engine""XX 能力线""XX 支柱"——为**单一执行域**新设平台级能力。执行域上的智能需求默认归入：
- 既有 6 支柱的能力扩展（如 KOL discovery 挂在"社媒"或"口碑"能力下作为分析场景）
- 或 L2 Industry Playbook
- 新设独立 L1 能力线一律标记为 PM 拍板项，不由 agent 自己决定

*为什么*：HBay 事故用的正是"KOL 智能层"的包装，绕过了"禁止 Connector 升 Capability" 的字面禁令。防的必须是动作不是名词。

### 红线 2 · 禁止客户 / 行业事实进 shared runtime
客户名、客户 ID、客户业务数字、行业硬编码判断，禁止进 `src/lib/` 共享代码路径、shared prompt template、平台默认权重。只能进 Playbook / Profile / Configuration / private memory。

### 红线 3 · 单客户 Capability/Playbook 语义默认落 L4/L2，禁止**直接**升 L1（Codex 复审修正 · 不含符合 L3 判据的 Connector）
- 本红线只约束单客户提出的 **Capability / Playbook 语义**——即声称"ME 智能层该新增/扩展一种判断规则、打分权重、决策逻辑"的需求。**符合 L3 判据的 Connector 需求不适用本红线**：provider-specific adapter 挂在既有 Capability 下、不同客户用不同 Connector 组合，本就是 L3 判据允许的常态，不需要先落 L4/L2 再登记候选，也不占用"L1 候选"名额
- 命中本红线的单客户 Capability/Playbook 需求，默认落 L4 或 L2 实现 + **登记为"L1 候选"**进入 [`docs/registry/platform-candidates.md`](../../../docs/registry/platform-candidates.md)（不是 console.log，进入可复查的管道，遵循 "管道不许断头"）
- **禁止的是"跳过 L4/L2 直接建 L1"**——不是禁止发现管道本身
- L1 晋升硬证据白名单：≥2 个**已付费**客户分属不同行业提出同一需求，或某 L2/L4 实现已在 ≥3 客户处出现事实复制
- L1 升级提案强制走"大任务 2 审"：子牙（架构）+ 魏征（挑刺），"我自己审过了"不算

*为什么*：ME 的方法论是 Customer Zero——真正该建的能力，出生时总是只有一个客户在要。全禁会杀死发现管道；允许直建又会打开污染平台的口子。中间路是"先落低层 + 登记候选 + 硬证据升级"，但这条路只该拦"能力/剧本"级野心，不该误伤本就该走 L3 的 Connector 接入（见下方 HBay 自检示范：判定为 L3 时不进候选表）。

### 红线 4 · 换客户测试（语义级）
问句必须严格版：**"换客户后，这段代码的默认行为、权重、prompt、判断规则，有没有一条只对首客户成立？"**

不接受回答"clientId 是参数"——参数化不等于语义通用。必须列举 ≥2 个具体反例客户（如从 HBay 换到 CTS 换到 Roman），逐条推演默认行为是否需要改。

### 红线 5 · 换行业测试（语义级）
问句：**"换行业后（如从瓶装水换到地产换到旅游），这段代码的默认行为、权重、prompt、判断规则，有没有一条只对首行业成立？"**

同样列举 ≥2 个具体反例行业逐条推演。

### 红线 6 · 新增 L1 Capability 必须走五道 Build Gate
本 skill 是**五道 Build Gate 里 Architecture/Reuse Gate 的前置子步骤**（不是并列第六道）。冲突时以后续 gate 为准。tier-gate 判定为 L1 候选后，仍需完整走 Repository Fact → Domain Semantics → Product → Architecture/Reuse → GO BUILD 五道 gate。tier-gate 不替任何后续 gate 背书。

### 红线 7 · L2 Playbook 只装行业级 / 版本级判断
Industry Playbook / Profile / Version 只能装：行业级 / 版本级的 6 支柱权重、内容模板、决策规则、默认参数。**单客户事实一律下沉 L4**——即使这个客户是这个行业的第一个 / 唯一一个，也不能把它的事实硬编码进 Playbook。

---

## PM 拍板项（不进红线，明确交回 PM）

以下决策属**商业模式 / 产品战略**，不由 skill 冻结，遇到时明确标记"PM 待拍板"抛回：

- ME 是否从 Connector 抽佣 / 是否做外部执行中介
- ME 是否新增第 7 支柱（`docs/registry/pillars.md` 未来更新）
- ME 是否新增 XX 垂直版本（`docs/registry/product-versions.md` 未来更新）
- L1 升级候选进入正式提案的时机
- 定价 / 服务档位 / setup fee 结构

规则：**agent 不能替 PM 做以上决策，也不能借"技术上更好"名义把商业选择包装成技术判据**。

---

## 输出：双模式（v2 新增 · 核心特性）

### Inline 模式（默认 · "跟班式 PM" 日常介入）
3 句话完成，融入正常对话不打断节奏：

```
> [跟班 · Tier] 这是 L3（KOL 撮合），挂在既有社媒 / 口碑支柱下 · 不新增能力线 · 不用登记 candidates。
> [跟班 · 红线] 保持 ME 不从 MCN 抽佣的一贯原则。
> [跟班 · 继续吗？] 判定完了，你 `继续` 我就走下一步。
```

**Inline 使用条件**：
- 单客户判定 / 日常代码 review / 讨论已有能力的挂载点
- 不涉及新增 L1 / 不涉及跨 3+ 客户共享逻辑 / 不涉及新支柱或新版本
- 明显归属既有能力线时
- 判定为 L3 Connector 且不占用候选名额时（按红线 3 直接归位）

**Inline 三句话结构**：
1. **[跟班 · Tier]**：层级判定 + 挂在哪 + 要不要登记
2. **[跟班 · 红线 / 判据]**：关键红线是哪条 · 或者用了哪条判据
3. **[跟班 · 继续吗？]**：等 PM 明确 `继续`

### Full Report 模式（重大决策 · v1 原格式）
8 段完整 Tier Classification Report，用于：
- **真的**要新增 L1 Capability
- 涉及 3+ 客户或跨行业的共享逻辑
- 新支柱 / 新 ME 垂直版本申请
- 动共享 runtime（`src/lib/`）
- Reuse Statement 里出现新 Capability 名
- PM 明说 `跑一次 full`

Full Report 完整格式见下方"强制输出格式"段。

### 模式选择判据（agent 自决）
从 Inline 开始，触及以下任一 → 升 Full：
- 疑似 L1 或 L2 候选
- 跨客户 / 跨行业 / 跨 ME 版本
- 动 shared runtime
- 新支柱或新版本申请
- PM 明说 `跑 full` / `完整过一遍`

---

## 登记双门槛（v2 新增 · Low bar + High bar）

### Low bar 登记（PM 一句"记"就登）
Inline 判定后建议登记时，用轻量条目：

```
候选名: [一句话]
建议层级: [L1 / L2]
来源客户: [名字]
状态: pending_pm_confirm
备注: [3 行以内的关键上下文]
```

**PM 响应**：
- `记` / `记下` / `mark it` → agent 追加进 `docs/registry/platform-candidates.md`，走 Low bar schema（可以先只填 5 个字段，其余等后续），并同步登记进 [`src/lib/pm-todo/platform-candidate-reviews.ts`](../../../src/lib/pm-todo/platform-candidate-reviews.ts) 让复查日到期自动下发待办
- `不记` / `skip` → 跳过登记，继续原任务
- `跑 full` → 升级到 Full Report + High bar 完整登记

### High bar 登记（Full Report 判定的 L1/L2 候选）
完整 schema 全填 · 强制走 PR 而不是直接改 file · 复查节奏由 PM 拍板

### 目的
让"随时登记"变得**无摩擦**——不然会因为"要填 11 个字段太麻烦"而漏登，就是平台化原则最怕的漂移。

---

## 对话协议（v2 新增 · 核心行为约束）

命中触发条件后，agent **禁止**：
- ❌ 跳过 Tier Classification 输出直接写代码
- ❌ 跳过 Tier Classification 输出直接写客户方案下一段
- ❌ 用"顺手一起做"名义跳过判定环节

agent **必须**按以下顺序执行：

```
命中触发
  ↓
输出 Tier Classification（Inline / Full）—— 这一步永远做
  ↓
判定分档决定后续：
  · 归位既有能力 + 无需登记 + 无红线冲突 → Inline 说完直接继续
  · 建议登记 Low bar 候选 → 停等 PM 一句 `记` / `跳` / `跑 full`
  · 触发商业决策 / 新支柱 / 新版本 / 红线 / 升 Full Report → 停等 PM 拍板
```

**为什么这样分档**：v1 事故（KOL 智能层）根因**不是**"没等 PM 就继续"，而是 **agent 在讨论客户方案时"顺手"写下"第七条能力线"，跳过了判定环节**。v2 保留"必须做判定"这条硬约束（跳过判定就是失职），但把"停等 PM"限定到真需要 PM 拍板的场景——不然普通代码 review 里出现 `module` / `interface` / `service` 等词也硬停，反而违反 CLAUDE.md §2 "PM 不决策架构与接口"。

---

## Reuse Statement 对账（防止决策与实现漂移）

本 skill 在**决策时刻**运行，Reuse Statement 在**交付时刻**填写。中间隔着实现过程，容易出现"决策时归 L4 / 实现时写进 shared runtime"的漂移。

强制对账行（每份 Reuse Statement 必答）：
> **本次实现落点与 tier-gate 决策时的分类是否一致？若不一致，列出差异并说明为何。**

禁止直接粘贴决策时的分类文字应付了事。

---

## 默认降级 · 强制候选登记

分类拿不准时——**一律先归更低层**（拿不准是 L1 还是 L2，先归 L2；拿不准是 L2 还是 L4，先归 L4；拿不准是 L1 还是 L3，先归 L3）。

**同时强制**：
- 登记进 [`docs/registry/platform-candidates.md`](../../../docs/registry/platform-candidates.md)（Low bar / High bar 按情况）
- 同步登记进 [`src/lib/pm-todo/platform-candidate-reviews.ts`](../../../src/lib/pm-todo/platform-candidate-reviews.ts)，让复查日到期自动下发"需要你动手"待办
- 凑齐红线 3 的硬证据 → 自动触发晋升提案 → 走 2 审 → 进 Build Gate

*为什么*：默认降级如果没有晋升车道，会制造"同一段逻辑在 N 个客户配置里各复制一份"的平行系统——那正是平台化原则禁止的。

---

## 强制输出格式（Full Report · Tier Classification Report）

Full Report 模式完整格式：

```
## Platform Tier Classification（Full）

**被判定对象**: [用一句话描述]

**建议层级**: [L1 Capability / L2 Playbook / L3 Connector / L4 Configuration]

**归属**（若声明 L1，必填一项）:
- [ ] ME 6 支柱之一：[哪一柱]
- [ ] 平台基础设施：[Kernel / Measurement Contract / Attribution / Memory / Verification / 其他]
- [ ] 都不是 → 强制降为 L2 或 PM 拍板"是否新增支柱 / 版本"

**换客户测试**: ✓/✗
- 反例客户 1（[名字]）: [默认行为 / 权重 / prompt / 规则是否需改]
- 反例客户 2（[名字]）: [同上]

**换行业测试**: ✓/✗
- 反例行业 1（[名字]）: [同上]
- 反例行业 2（[名字]）: [同上]

**智能层 or 执行手**: [判断 + 一句话原因]

**红线检查**（逐条 ✓/✗）:
- 红线 1（禁包装升级）: 
- 红线 2（禁客户/行业事实进 shared runtime）: 
- 红线 3（禁直建 L1）: 
- 红线 4（换客户测试语义级）: 
- 红线 5（换行业测试语义级）: 
- 红线 6（若 L1，将走五道 Build Gate）: 
- 红线 7（L2 只装行业级 / 版本级）: 

**PM 待拍板项**（若涉及）: [列出]

**结论**:
- 原本想法层级：[X]
- Skill 判定层级：[Y]
- 若 X ≠ Y：改口话术为 "[具体如何重新表述]"
- 若判定 L1 / L2 候选：已登记进 `docs/registry/platform-candidates.md`（填写 commit SHA 或 PR 链接：___）
- 下一步：[继续原任务 / 走五道 Build Gate / 抛 PM 拍板 / 拒]
```

---

## 与既有治理机制的关系（防止推诿 / 重复）

| 机制 | 何时运行 | 关注点 | 与本 skill 的关系 |
|---|---|---|---|
| 五道 Build Gate | 提议动手前 | 全流程审核 | 本 skill 是其中 Architecture/Reuse Gate 的**前置子步骤** |
| Domain Semantics Gate | Build Gate 第 2 步 | 语义通用性 | 本 skill 强化其中的"换客户测试"到语义级 |
| Reuse Statement | 交付时 | 事后声明落点 | 本 skill 输出用于事前预判，交付时强制对账 |
| 大任务 2 审 | 大任务开工前 + 完工后 | 架构 + 挑刺 | L1 晋升提案强制走 2 审 |
| memory 分层 | 记录事实时 | 客户 / 行业 / 全局分层 | 遵循同一"默认更低层 + 有证据才升级"原则 |

**冲突时优先级**：产品定义（`ME_PRODUCT_DEFINITION.md`）> 平台化原则（`2026-08-19-me2-platformization-principle.md`）> 五道 Build Gate > 本 skill > 其他。

---

## 自检示范

### 示范 1 · HBay KOL 事故复盘（Full Report · v1 原示范）
**被判定对象**：KOL discovery + brief + ROI 归因作为 ME 新"第七条能力线 · KOL 智能层"

**归属**：都不是（6 支柱无 KOL 柱，也不是平台基础设施）→ 强制降为 L2 或 PM 拍板"是否新增支柱"

**换客户测试**：✗ —— HBay 的 KOL 场景权重（澳新华人 + 英文 KOL 并行）跟 CTS（旅游社群）、Roman（地产 KOC）都不同

**换行业测试**：✗ —— 瓶装水 / 地产 / 旅游 三个行业的 KOL 场景差异巨大，无一套通用规则

**智能层 or 执行手**：本质是外部执行手（KOL agency + 内容发布），套上"智能"包装

**红线检查**：红线 1 ✗ 包装升级 · 红线 3 ✗ 单客户直建 L1 · 红线 7 ✗ 想装单客户到平台层

**结论**：
- 原本想法层级：L1 Capability
- Skill 判定层级：**L3 Connector（KOL agency 名单库）+ 挂在既有"社媒"/"口碑"L1 能力下的场景应用**
- 改口话术：不说"ME 新增 KOL 智能层"，说"ME 的社媒 / 口碑能力扩展一个 KOL 场景：discovery + brief + ROI 归因由 ME 智能层做，执行由客户自选 agency"
- 登记：**不进 `platform-candidates.md`** —— 判定为 L3 Connector 不占用候选名额（红线 3 显式排除 L3）
- 下一步：继续原任务（在客户方案里挂在既有能力线下）

### 示范 2 · Inline 模式 · HBay VI 判定（v2）
**触发词**：`VI 视觉手册` `品牌调性`（能力名词 + 边界追问）

```
> [跟班 · Tier] 这是 L4 · HBay 单客户先做起来 · 建议 Low bar 登记 candidates（VI 生成能力有跨客户复用潜力，未来 3+ 客户需要就升 L1）。
> [跟班 · 红线] 不新增支柱（VI 不在 6 支柱内 → 属 PM 拍板项）· 用 Claude Design 完成 · 不涉及 shared runtime。
> [跟班 · 继续吗？] 判定完了，`记 + 继续` 就登候选并继续写方案，`跳 + 继续` 就不登。
```

### 示范 3 · 语言级触发 · 版本归属判定（v2）
**触发**：PM 说 `这个能力要放 ME 通用还是 ME 地产版？`

```
> [跟班 · Tier] 需要先明确判据：换其他行业客户测试是否通过？如通过 → L1 通用；如只对地产语义合理 → L2 ME 地产版。
> [跟班 · 判据] 请具体说明是什么能力，我用换客户 / 换行业测试逐条推演。
> [跟班 · 继续吗？] 拿到具体能力名后我给判定 · 等你说了才走下一步。
```

---

## 版本

- **v2.1 · 2026-08-27** · Codex 第 4 轮复审修正：停等 PM 的硬约束分档（日常触发 Inline 后可继续 · 只有登记候选 / 商业决策 / 新支柱 / 红线冲突 / 升 Full 才停等）· 避免普通代码 review 出现 `module` / `interface` / `service` 等日常词也硬停 PM（违反 CLAUDE.md §2 PM 不决策架构与接口）
- **v2 · 2026-08-27** · 跟班式 PM 模式升级：语言级触发扩面 · Inline / Full 双输出 · Low / High 双门槛登记 · 分档式对话协议 · 版本词从 registry 动态推导 · 吸收 Codex 复审 3 轮修正（L3 Connector 与 ME_PRODUCT_DEFINITION §7 对齐 · 纯技术分歧不升 PM · 红线 3 显式排除 L3 · 复查日接入 pm-daily-todo 自动待办）
- **v1 · 2026-08-27** · 因 HBay KOL 事故设立；经魏征对抗性复审 + 子牙架构复审后修正 3 条必改项落地
