# 地产 Agent 客户 Onboarding —— 第三方平台曝光注册 SOP

> **适用范围**：`client_type = 'agent'`（个人/团队地产中介客户）。每个新签的 NZ 地产 agent 客户，onboarding 阶段直接走这份清单，不用重新审计一遍。
> **起源案例**：Roman Hu（Ray White Mission Bay），2026-08-21 首轮审计 + 2026-08-27 沟通稿落地。详细审计过程见 [`docs/clients/roman-hu/2026-08-21-third-party-platform-audit.md`](../clients/roman-hu/2026-08-21-third-party-platform-audit.md)。
> **PM 决定**（2026-08-27）：这几个平台是新西兰地产 agent onboard 后，ME **默认协助完成注册/信息核对**的标准动作，不是 Roman 专属服务。

---

## 为什么这件事重要（不只是"资料要更新"）

这几个平台的域名权重远高于客户刚起步的官网（RateMyAgent DR 68、OneRoof DR 67、homes.co.nz DR 58，对比一个新官网常见 DR < 1）。**AI 助手判断"该推荐哪个 agent"，大概率是从这些高权重第三方页面认出客户，而不是从他自己的官网**。所以这些页面信息对不对、有没有反链回客户官网，直接影响 AI 可见度（GEO），不是单纯的"资料整洁"问题。

**硬性检查项：每个平台的 profile 网站字段必须 backlink 回客户官网。**

---

## 五个平台，按能不能自助处理分三类

### ① 自助处理（客户自己登录，几分钟搞定，不用发邮件）

| 平台 | 客户要做什么 | 备注 |
|---|---|---|
| **Trade Me OneHub**（onehub.trademe.co.nz） | 用所属中介行的公司账号登录，确认 Agency & License Links 是当前东家、Servicing regions 覆盖当前主打区域、清掉旧东家的 Awards 履历 | **关键：homes.co.nz 的资料是从这里同步的**，先做这步，homes.co.nz 有时会自动跟着修正 |
| **RateMyAgent**（ratemyagent.co.nz） | 登录自己的资料编辑页，在独立的 "Website" 字段填客户官网链接 | 跟社媒链接是分开的字段，容易漏填 |

### ② 需要提交客服工单（先等①自动同步，没同步再发）

| 平台 | 触发条件 | 备注 |
|---|---|---|
| **homes.co.nz** | 做完①等 3-5 天，资料还显示旧东家 | 没有公开客服邮箱，走 Trade Me 统一工单入口 [help.trademe.co.nz/hc/en-us/requests/new?contactus](https://help.trademe.co.nz/hc/en-us/requests/new?contactus)（homes.co.nz 是 Trade Me 旗下产品）。工单模板见 [`docs/clients/roman-hu/2026-08-27-third-party-outreach-drafts.md`](../clients/roman-hu/2026-08-27-third-party-outreach-drafts.md) |

### ③ 需要客户本人身份验证，ME 不能代劳（只能引导，不能代做）

| 平台 | 为什么不能代做 | 引导要点 |
|---|---|---|
| **Neighbourly**（neighbourly.co.nz） | 地址验证要求上传**驾照或本人地址证明文件**（水电账单/银行对账单），是本人身份绑定，第三方代传等于弄虚作假 | neighbourly.co.nz/join → 填姓名/住址/邮箱 → 验证方式二选一（驾照 / 上传地址证明）→ 最长 3 天处理 → 通过后去 Business 页面 "Let's get started" 建商家资料 |

---

## 不算清单的两项（查过，确认不适用）

- **OneRoof（NZME）个人主页**：没有自助功能，"Agent profiling" 是要联系区域销售经理谈的付费投放位（Auckland 区对接人 Gerard Russel），不是标准 onboarding 动作。**要不要谈这个是商务决策，PM 拍板，不默认列入 onboarding 清单**。
- **REA 官方公共注册**（publicregister.rea.govt.nz）：纯政府维护记录，agent 不能自己在线改，换东家要通知 REA 属于**执照合规义务**，不是营销动作，也通常在入职流程里已经处理。ME 不跟进，除非客户自己发现执照信息有误。

---

## 如何评估未来出现的新候选平台

不是每个"看起来像地产目录"的网站都要加进清单。新候选先问三个问题：

1. **有没有自助注册/编辑入口？** 纯靠平台自己调研/抓取生成的排名榜（比如 Canstar 那种客户满意度奖项）不算，agent 没法自己动手。
2. **是不是聚合已有数据，而非独立信息源？** 比如 Top5.nz 是把 RateMyAgent/Google 等已有评价数据聚合排名——把源头平台做好，这类聚合站会跟着受益，不用单独处理。
3. **权重/流量是否显著？** 用 ahrefs/similarweb 类工具粗查一下 DR 和月访问量，太低的 SEO 内容站（哪怕能注册）性价比不值得客户花时间。

三条都过了才值得加进本清单——加的时候更新这份文档，而不是写死进某个客户的 client 配置里。

---

## Reuse Statement

- **复用了什么**：`docs/sops/client-onboarding-access-requirements.md` 的 Tier 分级表格格式；Roman Hu 案例的完整审计与沟通稿（保留在 `docs/clients/roman-hu/`，作为可追溯的原始素材，不重复搬运）。
- **新增内容哪些是 platform-shared**：本文档本身——五平台清单、三分类处理逻辑、新候选平台评估三问，适用于任何 `client_type='agent'` 客户。
- **哪些是 client-specific**：Roman 的具体入职日期、license 号码、旧东家名字等，留在 `docs/clients/roman-hu/` 的沟通稿里，不写进本 SOP。
- **客户私有事实有没有混进 shared runtime**：没有——本文档不含任何客户名/ID/私有事实。
