# CRM + AI 客服接入 —— 构建控制室（Build Control Room）

> 本文档是**控制记录**，不是实现 issue，不当分支/PR 范围用。仿照 `docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md`
> 与 [issue #870](https://github.com/bigbigraydeng-maker/magic-engine/issues/870)（ME2 构建控制室）的既有模式——本仓库已经有一次
> "多窗口并行、没人管全局，结果互相踩"的教训（见下方"已发生的真实冲突"），这次是把同一套治理搬到 CRM/AI 客服这条线。

## 目的（PM 2026-09-15 拍板）

让 ME 的 CRM 系统兼顾：
1. AI 客服接入 Facebook Messenger（WhatsApp 范围见下方"范围已拍板"）
2. 用户（客户联系人）信息管理
3. CAPI 数据回传（广告归因闭环）
4. 知识库训练（AI 该说什么/不该说什么的事实源）
5. 接收邮件、Messenger、WhatsApp 的对话信息（统一收件——**收件**跟"AI 主动接
   WhatsApp Business 客服"是两件事，收件不受下面这条范围决定影响）

**范围已拍板（2026-09-15）**：PM 确认维持 issue #1290 原有冻结决定——**先只做 Messenger
一条路，WhatsApp Business 的 AI 客服接入暂不启动**，等真的有 ≥2 个客户要用再抽公共
Adapter。构建控制/任何窗口看到"要不要现在做 WhatsApp AI 客服"，答案是"不做，按老计划"，
不用再问 PM。

**PM 需要的不是新功能，是一个不会让自己"lost"的控制点** —— 现在有 6+ 个并行窗口在碰这条线的不同角落，PM 自己拼不出全貌，容易重复授权、重复花钱、或者漏掉冲突。

## 角色

- **产品负责人**：PM（Ray）—— 业务、优先级、花钱、风险接受度、"WhatsApp 现在要不要做"这类范围决定
- **构建控制**：一个专门开的窗口/会话，只做协调，不写代码——职责见下"构建控制的日常工作"
- **实现窗口**：任意 Claude Code 窗口——领活前必须先来这份文档 + 对应 issue 核对现状，不许凭记忆开工
- **铁律**：一个窗口 = 一个 issue/PR，同一个 issue 同时只许一个窗口在动

## 工作原则（照抄 #870，验证过有效）

- 不搞 Agent 群魔乱舞——先看现有能力能不能扛，不是每个新需求都建一个新模块
- **写方案不等于批准**，**批准不等于执行**——merge / apply migration / 上线开关 / 接通调用方，永远是分开的、需要 PM 显式 `go` 的动作
- GitHub issue / PR / 数据库记录是窗口之间**唯一**的交接方式——不许靠聊天记录或者"我以为"传状态
- 每次有实质进展，**当场**在对应 issue 上评论 + 勾掉 checklist，不许拖到"最后汇总"再补

## 现状全景（2026-09-15，逐条 `gh issue/pr view` 核实，不是抄旧文档）

### 已经做完、可以复用的地基

| 能力 | 状态 | 位置 |
|---|---|---|
| 客户知识库（AI 该说什么/不该说什么的双签事实源） | ✅ 6 步全部合并 | `src/lib/knowledge/`，issue #1643-#1648 均已关闭，详见 [ROADMAP.md](../ROADMAP.md) |
| Messenger webhook 接收 | ✅ 已合并 | issue #1640 |
| WhatsApp webhook 退订+事件接线 | ✅ 已合并 | issue #1637 |
| 渠道查表分发（channel-dispatch） | ✅ 已合并 | issue #1636 |
| 跨渠道退订检测 | ✅ 已合并 | issue #1625 |
| 对话分类逻辑 | ✅ 已合并 | issue #1621 |
| CAPI 支持 Facebook 私信身份（PSID）第三种匹配键 | ✅ 已合并（NAL 客户） | PR #1684 |
| NAL 私信 → CAPI 有效咨询同步（dry_run） | ✅ 已合并，未切真发送 | PR #1675/#1689，等 PM/FDE 决定要不要审这批 `pending_review` |
| Verifier 框架 + CTS 七道闸（AI 说的话过最后一道数字核实） | ✅ 已合并（2026-09-15，merge commit `65efbfa0`） | issue #1579，PR #1638 —— 改接新 `getClientKnowledge` 完成，子牙 CONDITIONAL PASS（[#1726](https://github.com/bigbigraydeng-maker/magic-engine/issues/1726) 跟踪，P3 不阻塞）+ 魏征 ✅ 通过，PM 拍板后合并 |
| Messenger AI 客服核心（prompt.ts + 3 只读工具） | ✅ 已合并（2026-09-15，merge commit `2c05d77f`） | issue #1580，PR #1639 —— 同上改接完成，子牙 ✅ 通过，PM 拍板后合并 |
| Inngest 编排 F3 批准中继 + 门户批准/拒绝/改后发送端点 | ✅ 已合并（2026-09-15，merge commit `7e938eb6`） | issue #1586，PR #1741 —— 子牙+魏征各一轮，两边独立发现同一个真实并发漏洞（双人/双击可能导致"DB 说拒绝、批准通知却已经真发出"的不一致）已修复为数据库层原子条件更新，魏征用真实测试+变异测试核实通过，PM 拍板后合并。**依赖 #1585（F2）尚未实现，本身不会让 CTS 私信客服真正上线**——已把两条交接说明写进 #1585 的评论 |

### 依赖已经解除，逐条 `gh issue view` + `gh pr list --state all --search` 核实过（2026-09-15）

> ⚠️ 上表中 Verifier 框架和 Messenger AI 客服核心这两行，代码只是"判断该不该说 / AI 能查什么"
> 这两层静态逻辑，**单独不能让 CTS 私信客服真正跑起来**。F3（Inngest 编排批准中继）已经合并，
> 属于编排层，不在"静态逻辑"之列——但 F3 依赖的 F2（生成草稿主函数，见下表 #1585）还没人做，
> 所以整条私信客服链路仍然卡在 F2 这一环，还没打通。下面这批 Inngest 编排/UI/dry-run 才是让它
> 真正上线要做的事。已逐条核实，不是抄旧文档。

| 能力 | issue | PR | 现状 |
|---|---|---|---|
| ~~Inngest 编排 F1 自动应答~~ | #1584 | [#1739](https://github.com/bigbigraydeng-maker/magic-engine/pull/1739)（已合并，`Closes #1584`） | ✅ 已完成（PR #1736 是同名重复分支，已关闭未合并，别再当在做的窗口） |
| Inngest 编排 F2 生成草稿（主函数） | #1585 | 无 | 没人在动——F3（上表）已经等着它，F2 是当前最卡关的一环 |
| ~~Inngest 编排 F3 审批端点~~ | #1586 | [#1741](https://github.com/bigbigraydeng-maker/magic-engine/pull/1741)（已合并） | ✅ 已完成，见上表 |
| Inngest 编排 F4 健康心跳 | #1587 | 无 | 没人在动 |
| ~~PM daily-todo UI + 紧急停按钮~~ | #1589 | [#1747](https://github.com/bigbigraydeng-maker/magic-engine/pull/1747)（已合并） | ✅ 已完成 |
| 待批准草稿 UI（三按钮） | #1588 | 无 | 没人在动 |
| T-14d 端到端 dry-run | #1591 | 无 | 没人在动 |
| 回滚 SOP 演练 | #1590 | 无 | 没人在动 |
| Delivery day 灰度切换 | #1592 | 无 | 没人在动 |

> ⚠️ 核实方法：`gh issue view <号>` 查真实 state；`gh pr list --state all --search "<号>"` 逐个查有没有
> 已开/已合并/已关闭的 PR（`gh pr list` 默认只列 open，漏了 `--state all` 会把已合并的 PR 也判成"没人在动"）。
> 本次核实（2026-09-15）：9 个里 **3 个已 CLOSED**（#1584 经 PR #1739、#1586 经 PR #1741、#1589 经 PR #1747，
> 均已合并）；其余 6 个（#1585/#1587/#1588/#1590/#1591/#1592）仍是 `OPEN` 且搜索无匹配 PR，状态是真的
> "没人在动"，不是"没查"。**这份核实是这次改动时的快照，会过期**——下一个进这条线的窗口领活前
> 仍要自己重跑一遍上面两条命令，不能直接信这张表。

### 已知的真实冲突/重复劳动（本 session 已实测抓到，别再踩一次）

1. **#1622 vs #1629 vs #1623**：三个 PR 修的是同一个"AI 私信回复冒充 CTS 身份"的问题，各开各的，最后 #1629 合并、其余关闭 credit——如果当时有构建控制室先查一遍开着的 PR，这两次重复工作能省掉。
2. **迁移版本号撞车两次**（PR #1678、#1711 各修过一次）：两个窗口各自"猜"下一个可用的时间戳版本号，猜中同一个数字，合并后才发现——现在有自动检测测试（`src/lib/kernel/__tests__/architecture.test.ts`），但**事前核对 `ls supabase/migrations | tail -20` 比事后修更便宜**。
3. **`brief.ts` 和 `stage-from-conversation.ts` 同款硬编码 CTS 身份 bug**（issue #1627 待修，跟 brief.ts 那次是同一类问题，还没人补）——同一个 bug 模式在两个文件出现，说明"查一遍全仓库还有没有同款问题"这一步经常被漏掉。
4. **6 个客户知识库 issue 合并后没关闭、ROADMAP.md 没更新**（今天由另一个窗口读文档时发现并指出）——PR 描述里没写对 `Closes #xxxx` 格式，导致"已经做完"和"看起来还没做"长期对不上，浪费了一个窗口的排查时间。

## 构建控制的日常工作（这是给"构建控制"窗口本身的操作手册）

每次有人（PM 或另一个窗口）问"现在到底做到哪了"，按这个顺序回答，不许凭记忆：

1. `gh issue view <相关 issue号>` 查真实 state（不信 ROADMAP.md 的文字，那是快照，会过期）
2. `gh pr list --state all --search "<关键词>"` 查有没有已开/已合并/已关闭、可能重复的 PR
   （不加 `--state all` 会漏掉已合并的 PR）
3. 对答案里任何"已合并"的说法，补一句它有没有真的在生产 apply / 启用（合并 ≠ 上线，这条铁律本仓库反复踩过）
4. 发现两个窗口在动同一个东西——立刻在两边 issue 上留言 @ 对方，不要等 PM 发现

## 范围问题已拍板（2026-09-15，记录不再重问）

issue #1290（CTS Governed Lead-Reply Agent 主设计）此前拍板的 4 个岔口第一条：**"MVP 覆盖：
只 CTS · Messenger 一条路 · WhatsApp 等真接凑 ≥2 客户证据再抽"**。当天 PM 就"CRM 要不要同时
接 WhatsApp AI 客服"这个疑似冲突当场确认：**维持原决定，先按老计划走，WhatsApp AI 客服接入
不启动**。WhatsApp 相关 issue（#1300/#1309/#1455/#1304）保持"设计已存在、暂不启动"状态，
不用再为这件事去问 PM。

（"接收 WhatsApp 对话信息进统一收件"跟"AI 主动用 WhatsApp Business 回复客户"是两件事——前者
本来就在 #1637 里做完了，不受这条范围决定影响；受影响的只是"让 AI 客服本身去说话"这一层。）

**唯一的例外（PM 2026-09-15 当场拍板）**：邮件渠道 AI 客服（[issue #1745](https://github.com/bigbigraydeng-maker/magic-engine/issues/1745)）是这条"Messenger-only"范围冻结的例外，只适用于邮件这一条——**WhatsApp 仍按上面的原冻结决定，不做**。这条例外不代表范围冻结整体松动，下一个窗口看到别的渠道（WhatsApp/短信等）想比照 #1745 扩范围，答案还是"不做，按老计划"。

## 不受范围决定影响的外部阻塞

**Meta 企业验证仍未通过**（issue #1299，需要 PM 本人上传公司文件）——不管 Messenger 这条路
代码做到多完整，真正对客户生效那天都卡在这一步，需要 PM 处理，不是代码能解的。
