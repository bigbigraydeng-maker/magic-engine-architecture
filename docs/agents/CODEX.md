# Magic Engine — Codex Agent 参考手册

> 本文件专为 Codex 设计，作为任务上下文注入。  
> 简洁、机器友好、无废话。每次给 Codex 派活时，将本文件作为上下文。

---

## 系统定位

Magic Engine 是 AU/NZ 营销执行平台（Next.js 14 + Supabase + Render）。
Codex 负责**精准修复/补测试/死代码清理**，不做架构决策。

---

## 10 个 Agent 速查表

| Agent | 代码位置 | 职责一句话 |
|-------|---------|-----------|
| 子牙 | `src/lib/ziya/` | 技术大脑：架构/安全/后台统筹（Claude Opus）|
| 诸葛亮 | `src/lib/zhuge/` | 业务大脑：客户策略/FDE工作台（Claude Sonnet）|
| 张骞 | `src/lib/zhangqian/` | 侦察：采集站点/关键词/AI可见度证据 |
| 孙子 | `src/lib/seo-agent/` | SEO编排：把 Goal/Brief/关键词信号变成本周 SEO 优先级 |
| 华佗 | `src/lib/huatuo/` | 诊断：6维度评分（0–100）|
| 鲁班 | `src/lib/luban/` | 执行：flywheel adapter + 落数据 |
| 马良 | `src/lib/visual/` | 视觉学习：图片/视频质量 + 平台研究 |
| 李白 | `src/lib/blog/` + `src/lib/geo/` | 文案质量 + 全系统提示词管理 |
| 达芬奇 | `src/lib/davinci/` | PM：挑战设计方案（只读，无执行权）|
| 魏征 | `src/lib/weicheng/` | 代码检查：CI关卡 + LLM审查 |

---

## 强制约束（违反 = 魏征拒绝 merge）

```typescript
// ❌ 禁止
const any_var: any = ...
const client = new Anthropic()           // 模块级初始化
import { OpenAI } from 'openai'          // 模块级变量

// ✅ 正确
function handler() {
  const client = new Anthropic()         // handler 内部初始化
}
```

- TypeScript strict mode，无 `any`
- 文件 < 800 行，函数 < 50 行
- SDK client 必须在 handler/function 内初始化
- UI 文案禁止出现：OpenAI / Anthropic / WaveSpeed / Seedance / SEMrush（用封装名）
- Commit message 格式：`feat(module): desc [PXX.Y]`

### 风险分级质量闸（开工前必做）

先读 [`docs/ENGINEERING_QUALITY_GATES.md`](../ENGINEERING_QUALITY_GATES.md)，声明 A / B / C 级后再编码：

- **A 级**：安全、隔离、Kernel、migration、资金、外部发布等高风险边界；需要强测试、真实边界证据和关键 mutation；
- **B 级**：普通业务逻辑/API/报表；核心单测、1–2 条集成、type/lint/build、一次集中 review；
- **C 级**：UI/文案/原型；smoke/截图/build，保持快速。

Codex 必须检查：风险有没有被故意降级、实现是否超过当前调用方的最小契约、非 blocker 是否被错误升级成新修补轮次。完整 mutation 默认只用于 A 级，并且只在冻结 head 上跑一次。Review 按 [#964](https://github.com/bigbigraydeng-maker/magic-engine/issues/964) 收敛，机器人新 finding 不等于继续修改授权。

---

## Memory Layer 接口（Phase 23）

```typescript
// 所有 agent 读 memory 的标准方式
import { loadMemoryForClient, formatMemoryForPrompt } from '@/lib/memory'

const memory = await loadMemoryForClient(supabase, clientId, {
  flywheel?: 'seo' | 'geo' | 'ads' | 'social',
  maxRecentDecisions?: number,   // 默认 5
  minConfidence?: number,        // 默认 0.6
})

const memoryBlock = formatMemoryForPrompt(memory, {
  includePreferences: true,
  includeProvenPatterns: true,
  includeFailedExperiments: true,
  includeRecentDecisions: true,   // 只有诸葛亮需要 true
})
```

**写权限矩阵（严格）：**
- `client_decision_history`：只有诸葛亮（conductor）写
- 其余三张表：只有 23.B FDE 标注 API + 23.C 自动抽取器写
- 张骞/华佗/鲁班/马良/李白：禁止写 Memory

---

## 飞轮落数据（鲁班执行后必须写）

```typescript
import { getAdapter } from '@/lib/flywheel/adapters/registry'

const adapter = getAdapter(flywheel)  // 'seo' | 'geo' | 'ads' | 'social'
const action = await adapter.execute({
  client_id,
  flywheel,
  action_type,     // 来自 vocabulary.ts 词表，不能自创
  execution_mode,  // 'in_house' | 'third_party' | 'external_manual'
  expected_metric,
  expected_delta,
})
```

---

## 常用文件位置

```
src/lib/memory/          → Phase 23 记忆层（读写接口）
src/lib/flywheel/        → 飞轮数据模型（adapters/vocabulary/attribution）
src/lib/anthropic/       → Claude 统一入口（callClaudeChat / callClaudeWithDocs）
src/lib/zhuge/types.ts   → ZhugeInput / PriorityAction 类型定义
src/types/               → 全局类型（Client / DiagnosticDimension 等）
supabase/migrations/     → 数据库变更历史
docs/agents/             → 所有 agent 手册（本目录）
```

---

## Codex 任务标准格式

子牙给 Codex 派活时，任务 prompt 必须包含：

```
文件：[绝对路径 + 行号范围]
任务：[具体改什么]
验证：npx vitest run [测试文件路径]
预期：[测试数量] 个测试通过
Build：npm run build 必须通过
禁止动：[不能碰的文件列表]
交付：commit hash + 测试输出截图
```

---

## FAST DELIVERY MODE V1（#1100，2026-08-23 生效，强制）

Ray Product Owner 决策：Magic Engine 必须按 AI 速度交付。Codex 每个窗口在开工前必须遵守，与既有约定冲突时以此为准。真相源：GitHub Issue [#1100](https://github.com/bigbigraydeng-maker/magic-engine/issues/1100) comments `5385687885` + `5385784440`。

**1. 交付速度目标**：小修 30–90 分钟；常规 MVP 2–4 小时；超过 4 小时立即 STOP，回 Build Control 证明 P0/P1 blocker；否则窄化 scope、defer 非阻断项、按小切片继续。

**2. 默认单窗口生命周期**：一个 Issue = 一个 IMPLEMENT writer / window / worktree / branch / PR；一次完整实现 + writer 自测；一次集中 whole-PR review；一次集中 remediation；一份 final receipt（含 HEAD / tests / checks / unresolved blockers / deferred items / production writes / spend）；敏感边界必要时 + 一次窄的 final risk confirmation。**禁止**拆成 PATCH1 / PATCH2 / PATCH3 / closeout / reconciliation / final receipt 多轮循环。

**3. Blocking 阈值（reopen 代码的唯一条件）**：仅 P0/P1 — 安全 / 隔离 / 隐私 / 鉴权失败 · 错客户 / 错 provider / 错落点 · 数据损坏、丢失、假成功、假 Outcome · 核心客户旅程断 · required checks 失败 · 直接违 Task Contract。恢复性 P2、外观、行数打磨、架构偏好、罕见并发 UX、未来规模优化：一律记 accepted deferred。一次 remediation 之后，新 P2 finding 不自动再开一轮代码；只有新 P0/P1 才能 reopen。Codex 必须主动挡下试图借新 P2 finding 反复重开代码的行为。

**4. 风险分级 review 强度**（不因一小段敏感边界就把整个 PR 升级到 Risk A）：

- **Risk A**（安全 / 隔离 / 隐私 / 鉴权 / 付款 / 发布 / 生产 / provider 花费 / 错落点）：一次集中 review + 一次 remediation + 敏感边界一次窄终审；
- **Risk B**（只读客户 UI / 编辑 / 展示 / 下载）：writer 自测 + 一次独立集中 review；无实证 blocker 不加第二次终审；
- **Risk C**（本地 / 内部非生产 proof）：tests + 必要人工/视觉验收；**禁止套 Risk A 全礼节**。

与「风险分级质量闸」并行：本条设 review 轮次上限，质量闸设测试与验证强度。

**5. Claude 窗口数量上限**（PM 不管窗口舰队）：默认最多一个当前最短板 lane 的 active Claude IMPLEMENT 窗口；HEAD 冻结到 review 时机时才可加一个独立只读 REVIEW 窗口；SCOUT 优先走 Build Control / Codex 只读检查，不新开 Claude 窗口；remediation 复用同一 writer；完成的窗口先 close / HOLD 再申请新窗口。申请新 Claude 窗口必须回答：现有为什么不能复用？精确碰撞边界？为什么必要？「throughput 更快」不算充分理由。**Codex 是首选的只读 SCOUT 通道，不要建议 Ray 为普通 audit / discovery 新开 Claude 窗口。**

**6. Relay / IMPLEMENT 提示词前置四条款**（Codex 收到派活提示词时必须验证已包含；缺一条即视为合同不完整，回 Build Control 补齐后再动手）：

```text
开工前先完整读取 #1100 最新 FAST DELIVERY MODE 及本 Issue 最新 Build Control 合同，并严格遵守。
不要过度开发。若范围扩大，立即停止、撤回或收窄并回报 Build Control；不得自行继续。
优先复用现有窗口、worktree、branch 和 PR。未经 Build Control 明确证明必要，不得新开 Claude 窗口、SCOUT、第二 reviewer、第二 branch 或第二 PR。
本轮最多一次集中 review、一次集中 remediation；普通 P2/架构打磨/未来优化一律 deferred，不得重新打开代码循环。
```

**边界不变**：本规则不授权 merge / deploy / migration / 生产写 / provider 写 / 客户接触 / spend；只降流程冗余，不弱化结构安全。默认停在 Draft PR。

---

## GitHub Task Contract Protocol（所有 Codex 窗口强制）

治理真相源见 GitHub Issue **#1100**：`[Build Control Governance] GitHub Task Contract Protocol — Issue = Contract, PR = Implementation`。

### 1. 长工程任务禁止继续用聊天长提示词承载

只要任务复杂到需要长工程提示词、跨多步实施、多个 runtime fact、安全边界或 STOP 条件，Codex 必须优先把完整合同落到 GitHub：

1. **Issue = Task Contract / Work Package Contract**
2. **Issue 最新 `BUILD CONTROL — ...` comment = 当前授权边界**
3. **PR = Implementation Artifact / 实际 diff 与验证证据**
4. **PR review threads = 实现 finding 与修复记录**
5. Chat 只负责启动、澄清、PO 决策，不再作为长期工程合同

如果当前任务还没有 Task Contract Issue，Codex 应先回 Build Control 要求建立 Issue；不要自己在聊天里继续堆几千字施工合同。

### 2. Codex 给另一个窗口/Claude 的交接输出

不要输出整份长提示词。默认只输出：

```text
Issue: #XXXX
建议窗口名：<name>

启动词：
你负责 Magic Engine Issue #XXXX。
开工前：
1. git fetch origin main
2. 完整读取 CLAUDE.md / AGENTS.md / docs/agents/CODEX.md（按执行方适用）
3. 完整读取 Issue #XXXX 及全部评论
4. 最新 BUILD CONTROL 评论是唯一授权边界

一窗口 / 一 worktree / 一 PR。
不扩大 scope。
完成后开 Draft PR，回 Issue 汇报并停止。
```

除非用户明确要求“把完整提示词贴出来”，否则不要再把 Issue 正文复制回聊天。

### 3. 每个 Codex 窗口的标准回报格式

每次阶段性或最终工程回报都按下面顺序，避免不同窗口各说各话：

```text
remote fetched at: <timestamp> · exact main SHA: <full sha>

## Scope / Contract
- Task Contract Issue: #XXXX
- 当前 BUILD CONTROL 决议：...
- branch / worktree / PR: ...

## 结论
- GO / PATCH REQUIRED / DEFER / STOP / READY FOR REVIEW

## 木桶自审
- 本次解锁哪条完整闭环或哪一段
- 当前最短板是什么
- 本组件做到什么程度已经够用
- 为避免局部过度开发主动推迟了什么

## Exact changes
- 精确 changed files
- 没改什么（关键 non-goals）

## Verification
- targeted tests
- architecture / mutation（按风险级别）
- type-check
- build
- git diff --check
- baseline failure 如有，明确 pre-existing 证据

## Reuse Statement
- reused what
- new truly reusable capability
- industry-specific?
- client-specific?
- deliberately not generalized?
- production write?

## Next gate
- 下一步只写 Build Control 需要决策的一个 gate；不得自动开下一项施工
```

没有 repository SHA 的工程回报视为无效。

### 4. Issue / PR 分工

**Issue 负责 WHY / WHAT / BOUNDARY：**
- 为什么现在做
- 当前最短板
- scope / non-goals
- runtime facts
- safety / authorization boundary
- acceptance / STOP conditions

**PR 负责 WHAT ACTUALLY CHANGED：**
- exact changed files
- implementation notes
- tests / type-check / build / diff-check
- review findings
- Reuse Statement
- production-write statement
- head/base SHA

PR 描述不得重新发明第二套架构 spec。

### 5. 一窗口纪律

默认：

**one Codex window = one Task Contract Issue = one worktree = one branch = one PR**

发现新的真实 blocker 但不在 Issue scope：

```text
DEFER — <real blocker>
```

然后停止，回 Build Control。不要在当前窗口顺手解决，也不要把第二个 WP 塞进同一 PR。

### 6. 木桶原则

每个 Codex 窗口必须优先回答：

1. 当前阻止最小真实闭环跑通的最短板是什么？
2. 本次改动是否直接补强最短板或紧邻下一环？
3. 当前组件是否已满足本轮最小验收？满足就立即停止。
4. 上游还提供不了、下游还消费不了、Measurement 还验证不了的精度，不提前建设。

原则：**先跑通窄闭环，再逐段加深；只抬最短板，不继续加高最长板。**

例外：安全、授权、法律合规、数据完整性、成本硬顶、幂等和失败恢复是结构板，不能用“避免过度开发”跳过。

### 7. 默认生产红线

除非最新 Build Control GitHub comment 明确授权：

- NO merge
- NO deploy
- NO migration apply
- NO production write
- NO provider write
- NO secret changes
- NO irreversible operation

默认停在 Draft PR。

---

## 封装名对照（UI 层必须用封装名）

| 真实服务 | 封装名 |
|---------|--------|
| OpenAI GPT-4o-mini | Content Engine |
| Anthropic Claude Sonnet | Strategy Engine |
| WaveSpeed / Atlas | Visual Studio |
| Seedance | Video Studio |
| HeyGen | Avatar Studio |
| SEMrush | Keyword Intelligence |
| Jina.ai | Site Analyzer |
| Airtable | Content Workspace |
| Publer | Publishing Hub |
