# ADR: 最小 Meta Provider-Object 归属契约（AD-ISO-1 真钱激活前 BLOCKER）

**状态：DESIGN ONLY —— 零代码/Meta 调用/migration/部署，等 Build Control 复审**
**日期**：2026-08-20
**关联**：`docs/ROADMAP.md` `AD-ISO-1`（已追踪 50+ 轮，本设计是它的修复方案）、
`docs/adr/2026-08-20-me-ads-hub-v1-irreversible-outward-contract.md`（已冻结，本设计不碰它）、
`src/lib/meta/campaign-ownership.ts`（AD-SEC-1，写路径的既有守卫，本设计是它的读路径对应物 + 权威登记表）

## 背景

上一轮只读追踪确认：`ad_daily_insights` 的采集→落库路径，对共享 Meta 广告账户
（CTS/Oztop/Roman 共用 `act_2775766642787274`）**没有任何 campaign→client 归属
过滤**——循环按 `clients` 表逐客户跑，每跑到一个共享账户客户就把**整个账户**的
insights 写成**那个客户**的数据，同一个 campaign 的同一天数据会在表里出现三份，
分别挂在三个不同客户名下。这条洞已经存在、有真实数据，且第 46 轮审计确认
"根治前提"（权威归属表）根本不存在。Build Control 把它升为**真钱激活前
BLOCKER**——本设计就是补上这张权威归属表 + 改造采集器路由逻辑的最小方案。

## 一、`meta_object_ownership`：最小归属契约

**一张表，覆盖 campaign/adset/ad/creative 四个层级**（用 `level` 字段区分，
不拆四张表——四层的字段结构完全一样，拆表只会制造四份重复的约束逻辑）：

```sql
CREATE TABLE meta_object_ownership (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  ad_account_id    text NOT NULL,   -- 'act_2775766642787274'（含前缀，跟 clients.meta_ad_account_id 存法一致）
  level            text NOT NULL CHECK (level IN ('campaign','adset','ad','creative')),
  object_id        text NOT NULL,   -- Meta 的数字 id（campaign_id / adset_id / ad_id / creative_id 视 level 而定）

  -- NULL = 明确判定为不可归属，不是"还没查"（没有行才是"还没查"）
  client_id        uuid REFERENCES clients(id),

  source           text NOT NULL CHECK (source IN (
    'declared_at_creation',      -- ME 自己建的，建的那一刻就知道是谁的（M1-M5 走这条）
    'manually_verified',         -- 人工在 Meta 后台核对过，登记进来
    'imported_verified',         -- 历史数据批量导入，经过校验脚本确认（见"六"）
    'unattributable'             -- 明确查过、判不出来或有歧义
  )),
  -- 🔴 name_heuristic_candidate **不是这张表的合法 source 值**——见"六"，
  --    名字启发式候选永远不进这张权威表，只能是人工核实前的中间产物。
  unattributable_reason text,     -- source='unattributable' 时必填

  kernel_run_id    uuid REFERENCES action_runs(id),  -- 可空：非 Kernel 创建的对象没有
  content_post_id  text,                              -- 可空：object_story_id，boost_existing_post 场景才有

  verified_at      timestamptz NOT NULL,
  verified_by      text NOT NULL,   -- 'system:ads.meta_boost_sandbox_reel' / 'human:<email>' / 'system:import_backfill_v1'

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- 状态机在 DB 层面强制：要么"有主"要么"明确判定无主"，没有第三种半吊子状态
  CONSTRAINT client_id_matches_source CHECK (
    (source = 'unattributable' AND client_id IS NULL AND unattributable_reason IS NOT NULL)
    OR
    (source != 'unattributable' AND client_id IS NOT NULL)
  ),

  -- 🔴 并发唯一约束（点 7）：一个 provider object 在一个账户里只能被认领一次。
  --    两个进程同时想把同一个 campaign_id 分给两个不同客户，Postgres 唯一约束
  --    会让其中一个 INSERT 直接失败（23505），不会出现"后写的悄悄覆盖先写的"。
  UNIQUE (ad_account_id, level, object_id)
);

-- RLS：service_role 模板（铁律 7）
ALTER TABLE meta_object_ownership ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service_role_full" ON meta_object_ownership FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**为什么"没有行"和"NULL client_id 的行"是两种不同的状态**（不是同一件事的两种写法）：
"没有行" = 系统还没对这个对象做过任何归属判定（采集器第一次碰到它）；
"`client_id=NULL` + `source='unattributable'`" = 系统**判定过**，结论是判不出来。
两者对采集器的处置一样（都不写进 `ad_daily_insights`），但**可观测性不一样**——
前者是"待处理积压"，后者是"已处理，结论是不知道"，运维需要能分清这两种，
不能都当成同一种沉默。

**为什么不给 `name_heuristic_candidate` 一个合法位置**（点 6 的直接体现）：
如果它是这张表的合法 `source` 值，下游任何一个消费者忘了加
`WHERE source NOT IN ('name_heuristic_candidate')` 就会把猜的当真的用——这正是
"权威证据"这四个字要防的事。把它排除在 CHECK 约束之外，**从数据库层面就不可能
把一条猜测写成一条归属记录**，不依赖"consumer 记得过滤"。

## 二、采集器改造：账户级去重 + 按归属路由

**现状**（`google-data-pullback-daily/route.ts` 主循环）：按 `clients` 表逐行跑，
每行调 `syncMeta(client.client_id, client.meta_ad_account_id, ...)`——三个共享
账户的客户 = 同一个账户被拉三次，每次都把整账户数据写成那次调用的 client_id。

**改造后**：

```
1. 先按 ad_account_id 去重：Map<ad_account_id, client_id[]>
   （CTS/Oztop/Roman 三行客户 → 一个 key，值是三个 client_id）

2. 对每个唯一 ad_account_id，只调一次 getCampaignDailyInsights / getAdDailyInsights
   （原来是 N 个客户 = N 次调用，现在是 M 个唯一账户 = M 次调用，M ≤ N）

3. 每一行结果按 (ad_account_id, level, object_id) 查 meta_object_ownership：
   - 查到且 client_id 非空 → 写进 ad_daily_insights，client_id 用查到的那个
     （不是"当初触发这次同步的那个客户"——这是修复的核心：**写入身份来自归属表，
     不来自调用方**）
   - 查到但 client_id 为空（source='unattributable'）→ 不写，计入
     skipped_unattributable 计数
   - 完全查不到（没有行）→ **fail closed**，不写，计入 skipped_unknown 计数
     （不是写给"触发这次同步的客户"这个旧的隐式默认值）

4. cron 结果摘要带上三个计数：written / skipped_unattributable / skipped_unknown，
   这三个数字本身就是"归属表还有多少积压"的实时进度条，不需要另外建监控
```

**为什么"账户级去重"和"按归属路由"要一起做，不能只做一半**：
只做去重（一个账户只拉一次）不解决污染——不知道该写给谁，污染只是从"写三份"
变成"写一份但可能写错"。只做路由不去重——三次账户级 API 调用照样在浪费配额、
且三次路由结果理论上应该完全一致，跑三遍是纯浪费。两者必须一起改。

## 三、Fail-closed：不可归属对象绝不进入下游

设计已经在"二"里体现：`skipped_unattributable` 和 `skipped_unknown` 的对象
**从不写入 `ad_daily_insights`**——不写给触发同步的客户，不写给"猜起来最像"的
客户，不写给任何客户。这意味着诊断（`evaluate.ts`）、报表（`weekly-report`）、
Goal 指标、Prescription **不需要额外改一行代码**去过滤这些对象——它们读的
`ad_daily_insights` 从源头就不包含未归属数据，下游保持"读侧过滤 client_id"这套
既有逻辑不变，因为源头已经干净。**这是本设计刻意的收敛点**：只修一处（采集器
写入逻辑），而不是在四五个下游消费者里各加一层"顺便过滤一下疑似污染数据"的
补丁——那样才是真正的"重复身份系统"雏形。

## 四、M1-M5 Publisher：在哪个成功点登记归属 + 部分成功处理

**登记点**：`post-boost-publisher.createBoostAdPaused()` 现有的四步
（campaign→adset→creative→ad）全部成功之后，**在返回 `{ok:true}` 之前**，
用**一条多行 INSERT**把四个对象的归属一次性写进 `meta_object_ownership`
（`source='declared_at_creation'`，`kernel_run_id=ctx.runId`，
`content_post_id=objectStoryId`，`verified_by='system:ads.meta_boost_sandbox_reel'`）。

**为什么是"四步都成功后一次性写"，不是"每建一个就写一个"**：
如果建到第 3 步（creative）失败，既有的 `rollback()` 会把已建的 campaign/adset
删掉。如果归属登记是"边建边写"，删除时还要**同步删掉已经写的归属行**，两条
清理逻辑必须永远同步，一旦漏改一处就会留下"对象已删、归属行还在"的鬼行。
"四步都成功后一次性写"，把归属登记变成**第五个原子步骤**，复用**已经存在**的
"任一步失败就整体回滚"这套逻辑，不需要新增一套清理路径。

**"provider 已创建、ownership 写入失败"这个具体场景怎么处理**：
这条多行 INSERT 本身**就是**这个原子步骤——它失败时，`createBoostAdPaused`
按**现有**的失败处理路径走：`return { ok:false, step:'ownership', error, orphans:
await rollback() }`。四个刚建的 Meta 对象会被删掉（复用现有 `rollback()`，
不新增任何删除逻辑）；M2 的预算预留会被释放（复用现有"建失败释放预留"逻辑，
Capability 的 `publish_paused` 步骤已经在处理 `!result.ok` 的情况）。

**净效果**：`createBoostAdPaused` 从"四步全有或全无"变成"五步全有或全无"——
归属登记不是附加的、可以失败而不影响主流程的旁支，是主流程本身的一部分。
这样"Meta 上有个真实存在但没有归属记录的对象"这种状态**在正常路径下永远
不会发生**——除非删除本身也失败（既有 `orphans` 机制已经覆盖了这种情况：
删不掉的对象如实报出来转人工，不假装干净）。

## 五、Meta insights 各 level 返回的 object id（核实结果，不是猜的）

读 `src/lib/meta/client.ts` 确认：

| level | 请求的字段（`DAILY_FIELD_LIST` / `AD_DAILY_FIELDS`） | 返回的身份字段 |
|---|---|---|
| `campaign` | `campaign_id, campaign_name, spend, impressions, ...` | 只有 `campaign_id` |
| `ad` | 上面 + `ad_id, ad_name` | `campaign_id` **+** `ad_id`，**没有 `adset_id`** |

**结论**：insights 采集器**只需要在两层做归属路由**——campaign 级按
`(ad_account_id, 'campaign', campaign_id)` 查，ad 级按
`(ad_account_id, 'ad', ad_id)` 查（ad 级也可以退回按 `campaign_id` 路由，
如果 `ad_id` 归属没登记但 `campaign_id` 归属有——这条退回策略本设计不展开，
留给实施时按实际数据覆盖率决定要不要加）。

**adset/creative 两层的归属记录在这张表里依然有意义，只是不被采集器消费**——
它们服务的是"四"里 M1-M5 的记账完整性（一条 ad 的完整血缘要包含它挂在哪个
adset、用了哪个 creative），以及未来如果 Meta insights API 真的开始返回
`adset_id`（当前代码没请求，不代表 Meta 不支持返回，只是没要），这张表已经
提前有了对应的行，不需要事后补建。**这不是"提前建设采集器用不到的精度"**——
建这两层是给创建端记账，不是给采集器路由，两者是不同的消费者，互不依赖。

## 六、历史 campaign backfill：只认两种权威来源，名字匹配只能做候选

`source` 枚举里没有 `name_heuristic_candidate`（见"一"）。历史 campaign
（`ME` 建号之前就存在、或人工在 Meta 后台直接建的）要进这张表，只有两条路：

1. **`manually_verified`**：人工在 Meta Ads Manager 后台直接核对"这条 campaign
   是给哪个客户投的"，然后手工执行一条 INSERT（或未来一个管理脚本/界面，
   本设计不展开界面，那是 M6 范畴，仍冻结）。
2. **`imported_verified`**：批量历史数据导入，但"导入"本身必须先经过一轮
   独立于名字的核实（比如核对 landing page URL 指向哪个客户的官网、核对
   pixel id 归属、核对 `contacts.attr_campaign_id` 里真实产生过 lead 的
   campaign 反查客户——这些都是"证据"不是"猜"，跟名字解析的性质不同）。

**名字匹配的唯一合法用途**：生成一批**候选建议**给人工看（"这条 campaign
叫『CTS China Tours』，看起来像 CTS 的，要不要确认？"），这个候选列表**不落
`meta_object_ownership` 表**，只是一次性脚本的中间输出（打印/导出成一份待办
清单），人工确认后，**人工确认这个动作本身**才产生一条 `manually_verified`
行——数据库里从头到尾不存在"待确认的候选行"这种中间状态。

（这也是"九"里主动推迟的一项：不建候选审核队列表，见后文）

## 七、最少 migration / 最少改动文件 / 并发约束 / 回滚恢复 / 测试矩阵

**Migration（一份）**：`meta_object_ownership` 建表 + 两条 CHECK 约束 +
一条 UNIQUE 约束 + RLS service_role 策略。不改动任何既有表的 schema——
`ad_daily_insights` / `campaign-ownership.ts` 用到的 `clients` 表都不用动。

**改动文件（四个核心 + 一个一次性脚本）**：
1. 新 migration 文件（如上）
2. 新 `src/lib/meta/object-ownership.ts`——`lookupOwnership()` /
   `recordOwnership()`（多行原子 insert）/ `recordUnattributable()`
3. 改 `src/lib/meta/post-boost-publisher.ts` 的 `createBoostAdPaused()`——
   四步成功后加第五步（归属登记），失败走现有 rollback
4. 改 `src/lib/ads-strategy/daily-insights.ts` 的
   `syncCampaignDailyInsights` / `syncAdDailyInsights`（或它们的调用方
   `google-data-pullback-daily/route.ts` 的主循环）——账户级去重 + 按归属路由
5. 一次性历史 backfill 脚本（不是常驻 lib 文件，跑一次、人工确认候选、
   写入 `manually_verified` 行）

**并发唯一约束**：`UNIQUE (ad_account_id, level, object_id)`——单条语句级别的
Postgres 保证，不需要显式锁、不需要 RPC（跟 M2 的预留表不同，M2 需要"读-判-写"
在一条语句里原子完成；这里只是"抢注"，唯一约束本身就是那个原子操作，第二个
INSERT 直接失败，不需要额外设计）。

**回滚 / 恢复路径**：
- 归属写入失败 → 走"四"里的现有 rollback（删 Meta 对象 + 释放预留）
- 采集器发现某对象归属查不到 → 不写、计数、不重试（下次 cron 再查一次，
  等归属表补上了自然就开始写）
- 归属记错了（人工核实出错）→ 更正 = 更新那一行的 `client_id` +
  重新盖 `verified_at`/`verified_by`；**遗留问题**：更正前已经按错误归属写进
  `ad_daily_insights` 的历史行需要一次性清理/重算，本设计标注这是一个已知的
  后续步骤，不在这次范围内展开（属于"发现即处理"的运维动作，不是设计要解决的）

**测试矩阵**（列出要测什么，不是现在就写）：
1. 唯一约束真的挡得住并发抢注（同 M2 并发测试的写法：两个"进程"同时插入
   同一个 `(ad_account_id, level, object_id)`，只有一个成功）
2. CHECK 约束拒绝 `client_id` 和 `source` 不匹配的行（四种非法组合各测一次）
3. 采集器：账户级去重——两个客户共享一个 `ad_account_id`，Meta 的 insights
   接口只被调一次（断言 fetch mock 调用次数）
4. 采集器：查到归属 → 写给归属里的那个客户，不是触发同步的客户
5. 采集器：查不到归属 → 不写、计数增加，不落进任何客户名下
6. 采集器：`source='unattributable'` 的行 → 不写、计数增加
7. Publisher：五步全成功 → 归属行齐全
8. Publisher：归属 INSERT 失败 → 四个 Meta 对象被删、预留被释放（复用现有
   rollback 测试模式）
9. 历史 backfill：名字候选永远不能被脚本自动写成 `manually_verified` 行
   （必须有一个"人工确认"的显式步骤介入，测试要证明脚本本身没有自动转正的路径）

## 八、跟既有身份系统的关系（禁止重复身份系统）

| 既有机制 | 管什么 | 跟 `meta_object_ownership` 的关系 |
|---|---|---|
| `clients.meta_ad_account_id` / `clients.facebook_page_id` | 客户 ↔ **账户**级绑定（onboarding 时登记） | **不变、不重复**。`meta_object_ownership` 是账户内部的**对象级**细分，账户级绑定还是"这个客户用哪个账户"的唯一真相源，新表回答的是"这个账户里的哪个具体对象是哪个客户的" |
| `campaign-ownership.ts`（AD-SEC-1，写路径守卫） | 校验请求体里的 `campaign_id` 是不是在**这个客户注册的账户**里 | **互补，不重复**。AD-SEC-1 挡的是"完全不同账户"的误操作，挡不住同账户内的跨客户混淆（文件头注释自己承认）。新表填的正是这个空——未来 AD-SEC-1 的写路径可以**升级成查 `meta_object_ownership`** 而不是只查账户 id，两者会合并成一套判据，不是两套并存 |
| `ad_creative_links` | ad_id ↔ **我们自己内容**的映射（这条广告投的是哪条片子） | **不同轴，不重复**。归属回答"这个 Meta 对象是谁的"，creative-link 回答"这条广告用了哪个素材"。**未来整合方向**（本设计不实施）：`linkAdToCreative` 目前把 `clientId` 当**信任的入参**，不做独立核实；有了归属表之后，它应该改成从 `meta_object_ownership` 查 `ad_id` 对应的 `client_id`，而不是相信调用方传进来的——这样两个表就不会因为调用方传错参数而互相打架 |
| Kernel lineage（`action_runs` / `authorization_decisions`） | Goal → Run → Outcome 的执行血缘 | **不重复，是它的延伸边**。`meta_object_ownership.kernel_run_id` 是一条可空外键指回 `action_runs(id)`，跟 `flywheel_actions.action_run_id`（WP01 migration 里"补上 lineage 的最后一条边（可空，零行为变化）"）是完全同一种设计动作——给 Kernel 的血缘图多加一条边（Run → 它建出来的 Meta 对象），不是另起一套追踪机制 |

**一句话**：新表是**唯一**新增的权威身份登记点；其余四套机制要么保持不变、
要么在未来被改造成"读这张新表"而不是各自维护一份判断，最终收敛成一个真相源。

## 九、按木桶原则主动推迟的（不提前建设）

- **不建候选审核队列表**——名字启发式候选是一次性脚本的中间输出，不是持久化
  数据结构；真要做成常驻审核流程，等有第二个/第三个需要历史 backfill 的场景
  出现再考虑要不要抽象
- **不做 Google Ads 的同名机制**——CTS/Oztop/Roman 共享的是 Meta 账户，Google
  Ads 有没有类似风险本设计没有核实过，不能假设它也需要同一套方案；上游
  （Google Ads 是否也有共享账户场景）现在还不确定，不提前建
- **不建管理 UI**——M6 仍冻结，归属表的读写在这次范围内全部走脚本/代码，
  不做任何界面
- **不做 adset/creative 层的采集器路由**——"五"已经确认 insights 根本不返回
  这两层的 id，路由逻辑无从谈起，这不是"推迟"，是"目前不存在需求"
- **不把 `campaign-ownership.ts`（AD-SEC-1 写路径守卫）改造成查新表**——"八"
  提到这是未来的整合方向，但本设计的范围是**读路径**（采集器）+ **创建登记**
  （M1 publisher），AD-SEC-1 的写路径升级是一个独立的、有自己完整测试矩阵的
  改动，不在这次范围内一起做
- **不自动重算/清理历史被污染的 `ad_daily_insights` 行**——"七"标注这是已知
  遗留步骤；本设计只保证**从今往后**新写入的数据是干净的，不承诺回填修复
  105 行历史快照（那是 AD-ISO-1 自己的审计/清理任务，第三十一轮已经做过一次
  抽样核对，不属于"激活前必须闭环"的范围——激活产生的是**新数据**，新数据
  干净就够了）

## 明确不做的事（跟指令逐条对应）

不写代码、不调用 Meta、不 apply migration、不部署。本文档是设计草案，
等 Build Control 复审；复审通过后才进入"最小改动实施"，且仍然不解除
M6/M7/真钱激活的冻结——那些是独立的、由你另行裁决的闸。
