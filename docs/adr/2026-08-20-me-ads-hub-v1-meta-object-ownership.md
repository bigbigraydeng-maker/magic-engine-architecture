# ADR: 最小 Meta Provider-Object 归属契约（AD-ISO-1 真钱激活前 BLOCKER）

**状态：DESIGN ONLY，R2 修订版 —— 零代码/Meta 调用/migration/部署，等 Build Control 聚焦复审**
**日期**：2026-08-20 首版（`feb375b4`）/ 2026-08-20 R2 修订（Build Control R1 三项 BLOCKER + 两项契约细节）
**关联**：`docs/ROADMAP.md` `AD-ISO-1`、`docs/adr/2026-08-20-me-ads-hub-v1-irreversible-outward-contract.md`（已冻结，不碰）、
`src/lib/meta/campaign-ownership.ts`（AD-SEC-1，写路径既有守卫）

## R2 修订说明

R1 复审确认方向正确（新建权威归属表 + 账户级去重 + 按归属路由 + fail-closed +
名字启发式只做候选），但抓到三个 BLOCKER：

1. **归属登记不能"四步全成功后一次性写"**——Meta 外部写入和 Supabase 归属登记
   进不了同一个数据库事务，进程可能在任意一步崩溃，首版设计对这种崩溃没有
   任何中间状态可以恢复
2. **"不写"不等于"不留证据"**——首版设计对不可归属的 insights 直接丢弃，
   丢的是 Meta 真实返回过的数据，事后没法追溯"当时到底拉到了什么"
3. **只修未来不够**——`ad_daily_insights` 里已经有历史污染，不定切换策略，
   修完采集器污染数据照样在学习窗口里

本次修订：①归属登记改成逐层原子写 + 三态状态机；②新增 quarantine 表；
③选定历史污染处理方案；④补齐 campaign/ad 一致性规则 + `ad_account_id`
规范形式。

## 只读回显（本轮开工前确认，按指令要求）

```
pwd:      /Users/raydeng/Projects/magic-engine/.claude/worktrees/me-ads-hub-v1
worktree: me-ads-hub-v1（隔离，跟共享主仓库物理分开）
branch:   feat/me-ads-hub-v1
HEAD:     feb375b4ba5dbe3de3144e23583deb3d35b5d752
status:   干净（无未提交改动）
文档路径: docs/adr/2026-08-20-me-ads-hub-v1-meta-object-ownership.md（已存在，20785 字节）
feb375b4 在当前分支历史中：是（HEAD 本身就是它）
```

共享主仓库（`/Users/raydeng/Projects/magic-engine`）当前在另一个分支
（`docs/me-business-framework-v1`）上有另一个窗口的未提交改动
（`docs/roadmap/2026-08-19-me2-platformization-principle.md`）——本次会话
全程没有进入过那个目录做任何写操作，不 stash/reset/clean/checkout。

## 问题陈述与真实代码证据（不变，R1 已核实，此处不重复贴代码，只列结论）

- `google-data-pullback-daily/route.ts` 按 `clients` 表逐客户循环，CTS/Oztop/
  Roman 在各自 `clients` 行登记同一个共享账户 `act_2775766642787274`
- `syncCampaignDailyInsights`/`syncAdDailyInsights` 拉的是**整账户**，
  `UPSERT_KEY = 'client_id,platform,level,entity_id,insight_date'`——
  同一个 campaign 会在表里出现三份，分别挂三个客户
- `campaign-ownership.ts`（AD-SEC-1）只在写路径生效，insights 采集路径完全
  不经过它，文件头自己承认"同账户内的跨客户操作，这条校验查不出来"
- `AD-ISO-1`（`docs/ROADMAP.md:163-189`）已追踪 50+ 轮，第 31 轮实测 105 行
  快照（101 干净 + 2 舍入误差 + 2 无法核对），第 46 轮确认根治前提（权威归属
  表）不存在
- Meta insights 字段核实：campaign 级只返回 `campaign_id`；ad 级返回
  `campaign_id + ad_id`，**不返回 `adset_id`**（`AD_DAILY_FIELDS` 没请求这个
  字段，`src/lib/meta/client.ts:429`）

## 当前错误数据流

```
clients 表（N 行，M 个不同 client_id，但可能共用同一个 ad_account_id）
  │
  ▼ 逐客户循环，每行触发一次
getCampaignDailyInsights(该客户的 ad_account_id)  ← 整账户，零过滤
  │
  ▼ 原样写入
toInsightRow({ clientId: 触发这次循环的那个客户, ... })
  │
  ▼ upsert，client_id 是唯一键第一段
ad_daily_insights：同一个 campaign 的同一天数据，被写成 N 份（N=共享账户的客户数）
  │
  ▼ 读侧按 client_id 过滤（过滤本身没错）
evaluate.ts / weekly-report / Goal 指标 / ad_health_narratives
  → 消费的是"过滤正确但源头污染"的数据
```

## 修订后的目标数据流

```
clients 表
  │
  ▼ 按 ad_account_id 去重（一个账户只出现一次，不管几个客户共用它）
唯一 ad_account_id 集合
  │
  ▼ 每个唯一账户只调一次
getCampaignDailyInsights(ad_account_id) / getAdDailyInsights(ad_account_id)
  │
  ▼ 每一行查 meta_object_ownership（campaign 查 campaign 层，ad 查 campaign+ad 双层，见"契约细节一"）
      ├─ 两层都 confirmed 且 client_id 一致 → 写入 ad_daily_insights（唯一一份，client_id=归属表查到的）
      └─ 缺失/未确认/冲突/歧义         → 写入 meta_insight_quarantine（不丢，不进任何客户名下）
  │
  ▼
ad_daily_insights 只含 confirmed 归属数据 → 下游读侧逻辑不用改一行，源头已经干净
meta_insight_quarantine 保留全部原始证据 → 等人工确认归属后一次性、幂等地转正
```

## 一、`meta_object_ownership`：逐层登记 + 三态状态机（BLOCKER 1）

### Schema（相比首版新增 `status` 字段）

```sql
CREATE TABLE meta_object_ownership (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  ad_account_id    text NOT NULL,   -- 规范形式：'act_<digits>'，见"契约细节二"
  level            text NOT NULL CHECK (level IN ('campaign','adset','ad','creative')),
  object_id        text NOT NULL,

  status           text NOT NULL CHECK (status IN (
    'provisional',              -- provider 对象已创建并与 client/run 绑定，整组尚未完成验证
    'confirmed',                -- 所属 run 的 PAUSED package 已通过回读验证
    'orphaned_needs_reconcile'  -- 对象可能仍存在，但创建/登记/回滚/provider 状态不确定
  )),

  client_id        uuid REFERENCES clients(id),   -- NULL 只允许配合 source='unattributable'
  source           text NOT NULL CHECK (source IN (
    'declared_at_creation', 'manually_verified', 'imported_verified', 'unattributable'
  )),
  unattributable_reason text,

  kernel_run_id    uuid REFERENCES action_runs(id),
  content_post_id  text,

  -- 🔴 BLOCKER 1 新增：deterministic tag 是 reconcile 的第二档查找依据
  --    （object_id 不可用/不确定时才退回按 tag 查，见"reconcile 顺序"）
  deterministic_tag text,   -- 'ME-SANDBOX-<runId>'，跟 post-boost-publisher.ts 现有机制同一个值

  verified_at      timestamptz NOT NULL,
  verified_by      text NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_id_matches_source CHECK (
    (source = 'unattributable' AND client_id IS NULL AND unattributable_reason IS NOT NULL)
    OR
    (source != 'unattributable' AND client_id IS NOT NULL)
  ),

  UNIQUE (ad_account_id, level, object_id)
);

ALTER TABLE meta_object_ownership ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service_role_full" ON meta_object_ownership FOR ALL TO service_role USING (true) WITH CHECK (true);
```

`status` 是**跨层的运行状态**，`source`/`client_id` 是**归属判定本身**——两者
正交：一条 `declared_at_creation` 的行可以是 `provisional`（刚建完还没验证）
也可以是 `confirmed`（验证过了），但**永远不会**是 `unattributable`（那是给
"根本不知道是谁的"对象用的判定，跟"知道是谁的、但还没验证完"是两件事）。

### 逐层登记时序（取代首版"一次性写四层"）

```
① 创建 campaign（Meta API 调用）
   → 成功后立即 INSERT 一行 meta_object_ownership
     (level='campaign', status='provisional', source='declared_at_creation',
      client_id=ctx.clientId, kernel_run_id=ctx.runId, deterministic_tag=tag)
   → 🔴 这条 INSERT 失败 → 立即停止，不创建 adset（见下"部分成功恢复"）

② 创建 adset
   → 成功后立即 INSERT 一行（level='adset', ...同上）
   → 失败 → 立即停止，不创建 creative

③ 创建 creative
   → 成功后立即 INSERT（level='creative', ...）
   → 失败 → 立即停止，不创建 ad

④ 创建 ad
   → 成功后立即 INSERT（level='ad', ...）
   → 失败 → 立即停止（这是原来"四步"的最后一步，本来就没有下一层）

⑤ PAUSED package 回读验证通过（复用已实施的 gate 步骤 checkLaunch）
   → UPDATE meta_object_ownership SET status='confirmed'
     WHERE kernel_run_id = ctx.runId AND status = 'provisional'
   → 验证不通过 → 保持 provisional（不是失败，是"还没验证过"，
     人工介入的入口是 Kernel run 本身落 dead_letter+needs_human——
     已实施的 gate 步骤失败路径，见"六、跟既有系统的关系"）
```

**为什么每一步都要真的停下来，不能"先记个待办，回头再补"**：
"回头再补"意味着这一刻系统里同时存在"Meta 上有个真对象"和"归属表不知道它"
两个事实——哪怕只存在一秒钟，采集器下一次 cron 跑起来时就可能在这一秒钟内
把它当成"查无归属"处理（进 quarantine，这是安全的）或者更糟——如果那一秒钟
恰好是另一个进程在做类似的事，唯一约束会保护住"两个客户认领同一对象"，但
保护不住"这个对象暂时没人认领"这件事本身继续存在。立即停止 = 把这个窗口期
压缩到"下一条 SQL 语句执行之前"，而不是"直到某个批处理任务发现并修复它"。

### 部分成功恢复：ownership 写入失败时的处理

```
Meta 对象创建成功，紧接着的 ownership INSERT 失败
  │
  ▼ 尝试回滚（删除刚创建的这一层 + 之前已创建的所有层，复用现有 rollback()）
  ├─ 全部删除成功
  │    → 已写入的、属于被删对象的 ownership 行（如果有）一并 DELETE
  │      （对象真的不存在了，归属记录也不该留着）
  │    → 预算预留：release（确定没有任何东西留存，钱没花，也不会花）
  │    → run 按现有失败路径落 dead_letter + needs_human（今日待办可见）
  │
  └─ 任何一层删除失败或结果不确定
       → 🔴 不能把对象当成不存在。已成功创建但归属登记失败的那一层，
         其 ownership 行手工/程序化补写为 status='orphaned_needs_reconcile'，
         source='unattributable'，unattributable_reason='ownership insert
         failed, rollback delete uncertain'（这一步能做到，是因为我们仍然
         知道 object_id——它是 Meta create 调用刚返回的）
       → 更早已经写成功的层（如果有）也一并改成 orphaned_needs_reconcile
         （整个 run 的这组对象状态一致，不允许"部分 provisional、部分
         orphaned"混着放）
       → 预算预留：**保留**（不确定 = 按"可能已经产生外部效果"处理，
         跟 M2 的 failed_needs_reconcile 桶同一个哲学：宁可多占一点额度，
         不能让不确定的钱溜过硬顶）
       → run 落 dead_letter + needs_human，错误信息明确写"Meta 上可能存在
         未登记归属的对象，需要人工用 reconcile 顺序核实"
```

**没有 ownership 行时的兜底路径（ownership INSERT 从一开始就没写成功，
不存在这一行可以更新）**：这种情况下无法靠查 `meta_object_ownership` 发现
问题（表里压根没有这条记录），恢复完全依赖 `deterministic_tag` 反查 Meta——
这正是为什么"reconcile 顺序"（下一节）必须同时支持"有 object_id"和
"没有 object_id、只有 tag"两条路径，而不能假设 ownership 表本身永远可信。

### Reconcile 顺序

```
1. 优先按 provider object ID 查询（如果我们知道具体是哪个 id——
   多数情况下是知道的：Meta create 调用的响应本身就带 id，只是紧接着的
   ownership 写入失败，id 本身没丢）
   → GET /{object_id}，核实它是否存在、当前状态（PAUSED/ACTIVE/已删除）

2. 只有 object ID 完全不可用时（例如整个 create 调用本身超时，
   连响应里的 id 都没拿到），才退回按 deterministic tag 查询
   → 复用已实施的 findByTag()（按 name CONTAIN tag 过滤）

3. 两条路径统一按查到的数量分派：
   ├─ 0 个   → 对象真的不存在（create 从没成功过，或已被删除）
   │           → 安全释放预留、清理任何残留的 provisional/orphaned 行
   │           → 可以安全重建（如果这是一次重试）
   ├─ 1 个   → 唯一确定，接续处理：
   │           → 如果之前没有 ownership 行 → 补写（source 视情况定，
   │             多数是 'declared_at_creation'，因为我们知道是哪次 run 建的）
   │           → 如果之前是 orphaned_needs_reconcile → 核实清楚后转回
   │             provisional 或直接标 confirmed（视这一层是否已经过 gate 验证）
   └─ 多个 / 查询本身失败或结果有歧义
              → **必须转人工**，不允许程序自动挑一个当"就是它"
              → ownership 行（新写或已有）状态钉死在 orphaned_needs_reconcile，
                预留继续占用，run 保持 dead_letter + needs_human
```

### Collector 如何处理三态

```
只有 status='confirmed' 的归属可以路由进 ad_daily_insights。
provisional 和 orphaned_needs_reconcile 一律走跟"查无归属"完全相同的
fail-closed 路径 —— 进 meta_insight_quarantine（reason_code='ownership_not_
confirmed'），不进任何客户名下，不因为"至少知道是哪个客户建的"就放宽标准。
```

**为什么 `provisional` 不能被 collector 当"大概率是对的，先用着"**：
`provisional` 只means"知道是谁建的"，不 mean"这组对象是干净的、没有
targeting/预算/年龄配错"。让还没过 gate 验证的对象进正式报表，等于让一条
可能马上要被 blocker 拦下的广告的花费数据先污染了 Goal 指标——跟"共享账户
误归属"是不同的洞，但同样违反"不确认就不能进入下游"这条总原则。

### 幂等（run_id + deterministic tag + object ID）

四层里的**每一层**在重试/断点续跑时，都必须先做跟 M1 现有 `publish_paused`
步骤同款的检查——不是只在最外层检查一次：

```
准备创建某一层之前：
  1. 先查 meta_object_ownership 有没有这一层 + 这个 kernel_run_id 的行
     → 有 → 这一层已经处理过（不管是 provisional/confirmed/orphaned），
       不重新创建，直接读取已有的 object_id 接续下一层判断
  2. 没有 ownership 行 → 用 deterministic_tag 查 Meta（findByTag 的这一层
     子集）→ 查到 1 个 → 说明 Meta 建成了但 ownership 没写成，走上面
     "没有 ownership 行时的兜底路径"补写；查到 0 个 → 真的还没建，正常创建；
     查到多个 → 转人工
```

### 并发登记的唯一约束（不变，重申）

`UNIQUE (ad_account_id, level, object_id)`——两个进程同时想给同一个
`object_id` 写两条指向不同 `client_id` 的行，Postgres 直接拒绝第二条
INSERT（`23505`），调用方必须把这个错误当"别人已经认领了，我这边不能再写"
处理，不能重试成"改成 UPDATE 覆盖过去"。

## 二、`meta_insight_quarantine`：未知 insights 不丢（BLOCKER 2）

### 复用核实（先查，不猜）

搜了 `supabase/migrations/` 全部文件，没有任何名字带 `quarantine`/
`unattributed`/`raw_observation`/`pending_attribution` 的表。看起来最像的
候选是 GEO 模块的 `geo_observations`/`geo_evidence`
（`20260811000001_me2_geo_measurement_storage_v1.sql`）——读了它们的完整
字段：`client_id uuid NOT NULL`（**不允许为空**）、`query_set_version`/
`engine_family`/`model_version`/`citations` 等一整套 GEO 专属采集身份字段，
跟广告 insights 的形状完全不搭，而且最关键的一点——**它要求 `client_id`
非空**，跟本设计"存的就是不知道 client_id 是谁的数据"这个核心诉求直接矛盾。
**结论：没有可安全复用的表，新建一张最小的是对的。**

### Schema

```sql
CREATE TABLE meta_insight_quarantine (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  ad_account_id    text NOT NULL,
  level            text NOT NULL CHECK (level IN ('campaign','ad')),  -- insights 只在这两层，adset/creative 不适用
  campaign_id      text NOT NULL,
  ad_id            text,               -- level='ad' 时才有
  insight_date     date NOT NULL,

  metrics_payload  jsonb NOT NULL,     -- spend/impressions/reach/clicks/... 足够重放的完整字段

  reason_code      text NOT NULL CHECK (reason_code IN (
    'ownership_missing',         -- 完全查不到归属行
    'ownership_not_confirmed',   -- 有行但不是 confirmed（provisional/orphaned）
    'ownership_conflict',        -- campaign 和 ad 都 confirmed，但指向不同 client（契约细节一）
    'ownership_ambiguous'        -- 归属存在多重/矛盾记录
  )),

  pull_run_id      text NOT NULL,      -- 这次采集 cron 的批次标识（不是 Kernel run，是 cron 自己的执行 id）

  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),

  resolution_status text NOT NULL DEFAULT 'unresolved' CHECK (resolution_status IN ('unresolved','resolved')),
  resolved_ownership_id uuid REFERENCES meta_object_ownership(id),
  resolved_at      timestamptz,

  fingerprint      text NOT NULL,      -- ad_account_id+level+campaign_id+ad_id+insight_date+metrics_payload 的 hash，供人工快速判断"这次拉到的跟上次是否一致"，不是去重键本身

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- 幂等 upsert 键：同一个未知对象同一天重复拉取，更新 metrics_payload +
  -- last_seen_at，不新增行（Meta 数据在归因窗口内可能被修正，用最新值）
  UNIQUE (ad_account_id, level, campaign_id, ad_id, insight_date)
);

ALTER TABLE meta_insight_quarantine ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service_role_full" ON meta_insight_quarantine FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**为什么 `fingerprint` 不是唯一键**：唯一键必须是"这是同一个可观测对象"
（账户+层级+实体+日期），而 `metrics_payload` 会随 Meta 侧数据修正而变化——
拿会变的内容当身份键，同一个对象会因为数字更新而被误判成"新对象"，产生重复
行。`fingerprint` 单纯是给人看"这次跟上次比有没有变"的辅助字段。

### 三条不放行规则的落地

```
已确认唯一归属（campaign+ad 都 confirmed 且 client_id 一致）
  → 写入 ad_daily_insights

查无归属 / 归属未确认（provisional 或 orphaned）
  → 写入 meta_insight_quarantine，reason_code 相应设置

campaign/ad ownership 冲突（两个都 confirmed 但指向不同客户）
  → 写入 meta_insight_quarantine，reason_code='ownership_conflict'

对象存在多重/歧义归属记录（理论上不该发生，唯一约束会挡住，
但如果历史遗留数据或 reconcile 过程中出现异常）
  → 写入 meta_insight_quarantine，reason_code='ownership_ambiguous'
```

### 不进入学习的强制边界

quarantine 表**不被** `evaluate.ts`（Prescription 引擎）、`weekly-report/
build.ts`、`ad-benchmark-queries.ts`、`ad_health_narratives`、任何 baseline
计算读取——这不是靠"consumer 记得不要读它"，是靠**这些函数现在查询的是
`ad_daily_insights`**，而 quarantine 数据从来没进过那张表。只要 collector
按本设计实现，"不进入学习"是**结构性**成立的，不需要在每个消费者里加一条
"排除 quarantine"的逻辑——根本不存在需要排除的东西，因为它们压根不在同一张
表里。

### 人工确认后如何可审计地转入正式表，且不重复累计

```
人工确认某个此前 unattributable/provisional/冲突的对象归属
  → 在 meta_object_ownership 里补一条（或更新一条）confirmed 行
  │
  ▼ 一次性、幂等的转正操作（可以是一个批处理，不需要新建执行框架）：
  SELECT * FROM meta_insight_quarantine
   WHERE resolution_status = 'unresolved'
     AND ad_account_id = <该对象账户>
     AND level = <该对象层级>
     AND (campaign_id = <object_id> OR ad_id = <object_id>)
  │
  ▼ 对每一行：
  UPSERT INTO ad_daily_insights (client_id=<刚确认的client_id>, ...其余字段来自 quarantine 行)
    ON CONFLICT (client_id, platform, level, entity_id, insight_date) DO UPDATE ...
  │
  ▼
  UPDATE meta_insight_quarantine SET resolution_status='resolved',
    resolved_ownership_id=<新 ownership 行 id>, resolved_at=now()
   WHERE id = <这一行>
```

**为什么不会重复累计**：转正操作写的是 `ad_daily_insights` 的 upsert（跟
regular collector 用的同一个 `UPSERT_KEY`），不是 `INSERT`——即使转正脚本
本身因为崩溃被重跑一遍，或者常规 collector 在归属确认之后的某次运行也恰好
拉到了同一天的数据，落地的还是**同一行**（同一个 client+level+entity+date
组合），数值是最新一次写入的值，不是累加。`resolution_status='resolved'`
这个过滤条件让批处理天然幂等——重跑时已转正的行会被
`WHERE resolution_status='unresolved'` 排除，不会被处理第二次（即使没有这条
过滤，UPSERT 语义本身也保证不会累计，这条过滤只是让批处理不用重复扫描）。

### 告警契约（不建新通知系统，复用今日待办）

**触发条件**：quarantine 表里出现此前没见过的 `(ad_account_id, level,
campaign_id, ad_id)` 组合（即 `first_seen_at` 是这次 cron 运行内新产生的）。

**载荷**（对齐 CLAUDE.md 铁律 3 的 what/how/href 三件套，复用
`src/lib/pm-todo/manual-items.ts` 现成的"🙋 需要你动手"栏，不新建通知机制）：
- **what**："共享广告账户 `<account>` 里出现一个没有登记归属的 campaign/ad
  （`<object_id>`），花费数据暂时被隔离，没有进任何客户的报表"
- **how**："去 Meta Ads Manager 核实这条 campaign/ad 属于哪个客户，然后……
  （具体的人工确认操作，走"六"里跟既有身份系统整合后的入口）"
- **href**：直达 Meta Ads Manager 该对象的链接（`https://business.facebook.com/
  adsmanager/manage/campaigns?...`，具体拼法待实施时按 Meta 后台真实 URL 结构定）

**本轮只设计这个契约，不实现**——具体的告警触发代码、`manual-items.ts` 里加
一个新条目类型，属于实施阶段的工作。

## 三、历史污染 Cutover 策略（BLOCKER 3）

### 方案选择：方案 B（可信切换时间）为主，方案 A 元素融合成 hybrid

**理由**（对应"优先选择对现有下游改动最小、不会继续消费污染历史的方案"）：

- **方案 A（历史重归属）需要动的面更大、风险更高**：要给全部历史 campaign
  建归属证据（哪怕只有 105 行快照对应的对象，也要逐条找"非名字"的独立证据
  ——落地页 URL、pixel id、`contacts.attr_campaign_id` 反查），然后**改写**
  `ad_daily_insights` 里已经存在的行的 `client_id`。改写存量数据本身就是一次
  高风险操作——归因判断错了，等于制造一批**新的**污染，而且是"看起来已经
  修复过"的污染，比现在这种"已知有问题"的状态更难发现。
- **方案 B 不改写任何存量行**，只是**标注**它们不可信，下游可以选择性地
  排除——改动面小到只是一列新标记 + 未来（不在本轮）每个消费者加一行过滤。
  不确定的历史数据保持"不确定"这个诚实的状态，不伪装成"已核实"。

**融合的 hybrid 部分**：cutover 发生时，如果某个历史对象**已经**有
`manually_verified`/`imported_verified` 的归属记录（比如 AD-ISO-1 第 31 轮
审计里已经人工核对过、非名字证据确认的那部分），它在 cutover 之前的历史行
**不需要**被标记"不可信"——它是"方案 A 式"地被验证过的例外，其余没有验证
过的历史照方案 B 处理。

### 设计

**新增一列到既有 `ad_daily_insights` 表**（唯一涉及既有表的 schema 改动，
且是纯加法、可空列，不影响任何现有查询）：

```sql
ALTER TABLE ad_daily_insights
  ADD COLUMN IF NOT EXISTS ownership_trust_status text
    CHECK (ownership_trust_status IN ('trusted','not_comparable'));
```

**语义**：
- 修复后的 collector（本设计的目标数据流）写入的**每一行**都显式带
  `ownership_trust_status='trusted'`——因为按新设计，能写进这张表的行，
  必然是 `meta_object_ownership` 里 `confirmed` 状态的产物，天然可信。
- Cutover 那一刻，对**所有既存**行执行一次性 `UPDATE`：
  ```sql
  UPDATE ad_daily_insights
     SET ownership_trust_status = 'not_comparable'
   WHERE ownership_trust_status IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM meta_object_ownership o
        WHERE o.ad_account_id = ad_daily_insights.ad_account_id
          AND o.level = ad_daily_insights.level
          AND o.object_id = ad_daily_insights.entity_id
          AND o.client_id = ad_daily_insights.client_id
          AND o.status = 'confirmed'
          AND o.source IN ('manually_verified','imported_verified')
     );
  ```
  这条 UPDATE 排除了"已经有独立验证证据"的历史行（hybrid 部分），其余
  一律标 `not_comparable`。
- **不把历史未知值解释成 0**：`not_comparable` 是一个独立于"有花费"/
  "没花费"的第三态，不是"金额是 0"，任何读到这一列的地方都不能把它当
  "这天没花钱"处理。

### 下游怎么用（本轮只设计契约，不改消费者代码——见"明确禁止"）

未来（下一轮实施，不在本次范围）每个消费者加一行过滤：
`.eq('ownership_trust_status', 'trusted')` 或等价的 WHERE 条件。**本轮不碰
`evaluate.ts`/`weekly-report`/`ad-benchmark-queries.ts` 等任何下游文件**——
这是"八、明确禁止"里"顺手修下游报表、Goal、诊断或 Prescription"明确挡住的
范围。

**报表如何说明基线从哪天开始可信**：`meta_account_ownership_cutover`
（一张极小的配置表，一行一个账户）：

```sql
CREATE TABLE meta_account_ownership_cutover (
  ad_account_id text PRIMARY KEY,
  trusted_from  timestamptz NOT NULL,
  set_by        text NOT NULL,
  set_at        timestamptz NOT NULL DEFAULT now()
);
```

这张表**不是给 collector 或 quarantine 逻辑用的**（那两处用的是逐行的
`ownership_trust_status` 列，不需要查这张表）——它存在的唯一目的是给报表/
UI 一个可以直接引用的"这个账户从哪天起可信"的人类可读时间点，不用每次都去
`ad_daily_insights` 里找最早一条 `trusted` 行反推。

### 各来源作为历史归属证据的可信度

| 来源 | 可信度 | 能否单独作为 `manually_verified`/`imported_verified` 依据 |
|---|---|---|
| Meta Ads Manager 后台人工核对 | 高 | 可以，`manually_verified` |
| 落地页 URL 指向客户官网 | 高 | 可以，作为 `imported_verified` 的支撑证据之一 |
| Pixel ID 归属 | 高 | 可以，同上 |
| `contacts.attr_campaign_id`（真出过 lead 反查） | 中——只覆盖出过 lead 的 campaign | 可以，但覆盖率有限，不能指望它覆盖全部历史 |
| Campaign/adset 名字 | **不可以** | 只能生成候选，人工核实后才转化成上面几种之一 |

### CTS/Oztop/Roman 共享账户历史的具体处理

不逐条重新归因（方案 A 的全量重归属不在本轮做）。Cutover 执行后：
- 有独立证据（非名字）支持的历史行 → 保持可信，`ownership_trust_status`
  不被 UPDATE 语句覆盖
- 其余 → `not_comparable`，未来消费者加过滤后自然从 baseline/Goal/
  Prescription 里退出，直到有人拿到独立证据补一条 `manually_verified`/
  `imported_verified`（那时候如果需要，可以有一条独立的"回填个别历史对象"
  操作，把它们对应的历史行也改回 trusted——这个回填机制本身不需要新设计，
  复用"人工确认后一次性、幂等地转正"那套逻辑，只是这次转正的目标行已经
  存在于 `ad_daily_insights`（不是从 quarantine 转入），走的是同一条
  "改写 `ownership_trust_status`"的路，不是新机制）

### Migration / Deploy / Cutover 顺序

```
① apply migration：meta_object_ownership + meta_insight_quarantine +
   meta_account_ownership_cutover 三张新表 + ad_daily_insights 加
   ownership_trust_status 列（全部 additive，不锁表、不改现有列语义）
   （PM 显式 go 之后才 apply，本轮不做）

② 部署新版 collector（账户级去重 + 按归属路由 + fail-closed）
   🔴 部署前提：meta_object_ownership 必须已经能查询（① 已完成）；
      部署那一刻账户很可能还没有任何 confirmed 归属行——这是**预期状态**，
      不是 bug：第一次跑新 collector 时，几乎所有历史 campaign 都会因为
      查无归属而进 quarantine，这正是设计要的效果（不确定的东西先隔离，
      不是"没准备好所以先别切"）

③ 对每个共享账户（先从 CTS 所在的 `act_2775766642787274` 开始）执行历史
   backfill：人工确认已知的、有独立证据的历史 campaign/ad，写
   manually_verified/imported_verified 行

④ 执行一次性 cutover UPDATE（"设计"节里那条 SQL），并写入
   meta_account_ownership_cutover 一行，记录 `trusted_from` = 这一刻

⑤（不在本轮）下游消费者逐个加 `ownership_trust_status='trusted'` 过滤
```

### 新旧 collector / migration 未 apply 时如何 fail closed

- **migration 未 apply**（`meta_object_ownership` 表不存在）→ 新版 collector
  的归属查询会失败（表不存在）→ **必须整体拒绝写入 `ad_daily_insights`**，
  不能退回旧逻辑（那样等于悄悄绕过整个修复）。具体表现：collector 每一行
  insights 的归属查询失败时，当作"查无归属"处理（进 quarantine 或者更保守
  地——直接让这次 cron run 整体失败并告警，因为"表都不存在"不是单条数据的
  归属问题，是整个机制没就绪，不该假装成"这一行不知道归属"那种正常情况）。
  实施时需要在 collector 入口加一次性的"依赖表存在性自检"，缺表就整体
  `fail closed` 并转告警，不逐行降级。
- **新旧 collector 同时跑**（部署过程中的重叠窗口）→ **禁止同时重复写入**：
  两版 collector 不能对同一个 `ad_account_id` 同时触发同步。最小实现（本轮
  只设计，不写代码）：cron 入口加一个基于 `ad_account_id` 的短期分布式锁
  （或者更简单——直接串行化整个 cron，不并发跑多个账户的同步任务，这本来
  就是当前实现的实际情况，不需要新机制），部署时确保旧版本进程完全停止后
  才启动新版本，不做"灰度并行"。

## 四、契约细节一：campaign/ad 父子一致性

Ad 级 insights 只有 `campaign_id` + `ad_id`，没有 `adset_id`。路由规则：

```
ad 级一行 insights → 必须同时满足：
  meta_object_ownership(level='campaign', object_id=campaign_id).status = 'confirmed'
  AND
  meta_object_ownership(level='ad', object_id=ad_id).status = 'confirmed'
  AND
  两者的 client_id 相等

全部满足 → 写入 ad_daily_insights（level='ad'）
以下任一情况 → quarantine：
  - 只有 campaign ownership（ad 层缺失或未 confirmed）→ reason_code='ownership_not_confirmed'
  - 只有 ad ownership（campaign 层缺失或未 confirmed）→ reason_code='ownership_not_confirmed'
  - 两者都 confirmed 但 client_id 不一致           → reason_code='ownership_conflict'
  - 任一层存在多重/歧义记录                          → reason_code='ownership_ambiguous'

campaign 级一行 insights → 只按 campaign ownership 路由，
  不需要、也没有 ad 层信息可供核对
```

`adset`/`creative` 两层的归属记录（M1 创建端逐层登记的产物）在这条路由规则
里**不被读取**——它们服务"六"里的 lineage 完整性，不是给 insights collector
用的。这条边界在设计里已经明确写死，不能因为"反正表里有，顺手查一下"就
在实施时悄悄加进来——那样会制造一条"看起来更严格但实际没有数据支撑"的假
安全感（Meta 压根不告诉我们 insights 行对应哪个 adset/creative，查了也没有
可比较的对象）。

## 五、契约细节二：`ad_account_id` 规范形式

**选定：`act_<digits>`（带前缀），跟 `clients.meta_ad_account_id` 现有存量
约定一致**——读了 `20260518000001_meta_ads_snapshots.sql` 的字段注释
（`'Meta (Facebook) ad account ID, e.g. "act_123456789"'`）和实际调用链
（`client.meta_ad_account_id` 直接作为 `adAccountId` 传给
`getCampaignDailyInsights` 拼 URL，中间没有加前缀的代码），确认现有最大的
引用面（`clients` 表 + 所有读它的同步路径）已经是带前缀形式。选它作规范
形式，不需要改动这个最大的既有面。

**必须覆盖的六个点**：

| 点 | 处理 |
|---|---|
| `act_123` 与 `123` 不得绕过唯一约束形成两条账户 | `meta_object_ownership`/`meta_insight_quarantine`/`meta_account_ownership_cutover` 的写入函数在写库前统一调用一次规范化（补前缀，若已有则不重复），保证同一账户物理上只有一种存法进表 |
| 输入校验 | 新建的 `object-ownership.ts` 里的写入函数对 `ad_account_id` 参数做格式校验（正则 `^act_\d+$`），格式不对直接拒绝（fail closed，不静默纠正后继续） |
| migration/backfill 规范化 | 历史 backfill 脚本读到任何形式（`act_xxx` 或裸数字）都先规范化成带前缀形式再写入 |
| ownership unique key | `UNIQUE (ad_account_id, level, object_id)` 天然依赖 `ad_account_id` 已经是规范形式——这是**输入校验**要在写入前挡住格式问题的直接原因，唯一约束本身不做格式转换 |
| collector group-by | "按 `ad_account_id` 去重"这一步的 Map key 必须先规范化 `clients.meta_ad_account_id` 的读值（虽然现在存量应该已经是带前缀形式，但去重逻辑不能假设——规范化一次成本极低，防止未来某条 onboarding 路径不小心存了裸数字） |
| clients onboarding binding | `clients.meta_ad_account_id` 保持现状不变（本轮不碰这张表的写入路径），但**新增**的任何读它的地方（collector 去重、ownership 查询）在读出来那一刻规范化一次，不信任存量数据 100% 干净 |
| provider API 调用转换 | 调 Meta Graph API 时用带 `act_` 前缀的形式拼 URL——这本来就是现状（`campaign-ownership.ts` 反而是那个"去掉前缀再比较"的特例，用于内部字符串相等判断，不是存储或 API 调用形式） |

## 六、跟既有系统的关系（禁止重复身份系统，逐条回应）

| 既有机制 | 能证明什么 | 不能证明什么 | 关系 |
|---|---|---|---|
| `clients.meta_ad_account_id` / Facebook onboarding binding | 客户被允许连接哪个账户（onboarding 时人工/OAuth 确认过） | 共享账户内某条具体 campaign 属于哪个客户——onboarding 只发生在账户层面，不下沉到对象层面 | 不变、不重复。`meta_object_ownership` 是账户内部的对象级细分，账户绑定依然是"这个客户名下配的是哪个账户"的唯一真相源 |
| `campaign-ownership.ts`（AD-SEC-1 写路径守卫） | campaign 是不是在**完全不同**的账户（挡最粗暴的跨账户误操作） | 同账户内的跨客户操作——文件头自己写明 | 互补，本轮不改它。未来（不在本轮）它可以升级成同时查 `meta_object_ownership`，把"同账户内也能分清"这个能力补上，两套判据合并，不是并存两套各管一半 |
| `ad_creative_links` | 一条广告用了哪个 ME 内容素材（创意归因） | 不该被当客户归属的权威来源——它现在信任调用方传入的 `clientId`，不做独立核实 | 不同轴，不重复。未来（不在本轮）`linkAdToCreative` 的调用方应该先查 `meta_object_ownership` 拿到 confirmed 的 `client_id` 再传进去，而不是自己决定传什么——这样两个表不会因为调用方传错参数互相打架，但这次改动不在本轮范围内 |
| Kernel lineage（`action_runs`/`authorization_decisions`） | Goal→Run→Outcome 的执行血缘 | 谁"拥有"某个 Meta 对象——lineage 只回答"这次 run 做了什么"，不是身份登记系统 | 不重复，是延伸边。`meta_object_ownership.kernel_run_id` 是可空外键指回 `action_runs(id)`，跟 `flywheel_actions.action_run_id` 那种"给既有表加一条可空 lineage 边"是同一手法，不是另建一套追踪机制 |
| **Provider Connection Readiness Gate**（onboarding 时确认 Page/Ad Account/权限/token/币种/时区，R2 新增回应点） | 这个客户的接入本身是完整的、可用的（token 有效、权限够、币种时区registered） | Connection Readiness ≠ Campaign Ownership——一个客户的 Meta 连接可以完全"就绪"（token 有效、能调 API），但账户里的某条具体 campaign 依然可能是同账户另一个客户的。**这是两个独立的问题**，Readiness Gate 解决"我们能不能跟这个账户对话"，`meta_object_ownership` 解决"这个账户里的哪个对象是谁的"，一个就绪不代表另一个自动成立 | 不重复，正交。Readiness Gate 是 onboarding 时的一次性检查（本次会话没有创建或修改它），`meta_object_ownership` 是运行时持续维护的登记表，两者服务不同的问题，不应该合并成一个系统 |

**一句话**：`meta_object_ownership` 是**唯一**新增的对象级权威登记点；
`meta_insight_quarantine`/`meta_account_ownership_cutover` 是它的两个直接
支撑结构（证据保全 + 切换时间点记录），不是三套平行的身份系统——后两张表
离开 `meta_object_ownership` 单独存在没有意义。

## 七、测试矩阵（按指令逐条覆盖，只列要测什么）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 同账户三个客户共享，collector 跑一轮 | Meta insights 接口只被调用一次（mock 调用次数断言） |
| 2 | campaign 已 confirmed 归属 | 数据路由进 `ad_daily_insights`，client_id 是归属表里那个 |
| 3 | campaign+ad 都 confirmed 且同客户 | ad 级行正确路由 |
| 4 | campaign/ad 客户不一致（都 confirmed） | 进 quarantine，`reason_code='ownership_conflict'` |
| 5 | 归属完全缺失 | 进 quarantine，`reason_code='ownership_missing'` |
| 6 | 归属是 provisional 或 orphaned_needs_reconcile | 进 quarantine，`reason_code='ownership_not_confirmed'`，不因为"至少有行"就放行 |
| 7 | `act_123` 与 `123` | 规范化后视为同一账户，不会产生两条独立的账户分组 |
| 8 | 两个并发写入尝试认领同一 `(ad_account_id, level, object_id)` | 唯一约束只放行一方，另一方收到 `23505` 并按"别人已认领"处理 |
| 9 | provider create 成功、紧接着 ownership INSERT 失败 | 触发 rollback；rollback 成功则对象+ownership 行都不留痕；rollback 失败则该层（及之前各层）转 `orphaned_needs_reconcile`，预留保持占用 |
| 10 | ownership 写成功后进程立即崩溃（模拟：写完某一层就停止，不再调用下一层） | 下次重试时，幂等检查（先查 ownership 表、再退回按 tag 查）能正确识别"这一层已经建过"，不重复创建 |
| 11 | rollback 删除 Meta 对象失败 | 不当成"对象不存在"处理；ownership 行转 `orphaned_needs_reconcile`；`orphans` 机制如实上报 |
| 12 | 同一条 unknown insight（同 account+level+campaign+ad+date）被多次 cron 拉取 | `meta_insight_quarantine` 只有一行，`last_seen_at` 更新，不产生重复行 |
| 13 | quarantine 行经人工确认归属后转正 | `ad_daily_insights` 只出现一次该行数据；再次运行转正批处理（模拟重跑）不产生重复/不改变已有数值之外的副作用 |
| 14 | cutover 执行后 | 无独立验证证据的历史行 `ownership_trust_status='not_comparable'`；有 `manually_verified`/`imported_verified` 支撑的历史行保持 `trusted` |
| 15 | migration 未 apply（`meta_object_ownership` 表不存在）时 collector 跑一次 | 整体 fail closed，不写入任何 `ad_daily_insights` 行，不退回旧的无过滤逻辑，产生明确告警 |
| 16 | 新旧版本 collector 同时对同一账户触发同步（模拟并发部署窗口） | 设计要求禁止此场景发生（串行化/锁），测试断言"不允许同时触发"这条约束本身被遵守，而不是断言两版数据不冲突（那样已经是允许了不该允许的场景） |
| 17 | 未知（quarantine）数据 | 不会在任何报表/诊断里显示为 spend=0 或 impressions=0——它应该完全不出现，而不是以"0"的形态出现（0 和"不知道"是两个不同的诚实状态，混淆会被误读成"这天真的没花钱"） |

## 八、Reuse Statement

**复用不动**：`clients.meta_ad_account_id` 账户级绑定（onboarding 机制不碰）、
`campaign-ownership.ts`（AD-SEC-1 写路径守卫，本轮不改，未来可能升级但不在
这次范围）、`post-boost-publisher.ts` 的 `deterministic_tag` + `findByTag`
机制（R2 直接复用，作为 reconcile 第二档查找依据）、M2 的
`ads_spend_reservations`（预留/释放逻辑照搬到 ownership 失败场景）、
`pm-todo/manual-items.ts`（告警契约复用其"what/how/href"三件套，不新建
通知系统）、`flywheel_actions.action_run_id` 的"可空 lineage 边"设计手法
（`meta_object_ownership.kernel_run_id` 照抄同一手法）。

**新增是 platform-shared**：`meta_object_ownership`/`meta_insight_
quarantine`/`meta_account_ownership_cutover` 三张表的结构本身——`client_id`
是参数化的，Oztop/Roman 甚至未来任何共享 Meta 账户的客户都能直接用同一套
表，不需要为每个客户建专属逻辑。三态状态机（provisional/confirmed/
orphaned_needs_reconcile）和 reconcile 顺序（先按 object ID、退回按 tag、
按 0/1/多个分派）是通用的 Meta 对象生命周期模式，不含任何 CTS/Oztop/Roman
的业务语义。

**新增是 client/行业特定的**：无——本设计不含任何客户名、客户 ID 或行业
判断写死进 shared 结构。共享账户 `act_2775766642787274` 本身作为一个真实
的当前实例出现在证据/示例里，但表结构和逻辑不依赖这个具体账户 ID。

**平台化自检**：如果明天把 CTS 换成 Oztop 或 Roman，或者换成一个全新客户，
`meta_object_ownership`/quarantine/cutover 三张表和 collector 改造逻辑一行
不用改——它们本来就是按 `ad_account_id`/`client_id` 参数化设计的，专门为了
处理"多个客户共享一个账户"这个结构性场景，不是为 CTS 这一个客户量身定做的。

## 九、木桶自审

**本次解锁哪条完整闭环**：不解锁任何新的执行闭环——这是"归属"这个已确认
的结构性短板的**设计**修复，不是新功能。真正被"解锁"的是：一旦这份设计
被实施，"执行→数据回流"这条链路的归属环节才第一次有了权威依据，而不是
建立在一个已知会污染数据的采集器上。

**当前最短板**：仍然是这份设计本身——它还没有被复审冻结，冻结之前，
"要不要实施"是你的决定，不是我可以自行推进的下一步。

**本组件做到什么程度就算够用**：本文档覆盖了 R1 点名的三个 BLOCKER + 两项
契约细节 + 六个既有系统关系点 + 测试矩阵 + Reuse Statement——如果复审确认
这些回应到位，这份设计**够用**，可以冻结；如果还有遗漏，等下一轮反馈，不
主动再扩写内容去覆盖没被问到的场景。

**为避免局部过度开发，主动推迟的**（详见"十、明确延后的工作"）。

## 十、明确延后的工作

- **不建候选审核队列表**——名字启发式候选仍然是一次性脚本的中间输出（首版
  已有此决定，R2 不变）
- **不做 Google Ads 的同名机制**——本设计范围限定在 Meta，Google Ads 是否
  有类似共享风险未核实，不假设
- **不建管理 UI**——M6 仍冻结
- **不做 adset/creative 层的采集器路由**——insights 根本不返回这两层 id，
  不是推迟，是不存在这个需求
- **不改造 `campaign-ownership.ts` 的写路径查询**——未来整合方向已在"六"
  写明，这次不动
- **不修改任何下游消费者**（`evaluate.ts`/`weekly-report`/
  `ad-benchmark-queries.ts`/`own-ad-activity.ts`/`ad-engine/page.tsx`）——
  本轮只交付 `ownership_trust_status` 这一列 + cutover 记录，让下游未来
  能够低成本地加一行过滤；实际去加这行过滤，是下一轮的工作，明确不在
  本次范围
- **不做全量历史重归属（方案 A 的完整版本）**——只做 hybrid 里"已有独立
  证据的例外"部分，其余历史数据保持 `not_comparable`，不主动花力气去人工
  核实全部 105+ 行的真实归属
- **不设计告警系统的具体触发代码**——只给出契约（触发条件 + what/how/href
  载荷），复用现成的 `pm-todo/manual-items.ts`，接线工作留到实施阶段
- **不建通用 saga/workflow 引擎**——BLOCKER 1 的状态机只覆盖"创建 Meta 对象
  + 登记归属"这一件事的最小必要状态，不抽象成可以描述任意多步骤流程的
  通用框架

## 明确不做的事（跟指令逐条对应）

本轮不修改任何 `.ts`/`.tsx`/`.sql` 文件、不创建 migration、不调用 Meta
Graph API、不创建/暂停/激活任何真实广告、不花费任何资金、不读取或修改生产
数据、不 deploy、不 merge、不 push、不开 PR、不修改 GitHub Issue/PR、不恢复
M6/M7、不实施真钱 activation、不顺手修改下游报表/Goal/诊断/Prescription、
不建通用 identity platform/event bus/workflow engine/通用 quarantine
framework、不修改其他 worktree 或共享主仓库。本次会话全程只在
`/Users/raydeng/Projects/magic-engine/.claude/worktrees/me-ads-hub-v1`（`feat/
me-ads-hub-v1` 分支）内操作，唯一改动是这份设计文档本身。
