---
name: me-platform-tier-gate
description: Magic Engine 平台层级门。当出现以下任一情况时必须调用：(a) 客户新需求判断"ME 要不要自己做"；(b) 提议新增能力线/支柱/pillar/capability/智能层/分析层/XX Intelligence；(c) Build vs Connect vs Buy 决策；(d) 讨论 ME 底层/平台层/kernel/共享 runtime 变动；(e) 客户方案/交付文档里出现"能力线/支柱/平台能力/智能层"字样；(f) 动 src/lib 共享目录、加共享 schema、新建无 client_id 语义的表；(g) 写 Reuse Statement 时涉及新 Capability 名；(h) 讨论 KOL/agency/中介/外包等外部执行域。输出 Tier Classification Report，判定应归 L1 Capability / L2 Playbook / L3 Connector / L4 Configuration 哪一层，并对照 7 条红线检查。
---

# Magic Engine 平台层级门（me-platform-tier-gate）

## 存在的原因

真实事故（2026-08-27）：主 agent 在给客户 HBay 做方案时，因为客户提了 KOL 种草需求，就提议给 ME 新增"第七条能力线 · KOL 智能层"——把一个外部执行连接（KOL/agency）抬到与 SEO/AI 可见度同级的平台底层能力。PM 当场抓住，本 skill 因此设立。

事故的**根因不是分类错**，是**默认方向错 + 触发时机失灵 + 话术能绕过既有约束**：
- agent 没自认为在做"平台决策"，只是顺手写"能力线"；既有的 Domain Semantics Gate / Reuse Statement 在决策时刻没被触发
- 一旦包装成"智能层""XX Intelligence"，任何外部执行域都能"通过"既有的软性判据
- 分类拿不准时缺省选择往上抬（听起来更 impressive），而不是往下压（更保守 / 更 reuse-friendly）

本 skill 就是把这三条堵死。

---

## 强制触发（不问 agent 自认为在干什么）

以下产出物特征命中任一，**必须**立刻输出 Tier Classification Report，不问 agent 主观意图：

- 客户方案 / 交付文档 / PR 描述 / commit message 中出现："能力线"、"支柱"、"pillar"、"平台能力"、"智能层"、"分析层"、"XX Intelligence"、"新增能力"、"加一条"
- 提议动 `src/lib/` 共享目录、新增 `src/lib/<domain>/` 子目录、或引入没有 `client_id` 语义的新表 / schema
- Reuse Statement 里将要出现新的 Capability 名
- 讨论 KOL / agency / 外包 / 中介 / 第三方执行方
- 客户提出一个新需求且 ME 现有 6 支柱（SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品）不能直接覆盖
- 讨论从既有 Client Configuration 或 Playbook 抽取共享逻辑到平台层

**触发即输出**：直接调用本 skill 生成 Tier Classification Report，然后再继续用户的原任务。禁止"心里过一遍就好"。

---

## 四级分层（含判据）

### L1 Capability（平台能力，进 ME 底盘）
- **是什么**：ME 智能层底盘，跨所有客户 / 所有行业复用；垂直版本共享
- **判据**（必须全部通过）：
  1. 换客户测试通过（下面有严格版本）
  2. 换行业测试通过
  3. 是 ME 智能层输出，不是外部执行手
  4. 归属明确：ME 6 支柱之一（SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品），或平台基础设施（Kernel / Measurement Contract / Growth Contract / Attribution / Memory / Verification 机制）
- **例**：AI 可见度追踪、竞品监控引擎、内容归因引擎、6 支柱打分器、Measurement Contract、Client-scoped Memory

### L2 Industry Playbook / Profile（行业剧本）
- **是什么**：一个行业内所有客户复用；跨行业不复用
- **判据**：换客户测试通过 + 换行业测试**不通过**（就是这层）
- **禁止装的东西**：单客户事实、单客户名、单客户业务数字——这些一律下沉 L4（见红线 7）
- **例**：Beverage Playbook（瓶装水行业的 6 支柱权重 + 内容模板 + 决策规则）、Real Estate Playbook

### L3 Connector（外部连接）
- **是什么**：外部执行手，作为 adapter 挂在既有 Capability 下；ME 不控制执行、不做中介
- **判据**：是外部执行 + ME 只是接入 / 不控制过程 + 可挂可摘（不同客户可以有不同 connector 组合）
- **例**：DataForSEO Connector、Meta Ads Connector、Publer Connector、KOL agency 名单库

### L4 Client Configuration（客户配置）
- **是什么**：单客户独有；通过配置注入既有 Capability 或 Playbook
- **判据**：只服务一个客户 + 通过配置 / approved evidence / private memory 注入
- **例**：HBay 的 "25 万年" 表述（未证实需下架）、CTS 6 城 baker IP、Roman 的 30 天 rebrand 红线、客户品牌色

---

## 每层 owner 与仲裁链（防止分类空号）

分类系统没有 owner = 分类没有落点 = 每次分歧要现场重新协商 = 治理只在无争议时生效。为此显式绑定每层 owner：

| 层 | 提案 owner | 复审 owner | 分歧仲裁 |
|---|---|---|---|
| **L1 Capability** | 提案 agent | **子牙（架构）+ 魏征（挑刺）** 双审 | PM |
| **L2 Playbook / Profile** | 行业负责 FDE | **华佗（分析视角）** | PM |
| **L3 Connector** | 提案 agent | **鲁班（执行视角）** + 该 Connector 域负责人 | 该 Connector 域负责人 → PM |
| **L4 Client Configuration** | 当值 FDE | 无强制复审（客户配置属客户私域）| 当值 FDE → PM（若涉及跨客户共享风险）|

**分歧仲裁链**（写死流程）：

```
agent 提案层级 X
     ↓
复审 owner 判定 Y ≠ X
     ↓
该层 owner 拍板（agent 与复审 owner 之间的分歧由 owner 断）
     ↓
owner 也拿不准 / 涉及商业决策 / 涉及新支柱
     ↓
抛 PM
```

**每层 owner 的职责**：
- 定期扫本层实际实现，看有没有本该属于其他层的东西溜进来
- L1 owner 额外负责扫 `docs/registry/platform-candidates.md`，评估晋升成熟度
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

### 红线 3 · 单客户需求默认落 L4/L2，禁止**直接**升 L1
- 单客户需求默认落 L4 或 L2 实现 + **登记为"L1 候选"**进入 [`docs/registry/platform-candidates.md`](../../../docs/registry/platform-candidates.md)（不是 console.log，进入可复查的管道，遵循 "管道不许断头"）
- **禁止的是"跳过 L4/L2 直接建 L1"**——不是禁止发现管道本身
- L1 晋升硬证据白名单：≥2 个**已付费**客户分属不同行业提出同一需求，或某 L2/L4 实现已在 ≥3 客户处出现事实复制
- L1 升级提案强制走"大任务 2 审"：子牙（架构）+ 魏征（挑刺），"我自己审过了"不算

*为什么*：ME 的方法论是 Customer Zero——真正该建的能力，出生时总是只有一个客户在要。全禁会杀死发现管道；允许直建又会打开污染平台的口子。中间路是"先落低层 + 登记候选 + 硬证据升级"。

### 红线 4 · 换客户测试（语义级）
问句必须严格版：**"换客户后，这段代码的默认行为、权重、prompt、判断规则，有没有一条只对首客户成立？"**

不接受回答"clientId 是参数"——参数化不等于语义通用。必须列举 ≥2 个具体反例客户（如从 HBay 换到 CTS 换到 Roman），逐条推演默认行为是否需要改。

### 红线 5 · 换行业测试（语义级）
问句：**"换行业后（如从瓶装水换到地产换到旅游），这段代码的默认行为、权重、prompt、判断规则，有没有一条只对首行业成立？"**

同样列举 ≥2 个具体反例行业逐条推演。

### 红线 6 · 新增 L1 Capability 必须走五道 Build Gate
本 skill 是**五道 Build Gate 里 Architecture/Reuse Gate 的前置子步骤**（不是并列第六道）。冲突时以后续 gate 为准。tier-gate 判定为 L1 候选后，仍需完整走 Repository Fact → Domain Semantics → Product → Architecture/Reuse → GO BUILD 五道 gate。tier-gate 不替任何后续 gate 背书。

### 红线 7 · L2 Playbook 只装行业级判断
Industry Playbook / Profile 只能装：行业级的 6 支柱权重、行业级内容模板、行业级决策规则、行业级默认参数。**单客户事实一律下沉 L4**——即使这个客户是这个行业的第一个 / 唯一一个，也不能把它的事实硬编码进 Playbook。

---

## PM 拍板项（不进红线，明确交回 PM）

以下决策属**商业模式 / 产品战略**，不由 skill 冻结，遇到时明确标记"PM 待拍板"抛回：

- ME 是否从 Connector 抽佣 / 是否做外部执行中介
- ME 是否新增"第七支柱"（6 支柱数量是产品决策，不是工程决策；skill 只负责拦下并上报）
- L1 升级候选进入正式提案的时机
- 定价 / 服务档位 / setup fee 结构

规则：**agent 不能替 PM 做以上决策，也不能借"技术上更好"名义把商业选择包装成技术判据**。

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
- 登记进 [`docs/registry/platform-candidates.md`](../../../docs/registry/platform-candidates.md)（跨 worktree 走 git 同步，可复查，非 console.log）
- 复查节奏：月度跨客户配置相似度扫描（每月第一个周一，当值 FDE 主持）+ 季度 PM 审阅
- 凑齐红线 3 的硬证据 → 自动触发晋升提案 → 走 2 审 → 进 Build Gate

*为什么*：默认降级如果没有晋升车道，会制造"同一段逻辑在 N 个客户配置里各复制一份"的平行系统——那正是平台化原则禁止的。

---

## 强制输出格式（Tier Classification Report）

每次触发时必须先输出这段，再继续原任务：

```
## Platform Tier Classification

**被判定对象**: [用一句话描述——例："KOL discovery + brief + ROI 归因作为 ME 新能力"]

**建议层级**: [L1 Capability / L2 Playbook / L3 Connector / L4 Configuration]

**归属**（若声明 L1，必填一项）:
- [ ] ME 6 支柱之一：[哪一柱]
- [ ] 平台基础设施：[Kernel / Measurement Contract / Attribution / Memory / Verification / 其他]
- [ ] 都不是 → 强制降为 L2 或 PM 拍板"是否新增支柱"

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
- 红线 7（L2 只装行业级）: 

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
| memory 分层 | 记录事实时 | 客户/行业/全局分层 | 遵循同一"默认更低层 + 有证据才升级"原则 |

**冲突时优先级**：产品定义（`ME_PRODUCT_DEFINITION.md`）> 平台化原则（`2026-08-19-me2-platformization-principle.md`）> 五道 Build Gate > 本 skill > 其他。

---

## 自检示范（HBay KOL 事故复盘）

**被判定对象**：KOL discovery + brief + ROI 归因作为 ME 新"第七条能力线 · KOL 智能层"

**归属**：都不是（6 支柱无 KOL 柱，也不是平台基础设施）→ 强制降为 L2 或 PM 拍板"是否新增支柱"

**换客户测试**：✗ —— HBay 的 KOL 场景权重（澳新华人 + 英文 KOL 并行）跟 CTS（旅游社群）、Roman（地产 KOC）都不同，默认 prompt 与打分权重需改

**换行业测试**：✗ —— 瓶装水 / 地产 / 旅游 三个行业的 KOL 场景差异巨大，无一套通用规则

**智能层 or 执行手**：本质是外部执行手（KOL agency + 内容发布），套上"智能"包装

**红线检查**：
- 红线 1：✗ —— "KOL 智能层"就是被包装升级的典型
- 红线 3：✗ —— 单客户（HBay）需求直建 L1
- 红线 7：✗ —— 想装单客户的 KOL 场景到平台层

**结论**：
- 原本想法层级：L1 Capability
- Skill 判定层级：**L3 Connector（KOL agency 名单库）+ 挂在既有"社媒"/"口碑"L1 能力下的场景应用**
- 改口话术：不说"ME 新增 KOL 智能层"，说"ME 的社媒 / 口碑能力扩展一个 KOL 场景：discovery + brief + ROI 归因由 ME 智能层做，执行由客户自选 agency"
- 登记：**不进 `platform-candidates.md`** —— 当前证据不足（单客户单行业），且判定为 L3 Connector 不是 L1/L2 候选
- 下一步：继续原任务（在客户方案里挂在既有能力线下）

---

## 版本

- v1 · 2026-08-27 · 因 HBay KOL 事故设立；经魏征对抗性复审后修正 3 处必改项落地
