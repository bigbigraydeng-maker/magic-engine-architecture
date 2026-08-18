# ME2 Domain Module 提案：CRM Action Engine（Customer Journey）v0.1

> **状态：提案草稿，未获 Build Control Room 授权。**
> 本文档只是"申请材料"，不代表任何实现已开工。按 ROADMAP.md 里 ME2 史诗的治理规则：
> 架构、PR 边界、验收与合并决策归 Build Control Room；本文档写完即止，
> 不夹带任何代码改动，也不预设会被批准。
>
> 背景对齐讨论见 2026-08-18/19 的 Product → Architecture Alignment 会话（未落库为独立文档，
> 摘要保留在本提案 §1）。

## §1 一句话

把 CRM 里已经存在、但目前是"CTS 旅游业务硬编码"的"该不该联系这个客户 / 什么时候 / 走哪个渠道 / AI 还是人做"这套判断，登记为 ME2 的第二个 Domain Module（第一个是 WP05 GEO Module），使其能够复用 Kernel 的治权模型、Attribution/Flywheel 的学习闭环，而不是继续作为 CRM 内部一套自成一体、不可复用、不接受权治理的规则树。

## §2 为什么现在提

1. `src/lib/crm/segments.ts` 已经在生产实现了这套判断的**旅游业硬编码版本**（PR #1069 已把其中唯一真正耦合行业假设的一条规则拆成可插拔接口，零生产行为改变，属于铺垫性重构，**不是**本提案要求的工作）。
2. WP00 契约冻结定义的七层边界里，"Domain Module"这一层的职责（把证据变发现、发现变处方、处方变 ActionCandidate，但不拥有执行权/自我授权权）与这套判断的实际语义完全吻合。
3. Kernel 已有完整的治权模型（`client_automation_policies` 的 `auto_approve / require_approval / deny` 三态）尚无任何真实消费方；`action-bridge` 的 `MAPPING_TABLE` 是空数组。本提案不新造治权机制，只是给已有骨架一个真实的、账户外（lead 级）的消费场景。
4. WP05（GEO Module）是当前唯一被点名的 `src/lib/growth` 消费方；本提案若被接受，会成为第二个，有助于提前验证 Growth 契约的五段结构（`observe→diagnose→prescribe→propose→verify`）是否真的能被两个方向完全不同的域复用，而不是只在 GEO 这一个场景里显得合理。

## §3 提议登记的组件

按 Product Map 的登记纪律（`src/lib/product-map/registry/`），新组件建议：

```
id: domain-module.crm-action-engine
architecturalRole: domain_module
dapeStages: [analysis, prescription]
businessLane: crm
```

## §4 职责边界（先定边界，不设计算法——按 Build Control Room 一贯要求）

**拥有**：
- 读取一个联系人的完整跨渠道 timeline（复用已有的 `contacts` / `contact_identities` / `contact_touchpoints` / `contact_stage_events`，这些是 Measurement 层，已在生产）
- 产出一条 `GrowthActionCandidate`：是否建议现在行动、建议渠道、建议执行者（AI 可执行 / 必须人）、目标、理由（挂证据引用）
- 该候选提交给 Kernel 走 `authorizeRun()`，走已有的三态政策判断

**不拥有**：
- 不直接调用任何 Connector（不发消息、不拨号）——那是 Capability 层的事
- 不自行决定"AI 是否被允许自主执行"——那是 `client_automation_policies` 的事，本模块只能建议
- 不覆盖 DNC——被标记禁止联系的联系人在进入本模块判断之前就应被排除（复用 `lib/crm/dnc.ts` 现有判据，本模块不重新发明）
- 不做资金/折扣相关判断
- 不做行业专属的信号解析（如"客人说的出行月份"）——那部分归属见 §6

## §5 提议的 ActionKey（供 action-bridge 登记，非本提案自行登记）

`crm.contact_lead` —— 语义：建议对某个 `contact_id` 采取一次联系动作。

初始默认政策建议为 `require_approval`（不是 `auto_approve`）——**这条是提案内容的一部分，不是留给实现阶段决定**：在没有任何真实结果反馈闭环之前，不应该允许任何行业的这类判断自主执行。

## §6 CTS-specific vs Tourism Playbook vs 平台通用（沿用 PR #1069 已经定的分层原则）

- **平台通用**（进本 Domain Module）：判断骨架本身（信号 → 紧迫度 → 建议渠道 → 理由的推理形状）、`IndustryPlaybook` 接口（PR #1069 已建立雏形，`resolveWaitSignal` / `clickWindowMs`）
- **Tourism Playbook**（不进本次提案范围，仍留在 `src/lib/crm/`）：`travel-date.ts` 出行时间解析、`stage-infer.ts` 的旅游业 AI 提示词、`qualified-buyer-autotag.ts` 的旅游漏斗假设——这些是已知的、比 PR #1069 覆盖范围更广的旅游耦合点，本提案**不要求**一并解耦，留作独立后续工作
- **CTS 专属配置**：具体文案、CTS 的客户参数——不受影响

## §7 与已有工作的关系

- **不影响** WP02→WP04A（GEO 测量线，已在生产）
- **不影响** WP06（Page Optimization Capability，零调用方，本提案不使用）
- **依赖但不修改** Kernel 已有代码（`authorize.ts` / `registry.ts`）——只是新增一个 `ActionKey` 的登记，不改动治权逻辑本身
- **依赖但不修改** `action-bridge` 的 `MAPPING_TABLE` 结构——只是新增一行映射，不改动映射机制

## §8 明确不在本次提案范围内（避免过度承诺）

- 不提出任何算法/打分公式设计（按对齐会话的结论，先定边界，算法留到实现阶段）
- 不要求 Kernel 生产 migration apply（那是独立授权的运维动作）
- 不要求 WhatsApp / 3CX 人工座席电话等未接线的渠道先补齐
- 不要求"结果学习闭环"（联系了有没有用）一并做——那是本次对齐会话识别出的另一块独立缺口，若本提案被批准，建议作为该 Domain Module 的下一个 WP 单独提出

## §9 请求 Build Control Room 裁定的问题

1. 是否同意把这套判断登记为 ME2 的第二个 Domain Module？
2. §5 提议的 `crm.contact_lead` ActionKey 命名 / 默认政策 `require_approval` 是否可接受？
3. 是否需要先有一个类似 WP05 那样的"前置语义冻结"issue，还是本文档可以直接作为语义冻结的起点？
