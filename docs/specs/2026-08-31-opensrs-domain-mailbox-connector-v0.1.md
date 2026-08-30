# Spec：OpenSRS 域名 + 企业邮箱 Connector v0.1

- **日期**：2026-08-31
- **owner**：Claude Code（本窗口）
- **PM 拍板已获**：2026-08-31 —— 定位为**卖给客户（ME 当经销商）**，不是内部自用。**但商业批准 ≠ 产品路线图批准**，见 §0 的产品边界结论
- **风险级别**：**A 级**（涉及资金流 / 对外新收入线 / 不可逆副作用——域名注册一旦提交不可撤销、按年扣款）
- **Implementation Authorized**：**NO（路线图层面）**。产品边界门未过（见 §0），GO BUILD 不得启动。
  已存在的 `src/lib/opensrs/`（XCP 签名 / 信封 / 回包解析 / 只读 `lookupDomain`）是 **2026-08-31 的技术可行性验证产物**：
  零调用方、零副作用、不花钱、不建表、不加路由、不动 migration、未接任何 UI 或 cron。
  它**不构成**对 §4 后续阶段的授权；若 §0 结论走 (b) 或本服务被否决，这段代码必须保持无人调用或直接删除。
- **状态**：**三重阻塞**：(1) 产品边界未解决——本文档无法回答"这项能力属于 IMPACT 哪一阶段 / 是否增强 Digital Marketing Intelligence"（见 §0），按 [ME_PRODUCT_DEFINITION §11](../strategy/ME_PRODUCT_DEFINITION.md) 默认不得进入产品 Roadmap，需先由 PM+架构 明确按"ME 外部增值服务"处理（不算 Connector、不占 IMPACT 叙事），或补出它绑定的具体营销动作与验证闭环；(2)「PM 开 OpenSRS 经销商账号」未完成，**真实 API 一次都没打过**；(3) Kernel v1 不放行不可逆对外动作（见 §2 与 Phase 2 门 0），域名注册当前**没有**合规落点。任一未解决，GO BUILD 都不得启动
- **未过 2 审**：协议层代码未经子牙（架构）+ 魏征（挑刺）复审——本窗口不具备召子 agent 的条件，这是**已知缺口**，进 Phase 2 前必须补

---

## 0. 平台层级判定（me-platform-tier-gate · Inline）

- **草稿分类（技术形态）**：如果只看接线方式，OpenSRS 是外部供应商，技术上会长得像一个 L3 Connector adapter。
- **但产品边界判定不通过**：按 [ME_PRODUCT_DEFINITION §7.1](../strategy/ME_PRODUCT_DEFINITION.md)，Connector 的定义是 "IMPACT 的感知和行动边界"——必须能说清它为 `Inspect`/`Measure`/`Act`/`Check` 里的哪一环提供了什么。本 spec §1.3 已自行承认：**这条线不属于 IMPACT 闭环，也不属于 6 支柱**（域名/邮箱是数字资产托管，不是营销证据、不产出 Activation/Outcome）。按 [§11 Build vs Connect 原则](../strategy/ME_PRODUCT_DEFINITION.md) 的强制自检——"这项能力属于 IMPACT 哪一阶段？它是否直接增强 Digital Marketing Intelligence？"——本文档**回答不了**，而 §11 明确规定"不能回答第 1、2 或 6 项的自建提案，默认不进入产品 Roadmap"。
- **结论**：在补出具体绑定的营销动作 + Check/验证闭环之前，**本服务不得挂 "L3 Connector" 标签、不进 `platform-candidates.md`、不算平台能力线**，只能作为 **ME 外部增值服务**（经销商转售，独立于 IMPACT 叙事）处理；本文档 §4 的分阶段实施计划因此**暂停 GO BUILD**，直到 PM/架构明确选择：(a) 定义它服务的具体 IMPACT 环节和验证方式后按 Connector 重新走一遍 tier-gate，或 (b) 正式确认按外部增值服务处理并从产品路线图移出，仅作为独立商业功能立项。
- **不新增**（若最终按 (b) 处理，仍适用）：不新增能力线、不新增第 7 支柱、不新增 ME 垂直版本。
- **红线约束**（无论 (a)/(b) 哪种结论都适用）：
  - 供应商专属逻辑（XCP XML 信封、MD5 双签名、cluster 路由）**只能待在 adapter 内**，不得泄漏进 shared runtime。
  - UI / 报告 / 客户交付物里**禁止出现 "OpenSRS"**，对外封装名建议 **Domain & Mailbox Hub**；API 路由内部、错误日志、环境变量可用真名。

---

## 1. Build Gate

1. **Repository Fact Gate**：`git fetch origin` 已跑，`origin/main` = `fecd5eb43bac62fc216b9ebf05345a5f0351791c`（2026-08-31）。
2. **Domain Semantics Gate**：本 connector 不得把首个客户的域名/邮箱事实硬编码。客户的域名清单、邮箱数量、套餐归 L4 client configuration。
3. **Product Gate**：**不通过，见 §0**。这条线**不属于 IMPACT 闭环，也不属于 6 支柱**——它是一条**独立的增值服务收入线**，服务于「ME 已经在管客户的数字资产，顺手把域名和邮箱也管了」。按 ME_PRODUCT_DEFINITION §11，回答不出 IMPACT 阶段和 Intelligence 增益的自建提案默认不得进入产品 Roadmap；PM 的商业批准只覆盖"卖不卖给客户"，不能替代这道产品边界判定。在 §0 结论 (a)/(b) 二选一明确之前，本 spec 后续阶段（§4）**只作技术可行性记录，不视为已授权的路线图**。
4. **Architecture / Reuse Gate**：见 §2。

---

## 2. Reuse Statement（事前）

| 已有 / 待建 | 状态 | 说明 |
|---|---|---|
| 域名注册商接入 | ❌ 全仓 0 处 | 全仓 grep `opensrs\|registrar\|namecheap\|godaddy` 只命中 DataForSEO 的 domain-analytics 与文档，**没有任何注册商封装**。这是从零起的第一条。 |
| `src/lib/email/` | ⚠️ 不可复用 | 只有 `sender.ts` / `portal-invite.ts`，是**发通知信**（Resend），跟「给客户开邮箱账户」是两回事。 |
| `src/lib/kernel/` + `src/lib/capabilities/` | ⚠️ 必须复用，但域名注册当前**过不了** | 对外**写**动作一律走 Kernel gateway，**禁止**绕过 gateway 直接调 provider。但 `outward-authorization.ts:57-65` 对 `reversible !== true` 的对外动作无条件拒绝，而域名注册被本文档定义为不可逆——见 Phase 2 硬前置门 0，域名注册要么等 Kernel 契约升级放开不可逆对外动作，要么改成只读 capability + 人工下单，不能直接假设"接 gateway"就能跑通。 |
| `src/lib/platform-oauth/connection-store.ts` | ⚠️ 待评估 | OpenSRS 用的是 reseller 账号级凭证（非 per-client OAuth），凭证存 env 而非 connection-store；但「哪个客户挂了哪些域名/邮箱」需要一张新表。 |
| `src/lib/mtc/` + `src/lib/billing/` | ✅ 应复用 | 客户侧收费不得另起计费系统。 |
| `src/lib/pm-todo/manual-items.ts` | ✅ 应复用 | 需要真人处理的环节（如域名转移授权码、ICANN 验证邮件）走「🙋 需要你动手」栏，不得死在日志里。 |

**结论**：Connector adapter 是新增的（合理，无既有承载）；**计费、治理、待办下发三条线一律复用，不得平行造系统**。

---

## 3. 硬事实（外部调研结论 · 2026-08-31）

### 3.1 开户
- 注册是**自助的**，不需要商务谈判：<https://opensrs.com/join/>
- **一次性开户费 US$95**（不退，转成账户余额可用于购买）
- 用之前必须**预存款**；信用卡 / PayPal 存款另收 **3% 手续费**（电汇 / ACH 无此费）
- API key 在账号激活后于 Reseller Control Panel(RWI) 自取

### 3.2 两套 API 是**两个完全不同的东西**
| | 域名 | 企业邮箱 |
|---|---|---|
| 协议 | XCP：**XML over HTTPS** | **JSON** over HTTPS |
| 端点 | 测试 `horizon.opensrs.net:55443` · 生产 `rr-n1-tor.opensrs.net:55443` | 生产 `https://admin.<cluster>.hostedemail.com/api/<method>`；**测试端点未知**——`horizon` 是域名 XCP 专属的沙箱，OMA 邮箱 API 不走这个域名/端口，也未查到官方文档给出对应的 OMA 测试 cluster |
| 端口 | **55443**（非标准） | 443 |
| 鉴权 | `X-Username` + `X-Signature`（API key 与 payload 的**双重 MD5**） | JSON body 内 `credentials` 对象（user + password 或 session_token） |
| IP 白名单 | **生产必须**；测试环境不需要 | 需要（RWI → Add IPs for Script/API Access，默认上限 5 条，按 subnet 填，生效需约 15 分钟） |

→ **实现上必须是两个 adapter**，不要为了"统一"硬造一层抽象把它们捏在一起（那是典型过度设计）。

⚠️ **OMA 没有已确认的独立测试环境**：域名侧的 `horizon` 只是 XCP（域名）的沙箱，不能当成邮箱 API 的测试端点用。开户后必须先向 OpenSRS 支持确认 OMA 是否存在对应的 test cluster/IP 访问方式；如果确认不存在沙箱，Phase 1 的"全部指向 `horizon` 跑通"这个说法对邮箱侧不成立，**邮箱 adapter 应移出 Phase 1**，改为等 Phase 4 生产收尾时再做首次真实调用验证（或找到 OMA 沙箱后再补回）。

### 3.3 参考成本
- 邮箱：约 **US$0.50 / 5GB 邮箱 / 月**（来源为 OpenSRS 旧支持站，**开户后必须以后台实际批发价为准**，不得拿这个数字对客户报价）
- 域名：批发价按 TLD 不同，**开户后才看得到真实价目表**

### 3.4 生产环境的 IP 白名单是个真阻塞点
ME 跑在 Render。Render 的默认出站 IP 是**整个 region 与所有 Render 客户共享的 CIDR 段**，不是独占固定 IP。三条路：

| 方案 | 成本 | 评价 |
|---|---|---|
| A. Render dedicated outbound IP | **US$100 / 月** | 干净，但对一条**尚无收入**的新业务线是过重的固定成本 |
| B. 把 Render 共享 CIDR 段加白名单 | 免费 | 等于所有 Render 用户都在白名单里，白名单的防护意义归零（仍有 API key 兜底，但不该这么干） |
| C. 自建固定 IP 出口代理 | 低 | 新增一块基础设施，多一个故障点 |

**技术决策（我拍板，不上抛 PM）**：**先不选**。第一阶段**域名侧（XCP）**全部在 `horizon` 测试环境完成——测试环境**不需要白名单**，域名的查询、注册、续费这条链路可以真跑通。**这个结论只覆盖域名，不能推广到邮箱**：`horizon` 是域名 XCP 专属沙箱，OMA 邮箱 API 没有已确认的对应测试环境（见 §3.2）；邮箱侧能否在拿到生产白名单前跑通验证，取决于开户后能否找到 OMA 的 test cluster——找不到就按 §3.2 / Phase 1 的条件分支处理，邮箱 adapter 移出本阶段，不得因为域名侧跑通了就默认邮箱也跑通。等第一个真实付费客户出现、这条线证明有收入时，再决定域名生产端点的 A/B/C。理由：先证明跑得通，再付固定成本；反过来就是先烧钱后验证。

---

## 4. 分阶段落地

**Phase 0（阻塞中）· PM 开户**
只有 PM 能做：签约主体 + 付款。产出 reseller username + **域名 API key**（**凭证直接进 env，不进对话、不进仓库**）。
⚠️ 这一步**不产出邮箱侧凭证**——§3.2 已明确 OMA 鉴权走 JSON body 里的 `credentials`（`user + password` 或 `session_token`），域名 API key 不能拿来当邮箱凭证用。Phase 0 交接物必须**另外**包含：向 OpenSRS 申请的邮箱管理员账号（user/password）或获取 `session_token` 的方式，以及它的安全存储（同样进 env，不进对话/仓库）与轮换周期。缺这一项，Phase 1 的邮箱部分无法开工。

**Phase 1 · 测试环境跑通（无客户、无收钱）** — 协议层 ✅ 已写并测通；真实连通性 ❌ 一次未验
- 域名侧已落地：`src/lib/opensrs/xcp/{signature,envelope,parse,types}.ts` + `src/lib/opensrs/client.ts`
  （双 MD5 签名 / 确定性信封 / `dt_assoc`·`dt_array` 回包解析 / 只读 `lookupDomain`）。
  50 个单元测试 + 5 处变异验证；`OPENSRS_ENV` 只有显式 `live` 才打生产，其余取值一律落回 `horizon`。
  **测试锁的是「实现符合文档」，不是「OpenSRS 会接受」** —— 后者要等账号。
- 域名侧待补：价格查询（`GET_PRICE`）、余额查询；仍**不做任何花钱动作**
- `src/lib/opensrs/mailbox-adapter.ts`（OMA JSON 客户端）——**未开工**。前置条件：(1) Phase 0 已拿到邮箱管理员凭证/`session_token`（见上），(2) 已向 OpenSRS 确认并记录 OMA 的真实测试 cluster/IP 访问方式（见 §3.2 警示）。两者任一缺失，邮箱 adapter 移出本阶段，先只交付域名 adapter

**Phase 2 · 写动作进 Kernel**

🔴 **硬前置门 0（Kernel 契约门，比数据库对象门更根本，必须先过）**：本文档第 6 行已把域名注册定义为**不可逆**（一旦提交不可撤销、按年扣款）。但 `src/lib/kernel/outward-authorization.ts:57-65` 规定 Kernel v1 对 `sideEffect === 'outward'` 且 `reversible !== true` 的动作**一律返回拒绝**，且这条判据没有全局开关、没有 env 旁路、`requiresHumanApproval` 或补 `rollback` 字段都不能让它通过——注释原文写明"真要放开不可逆的对外动作，那是一次单独的、要重新评估风险的决定"。也就是说：**就算 Phase 0 拿到了 API key、Phase 2 的四张表和 RPC 全部 apply 完成，把"注册域名"做成 capability 交给 `gateway.ts` 执行也会被这道判据挡死**，人工批准和补数据库对象都不能放行。在选定下面 (a)/(b) 之一前，Phase 2 不得规划"域名注册 / 续费接 capability"这一步：
  - (a) 把"放开 `reversible: false` 的对外动作"列为独立的 Kernel 契约升级项，走一次单独的风险评估 + 2 审（子牙 + 魏征），明确新的授权模型（例如：更高等级的人工确认、更严格的账本、限额或冷静期），升级完成后域名注册才能作为 capability 接 gateway；
  - (b) **作为过渡方案，不是永久 SOP**：在 (a) 的契约升级完成前，从 Phase 2/3/4 的自动化范围里暂时**去掉**"域名注册 / 续费"这个写动作，只把只读能力（可用性查询、价格查询、到期日查询）做成 capability，注册这一步走人工审批——按 [`src/lib/pm-todo/manual-items.ts`](../../src/lib/pm-todo/manual-items.ts) 的"🙋 需要你动手"三件套下发（what/how/href 到 OpenSRS RWI 下单页），ME 只负责查询、提醒和记账，不负责代客户点下注册按钮。**真正的阻塞是 Kernel v1 当前的授权契约，不是 OpenSRS 侧确实无法自动化**（XCP API 本身可调用，见 §3.2）——选 (b) 时必须同时做两件事，否则就是把可自动化的能力永久固化成人工 SOP：
    1. 在 §5 待拍板项里登记 (a) 的重新评估触发条件（例如：这条收入线跑出稳定付费客户后，由 PM + 架构主动发起一次 Kernel 契约升级评估），不能选了 (b) 就无限期搁置 (a)；
    2. 人工审批只覆盖"要不要注册"这个业务决策本身；一旦 (a) 完成、Kernel 放开 `reversible: false` 的对外动作授权，注册/续费必须立刻切回 capability + gateway 执行，不得因为 (b) 已经能跑就失去升级动力，让每个客户都重复承担这个容易出错、无法统一审计的人工步骤。

  邮箱侧（开邮箱账户）如果确认是可撤销的（关闭邮箱账户 = 停止计费，不构成"按年扣款不可逆"这类事实），可以继续走 capability + gateway 路线，不受这道门槛约束；但域名注册必须先在 (a)/(b) 之间选一个，不能默认按原计划直接接。

🔴 **硬前置门 1（Kernel 启用 preflight，与门 0 相互独立、缺一不可，就算门 0 走了 (a) 升级完成，门 1 仍要单独过）**：按 [docs/STATE.md §3.1](../STATE.md) 2026-08-12 实查记录，生产环境 `action_runs` / `action_run_steps` / `authorization_decisions` / `client_automation_policies` 四张表和全部 `kernel_*` RPC **一个都不存在**，migration `20260808000003_me2_execution_kernel_v1.sql` 未 apply。这是会过期的快照，不能直接当现况用。进 Phase 2 前必须：
1. 重新对生产对象跑一次存在性核查（不能沿用旧记录）；
2. 若表/RPC 仍不存在，**apply 该 migration 需要 PM 另外显式授权**（属于第 6 条铁律"不可逆操作必须 PM 显式 go"），不得因为"这个 PR 已经拍板卖给客户"就默认可以顺带 apply；
3. 在 Kernel 存储确认可用之前，**不得**开始注册 / 续费 / 开邮箱这类写动作的接入代码——否则会在调用 provider 之前就因为审批与账本无处可写而失败或裸写。

🔴 **硬前置门 2（未知结果对账门，与门 0 / 门 1 相互独立、三者缺一不可）**：门 0 只解决"要不要允许发起不可逆的对外写动作"，没有回答"发起之后如果结果不明该怎么办"。真实风险场景——OpenSRS 已经受理续费/注册请求并完成扣款，但 ME 客户端在收到响应前超时——此时 Kernel 本地的幂等键（`idempotency.ts`）和账本只能证明"我方提交过这次请求"，**证明不了供应商侧到底有没有生效**。如果这时走 dead-letter 恢复或人工重提，会出现两种同样有害的后果：(1) 对已经扣款成功的订单重新发起注册/续费，造成二次扣款；(2) 把供应商侧其实已经成功的资产误判为失败写回账本。因此在把注册/续费/开邮箱接成 capability 之前，除了门 0/门 1，还必须补齐：
1. **`providerIdempotency` 声明**：逐个写动作确认 OpenSRS XCP/OMA 是否支持调用方自带的去重键（订单号/请求 ID）；支持的必须在 capability 定义里声明并透传这个键，不支持的要在 capability 文档里明确写"这个动作不允许被自动重放"。
2. **查询式对账，不允许盲重放**：任何写动作只要进入未知结果（超时 / 网络错误 / 5xx），dead-letter 恢复或人工重提之前必须先按域名或订单号调只读接口（如 `domain/get`、订单查询）确认供应商侧真实状态；不得在没有查询确认的情况下直接重放同一个写请求，也不得直接把它标记为失败。
3. **账本要能表达"未知/待对账"这一独立状态**：不能只有成功/失败二元状态，必须有一个中间态（待对账），只有对账查询把它转成"确认成功"或"确认失败"之后，才允许账本写终态、才允许放行下一步恢复动作。

门 0（域名注册的不可逆授权路径已选定并落地）、门 1（数据库对象已确认存在）、门 2（`providerIdempotency` + 查询式对账 + 未知结果恢复规则已定义）三者都通过，才继续做「注册 / 续费 / 开邮箱一律做成 capability，经 `kernel/gateway.ts` 授权后执行；不可逆 + 花钱的动作必须落审批与账本」这部分。

**Phase 3 · 客户侧**
新表记录「哪个客户持有哪些域名/邮箱」、到期提醒、计费接 MTC/billing、Settings UI 一起做完（不许让 FDE 进 Supabase 直填）。

**Phase 4 · 生产切换**
解决 §3.4 白名单，切 `rr-n1-tor`。**同样受 Phase 2 的 Kernel 启用门约束（门 0 / 门 1 / 门 2 全部适用）**——生产切换意味着开始产生真实资金动作，若这三道门在此之前失效（例如表被回滚、RPC 被撤、`providerIdempotency`/查询式对账实现被跳过），必须在切换前重新核查一次，不能假设 Phase 2 查过一次就永久有效。切到生产 cluster 后**必须重新验证一次门 2 的查询式对账接口**（`domain/get` 等）在 `rr-n1-tor` 上确实可用，不能假设测试环境 `horizon` 验证过就等于生产也通。

---

## 5. PM 待拍板项（不由 agent 决定）

1. **产品分类**（见 §0，GO BUILD 的第一阻塞项）—— 按 (a) 补出绑定的 IMPACT 环节/验证闭环走 Connector tier-gate，还是 (b) 确认按外部增值服务处理、移出产品路线图；这道判定不是纯技术问题，需 PM + 架构一起拍
2. **开户**（Phase 0 阻塞项）—— US$95 + 首笔预存款
3. **对客户的定价**：ME 在批发价上加多少 / 是打包进月费还是单收（需等 Phase 0 拿到真实批发价才谈得拢）
4. **要不要为生产环境花 US$100/月**（Phase 4 才需要决定，现在不用）
5. **域名注册这个不可逆对外动作怎么过 Kernel**（见 Phase 2 硬前置门 0）—— 是走 (a) 单独评估 + 2 审升级 Kernel 契约放开 `reversible: false` 的对外动作，还是 (b) 作为过渡先只做只读查询 + 人工下单、并登记 (a) 的重新评估触发条件；这道判定同样不是纯技术问题（涉及"要不要放开 Kernel v1 的不可逆红线"这个治理决定），需 PM + 架构一起拍，Phase 2 不得默认选边，选 (b) 也不等于把人工下单定成永久 SOP
6. **未知结果对账的失败模型**（见 Phase 2 硬前置门 2）—— `providerIdempotency` 怎么声明、查询式对账用哪个只读接口、账本的"待对账"中间态怎么落表；这是 A 级资金写路径的必备设计，须在门 2 通过前由架构明确，不得留白直接进 GO BUILD

---

## 6. 本 spec 明确**没有**做的事

- **没打过任何一次真实 OpenSRS 请求**。签名公式、端点、回包结构全部来自文档调研，
  单元测试锁的是「实现符合我读到的文档」，**不是**「OpenSRS 会接受」。这两件事之间
  隔着一个账号，账号到位前不许对外声称"接通了"。
- 没建表、没加 API 路由、没动 migration、没配 env 值（只在 ENV.md 登记了变量名）
- 没写任何花钱 / 不可逆动作（注册 / 续费 / 转入 / 开邮箱一律未实现）
- 没做邮箱 OMA 的 JSON 客户端（Phase 1 剩余项）
- 没做定价模型
- **未过 2 审**（A 级任务进 Phase 2 前须子牙 + 魏征）
