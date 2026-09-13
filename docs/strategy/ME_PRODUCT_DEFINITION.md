# Magic Engine — Digital Marketing Growth Intelligence System

> 文档类型：产品定义权威文件  
> 版本：v1.0 Frozen  
> 日期：2026-08-22（Pacific/Auckland）  
> Product Owner：Ray  
> 状态：Product Owner 已确认保存并冻结  
> 适用范围：产品定位、产品设计、架构、Roadmap、行业版本、客户交付与对外叙事

## 1. 权威声明

本文件用于统一 Magic Engine 的产品名称、责任边界、核心闭环和关键术语。

自本文件冻结起：

- 本文件成为 Magic Engine 产品定义的权威来源；
- `PRODUCT.md`、`CLAUDE.md`、Health Check、Roadmap、销售材料和功能设计必须与本文件对齐；
- 旧文件中与本文件冲突的产品定位、DAPE/IMPACT 关系或自建边界自动视为过时；
- 代码、Issue、PR、部署和测试只能证明实现状态，不能反向改写产品定义。

本文件定义产品应当是什么，不宣称任何能力已经在生产跑通。当前运行事实仍以 `STATE.md`、生产证据和最新 Build Control 状态为准。

## 2. 正式产品名称

### 英文产品类别

**Digital Marketing Growth Intelligence System**

### 中文产品类别

**数字营销增长智能系统**

### 一句话定义

> Magic Engine 持续理解企业的市场、渠道、内容、客户旅程与营销结果，选择下一步最有价值的数字营销动作，通过连接器受控执行，验证真实结果，并让下一次决策变得更好。

### 为什么名称中使用 Intelligence

Magic Engine 的核心价值不是拥有更多工具，也不是单纯替企业执行任务，而是形成可持续复利的营销智能：

- 理解企业当前的数字营销状态；
- 找到真正值得处理的问题与机会；
- 比较不同动作的预期价值、证据、成本和风险；
- 从真实 Outcome 中学习；
- 将可靠经验安全地沉淀为客户、行业和平台智能。

执行是 Intelligence 产生价值的必要路径，但不是产品类别名称本身。执行由 IMPACT 的 `Act` 阶段以及 Kernel、Connector 和 Governance 承担。

## 3. 产品责任边界

### 3.1 ME 直接负责

Magic Engine 对以下 Digital Marketing Growth 能力负责：

- 市场、受众、竞争、渠道和需求洞察；
- SEO、AI/GEO、社媒、广告、口碑和竞品 Intelligence；
- Digital Marketing Growth State；
- 机会发现、比较和排序；
- Next Best Digital Marketing Action；
- Campaign、Offer、内容、创意、页面和营销旅程的策略与资产生产；
- 跨渠道营销动作编排；
- 营销动作的审批、授权、执行证据和审计；
- Baseline、Verification、Outcome 和 Attribution；
- Failure Memory、成功经验和 Learning Promotion；
- 有证据支持的行业 Playbook 与 Benchmark。

### 3.2 ME 不直接负责

Magic Engine 不以自建方式替代企业已有的经营和交易系统，包括但不限于：

- CRM 系统本体；
- 预约、排班、POS、库存、支付和财务；
- 旅游库存、正式报价、出票和预订后台；
- 移民案件、留学申请和正式文档管理；
- 通用邮件、短信、WhatsApp 或社媒平台本体；
- 通用 OAuth、工作流、可观测性、计费和媒体处理基础设施；
- 其他已经存在成熟外部产品、且本身不构成 ME 营销智能护城河的能力。

这些系统继续作为各自业务事实的 Source of Truth。ME 通过 Connector 读取必要事实、调用被授权动作并接收结果，不复制完整业务流程。

### 3.3 最小保存原则

为完成营销决策、执行、验证和归因，ME 可以保存：

- 外部对象的稳定引用；
- 必要的营销上下文；
- 获得授权的快照和证据；
- 动作、审批、执行回执和 Activation；
- 可比较的 Outcome；
- 明确作用域的学习。

ME 不应因为“以后也许有用”而复制外部系统的完整客户、病例、案件、库存、订单或文档数据。

## 4. 唯一端到端产品闭环：IMPACT

**IMPACT 是 Magic Engine 唯一的端到端 Digital Marketing Growth Intelligence 闭环：**

> **Inspect → Measure → Prescribe → Act → Check → Tune**

IMPACT 不是泛指“效果”，也不是营销文案缩写。它是产品、数据、执行和验收共同遵守的 Operating Contract。

### I — Inspect

理解现在发生了什么，并保存可追踪证据。

包括：

- Business Goal 与营销目标；
- 企业、品牌、市场、受众、Offer 和约束；
- 网站、搜索、AI 可见度、内容、社媒、广告、口碑和竞品状态；
- 外部 CRM、预约、预订、案件或交易系统提供的必要事实；
- 数据缺口、异常、机会和可信度。

输出不是泛泛报告，而是带来源、时间、范围和置信度的 Current Digital Marketing Growth State。

### M — Measure

定义如何诚实地判断变化。

包括：

- 当前 Baseline；
- 目标 Metric 与业务相关性；
- 数据来源和对象身份；
- 分母、样本量和数据完整度；
- 对比 cohort；
- Verification Window；
- 可比性、成本和归因限制。

没有可信 Baseline、Metric 或可比方法时，系统不得假装能够证明 Impact。

### P — Prescribe

根据证据选择下一步最有价值的数字营销动作。

包括：

- Ranked Opportunities；
- Next Best Digital Marketing Action；
- 为什么现在做；
- Expected Impact；
- Confidence；
- Cost、Risk、Reversibility 和 Time-to-Evidence；
- 精确目标、输入、执行条件和 Verification Definition；
- 不做什么以及为什么。

Prescription 的价值不是产生更多建议，而是减少选择，形成可解释的优先顺序。

### A — Act

将被批准的精确营销动作安全地变成现实。

包括：

- Human Approval；
- Kernel Authorization；
- 预算、权限、成本、幂等和副作用检查；
- 通过 Connector 调用外部系统；
- Execution Receipt；
- 对精确目标的 Activation Verification；
- 失败、回滚或人工交接证据。

`PR merged`、`API 返回成功`、`邮件已发出`或`任务已完成`只能证明执行过程，不能证明营销结果。

### C — Check

在预先定义的时间和范围内检查真实结果。

包括：

- 按 Verification Definition 读取 after evidence；
- 验证对象、cohort、时间窗口和 Metric 与 Baseline 可比；
- 区分 Activation、Output、Marketing Outcome 和 Business Outcome；
- 记录正向、负向、无变化、证据不足或不可归因；
- 明确季节性、预算变化、并行动作和其他归因 caveat。

未知必须保持 `UNKNOWN`，缺失结果不能被推断为成功或失败。

### T — Tune

让真实 Outcome 改变下一次判断。

包括：

- 更新客户当前 Growth State；
- 调整机会和动作排序；
- 保存成功、失败和 inconclusive learning；
- 决定是否重复、停止、扩大、缩小或改变动作；
- 将学习保留在 client-private，或在满足证据和隐私条件时晋升到 industry/global；
- 生成下一轮可解释的 Inspect、Measure 或 Prescribe。

Tune 没有改变后续决策，就不能称为学习闭环。

## 5. IMPACT 的标准产品展开

以下对象不是另一套闭环，而是 IMPACT 的产品化展开：

```text
Inspect
  Business Goal
  → Current Digital Marketing Growth State
  → Evidence-backed Opportunities

Measure
  Baseline
  → Metric / Cohort / Verification Window
  → Comparability and Attribution Plan

Prescribe
  Ranked Opportunity
  → Next Best Digital Marketing Action
  → Expected Impact / Confidence / Cost / Risk

Act
  Human Approval
  → Kernel Authorization
  → Connector Execution
  → Receipt and Activation

Check
  Comparable After Evidence
  → Attributed Outcome
  → Confidence and Caveats

Tune
  Learning Scope
  → Memory / Playbook update
  → Better next ranking and action
```

## 6. IMPACT 与 DAPE 的关系

DAPE 与 IMPACT 不同名、不同层级，不能互换使用。

- **IMPACT** 是产品级、端到端、包含执行后验证与学习的唯一闭环；
- **DAPE** 是 ME 内部用于发现、分析、形成处方并转为执行的工作方法；
- DAPE 可以帮助完成 IMPACT 前四段的一部分，但不能替代 `Check` 和 `Tune`。

参考映射：

| DAPE | 主要服务的 IMPACT 阶段 |
|---|---|
| Discovery | Inspect |
| Analysis | Inspect + Measure |
| Prescription | Prescribe |
| Execution | Act |

所有 DAPE Execution 若没有进入 Check 和 Tune，只能称为执行完成，不能称为 IMPACT 完成。

## 7. Connector 战略

### 7.1 Connector 的产品角色

Connector 不是辅助集成，也不是客户特供接线。它是 IMPACT 的感知和行动边界：

- 为 `Inspect` 提供外部状态和业务上下文；
- 为 `Measure` 提供 Baseline、Metric 和结果数据；
- 为 `Act` 执行获得授权的动作；
- 为 `Check` 返回 Activation、预约、询盘、预订、签约、订单或收入证据。

### 7.2 API、Webhook 与 MCP 的分工

- **API**：稳定读取、批量同步和执行明确动作；
- **Webhook/Event**：接收外部系统发生的状态变化和结果；
- **MCP**：让 Agent 在明确权限内按需查询和调用外部工具；
- **文件导入/人工确认**：仅作为没有可靠接口时的受控 fallback，不成为默认架构。

不能为了使用 MCP 而把稳定同步和事件回传全部改造成 MCP；也不能因为外部系统没有 MCP 就重复开发其业务能力。

### 7.3 Connector 标准能力

每个 Connector 根据外部系统能力，声明并验证：

1. Discover：可以访问哪些对象与动作；
2. Read：可以读取哪些经过授权的事实；
3. Act：可以执行哪些精确动作；
4. Listen：可以接收哪些事件；
5. Verify：可以如何独立确认动作和结果；
6. Govern：权限、成本、审批、幂等、失败和回滚边界。

Provider-specific 逻辑留在 Adapter/Connector；行业语义不得进入 Connector；客户私有语义不得进入 shared runtime。

## 8. ME 必须拥有的 Intelligence

以下能力构成 ME 的核心产品资产，不应外包成一个无法解释和学习的黑箱：

1. **Digital Marketing Growth State**  
   理解客户当前目标、市场、渠道、资产、约束、证据和历史。

2. **Opportunity Intelligence**  
   发现并比较搜索、AI、内容、社媒、广告、口碑、竞争与转化机会。

3. **Next Best Digital Marketing Action**  
   用证据、预期价值、成本、风险、可逆性和验证速度选择下一步。

4. **Marketing Strategy and Asset Intelligence**  
   将判断转化为 Campaign、Offer、内容、创意、页面和营销旅程。

5. **Measurement and Attribution Intelligence**  
   证明发生了什么、效果多大、证据是否可比、归因能够说到哪一步。

6. **Outcome and Failure Intelligence**  
   同等重视成功、失败、无变化和证据不足，避免重复无效路径。

7. **Learning Promotion Intelligence**  
   决定一条客户经验何时有资格成为行业或平台知识。

8. **Governed Execution Intelligence**  
   让 AI 可以行动，但权限、预算、输入、审批、回滚和审计始终可控。

## 9. 六个 Digital Marketing 支柱

IMPACT 可运行于以下共享支柱：

- SEO；
- AI Visibility / GEO；
- Social；
- Ads；
- Reputation；
- Competitor Intelligence。

支柱不是六套独立产品，也不应各自建设平行 Kernel、Connector、Measurement、Attribution 或 Memory。

每个支柱可以拥有自己的 evidence、metric、candidate 和 action semantics，但必须进入同一个 IMPACT Operating Contract。

## 10. 行业版本

Magic Engine 的长期形态是一个共享平台和多个行业版本。

### 共享平台

- IMPACT Contract；
- Growth/Measurement/Verification Contract；
- Connector 与 Adapter 边界；
- Capability；
- Kernel 与 Governance；
- Attribution；
- Memory 与 Learning Promotion；
- 通用 Intelligence 和执行证据。

### 行业层

行业差异进入 Playbook、Profile、Policy、Benchmark 和 Configuration：

- 行业术语与实体；
- 常见 Audience 和 Offer；
- 渠道权重与季节性；
- 转化事件和商业价值；
- 合规约束；
- 有证据支持的推荐动作、先后顺序和失败边界。

### 客户层

客户差异进入：

- client configuration；
- approved evidence；
- provider connections；
- business goals；
- client-private memory。

首个客户或单个成功案例不得被直接写成共享平台规则。

## 11. Build vs Connect 原则

### ME 应建设

如果能力直接决定 ME 如何理解、选择、验证或学习 Digital Marketing Growth，应优先成为 ME 自有能力。

### ME 应连接或采购

如果能力主要负责外部业务经营、通用基础设施或已经成熟的渠道执行，应优先通过 API、Webhook、MCP 或成熟平台接入。

### 每项开发前必须回答

1. 这项能力属于 IMPACT 哪一阶段？
2. 它是否直接增强 Digital Marketing Intelligence？
3. 市场是否已有可靠产品和接口？
4. ME 是否只需要其数据、动作或结果，而不是系统本体？
5. 外部连接失败时，ME 是否能诚实显示 `NOT READY` 或 `UNKNOWN`？
6. 自建是否会形成真正的数据、决策或学习护城河？

不能回答第 1、2 或 6 项的自建提案，默认不进入产品 Roadmap。

## 12. Outcome 层级与诚实归因

ME 必须区分：

1. **Execution**：动作是否被执行；
2. **Activation**：动作是否在精确目标上真实生效；
3. **Marketing Output**：内容、曝光、访问、互动或线索是否发生；
4. **Marketing Outcome**：有效询盘、预约、报价、预订、签约等是否改善；
5. **Business Outcome**：收入、毛利、留存或复购是否发生变化。

ME 对自己的 Digital Marketing Growth 范围负责，但不把所有 Business Growth 都归因给营销。

只有证据允许时，才可以从 Marketing Outcome 关联到 Business Outcome；缺少外部结果回传时必须显示结果未知。

## 13. 一条 IMPACT Loop 的完成标准

只有同时满足以下条件，才可以声明一条真实 IMPACT Loop 完成：

- Goal、客户、对象和范围明确；
- Inspect 使用可追踪 Evidence；
- Measure 建立可信 Baseline、Metric、cohort 和验证窗口；
- Prescribe 产生一个可解释、可执行、可验证的优先动作；
- Act 经过必要审批与授权；
- 外部执行拥有精确 Receipt；
- Activation 被独立验证；
- Check 使用与 Baseline 可比较的 after evidence；
- Outcome 被诚实分类并说明归因限制；
- Tune 将结果用于下一次排序、动作或停止决定；
- 全链路可以追溯到同一个 Goal、Evidence、Action 和 Outcome lineage。

以下情况均不能宣称闭环完成：

- 只完成诊断或报告；
- 只生成内容或建议；
- 只获得人工批准；
- 只完成 API 调用、发布、PR、部署或回执；
- 只看到指标变化但无法证明可比；
- 保存 Outcome 但没有改变下一次决策；
- 本地测试跑通但生产没有真实运行事实。

## 14. 产品北极星

Magic Engine 的近期产品北极星是：

> 在真实客户、真实营销目标和真实外部系统上，重复完成 truthful Digital Marketing IMPACT loops，并证明每一轮 Intelligence 都因上一轮 Outcome 而变得更好。

衡量产品进展时优先看：

- 有可信 Baseline 的动作比例；
- 有明确 Verification Definition 的动作比例；
- 建议接受率与授权后执行率；
- Activation 成功率；
- 有可比较 Outcome 的动作比例；
- Outcome 到下一次决策的闭环率；
- 从发现到证据的时间；
- 每客户人工投入；
- 行业 Playbook 的证据覆盖与复用效果；
- 客户留存、扩张、收入和毛利。

功能数量、Agent 数、代码行数、表数量、Issue 或 PR 数量不是产品北极星。

## 15. 术语使用规则

- `IMPACT`：仅指 Inspect → Measure → Prescribe → Act → Check → Tune；
- `Impact`：普通英文语境下如需表示影响，应写成 `expected impact` 或 `measured outcome`，避免与 IMPACT 混淆；
- `Outcome`：Check 后形成的诚实结果，不等于 execution receipt；
- `Intelligence`：由证据、比较、判断、结果和学习共同形成的可解释营销智能；
- `Connector`：ME 与外部系统之间受治理的读取、行动和验证边界；
- `DAPE`：内部工作方法，不是产品级闭环；
- `Kernel`：受治理执行基础设施，不是产品定位；
- `Agent`、`Module`、`Capability`：内部实现手段，不作为产品最终价值定义。

## 16. 冻结后的同步范围

本文件冻结后，需要分阶段同步而不是一次性改动全部代码：

1. 在 `DECISIONS.md` 登记产品定位与 IMPACT 冻结决策；
2. 修正 `CLAUDE.md` 中“以 Goal 为中心的生意指挥平台，营销只是其中一条战线”的旧定位；
3. 修正 `PRODUCT.md` 的过时定位；
4. 修正 Health Check 中“无论叫 DAPE 还是 Impact”及另一套 canonical loop；
5. 在总控制台明确展示正式产品类别和 IMPACT 六阶段；
6. 要求所有新 Roadmap/WP 声明其 IMPACT 阶段、Build vs Connect 判断和 Outcome 验证；
7. 盘点现有 CRM、Voice、Billing、OAuth、Workflow 等 Roadmap，区分保留、连接、采购、退役与停止新增。

以上同步不代表自动获得 merge、部署、数据库或外部系统写入授权。

## 17. Reuse Statement

- 复用现有 shared platform 原则：Capability、Adapter/Connector、Kernel、Measurement、Growth、Verification、Attribution、Flywheel 与 Memory；
- 复用现有 IMPACT 实现语义：Inspect、Measure、Prescribe、Act、Check、Tune；
- 本文件新增的是统一产品层级、命名、边界和术语，不新增 runtime；
- 行业差异继续留在 Playbook/Profile/Policy/Benchmark；
- 客户差异继续留在 configuration、approved evidence、provider connections 和 private memory；
- 没有客户名、客户 ID、行业规则或客户私有事实进入 shared runtime；
- 本文件不把任何客户级学习提升到行业或平台层。
