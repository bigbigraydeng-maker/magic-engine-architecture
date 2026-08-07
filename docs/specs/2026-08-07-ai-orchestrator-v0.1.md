# ME2 AI Orchestrator v0.1 — 架构 spec

> **状态**：inactive scaffold。默认不运行、不调模型、不写仓库、零费用。
> **Issue**：[#860](https://github.com/bigbigraydeng-maker/magic-engine/issues/860) · **只读上下文**：[#859](https://github.com/bigbigraydeng-maker/magic-engine/issues/859)
> **代码**：`tools/ai-orchestrator/` · **workflow**：`.github/workflows/ai-orchestrator-manual.yml`
> **日期**：2026-08-07

这不是 Magic Engine 产品运行时的一部分，是帮我们升级 Magic Engine 的**工程协作控制面**。
它不 import `src/` 下任何业务模块，不连 Supabase，不碰客户数据。

---

## 1. 一句话

让 API 版 GPT reviewer 和 Claude Code implementer 围绕一个 GitHub Issue 自动轮转，
在轮数 / 费用 / 时间 / 授权范围任一触顶时停下来找人 —— 且**永远不会自己 merge、部署、跑迁移或开生产开关**。

---

## 2. 边界（v0.1 做什么，不做什么）

| 做 | 不做 |
|---|---|
| 类型化领域模型 + 状态机 | 真的跑 GPT ↔ Claude 循环 |
| policy / 授权 / 幂等 / 上限 / kill switch | 定时触发、Issue 评论触发 |
| Issue comment 事件账本 | 新数据库表、新仓库 |
| mock provider 完整实现 | 调真实 OpenAI / Anthropic |
| 真 provider **安全骨架**（缺 secret 即 fail closed） | 读写任何真实 API key |
| manual-only workflow（默认关） | merge / deploy / migration |
| 135 个测试 + dry-run 证据 | 改任何 Magic Engine 业务代码 |

---

## 3. 领域模型

全部用 zod 定义在 `src/domain/schema.ts`，**没有一处状态靠自由文本推进**。

### OrchestrationRun

`run_id` · `repository{owner,repo}` · `issue_number` · `mode(DESIGN|IMPLEMENT|REVIEW)` ·
`state` · `work_package_id` · `current_round` / `max_rounds` ·
`cumulative_cost_usd` / `cost_cap_usd` · `invalid_output_count` ·
`last_processed_comment_id` · `target_branch` / `pr_number` · `deadline_at` ·
`stop_reason` · `created_at` / `updated_at`

> **一轮 = 一个 agent turn**，不是「GPT + Claude 一来一回」。
> 选这个定义是因为它无歧义、好测，而且 IMPLEMENT 模式从 Claude 开始时也不用特殊处理。

### 状态机（`src/domain/state-machine.ts`）

```
READY ──► GPT_TURN ◄──────────► CLAUDE_TURN
            │  │                    │
            │  └──► APPROVED_FOR_HUMAN_MERGE   (仅 REVIEW 模式 + 审查通过)
            │
            └──► WAITING_HUMAN ──(仅凭有效授权事件)──► GPT_TURN / CLAUDE_TURN / CANCELLED

任意非终态 ──► FAILED / BUDGET_EXHAUSTED / CANCELLED
终态出边 = 0
```

两条硬性质，各有专门测试：

1. **`WAITING_HUMAN` 不会自己醒。** 只有账本里出现一条「run_id 匹配 + 作者在白名单 + 未过期」的
   `human_authorization` 事件才能出来。重跑 workflow 不行，等待也不行。
2. **终态没有出边。** 停掉的 run 不能被再次 dispatch 唤醒。

### Verdict → 下一状态

| Verdict | DESIGN / IMPLEMENT | REVIEW |
|---|---|---|
| `CONTINUE_DESIGN` / `REQUEST_CHANGES` | `CLAUDE_TURN` | `CLAUDE_TURN` |
| `APPROVED_FOR_NEXT_STAGE` | `CLAUDE_TURN`（进下一阶段） | **`APPROVED_FOR_HUMAN_MERGE`** |
| `WAITING_HUMAN` | `WAITING_HUMAN` | `WAITING_HUMAN` |
| `STOP_POLICY_VIOLATION` | `WAITING_HUMAN` | `WAITING_HUMAN` |
| `FAILED` | `FAILED` | `FAILED` |

`STOP_POLICY_VIOLATION` 故意不映射到 `FAILED`：越界是安全事件，得停在一个**人必须来看**的状态，
而不是被埋进「失败」堆里。

### WorkPackageAuthorization

`scope{allowed_paths[], denied_paths[], can_commit, can_push, can_open_draft_pr, can_merge, allowed_tools[], disallowed_tools[]}` ·
`prohibited_operations[]` · `side_effect_class(none|repo_local|outward)` ·
`expires_at` · `max_rounds` · `cost_cap_usd` · `authorized_by` · `authorization_source`

两条在**类型层**而不是运行时判断的约束：

- `can_merge: z.literal(false)` —— merge 不是配置项，是类型常量。`can_merge: true` 连 parse 都过不去。
- `prohibited_operations` 必须显式包含全部 7 条 `ALWAYS_PROHIBITED_OPERATIONS`
  （merge / deploy / apply_migration / enable_schedule / enable_issue_comment_trigger /
  write_secrets / call_customer_write_apis），漏一条 parse 失败。
  这样「授权文件写漏了」变成开工前的硬错误，而不是运行时才发现的缺口。

### AgentTurn / Verdict

`AgentTurn`：`turn_id · run_id · round · actor · input_refs[] · structured_output ·
provider / model · usage{input_tokens, output_tokens, cost_usd} · started_at / completed_at · idempotency_key`

Verdict 六值见上表。Reviewer 与 Implementer 的输出各有独立 schema
（`reviewerTurnOutputSchema` / `implementerTurnOutputSchema`），**provider 接口一律返回 `unknown`** ——
校验只在 runner 里发生一次，adapter 没法用自己的类型标注绕过去。

---

## 4. 状态存哪里：Issue comments 当 append-only 账本

一条编排事件 = 一条 Issue 评论 = 一行给人看的摘要 + 一段隐藏标记：

```
✅ **gpt_reviewer** finished round 1 · verdict `REQUEST_CHANGES` · cost $0.0500

<!-- me2-orchestrator:v1 {"schema_version":"v1","run_id":"…","event":"turn_completed",…} -->
```

**运行时状态 = 对事件流 fold 出来的派生值**（`src/domain/fold.ts`），不另存一份会漂移的真相。
重跑 workflow 读到同样的事件，落到同样的状态，所以「重复投递」天然不重复干活。

### 信任规则（这是防伪造的主防线）

任何人都能在 Issue 里打一段标记。**只有作者在白名单里（编排 bot + 仓库 owner）的标记才会被解码。**
不被信任的标记不是静默丢弃，而是进 `LedgerReadResult.rejected` 被报出来。

### 幂等，三层

| 层 | 挡什么 | 可测性 |
|---|---|---|
| **fold** | 普通的重复 dispatch —— 读到相同事件，落到相同状态，不重跑 | ✅ 集成测试 |
| **turn 事件自带 `next_state`** | 「turn 写进去了、状态没写进去」的崩溃窗口。两件事**同一条事件**，中间没有缝 | ✅ 集成测试 |
| **写前重读账本（compare-and-set）** | 租约在慢模型调用期间过期、被第二个 runner 接管后的双写。发现被抢 → **丢弃自己的结果，不记录、不计费** | ✅ 集成测试（注入竞态 client） |

`idempotency_key = sha256(run_id | round | actor | input_digest)[:32]`，
`input_digest = sha256(system prompt + user prompt)`。
对象键在 hash 前做稳定排序，否则同一个 turn 在两个进程里会算出两个 key。

### 锁

- GitHub Actions `concurrency: me2-orchestrator-issue-<n>`，`cancel-in-progress: false`；
- 账本内租约（`src/domain/lease.ts`）：`lease_acquired` / `lease_released`，带 `expires_at`；
- **stale lock recovery**：过期租约可被接管，接管时记录 `took_over_from`，不静默；
- 同一 holder 重跑自己 = 续租，不是抢锁。

> 为什么不上数据库：MVP 每次运行只有个位数轮次、每轮一条评论，而 Issue 账本还额外满足一个更重要的性质 ——
> **PM 不用登录任何后台就能看见全过程**。真到了 Issue 账本撑不住的时候，最小替代是一张 `orchestrator_runs` 表，
> 不在本次范围。

---

## 5. Provider 选型

### Claude 侧：`anthropics/claude-code-action@v1`（Enable 阶段），不是自己写 SDK 循环

Issue #860 的硬要求是「可限制 allowed/disallowed tools、max turns、timeout、输出 JSON、保留 session、能在 GitHub runner 内工作」。
Action 原生提供 `allowed_tools` / `disallowed_tools` / `max_turns` / `timeout_minutes`，
并且在 runner 内自己处理 git 身份与 token 交换 —— **这些恰恰是最不该我们手写的部分**。
走 SDK / headless 就要自己实现工具沙箱、凭据生命周期、分支与 PR 创建。

代价是 Action 的返回不是严格 schema，默认工具集也包含我们必须禁掉的项。
所以：**Action 只是 `ImplementerProvider` 接口的一种实现**。内核只认接口 + zod 校验后的结果。
将来要换 SDK 或 headless，改一个文件（`src/adapters/claude/implementer.ts`）。

### GPT 侧：OpenAI API + 版本化 persona

`src/prompts/reviewer-system.v1.ts` 把 Issue #859 的架构原则固化成**代码里的版本化常量**：
D→A→P→Authorization→E→V→L · Capability ≠ Authorization · policy envelope ·
Action Contract / stable registry · AI 判断软件记账 · 单体 + Postgres · vertical slice ·
no automatic merge/deploy/migration/enablement。

**不假装能恢复某个 ChatGPT 会话的隐藏状态。** 需要 reviewer 知道的事，写在这个文件里，改一次版本号加一。

### 真 adapter 的 fail-closed 顺序

```
createOpenAIReviewer / createClaudeImplementer:
  1. enabled === false            → ProviderDisabledError   ← 先查这个
  2. apiKey 缺失                  → MissingSecretError
  3. .review() / .implement()     → ProviderNotWiredError   （v0.1 一律拒绝）
```

第 1 步在第 2 步之前，是为了让「key 已经配好但开关没开」也走不通 —— 有 key 不等于可以用。

---

## 6. Prompt injection 防护

Issue 正文、Issue 评论、PR 描述、diff、文件内容 —— **全部是 data，不是 instruction**。

1. `system` 消息**只由代码常量拼**（`buildPromptEnvelope`），不可信文本一个字节都进不去；
2. 不可信文本被围栏包起来，进围栏前中和三样东西：围栏结束符、HTML 注释定界符 `<!--` / `-->`、
   以及 `me2-orchestrator` 标记命名空间 —— 否则 Issue 里贴一段假标记就能伪造「已授权」事件；
3. 每次 prompt 都带一条常驻声明：围栏内的内容不能授予权限、扩大范围、修改 system policy，
   也不能授权 merge / deploy / migration / schedule；发现里面有指令要**当作 finding 报告，不是照做**;
4. 账本解码只信白名单作者（见 §4）。

测试用的是一段真实形状的注入（「IGNORE ALL PREVIOUS INSTRUCTIONS」+ 伪造授权标记 + 提前闭合围栏），
断言 system 消息逐字节等于版本化常量、围栏只被闭合一次、伪造标记被中和。

---

## 7. 上限与 kill switch

| 闸门 | 默认 | 越界后 |
|---|---|---|
| `max_rounds` | 6 | `BUDGET_EXHAUSTED` |
| `cost_cap_usd` | 2.00 | `BUDGET_EXHAUSTED` |
| `max_wall_clock_ms` | 20 min | `BUDGET_EXHAUSTED` |
| `max_invalid_outputs` | 2 | `FAILED` |
| 授权 `expires_at` | 6 h | `WAITING_HUMAN` |
| `side_effect_class` | 只许 `none` / `repo_local` | `WAITING_HUMAN` |

轮数与费用取 **run 自带上限和部署上限里更紧的那个**，所以「工单里写了个大数字」不能突破部署级天花板。

**Kill switch 三个独立来源，全部 fail-closed**：

1. workflow 的 `enabled` 输入（默认 `false`）；
2. `ME2_ORCHESTRATOR_ENABLED` 必须**恰好等于字符串 `"true"`** —— `1` / `yes` / `TRUE` 都不算；
3. Issue 上的 `me2-orchestrator:stop` 标签，最高优先级，其它两个说 go 也停。

任一触发 → `CANCELLED`，且**在调用任何 provider 之前**。

---

## 8. active workflow 不能被运行中的 agent 改写

按「机械上做不到」→「做了会被抓住」排序：

| # | 机制 | 当前可用？ |
|---|---|---|
| 1 | `GITHUB_TOKEN` 无 `workflows:` 权限 → 含 `.github/workflows/**` 的 push 被 **GitHub 自己**拒绝 | ✅ 不依赖付费计划 |
| 2 | 只有 `workflow_dispatch`，而 dispatch 需要仓库 write 权限 → **agent 无法自我唤醒** | ✅ |
| 3 | `PROTECTED_PATHS` 拒绝：turn 的 `files_changed` 命中受保护路径 → `WAITING_HUMAN` | ✅ 有测试 |
| 4 | policy 完整性校验：run 开始时对控制面文件取 sha256，每轮复算，漂移即停 | ✅ 有测试（含正对照） |
| 5 | branch protection + 强制 CODEOWNERS review | ❌ **本仓库开不了，见 §9** |

受保护路径：`.github/**` · `CODEOWNERS` ·
`tools/ai-orchestrator/src/policy/**` · `tools/ai-orchestrator/src/prompts/**` ·
`tools/ai-orchestrator/src/domain/state-machine.ts`

第 3 层挡「自己申报改了控制面」，第 4 层挡「改了但没申报」—— 后者是自报文件清单永远抓不到的那一类。

### 要不要拆独立 control-plane 仓库

**v1 不拆。** 理由是证据而不是偏好：

- 跨仓写权限必须建 GitHub App 或 PAT，**在闭环还没被验证之前先把凭据爆炸半径扩大了**；
- Free 计划上新建的私有仓库**同样没有** branch protection，拆完并不获得想要的那层保护；
- 迁移成本已经预先压低：orchestrator 全部代码自包含在 `tools/ai-orchestrator/`，
  GitHub adapter 以 `{owner, repo, issue_number}` 为参数、不引用 `src/**`，
  将来迁仓 = `git mv` 一个目录 + 换 token 来源。

---

## 9. Enable checklist（全部是人工作业，本次一件都没做）

> ⛔️ **阻塞项在最前面。** 在 PM 就第 0 条给出决定之前，Enable 阶段保持 `WAITING_HUMAN`。

### 0. branch protection —— 当前计划下开不了（PM 决策）

实测（`gh api`，2026-08-07）：

| 探测 | 结果 |
|---|---|
| `repos/.../branches/main/protection` | **403 Upgrade to GitHub Pro or make this repository public** |
| `repos/.../rulesets` | **403 同上** |
| `user.plan.name` | `free` |
| `repos/.../actions/permissions/workflow` | `default_workflow_permissions: "read"` ✅ |
| `.github/CODEOWNERS` | 不存在 |

CODEOWNERS 文件可以放，但没有 branch protection 时它**只做 reviewer 自动指派，不构成强制**。
三选一：

- **A** 升级 GitHub Pro / Team → 开 branch protection + 强制 CODEOWNERS review（推荐）；
- **B** 拆独立 control-plane 私有仓库 —— 同样要付费计划才有保护，且引入跨仓凭据，**不推荐作为第一步**；
- **C** 接受 §8 第 1–4 层作为 v1 的保证，Enable 时以文档 + 人工 review 兜底。

### 1. Secrets（仓库 Settings → Secrets and variables → Actions）

| 名称 | 用途 | 备注 |
|---|---|---|
| `ME2_ORCHESTRATOR_OPENAI_API_KEY` | GPT reviewer | 本次**必须不配**；配了 workflow 会主动报错退出 |
| `ME2_ORCHESTRATOR_ANTHROPIC_API_KEY` | Claude implementer | 同上 |

两个 key 建议单独开、单独设支出上限，不复用 Magic Engine 生产用的 key ——
爆炸半径要跟业务 key 分开。

### 2. Variables

| 名称 | 值 |
|---|---|
| `ME2_ORCHESTRATOR_ENABLED` | `true`（Enable 时才设；必须恰好是这个字符串） |

### 3. GitHub permissions（Enable 时按 job 拆）

```yaml
reviewer-job:     { contents: read,  issues: write }
implementer-job:  { contents: write, pull-requests: write }
```

两个 job 都**永不**给：`actions` · `workflows` · `administration` · `deployments` · `packages` ·
`security-events` 的 write。`workflows: write` 尤其不能给 —— 它是 §8 第 1 层的全部依据。

### 4. CODEOWNERS（建议内容，本次未创建）

创建 CODEOWNERS 会立刻影响整个仓库的 review 指派，属于治理变更，交 PM 拍：

```
/.github/                                   @bigbigraydeng-maker
/tools/ai-orchestrator/src/policy/          @bigbigraydeng-maker
/tools/ai-orchestrator/src/prompts/         @bigbigraydeng-maker
/tools/ai-orchestrator/src/domain/state-machine.ts  @bigbigraydeng-maker
```

### 5. 费用上限

- OpenAI / Anthropic 控制台各设**月度硬上限**（建议 US$20 起步）；
- `SCAFFOLD_LIMITS.cost_cap_usd` 单次运行上限（当前 2.00）由 PM 确认；
- 第一周每天看一次实际花费，跟 `cumulative_cost_usd` 对账。

### 6. 手动验收步骤（按顺序，任一步不过就停）

1. 在一个**测试 Issue**（不是 #859 / #860）上 dispatch，`enabled=false` → 确认走 dry-run、零调用、零评论；
2. 配 secrets，`enabled=true` 跑一次 **DESIGN 模式、max_rounds=2、cost_cap=$0.50**；
3. 人工核对：Issue 上出现的评论数量、每条的 verdict、`cumulative_cost_usd` 与控制台账单是否一致；
4. 故意在 Issue 里贴一段注入文本，确认 reviewer 把它当 finding 报告而不是照做；
5. 打上 `me2-orchestrator:stop` 标签，再 dispatch 一次，确认立即 `CANCELLED`；
6. 让 implementer 故意越界（改 `src/**`），确认停在 `WAITING_HUMAN` 且没有 commit；
7. 以上全过，才把 Enable 扩到 #859 的真实 work package。

---

## 10. 测试

`npx vitest run tools/ai-orchestrator` —— **135 passed / 0 failed**，全部 mock，零网络、零费用。

| Issue #860 要求 | 覆盖位置 |
|---|---|
| 状态机合法 / 非法迁移 | `state-machine.test.ts` |
| 重复 delivery 不重复处理 | `runner.test.ts` › duplicate delivery（3 个场景） |
| 并发 run 只有一个获锁 | `lease.test.ts` + `runner.test.ts` › concurrency |
| max rounds 停止 | `runner.test.ts` › budget stops |
| cost cap 停止 | 同上 |
| kill switch 停止 | `policy.test.ts` + `runner.test.ts` › kill switch |
| secrets 缺失 fail closed | `providers.test.ts` |
| untrusted 文本改不了 system policy | `untrusted.test.ts` |
| Claude 越权工具被拒 | `runner.test.ts` › policy violations |
| GPT schema 不合法不推进 | `runner.test.ts` › schema-invalid provider output |
| WAITING_HUMAN 不自行恢复 | `state-machine.test.ts` + `runner.test.ts` › WAITING_HUMAN |
| dry-run 不调用 / 不评论 / 不 commit | `dry-run.test.ts`（每条都带正对照） |
| active workflow / policy 同轮不可改 | `runner.test.ts` › policy violations（申报的 + 没申报的两种） |

**关于「零调用」这类断言**：每一条都配了正对照（同一套 harness 关掉 dry-run 再跑一遍，
断言 provider 确实被调用、评论确实被写、commit 副作用确实被记录）。
只断言「等于 0」的测试，在实现整个坏掉、什么都不做的时候也会绿。

**变异验证**（改坏源码看测试是否变红，已全部还原）：

| 破坏 | 变红 |
|---|---|
| kill switch 永不停 | 12 |
| 受保护路径不检查 | 8 |
| dry-run 照样写评论 | 1 |
| runner 忽略 dry-run 早退 | 3 |
| 工具白名单形同虚设 | 4 |
| 租约永远发放 | 3 |
| 账本信任任意作者 | 3 |
| `WAITING_HUMAN` 自行恢复 | 5 |

---

## 11. 剩余风险

1. **branch protection 开不了**（§9.0）—— 最大的一条，Enable 前必须 PM 拍。
2. **真 provider 未接线。** `ProviderNotWiredError` 是刻意的：接线本身要单独 PR、单独审。
3. **租约 TTL 是估的。** 10 分钟基于「一轮 Claude Code Action 通常几分钟」的假设，
   真跑起来要按实际时长调；调之前，慢调用被接管的场景由 §4 第三层（写前重读）兜。
4. **成本估算依赖 provider 自报。** mock 里是脚本值，真接线后要拿 API 返回的 usage 对账，
   否则 `cost_cap` 挡的是一个我们自己编的数字。
5. **Issue 账本不适合高频。** 每轮一条评论，长跑会把 Issue 撑长。到那时再谈换存储。
6. **`docs/ROADMAP.md` 没登记这条线** —— Issue #860 明确禁止本窗口改 ROADMAP，留给 PM 或下一个窗口补。
