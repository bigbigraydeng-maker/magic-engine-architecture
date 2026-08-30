# Spec：OpenSRS 域名 + 企业邮箱 Connector v0.1

- **日期**：2026-08-31
- **owner**：Claude Code（本窗口）
- **PM 拍板已获**：2026-08-31 —— 定位为**卖给客户（ME 当经销商）**，不是内部自用
- **风险级别**：**A 级**（涉及资金流 / 对外新收入线 / 不可逆副作用——域名注册一旦提交不可撤销、按年扣款）
- **Implementation Authorized**：**部分** —— PM 2026-08-31 说「继续」后，授权范围限于**协议层 + 只读查询**（不花钱、不可逆风险为零、不建表、不加路由、不动 migration）。任何花钱或不可逆动作（注册 / 续费 / 转入 / 开邮箱）**仍未授权**，须先过 2 审。
- **状态**：Phase 1 协议层已落地并测通（50 个测试 + 5 处变异验证）；**真实 API 仍一次都没打过** —— 阻塞在「PM 开 OpenSRS 经销商账号」。
- **未过 2 审**：本窗口无法召架构 / 挑刺 agent 复审（当前会话不允许调子 agent），这是一个**已知缺口**，进 Phase 2 前必须补。

---

## 0. 平台层级判定（me-platform-tier-gate · Inline）

- **Tier**：**L3 Connector**。OpenSRS 是外部供应商，ME 与它之间是受治理的 Read / Act 边界，作为 adapter 挂在既有能力下。
- **不新增**：不新增能力线、不新增第 7 支柱、不新增 ME 垂直版本。
- **不进候选表**：按 tier-gate 红线 3，L3 Connector 不占用 `platform-candidates.md` 名额。
- **红线约束**：
  - 供应商专属逻辑（XCP XML 信封、MD5 双签名、cluster 路由）**只能待在 adapter 内**，不得泄漏进 shared runtime。
  - UI / 报告 / 客户交付物里**禁止出现 "OpenSRS"**，对外封装名建议 **Domain & Mailbox Hub**；API 路由内部、错误日志、环境变量可用真名。

---

## 1. Build Gate

1. **Repository Fact Gate**：`git fetch origin` 已跑，`origin/main` = `fecd5eb43bac62fc216b9ebf05345a5f0351791c`（2026-08-31）。
2. **Domain Semantics Gate**：本 connector 不得把首个客户的域名/邮箱事实硬编码。客户的域名清单、邮箱数量、套餐归 L4 client configuration。
3. **Product Gate**：这条线**不属于 IMPACT 闭环，也不属于 6 支柱**——它是一条**独立的增值服务收入线**，服务于「ME 已经在管客户的数字资产，顺手把域名和邮箱也管了」。必须明确它不是 Digital Marketing Intelligence 的一部分，避免污染产品定位叙事。
4. **Architecture / Reuse Gate**：见 §2。

---

## 2. Reuse Statement（事前）

| 已有 / 待建 | 状态 | 说明 |
|---|---|---|
| 域名注册商接入 | ❌ 全仓 0 处 | 全仓 grep `opensrs\|registrar\|namecheap\|godaddy` 只命中 DataForSEO 的 domain-analytics 与文档，**没有任何注册商封装**。这是从零起的第一条。 |
| `src/lib/email/` | ⚠️ 不可复用 | 只有 `sender.ts` / `portal-invite.ts`，是**发通知信**（Resend），跟「给客户开邮箱账户」是两回事。 |
| `src/lib/kernel/` + `src/lib/capabilities/` | ✅ 必须复用 | 对外**写**动作一律走 Kernel gateway。注册域名 = 花钱 + 不可逆，属于 Kernel 治理的典型对象，**禁止**绕过 gateway 直接调 provider。 |
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
| 端点 | 测试 `horizon.opensrs.net:55443` · 生产 `rr-n1-tor.opensrs.net:55443` | `https://admin.<cluster>.hostedemail.com/api/<method>` |
| 端口 | **55443**（非标准） | 443 |
| 鉴权 | `X-Username` + `X-Signature`（API key 与 payload 的**双重 MD5**） | JSON body 内 `credentials` 对象（user + password 或 session_token） |
| IP 白名单 | **生产必须**；测试环境不需要 | 需要（RWI → Add IPs for Script/API Access，默认上限 5 条，按 subnet 填，生效需约 15 分钟） |

→ **实现上必须是两个 adapter**，不要为了"统一"硬造一层抽象把它们捏在一起（那是典型过度设计）。

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

**技术决策（我拍板，不上抛 PM）**：**先不选**。第一阶段全部在 `horizon` 测试环境完成——测试环境**不需要白名单**，可以把注册、续费、开邮箱整条链路真跑通。等第一个真实付费客户出现、这条线证明有收入时，再决定 A/B/C。理由：先证明跑得通，再付固定成本；反过来就是先烧钱后验证。

---

## 4. 分阶段落地

**Phase 0（阻塞中）· PM 开户**
只有 PM 能做：签约主体 + 付款。产出 reseller username + API key（**凭证直接进 env，不进对话、不进仓库**）。

**Phase 1 · 测试环境跑通（无客户、无收钱）** — 协议层 ✅ 已落地，真实连通性 ❌ 未验证
- `src/lib/opensrs/domain-adapter.ts`（XCP 客户端：信封拼装 + 双 MD5 签名 + 55443）
- `src/lib/opensrs/mailbox-adapter.ts`（OMA JSON 客户端）
- 只读优先：域名可用性查询、价格查询、邮箱列表——**先不做任何花钱动作**
- 全部指向 `horizon`，用 `OPENSRS_ENV=test` 切换

**Phase 2 · 写动作进 Kernel**
注册 / 续费 / 开邮箱一律做成 capability，经 `kernel/gateway.ts` 授权后执行。**不可逆 + 花钱**的动作必须落审批与账本。

**Phase 3 · 客户侧**
新表记录「哪个客户持有哪些域名/邮箱」、到期提醒、计费接 MTC/billing、Settings UI 一起做完（不许让 FDE 进 Supabase 直填）。

**Phase 4 · 生产切换**
解决 §3.4 白名单，切 `rr-n1-tor`。

---

## 5. PM 待拍板项（不由 agent 决定）

1. **开户**（Phase 0 阻塞项）—— US$95 + 首笔预存款
2. **对客户的定价**：ME 在批发价上加多少 / 是打包进月费还是单收（需等 Phase 0 拿到真实批发价才谈得拢）
3. **要不要为生产环境花 US$100/月**（Phase 4 才需要决定，现在不用）

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
