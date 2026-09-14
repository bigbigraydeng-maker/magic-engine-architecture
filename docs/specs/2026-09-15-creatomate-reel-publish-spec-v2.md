# Creatomate / 现成成片 → 人工授权 → 原生发 Facebook Reel → 人工首评 + 只读核验 → T+4/T+72 成绩回收 · spec v2

> 起草：Claude Code · 2026-09-15 · 状态：**设计稿 v2，未写任何业务代码 / migration / 路由 / Inngest 函数**
> 取代：[`2026-09-15-creatomate-reel-publish-spec-v1.md`](./2026-09-15-creatomate-reel-publish-spec-v1.md)（v1 保留作审查记录）
> 基线：`origin/main` = `f9c8f3aa5dad51ff5f593edce329833e260a91d3`（2026-09-15 01:45 NZST 拉取，含 #1686）
> 审查沿革：v1 → 子牙（架构，11 条阻断）+ 魏征（挑刺，13 条必修 M1–M13）→ 协调方裁决 D1–D16 → 协调方生产只读探针 X1/X2/X4（§1.3，推翻零宽标记假设）→ 本 v2。文末 §13 逐条对照
> 风险级别：**A 级**（不可逆对外发布 + 状态机/幂等 + migration + SECURITY DEFINER RPC + 鉴权边界）
> Tier：既有社媒支柱「发布」能力延伸 + L3 Meta Connector（`facebookReelAdapter`）复用；**不新增能力线、不登记候选**（§11）
> IMPACT：**Act**（发 Reel）→ **Check**（T+4 / T+72）。Tune、自动建广告本期不接（§9）
> 下一步：本 v2 仍需子牙 + 魏征复核（针对改动部分，#964 第二轮）→ 才进入实现

---

## 0. 一句话

内部员工在出片抽屉里审片（含分镜自检九宫格）、审正文、审首评、逐句标来源，**亲手点「授权发布」并输入主页名确认** → 服务端把视频复制到不可覆盖路径并算内容哈希，写一条 `content_reel_publish_attempts` 记录（数据库保证一条内容同时只有一次进行中的发布）→ Inngest 发布函数拿副本原生上传成 Reel（默认草稿；全局急停开关 + 客户级开关 + 授权选公开，三者都为真才公开）→ 系统 GET 确认公开后落回执 → 跟进函数写三本账、发**独立的**内容 Reel 发布事件、删掉之前验格式用的草稿 → 测量适配器登记 T+4/T+72 → 首评由人用主页身份粘贴锁定原文，点「已发」触发只读核验才算完。任何卡点进今日待办（4 种），待办里的按钮真实存在。

---

## 1. 事实基线

### 1.1 生产只读事实（协调方 2026-09-15 核实）

| # | 事实 |
|---|---|
| P1 | `content_posts` 有 `BEFORE UPDATE handle_updated_at()`（`now()`）与 `AFTER UPDATE OF status trg_sync_execution_item_on_post_published` |
| P2 | `FACTORY_PUBLISH_LIVE` 生产为 `false` |
| P3 | CTS 授权 scope 无 `pages_manage_engagement`；`META_PAGE_SCOPES`（`src/lib/meta-oauth/client.ts:37-63`）根本不申请它 |
| P4 | CTS `clients.facebook_page_id` 与 `factory_config.publish_target.page_id` 一致 |
| P5 | CTS `factory_config.render.engine = 'creatomate'` |

### 1.2 代码事实（v1 F1–F20 仍有效，以下为 v2 新增/更正，均在 `origin/main` 核实）

| # | 事实 | 位置 |
|---|---|---|
| F3′ | **更正 v1 F3**：讲课片线真发判断是 `publishRequest.live === true \|\| env`，全局 env 一开，所有讲课片请求都变真发；工单线同样全局受控 | `src/lib/factory/lecture-publish.ts:109`、`src/app/api/cron/factory-publish-worker/route.ts:24` |
| F21 | `findExisting` 遇 Graph 报错 `return null`，「没找到」与「查询失败」不可区分 | `facebook-reel-adapter.ts:150` |
| F22 | start 与 finish 调同一路径 `/${pageId}/video_reels`，报错文本无法区分阶段 | `facebook-reel-adapter.ts:95, 112` |
| F23 | `resolveToken` 取不到库存页 token 时回退全局 `META_SYSTEM_USER_TOKEN`；`assertBrandMatches` 品牌名或页名为空时直接放行 | `facebook-reel-adapter.ts:40-77` |
| F24 | `promoteReelToPublished` 调 finish 不带 `description`；生产无转正成功证据 | `facebook-reel-adapter.ts:170-195` |
| F25 | `/api/posts/[id]` PATCH 允许改 `status`，鉴权只要付费档 | `src/app/api/posts/[id]/route.ts:60-81` |
| F26 | `/api/posts/batch` 的 `delete` / `updateStatus` 可删行、改任意状态，付费档可调 | `src/app/api/posts/batch/route.ts:44-73` |
| F27 | `[postId]` PATCH `confirm` 除 LinkedIn 外无状态条件；对无渲染任务的卡片会新排 Creatomate 渲染；`finalizeSuccess` 无条件覆盖 `source_video_url` | `[postId]/route.ts:114-132, 178-191`、`factory-creatomate-render.ts:238` |
| F28 | `/api/publer/create-post` 只检查 `status==='approved'` | `src/app/api/publer/create-post/route.ts:52` |
| F29 | 内部员工判据：`guardGlobalAdmin` = `perms.role==='admin' && !perms.allowedClientId`；`requireGlobalAdmin` 仅在未合并的 #1649 | `src/lib/auth/require-admin.ts:65-80` |
| F30 | SECURITY DEFINER 函数的仓库惯例：`SET search_path = pg_catalog, pg_temp`；`REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role` | `supabase/migrations/20260905123025_fix_post_measurement_search_path.sql`、`20260905000001_social_post_measurement_receipts.sql:236-249` |
| F31 | 看板页不支持 `?post=<id>` 深链（魏征 grep 为空，v1 U9 判为不成立） | `src/app/dashboard/clients/[id]/content-factory/page.tsx` |
| F32 | `expect_brand` 无任何编辑入口；`master_briefs.brand_name` 在 Brief 面板可编辑；`clients.facebook_page_id` 由 FDE 专用绑定路由写 | `BriefEditor.tsx:86-87`、`src/app/api/clients/[id]/facebook-page/route.ts:1-17` |
| F33 | `clients.domain` 存在（跨客户审计用它比对站点域名） | `src/lib/clients/cross-client-audit.ts:142` |
| F34 | 发评论所需 scope 不在申请清单；读评论有 `pages_read_engagement` + `pages_read_user_content` | `meta-oauth/client.ts:37-63` |

### 1.3 上线前只读探针实测（协调方 2026-09-15，生产 CTS 主页，页 token 只读 GET）

| # | 实测 | 对设计的约束 |
|---|---|---|
| X1 | 适配器 `encodeIdemTag` 写入的 U+2063 锚点 + 32 位 U+200B/U+200C，经 `GET /2259550698170048?fields=description` 与 `GET /<page>/video_reels?fields=description` 读回，**比特位全部被 Facebook 剥掉，只剩锚点**（9/06、9/01 两条工厂 Reel 皆如此；9/01 那条正文为空，只剩一个锚点） | `findExisting` 的 `description.includes(tag)` **永远匹配不上**：main 上工单线「已发不重发」对账防线实际失效（协调方另开 issue）。**v2 不以任何零宽字符标记作防重或核对依据** |
| X2 | `video_reels` 列表项含 `published`、`status.publishing_phase.publish_status`（已公开 = `"published"`）、`status.video_status`（`"ready"`）、`status.uploading_phase` / `status.processing_phase`；列表里目前全是已公开 Reel，**没有草稿样本** | 状态分类用 `status.publishing_phase.publish_status` + `published` + `status.video_status`；「列表是否含 DRAFT」「草稿的 publish_status 取值」仍未证实 |
| X4 | `GET /<已删除照片 id>` → HTTP 400 `code 100 / error_subcode 33`（GraphMethodException，「does not exist, cannot be loaded due to missing permissions, or does not support this operation」）；`GET /9999999999999999`（从未存在）→ **完全相同**；`GET /<page>_<已删帖子>`（组合 id）→ HTTP 400 **code 10**（OAuthException），不是 100/33 | 100/33 分不出「已删 / 从未存在 / 无权限读」；组合 id 删除后是 code 10。`not_on_facebook` 必须：只查我方记录的 `video_id` 本体 + 同一 token 读主页本身成功（排除权限失效）+ 间隔两次确认；**code 10 一律当查询失败** |

---

## 2. 架构：2 个 Inngest 函数 + 同步路由 + 独立表

### 2.1 仍然选「新 Inngest 线复用适配器」，不扩 publish-worker

理由同 v1 §2.1（两审均认可），不重复。v2 调整：

- Inngest 函数**只保留 2 个**：`cloud-factory-content-reel-publish`（`retries: 0`）、`cloud-factory-content-reel-followup`（`retries: 3` + `onFailure`）。
- 「重新核对 Facebook」「首评已发·核验」「重新删除草稿」都是**单次同步读取/单次幂等删除**，走同步路由（CLAUDE.md Inngest 例外允许单次同步读取）。
- 从 `publish-worker.ts` **只加 `export`、不搬家**：`resolveTarget`、`scanPublishCaption`、`validateVideoUrl`、`writeThreeBooks`（加可选 `vendor` 参数，默认值保持原 `oztop_facebook`，工单线行为不变；错误默认值另开 backlog）。
- 适配器只做**加法**（默认行为不变）：
  - `PublishTarget.strict?: true`：只用库存页 token（不回退 `META_SYSTEM_USER_TOKEN`）；品牌名或页名为空一律抛 `brand_mismatch`（D12）；**不在 description 末尾追加零宽标记**（X1 实测会被剥成一个孤立的 U+2063，毫无用处还污染客户正文）。
  - **不使用 `findExisting`**（X1：零宽标记被剥，匹配永远失败）。唯一可信源 = 我方数据库记录的 `video_id`（§3.4）。
  - 新导出 `getReelObjectStatus(videoId, pageId)`：同一次调用里先 `GET /<page_id>?fields=id`（主页可读性探针），再 `GET /<video_id>?fields=id,published,permalink_url,status`。返回：
    - `{kind:'exists', phase}`：`phase` 由 `status.publishing_phase.publish_status` + `published` + `status.video_status` 映射：`publish_status==='published' && published===true && video_status==='ready'` → `'published'`；`video_status` 非 `ready` 或 `processing_phase`/`uploading_phase` 未完成 → `'processing'`；其余（含草稿，其取值未证实）→ `'not_public'`；
    - `{kind:'absent_confirmed_once'}`：视频本体 `code 100 + error_subcode 33` **且** 主页探针成功（仍不等于「已删」，只算一次缺席证据）；
    - `{kind:'error', code}`：主页探针失败、`code 10`、`code 190`、超时、网络、其他任何错误。
  - 新导出 `deleteReelVideo(videoId)`：`DELETE /<video_id>`；调用方随后必须按 §3.4 第 9 步的两次缺席确认才算删掉。
  - 所有 Graph 查询**只用 `video_id` 本体**，不用 `<page>_<video>` 组合 id 判断存在与否（X4：组合 id 删除后返回 code 10）。
  - `promoteReelToPublished` 本期**不调用**（D4）。

### 2.2 组件清单（实现上限）

| 组件 | 说明 |
|---|---|
| migration：`content_reel_publish_attempts` + 3 个 RPC + `content_posts` 导入幂等索引 | §3；**apply 需 PM 单独 go** |
| `src/lib/factory/content-reel/*.ts` | 类型、zod schema、授权记录构造与校验、文案检查、UTM 拼装、RPC 调用封装 |
| `POST /api/clients/[id]/content-factory/[postId]/reel-publish` | action：`authorize` / `retry_start`（重发授权事件，新 id）/ `reconcile` / `confirm_seen_published`（仅在 X4′ 降级场景显示）/ `verify_first_comment` / `retry_draft_delete` / `restart_measurement` |
| `POST /api/clients/[id]/content-factory/import-video` | §8 |
| `GET …/[postId]/reel-publish/preview` | 表单预览：主页名、开关状态、首评方式、落地页候选、检查结果 |
| 两个 Inngest 函数 | §4.4、§5 |
| `factoryReelMeasurementAdapter` | triggers 数组加新事件（§5.2） |
| `src/lib/pm-todo/content-reel-items.ts` | 4 种待办（§7） |
| 看板抽屉 + `?post=<id>` 深链 | §4.1、§7 |
| `FactoryConfigPanel` 增 `publish_rules` 分区 | §6.2 |
| 状态机防护补丁：`[postId]` PATCH、`/api/posts/[id]` PATCH、`/api/posts/batch` | §3.5 |

---

## 3. 数据模型与状态机（D1）

### 3.1 表 `public.content_reel_publish_attempts`

```sql
CREATE TABLE public.content_reel_publish_attempts (
  id                        uuid PRIMARY KEY,                 -- = authorization_id（授权时生成）
  client_id                 uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  content_post_id           uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE RESTRICT,
  render_job_id             uuid NULL,
  mode_requested            text NOT NULL CHECK (mode_requested IN ('draft','live')),
  state                     text NOT NULL CHECK (state IN (
                              'authorized','claimed','uploading','in_doubt',          -- 进行中
                              'preflight_failed','not_on_facebook',                   -- 终态，可重新授权
                              'draft_published','draft_deleted','published')),        -- 草稿/终态
  authorized_via            text NOT NULL CHECK (authorized_via IN ('ui_click','chat_go')),
  authorized_by_user_id     uuid NOT NULL,
  authorized_by_email       text NOT NULL,
  prepared_by               text NOT NULL CHECK (prepared_by IN ('human','agent')),
  authorization             jsonb NOT NULL,                   -- §4.2 完整记录（不可改，RPC 不提供修改）
  video_sha256              text NOT NULL,
  video_copy_path           text NOT NULL,                    -- <client>/authorized/<id>.mp4
  source_video_url          text NOT NULL,                    -- 授权时看到的 content_posts.source_video_url
  page_id                   text NOT NULL,
  video_id                  text NULL,                        -- 一旦写入不可改（RPC 强制）
  video_state               text NULL CHECK (video_state IN ('DRAFT','PUBLISHED')),
  permalink                 text NULL,                        -- 绝对网址
  published_at              timestamptz NULL,
  publish_confirmation      text NULL CHECK (publish_confirmation IN ('graph_get','human_confirmed')),
  publish_confirmed_by_user_id uuid NULL,                     -- 仅 human_confirmed 时有值
  env_live_at_publish       boolean NULL,
  rules_live_at_publish     boolean NULL,
  error_code                text NULL,
  error_detail              text NULL,
  absence_first_confirmed_at timestamptz NULL,               -- 第一次 GET 得到 100/33 的时间（§3.4）
  last_step_started_at      timestamptz NULL,
  trigger_event_ids         text[] NOT NULL DEFAULT '{}',     -- 每次发出的授权/重试事件 id
  first_comment_state       text NOT NULL DEFAULT 'pending'
                              CHECK (first_comment_state IN ('pending','verified','not_applicable')),
  first_comment_verified_at timestamptz NULL,
  first_comment_verification_basis text NULL CHECK (first_comment_verification_basis IN ('from_and_url','url_only')),
  followup                  jsonb NOT NULL DEFAULT '{}',      -- books_written / published_event_ids / draft_delete_results / restart_seq
  provider_impact           jsonb NOT NULL DEFAULT '{}',      -- graph_write_calls / video_created / public
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  finished_at               timestamptz NULL
);

-- 一条内容同时只能有一次进行中的发布（D1 / M1）
CREATE UNIQUE INDEX content_reel_publish_attempts_one_active
  ON public.content_reel_publish_attempts (content_post_id)
  WHERE state IN ('authorized','claimed','uploading','in_doubt');
-- 同一个 Facebook 视频只对应一条记录
CREATE UNIQUE INDEX content_reel_publish_attempts_video
  ON public.content_reel_publish_attempts (video_id) WHERE video_id IS NOT NULL;
CREATE INDEX content_reel_publish_attempts_hash ON public.content_reel_publish_attempts (client_id, video_sha256, created_at DESC);
CREATE INDEX content_reel_publish_attempts_state ON public.content_reel_publish_attempts (state, updated_at);

ALTER TABLE public.content_reel_publish_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.content_reel_publish_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- import-video 幂等（D8 / M12d）
CREATE UNIQUE INDEX content_posts_manual_import_source
  ON public.content_posts (client_id, (generation_context_snapshot ->> 'import_source_url'))
  WHERE source = 'manual_import' AND generation_context_snapshot ->> 'import_source_url' IS NOT NULL;
```

- `updated_at` 触发器复用既有 `handle_updated_at()`。
- **回滚路径**：先停调用方（关 `CONTENT_REEL_PUBLISH_LIVE`、下线路由）→ `DROP FUNCTION` 三个 RPC → 表内有行时**不删表**（审计证据），仅 `REVOKE` 并在 DECISIONS 记账；空表可 `DROP TABLE`；`DROP INDEX content_posts_manual_import_source`。
- `content_posts.generation_context_snapshot` **不再存发布状态**（v1 §3.1 作废）：多处代码整列读-改-写会覆盖它（M1）。

### 3.2 RPC（全部 `SECURITY DEFINER`、`SET search_path = pg_catalog, pg_temp`、函数体全部 `public.` 限定、`REVOKE ALL … FROM PUBLIC, anon, authenticated`、`GRANT EXECUTE … TO service_role`，F30）

**① `public.content_reel_authorize(p_attempt jsonb) RETURNS jsonb`** —— 单事务：
1. `SELECT … FROM public.content_posts WHERE id=… AND client_id=… FOR UPDATE`；
2. 要求 `status='approved'`，且 `source_video_url = p_attempt->>'source_video_url'`；否则返回 `{ok:false, code:'post_state_changed'}`；
3. 要求 `public.content_factory_render_jobs` 无该帖 `status IN ('queued','planning','rendering','assembling')`（D7 / M4）；
4. 要求同 `client_id` 近 30 天无 `video_sha256` 相同且 `state IN ('authorized','claimed','uploading','in_doubt','published')` 的记录（D7 / M12d；草稿态不算，允许「先草稿后公开」同一片）；
5. 插入 attempt（`state='authorized'`），部分唯一索引兜底并发；
6. `UPDATE public.content_posts SET status='scheduled' WHERE id=… AND status='approved'`；
7. 返回 `{ok:true}` 或固定原因码。

**② `public.content_reel_transition(p_id uuid, p_from text[], p_to text, p_patch jsonb) RETURNS jsonb`** —— 单事务，`SELECT … FOR UPDATE` 该行后：
- 当前 `state` 不在 `p_from` → `{ok:false, code:'transition_lost', current_state}`（调用方必须据此中止，见 §3.4）；
- `(state, p_to)` 不在下面迁移表 → `RAISE EXCEPTION`（终态不可回退，D1）；
- `p_patch` 只允许白名单列；`video_id` 已非空时再写不同值 → `RAISE EXCEPTION`；
- `p_to IN ('preflight_failed','not_on_facebook','draft_published')` 时，**同一事务**里 `UPDATE public.content_posts SET status='approved' WHERE id=content_post_id AND status='scheduled'`（D9 / M3：卡片回到出片列，可换片、可重新授权）；
- `p_to='not_on_facebook'` 额外要求：`video_id IS NULL` **或** `absence_first_confirmed_at <= now() - interval '10 minutes'` 且 `last_step_started_at <= now() - interval '30 minutes'`（§3.4）。

| 从 | 可到 | 谁调用 |
|---|---|---|
| `authorized` | `claimed` | 发布函数 |
| `authorized` | `preflight_failed` | 发布函数（授权记录校验失败，未领） |
| `claimed` | `uploading`（必须带 `video_id`） | 发布函数 `onStarted` |
| `claimed` | `preflight_failed` | 发布函数（预检失败 / 没拿到 video_id 前失败） |
| `uploading` | `published` / `draft_published` | 发布函数（GET 确认后） |
| `uploading` | `in_doubt` | 发布函数 catch / `onFailure` |
| `claimed` / `uploading` / `in_doubt` | `published` / `draft_published` / `not_on_facebook` / `in_doubt` | 核对路由 |
| `in_doubt` | `published`（仅 `publish_confirmation='human_confirmed'`，服务端仍须读到 `exists`） | 「我已在主页上看到这条公开」路由（§10.1 X4′ 降级） |
| `draft_published` | `draft_deleted` | 跟进函数 / 重新删草稿路由（DELETE 后两次间隔缺席证据，§3.4 第 10 步） |
| 其余 | —— 拒绝 | |

**③ `public.content_reel_mark_post_published(p_id uuid) RETURNS jsonb`** —— 仅当该 attempt `state='published'`：`UPDATE public.content_posts SET status='published', published_at=<attempt.published_at> WHERE id=… AND status IN ('scheduled','approved')`。与回执写入**分两次调用**（D10：触发器写 execution_items 出错不连累回执）。

### 3.3 幂等键（D10 / D11）

| 用途 | 键 |
|---|---|
| 授权 → 发布事件 id | 首次 `content-reel-publish:<post>:<authorization_id>`；「重新发起」`…:r<n>`（n 为该 attempt `trigger_event_ids` 长度）。**防重复靠 `transition(authorized→claimed)`，不靠事件 id** |
| Facebook 侧标记 | **不使用**。零宽标记被 Facebook 剥掉（X1）；可见文本标记（如正文末尾 `#r1a2b`）会污染客户对外文案、且客户在 Meta 后台编辑正文即可抹掉，收益仅是「数据库记录全丢时能在 FB 侧找回」，而 §3.4 已保证 `video_id` 在任何可能公开的动作之前落库——**取舍：放弃 FB 侧标记** |
| 跟进事件 id | `content-reel-followup:<post>:<video>:<authorization_id>`；「重新启动成绩回收」`…:r<n>`（`followup.restart_seq`）。**仅 PUBLISHED 触发**（D11 / 3-C / M6） |
| 内容 Reel 发布事件 id | `me-factory-content-reel-<post>-<video>`；重启时 `…-r<n>`。防重复靠测量登记的唯一索引 |
| 测量幂等键 | `factory-content-reel:<post>:<video>`（工单线 `factory-reel:<wo>:<video>` 不动） |

### 3.4 防重复发帖细节（D10 写死）

1. **领取**：`transition(id, ['authorized'], 'claimed', {last_step_started_at})`，`transition_lost` → 函数直接结束，不碰 Graph。
2. **授权记录校验**（§4.2 fail-closed 清单）失败 → `preflight_failed`。
3. **预检**（均在碰 Graph 写接口之前）：
   - `target.strict=true` 取 token、页名；品牌名（`master_briefs.brand_name`）缺失或页名为空 → `brand_mismatch`（D12）；
   - `publish_target.page_id === clients.facebook_page_id`，否则 `page_binding_mismatch`（客户可改 `publish_target`，FDE 绑定才可信；也保证测量隔离检查能过）；
   - `content_posts.source_video_url === attempt.source_video_url`，否则 `video_changed_since_authorization`（D7 / M4）；
   - 副本 HEAD：`content-length` 与授权时一致、`content-type` 为 `video/*`；
   - 红线再扫一遍锁定正文与首评；
   - **历史视频检查**（M5-5）：该帖所有历史 attempt 的非空 `video_id` 逐个 `getReelObjectStatus`：任一 `exists/published` 或 `exists/processing` → `prior_video_live`；任一 `error` → `prior_video_unverifiable`；`exists/not_public` 仅当该 attempt 是 `draft_published` 时允许（公开成功后由跟进删除），否则 `prior_video_unverifiable`；`absent_confirmed_once` 仅当该 attempt 已是 `not_on_facebook`/`draft_deleted` 时视为无碍，否则 `prior_video_unverifiable`；
   - 本 attempt 行已有 `video_id`（处于 `claimed` 时不应出现）→ 不上传，转 `in_doubt`（`video_id_before_upload`）。**不调用 `findExisting`**（X1）。
4. **开关**：`live = mode_requested==='live' && env CONTENT_REEL_PUBLISH_LIVE==='true' && publish_rules.live_enabled===true`（当场读，D3）；两个开关值写进回执。
5. **上传**：`facebookReelAdapter.publish({ videoUrl: 副本公开地址, caption: 锁定正文, target:{…, strict:true}, idempotencyTag: authorization_id（strict 模式下不写入正文，仅传参兼容）, draft: !live, onStarted })`。
   - **我方数据库记录的 `video_id` 是唯一可信源**：`start` 一返回 `video_id`，`onStarted(videoId)` 立刻执行 `transition(id, ['claimed'], 'uploading', {video_id, last_step_started_at})`；**返回 `transition_lost` 或数据库报错一律抛错**，适配器在 rupload 之前中止（D10 / 2-A / M5-1）。
   - 为什么这就够、不需要 FB 侧标记：Reel 只有 `finish` 之后才可能公开，而 `finish` 一定在 `onStarted` 落库成功之后；`start` 成功但落库失败/进程崩溃时，Facebook 上最多留下一个未完成上传的空容器，不会公开。
6. **阶段判定只看两件事**（D10 / M5-3）：本次调用 `onStarted` 是否执行成功、库里是否已有 `video_id`。有 → 任何异常都转 `in_doubt`；无 → `preflight_failed`（`failed_before_upload`）。不解析 Graph 报错文本。
7. **确认与回执**：finish 返回后 `getReelObjectStatus(videoId, pageId)`：
   - `exists/published` → 回执 `published`（`publish_confirmation='graph_get'`）；本次是草稿且 `exists/not_public` → `draft_published`；
   - `exists/processing` → 函数内 `step.sleep` 2/5/10 分钟再查，仍 `processing` → `in_doubt`（`processing_timeout`）；
   - 本次是公开上传却得到 `exists/not_public`、或 `absent_confirmed_once`、或 `error` → `in_doubt`。
   - 回执写入有界重试 5 次（间隔 1/2/4/8/16 秒），仍失败 → 尝试写 `in_doubt` + `receipt_write_lost`；连这也失败 → 行停在 `uploading`，由待办「卡住」兜住（§7）。
8. **status→published**：回执成功后单独调 `content_reel_mark_post_published`，失败由跟进函数第一步补做。
9. **`not_on_facebook` 只认系统 GET，且三重条件**（D10 / 2-B / M5-4 / X4）：
   - 只对**我方记录的 `video_id` 本体**查（不用 `<page>_<video>` 组合 id，组合 id 删除后返回 code 10）；
   - 每次查询必须同时满足「视频本体 `code 100 + error_subcode 33`」**和**「同一 token `GET /<page_id>?fields=id` 成功」→ 才算一次缺席证据 `absent_confirmed_once`（100/33 本身分不出已删、从未存在、无权限读，主页可读排除了「token 失效」这一类）；
   - `code 10`、`code 190`、主页探针失败、超时、网络错误 → 一律「查询失败」，保持 `in_doubt`，不清零也不累加缺席证据；
   - 第一次缺席证据只记 `absence_first_confirmed_at`、状态不变、提示「10 分钟后再点一次」；第二次仍是缺席证据、距第一次 ≥10 分钟、`last_step_started_at` 早于 30 分钟（超过单步最长执行时长，U7）才 `transition → not_on_facebook`；两次之间任何一次 `exists` → 清空 `absence_first_confirmed_at` 并按 `exists` 分类。
   - **没有人工「标记没有」按钮**。
   - 残余风险（写明接受）：若某视频对本 token 不可读但主页可读（例如对象级权限异常），仍可能被误判为缺席；两次间隔 + 30 分钟无在跑步骤 + 无 FB 侧标记可交叉确认，是当前 Graph 能给出的最强证据。重新授权后的上传前历史视频检查（第 3 步）会再查一次。
10. **草稿删除确认**：`deleteReelVideo` 返回成功后，按第 9 步同一规则取得两次间隔缺席证据才 `draft_published → draft_deleted`；中间态记在 `followup.draft_delete_results`（`deleted_pending_confirm` + 首次时间），由「重新删除草稿」按钮或下一次跟进补做第二次确认。

### 3.5 堵绕过状态机的入口（D9 / 2-D / M2）

同一实现 PR：
- `[postId]` PATCH：`confirm` 只允许从 `draft/rejected`（`.in('status', …)` 写进 UPDATE 条件）；`schedule` 对配了 `publish_target` 的客户返回 409「请用授权发布」；`reject` 只允许从 `draft/approved`，且该帖无 `authorized/claimed/uploading/in_doubt/published/draft_published` 的 attempt。
- `/api/posts/[id]` PATCH：body 含 `status` 且该帖存在任意 attempt → 409。
- `/api/posts/batch`：`updateStatus` / `delete` 命中任一有 attempt 的帖子 → 整批 409（外键 `ON DELETE RESTRICT` 在库层兜底删除）。
- `video/route.ts` 挂片本就要求 `approved`；进行中 attempt 时帖子是 `scheduled`，天然挡住。
- 以上三处进 mutation 清单（§10.2）。
- **与探针结论的关系**：这些入口防护是「数据库记录的 `video_id` 为唯一可信源」成立的前提——FB 侧没有任何可检索标记（X1），一旦帖子行或 attempt 行被绕过删改，就再也无法从 Facebook 反查「这条内容发过没有」。因此删除一律由外键 `ON DELETE RESTRICT` 在库层兜底，attempt 行没有删除路径（RPC 不提供，service_role 之外无权限）。

---

## 4. 授权（D6 / D7 / D8）

### 4.1 谁、在哪、怎么点

- **在哪**：看板出片列卡片抽屉（`?post=<id>` 深链可直达）。客户配了 `publish_target` 时显示「审核并授权发到 Facebook」表单；没配时不出现任何自动发布入口。
- **谁**：所有 `reel-publish` action 与 `import-video` 都要求 `requireDashboardClientAccess(clientId)` 通过 **且** 内部员工判据（main 上用 `guardGlobalAdmin` 的判据：`role==='admin' && !allowedClientId`；#1649 合并后换 `requireGlobalAdmin`，实现 PR 写明此依赖）。DEMO_ADMINS、scoped_admin、付费客户本人一律 403。
- **怎么点**：授权按钮点击后弹确认框，**必须输入主页名**（与服务端现查的页名逐字一致）才提交；`authorized_via='ui_click'`。
- **agent 的边界**：agent 只能准备——建卡、挂片、预填正文与首评草稿、标句子来源、生成并上传九宫格、填逐镜检查——这些写入记 `prepared_by='agent'`。**授权这一步 agent 不点**，包括不得用 PM 登录态操作浏览器点授权（v1 §8.1 那句删除）。
- **备选 `chat_go`**：PM 在对话里对「具体 post id + 正文 sha256 前 12 位」说 go 时，由一名**非 agent 的内部员工**在同一表单选「PM 已在对话里授权」，粘贴 PM 原话；服务端校验原话里的 post id 与哈希前缀与当前表单一致，记 `authorized_via='chat_go'`、`authorization.chat_go_quote`；授权人字段仍是提交的员工。

### 4.2 授权记录（写入 `authorization` jsonb，RPC 不提供修改）

```ts
interface ContentReelAuthorization {
  schema_version: 2
  authorization_id: string
  authorized_via: 'ui_click' | 'chat_go'
  chat_go_quote?: string
  authorized_by_user_id: string
  authorized_by_email: string
  authorized_at: string
  prepared_by: 'human' | 'agent'
  confirm_typed_page_name: string
  client_id: string
  content_post_id: string
  render_job_id: string | null
  target: { platform: 'facebook'; page_id: string; page_name_seen: string; brand_name_seen: string }
  mode_requested: 'draft' | 'live'
  video: { source_video_url: string; copy_path: string; copy_public_url: string; content_length: number; sha256: string }
  caption_text: string; caption_sha256: string
  first_comment: { mode: 'manual' | 'none'; text: string | null; text_sha256: string | null; landing_url: string | null; landing_reason: string | null; utm: Record<string, string> | null }
  sentence_sources: Array<{ field: 'caption' | 'first_comment' | 'onscreen'; index: number; sentence: string; source: 'website' | 'brief'; ref: string }>
  onscreen_claims: Array<{ text: string; source: 'website' | 'brief'; ref: string }>
  storyboard_check: { grid_path: string; frames: Array<{ index: number; image_ok: boolean; text_ok: boolean; logo_ok: boolean; note?: string }>; watermark_ok: boolean }
  text_checks: { language: string; cjk_found: boolean; internal_terms_hit: string[]; url_in_caption: boolean; comment_reference_in_caption: boolean; price_claims: string[] }
  redline_scan: { hits: string[]; scanned_at: string }
}
```

**授权按钮禁用条件（服务端再校验一次）**：
- 正文为空（**不许用 `title` 预填**，D8 / M12b）；
- 任一句（正文、首评、画面声明）无来源或来源为「未证实」；含价格的句子来源必须是 `website` 并附页面 URL（价格检测复用 `src/lib/content/price-claim.ts` / `price-claim-gate.ts` 的口径；「必须带 from」这类属于客户核对清单，不写进共享代码，D13）；
- `storyboard_check` 缺九宫格、任一镜三项有 false、水印未确认——**`render_job_id` 为空时强制（D8）；Creatomate 成片同样强制**（CLAUDE.md 铁律 8「对外成片交付前必先出分镜自检表」，比 D8 更严、不放宽）；
- `onscreen_claims` 为空而画面上有文字（由准备者勾「画面无文字声明」才可为空，勾选也记录）；
- 语言检查：`publish_rules.caption_language` 为英文时出现中日韩字符；命中 `clients.brand_redline_phrases`（内部简称如 Bayside 放这里，复用既有红线机制，不新建字段）；
- 首评为 `manual` 时正文出现引用评论的句子（按 `publish_rules.comment_reference_patterns` 检测，默认空则只做「正文不得含 URL」检查）；
- 落地页域名不属于 `clients.domain`（含子域名），D13；
- 红线扫描命中；页名与品牌不符或任一为空；
- 该帖有进行中渲染任务；视频复制或哈希失败。

**发布函数 fail-closed 校验**（任一不满足 → `preflight_failed`）：记录缺失、`schema_version` 不认识、`authorization_id ≠ attempt.id`、两个 sha256 重算不符、`sentence_sources` 覆盖不到全部句子（拆句规则见 §6.4）、`storyboard_check` 不完整、红线命中。

### 4.3 锁定视频（D7 / M4）

授权路由在调用 `content_reel_authorize` 之前：
1. 读 `source_video_url`（Supabase 公开地址直接读 Storage；外链走 `safeProbeRemoteFile` 同款逐跳校验下载，大小上限 1 GB）；
2. **流式**写入 `content-factory/<client>/authorized/<authorization_id>.mp4`（`upsert:false`，已存在即报错），同时计算内容 sha256；
3. 副本公开地址写进授权记录；**FB 只拉副本**；
4. RPC 失败时删除刚写的副本（副本从未被发布，删除安全）。

### 4.4 开关（D3）

- `CONTENT_REEL_PUBLISH_LIVE`：环境变量，默认未设 = 关，**全局急停**；
- `factory_config.publish_rules.live_enabled`：客户级，仅内部员工可改（`factory-config` PATCH 对该键加内部员工判据），每次改写一条审计 `publish_rules.live_enabled_audit[]`（`by_user_id / email / at / value`，保留最近 20 条）并写 `fde_work_logs`；
- 表单只有在两者都为真时才出现「正式公开」选项；
- `FACTORY_PUBLISH_LIVE` **不动**（仍为 false）。

### 4.5 草稿（D4）

- 本期**没有草稿转正**。流程：可选「发草稿验格式」（`mode_requested='draft'` → `draft_published`，卡片回出片列）→ 人审 → **新授权、以公开方式重新上传**（2026-09-07 生产已验证路径）。
- 公开 attempt 进入 `published` 后，跟进函数对该帖所有 `draft_published` 的 `video_id`：`deleteReelVideo` → 按 §3.4 第 9、10 步取得两次间隔缺席证据 → `draft_deleted`；删除报错或 10 分钟后仍非缺席 → 记 `followup.draft_delete_results` → 待办「待核对」（§7）。跟进函数内用 `step.sleep('10m')` 做第二次确认。
- 「草稿转正」登记为后续（§9），前置条件：Magic Lab 自有主页实测转正 + 带 description（F24）。

### 4.6 回执

回执就是 attempt 行本身（D1）：`id`（授权 id）、`client_id`、`content_post_id`、`render_job_id`、`trigger_event_ids`、`state`、`authorized_by_user_id`、`authorized_via`、`mode_requested`、`env_live_at_publish`、`rules_live_at_publish`（即 no_publish 依据：`video_state='DRAFT'` 即未公开）、`page_id`、`video_id`、`video_state`、`permalink`（`normalisePermalink` 补全）、`publish_confirmation`、`error_code`、`provider_impact`（`graph_write_calls`、`video_created`、`public`；费用恒 0）、`created_at`/`finished_at`。
`cron_run_logs` 只留运行历史（`job_name` 静态字面量 `factory-content-reel-publish` / `factory-content-reel-followup`，登记 `UNSCHEDULED_CRON_ROUTES`）；业务结果记 `completed` + `summary.outcome`，只有函数崩溃记 `failed`（#1692 第 5 条）。

---

## 5. 事件与测量（D2 / D11）

### 5.1 新事件 `me/factory.content_reel.published`（v1 事件一字不改）

```ts
export const FACTORY_CONTENT_REEL_PUBLISHED_EVENT = 'me/factory.content_reel.published' as const
export const FactoryContentReelPublishedEventSchema = z.object({
  schema_version: z.literal(1),
  request_id: uuidLike,                // = authorization_id（M7）
  authorization_id: uuidLike,
  content_post_id: uuidLike,
  client_id: uuidLike,
  platform: z.literal('facebook'),
  page_id: numericId,
  video_id: numericId,
  post_id: numericId,                  // = video_id
  media_type: z.literal('reel'),
  permalink: z.string().url().optional(),
  published_at: z.string().datetime(),
  status: z.literal('PUBLISHED'),
  no_publish: z.literal(false),
  authorization: z.literal('AUTHORIZED'),
  cost_usd: z.literal(0),
  created_at: z.string().datetime(),
})
```

- 只在 `state='published'` 且 `video_state='PUBLISHED'` 时由跟进函数发。
- `docs/registry/platform-candidates.md` 的 me_ad_launch 条目在**实现 PR** 里补一句：「内容 Reel 走 `me/factory.content_reel.published`，是否自动建广告待 PM 定」（不在本设计分支改登记表）。

### 5.2 测量适配器

- `factoryReelMeasurementAdapter` 的 triggers 改为数组 `[{event: FACTORY_REEL_PUBLISHED_EVENT}, {event: FACTORY_CONTENT_REEL_PUBLISHED_EVENT}]`（inngest ^3.54），按 `event.name` 分支；若实现时类型不支持数组，退为独立小函数（仍共用 `registerReelPublishAction`、`reelMeasureAt`、fan-out），并在 PR 里说明函数数变化。
- 内容 Reel 分支：
  - 隔离检查同原逻辑；
  - `rebindContentReelAction`：`flywheel_actions` where `action_type='factory_reel_publish'` and `client_id` and `payload->>content_post_id` and `payload->>video_id` and `payload->>authorization_id` and `payload->>video_state='PUBLISHED'`（D11 / M6），再核 page、published_at；
  - 幂等键 `factory-content-reel:<post>:<video>`；`payload.source` 仍 `'factory_reel'`。
- 工单线分支代码路径不变，既有测试零改动。
- 删掉 v1 的 `own_comment_count`（D14）。
- **组合 id 的已知行为（X4）**：测量消费者读互动数用 `<page>_<video>` 组合 id；Reel 若在 T+4/T+72 之前被删，Graph 返回 `code 10` 而不是 100/33。现有消费者把它当 `graph_error` 有界重试后写 `retries_exhausted` 回执，本期**不改**消费者，只在「成绩回收」相关说明里不把 code 10 解释为「帖子已删」；存在性判断一律回到 §3.4 第 9 步（`video_id` 本体 + 主页可读 + 两次确认）。

### 5.3 跟进函数 `cloud-factory-content-reel-followup`（`retries: 3`，`onFailure` 写 `followup.last_error` + 运行记录）

触发：`me/factory.content_reel.publish_recorded`（发布函数在 `published` 回执后 `step.sendEvent`，仅 PUBLISHED）。步骤全部幂等：
1. 读 attempt，要求 `state='published'`；
2. `content_reel_mark_post_published`（已是 published 则无操作）；
3. 三本账：`flywheel_actions` 按 `(content_post_id, video_id, video_state='PUBLISHED')` 查重后插入（失败抛出重试，**不**吞掉继续发事件）；`execution_items` 仅当 `content_posts.execution_item_id` 为空时插（D10 / 子牙建议）；`fde_work_logs` 尽力；`vendor='meta_graph'`；
4. 发 `me/factory.content_reel.published`，事件 id 写回 `followup.published_event_ids`；
5. 删草稿（§4.5）；
6. `step.sleep('10m')` 后查 `flywheel_actions` 是否有 `social.publish_post` + `idempotency_key=factory-content-reel:<post>:<video>`，结果写 `followup.measurement_registered`（供待办判据参考，待办仍以实时查询为准）。

发布函数发 `publish_recorded` 失败：attempt 已是 `published`，由 `factory-publish-worker` cron 新增的独立 try `reconcileContentReelFollowups()` 兜：`published` 超 15 分钟且 `followup.published_event_ids` 为空 → 用 `…:r<n>` 新 id 重发（一轮上限 10 条）。`authorized` 未领不自动重发，交待办（§7），避免后台悄悄反复触发发布。

---

## 6. 文案、落地页、首评（D5 / D13）

### 6.1 正文与首评谁写

- 正文：**人填**（准备者可以是 agent，`prepared_by` 如实记录），不用 `title` 预填，不接 LLM。
- 首评：`publish_rules.first_comment_template` 填入落地页后得到草稿，可改前缀句，URL 只读。
- 发布与首评都用授权记录里的锁定文本。

### 6.2 客户配置 `factory_config.publish_rules`（`FactoryConfigPanel` 同 PR 补表单，铁律 8）

```jsonc
{
  "live_enabled": false,                               // 仅内部员工可改，带审计（§4.4）
  "caption_language": "en",                            // 触发中日韩字符检查
  "cta_placement": "first_comment",                    // 'first_comment' | 'none'
  "caption_cta_line_auto_comment": null,               // 自动首评可用时的正文引导句（本期不会用到）
  "caption_cta_line_manual": "",                       // 首评为人工时的正文引导句，不得引用评论；可为空
  "comment_reference_patterns": ["in the comments", "in comments"],  // 客户自己声明哪些句式算「引用评论」
  "first_comment_template": "👉 {landing_url}",
  "default_landing_url": "https://www.example.com/list",
  "landing_urls": { "<offer_key>": "https://www.example.com/tour-a" },
  "utm": { "source": "facebook", "medium": "organic_social", "campaign": "default-campaign" },
  "utm_campaign_by_offer": { "<offer_key>": "campaign-a" }
}
```

- 共享代码只认键名与占位符，不含任何客户值；`publish_rules` 缺失 → 表单禁用并指向设置页。
- 落地页：帖子有 `offer_key` 且 `landing_urls[offer_key]` 有值 → 候选之一；`default_landing_url` → 候选之一；人选并填 `landing_reason`。**不再依赖 `verified_cta` 或 `render.creatomate.offers`**（D13 / 6-A）。
- 域名必须属于 `clients.domain`。
- `utm_campaign`：单条表单覆盖 > `utm_campaign_by_offer` > `utm.campaign`。
- `utm_content`：默认 `reel_<post 前 8 位>`，可改；同客户重复**只提示**不拦（D14）。

### 6.3 首评本期人工 + 只读核验（D5 / 子牙 4 / M10）

- 首评方式本期固定为 `manual`（有 `first_comment.text`）或 `none`（`cta_placement='none'`）。自动首评函数、`postPageComment`、`findOwnComment` 全部删除。
- `manual` 时：正文禁止命中 `comment_reference_patterns`；引导句只能来自 `caption_cta_line_manual`（可为空），不写死任何语言。
- 公开成功即出首评待办（§7）；人用主页身份在 Reel 下粘贴锁定原文后，点「首评已发·核验」→ 同步路由 `GET /<page_id>_<video_id>/comments?fields=from,message&filter=stream&limit=100`：
  - 找到 `from.id === page_id` 且 message 含完整 `landing_url` → `verified`（`basis='from_and_url'`）；
  - 若 Graph 不返回 `from`（权限不足，子牙未证实 5）：message 含完整 `landing_url`（带唯一 `utm_content`）即 `verified`（`basis='url_only'`，回执写明降级）；
  - 没找到 → 保持 `pending`，抽屉显示「没找到这条评论，确认是用主页身份发的、链接完整」；查询报错（含 `code 10`，X4：组合 id 对象不可读/已删时返回它）→ 保持 `pending` 并显示原因码，**不据此推断 Reel 已删**。

### 6.4 拆句规则（魏征建议 9）

按换行拆行；每行再按 `. ! ?` + 空格拆句；纯 emoji 行、纯 hashtag 行不算句子（但 hashtag 也要过红线与语言检查）；URL 所在行整行算一句，来源为落地页本身（`ref` = 该 URL）。规则实现为一个纯函数，UI 与服务端共用。

### 6.5 自动首评需要 PM 的业务动作（不阻塞本期）

1. 在 ME 的 Meta 应用里申请 `pages_manage_engagement`（是否需要 Meta App Review：**未证实**）；
2. 通过后把它加进 `META_PAGE_SCOPES`；
3. 各客户在设置页重新点「连接 Meta」；
4. 再开一期实现自动首评（带发前查重、失败回落人工待办）。
在第 1–3 步完成前，任何待办文案不得写「重新连接即可自动发首评」。

---

## 7. 今日待办（D14 合并为 4 种；D11 规则）

新文件 `src/lib/pm-todo/content-reel-items.ts`，拉模式查 `content_reel_publish_attempts`（分页读全、稳定排序、读失败抛出不返回空数组），接进 `loadManualItems` 独立 `.catch`。**未解决的问题不按天数过期，只随状态变化消失**；同一 attempt 同一 kind 只出一条。href 统一为卡片深链 `https://app.magicengine.com.au/dashboard/clients/<client_id>/content-factory?post=<content_post_id>`（F31：同 PR 补深链），除非另注。how 里出现的按钮名由 UI 文案常量导入，测试逐字比对。

| kind | 判据 | what | how | href |
|---|---|---|---|---|
| `content_reel_publish_blocked` | `state='preflight_failed'` 且该帖之后没有更新的 attempt | 「{客户} 的视频《{标题}》没有发出去（{原因人话}）。Facebook 上什么都没发生，卡片已回到出片列」 | 按原因码：`brand_mismatch` → ①打开链接（客户概览页）→「Brief」面板 → 把「品牌名」改成与 Facebook 主页名一致（或确认主页选错）；②回卡片重新点「审核并授权发到 Facebook」。`page_binding_mismatch` → ①打开链接 → 设置页「Facebook 主页」绑定区，选对主页并保存；②回卡片重新授权。`no_page_token`/`graph_permission` → ①设置页「平台连接」点「连接 Meta」，用能管理该主页的账号授权；②回卡片重新授权。`video_changed_since_authorization`/`prior_video_live`/`redline_hit`/授权记录类 → 打开卡片，按抽屉里显示的具体问题换片或改文案后重新授权 | 按原因码：客户概览页 / 设置页 / 卡片深链 |
| `content_reel_publish_in_doubt` | `state='in_doubt'`；或 `state in (claimed, uploading)` 且 `updated_at` 早于 30 分钟；或 `state='authorized'` 早于 30 分钟；或 `followup.draft_delete_results` 有失败 | 按子情形：「上传到一半出错 / 流程卡住 / 授权后一直没开始 / 验格式的草稿没删掉」+「系统不会自动重发，以免同一条片发两次」 | 出错/卡住：①打开卡片点「重新核对 Facebook」；②显示「已发布」或「草稿在后台」→ 待办自动消失；③显示「Facebook 上暂未找到，10 分钟后请再核对一次」→ 10 分钟后再点一次；④两次都确认没有 → 卡片回到出片列，点「审核并授权发到 Facebook」重新发。授权后没开始：点「重新发起发布」（系统会先确认没有别的发布在跑）。草稿没删：点「重新删除草稿」 | 卡片深链 |
| `content_reel_first_comment_pending` | `state='published'` 且 `first_comment_state='pending'` 且有首评文本 | 「{客户} 的 Reel《{标题}》已经公开了，但带链接的第一条评论还没发——看视频的人找不到链接」 | ①打开链接（这条 Reel）；②右上角切换成 {主页名} 主页身份；③在 Reel 下发评论，内容整段复制：`{锁定首评原文}`；④回卡片点「首评已发·核验」，核验通过待办消失 | Reel 绝对 permalink |
| `content_reel_measurement_not_started` | `state='published'`、`published_at` 早于 30 分钟，且 `flywheel_actions` 不存在 `action_type='social.publish_post' AND payload->>idempotency_key='factory-content-reel:<post>:<video>'`（D11 / 3-B） | 「{客户} 的 Reel《{标题}》已公开，但成绩回收没有启动——4 小时和 3 天后的点赞、评论不会被记下来」 | ①打开卡片点「重新启动成绩回收」（每次点击都是新的触发，重复点击由数据库挡住不会重复记）；②10 分钟后刷新，显示「成绩回收中」即完成；③点过 2 次仍在 → 先到设置页「Facebook 主页」确认绑定的主页就是发布这条 Reel 的主页，改对后再点一次；④绑定无误仍不行 → 这条待办会保留并显示系统诊断码，属于系统缺陷，无需再手动操作 | 卡片深链 |

---

## 8. CTS 现成 5 条 mp4（D6 / D8）

文件：`content-factory` bucket `cts-reels/goldenchina-ads-20260908-v2/{gc_grandtour,gc_beijing,gc_xian,gc_shanghai,gc_food}.mp4`。

### 8.1 路径（与 Creatomate 成片同一出口）

1. **建卡片**：看板「用已有成片新建」→ `import-video`（内部员工）body `{ title, source_link, offer_key? }`：规范化 `source_link` 后插入 `content_posts`（`status='approved'`、`format='reel'`、`ratio='9:16'`、`platforms=['facebook']`、`route='route_a'`、`source='manual_import'`、快照 `import_source_url`、`offer_key`）；唯一索引冲突 → 返回已有卡片（幂等，D8）。不排渲染（P5：CTS 是 creatomate，从 draft 确认会花钱）。
2. **挂片**：卡片在备料列 → 现成「粘视频链接」（`video/route.ts` `link`）粘同一地址 → 出片列。
3. **准备**（可由 agent，记 `prepared_by='agent'`）：九宫格截图上传、逐镜三项检查、画面声明与出处、英文正文、首评、逐句来源。
4. **授权**：只由内部员工本人在界面点击并输入主页名（或 `chat_go`，§4.1）。首条选草稿验格式 → PM 看过 → 新授权选公开。

### 8.2 核对依据

官网团页 `https://www.ctstours.co.nz/tours/china/discovery/golden-china`（2026-09-15 抓取）：*China Discovery — Golden China*、12 Days、**From NZD $4,999 per person**（另 NZD $690 单人房差）、16–27 November 2026、Auckland → Shanghai → Beijing → Xi'an → Shanghai → Auckland。

| 文件 | 标题（内部，**不进正文**） | 落地页候选 | 授权前必须补的证据 |
|---|---|---|---|
| gc_grandtour | Golden China 总览 | `landing_urls.golden_china`（团页） | 九宫格逐镜城市属于线路四城；片尾价格句是否带 From |
| gc_beijing / gc_xian / gc_shanghai | 各城篇 | 画面全是该城且片尾卖 Golden China → 团页；混入线路外城市 → `default_landing_url`（列表页） | 同上 |
| gc_food | 美食篇 | 逐镜证明不了食物出自线路城市 → 列表页 | 逐镜核对 |

以上落地页判断是 CTS 客户规则（memory），只以配置 + 人选 + `landing_reason` 表达。受众为主流英语系新西兰人，正文 NZ 英语。

---

## 9. 范围外（实现 PR 合并时登记 ROADMAP，本分支不改 ROADMAP）

1. 自动首评（§6.5 业务动作完成后另开一期）
2. 草稿转正（需自有主页先实测 + 带 description）
3. Tune 读 Reel 回执（含首评对评论数的影响）
4. 广告归因 `creative-link.ts` 认内容 Reel；me_ad_launch 消费内容 Reel 事件（待 PM 定）
5. 审片记理由 / 打回重做流程
6. Instagram、排期发布、撤回/删帖按钮
7. LLM 起草正文
8. 讲课片线「sending 超 20 分钟自动重发」（A 级 backlog）
9. 工单线 `writeThreeBooks` 默认 `vendor='oztop_facebook'`
10. 工单线中断待核对不进待办；`creatomate_render_failed` 待办 how 不可执行；**工单线与讲课片线的 `findExisting` 防重对账实际失效**（X1，协调方另开 issue，本期不改那两条线）
11. `expect_brand` 编辑入口（本期新线不用它，how 指向 Brief 品牌名）
12. Reel 草稿长期未处理的低优先级提醒（草稿是否会被 Meta 清理未证实）

---

## 10. 测试、探针与上线

### 10.1 上线前只读探针（D16，协调方 2026-09-15 已执行，结果见 §1.3）

| # | 探针 | 实测结论 | 设计采用 |
|---|---|---|---|
| X1 | 已公开 Reel 的 `description` 是否保留零宽标记 | **不成立**：比特位被剥，只剩 U+2063 锚点 | 全面放弃零宽标记与 `findExisting`；唯一可信源 = 数据库 `video_id`（`onStarted` 落库失败抛错中止）；核对只用 `GET /<video_id>`；strict 模式不再往正文写标记；**不采用可见文本标记**（污染对外文案、客户可在后台抹掉、收益被 §3.4 第 5 步覆盖） |
| X2 | `video_reels` 列表字段、是否含 DRAFT | 字段已知（`published`、`status.publishing_phase.publish_status`、`status.video_status`、`uploading_phase`/`processing_phase`）；**无草稿样本，是否含 DRAFT 未证实** | 分类只用单个 `GET /<video_id>` 的同名字段；草稿一律归入 `not_public`，不依赖列表，也不依赖草稿的具体 `publish_status` 取值 |
| X4 | 不存在/已删对象的返回形状 | 视频/照片本体：已删与从未存在都是 `100/33`；组合 id：`code 10` | §3.4 第 9 步：本体 GET + 主页可读探针 + 间隔两次；`code 10` 当查询失败 |
| X4′（剩余） | 草稿对象、处理中对象的 `GET /<video_id>` 实际字段值 | 未取到样本 | **降级**：①草稿上传读回 `exists` 即记 `draft_published`（不依赖草稿字段取值）；②公开上传只在 `publish_status==='published' && published===true` 时自动记 `published`；读回缺这两个字段时进 `in_doubt`，抽屉出现「我已在主页上看到这条公开」按钮（仅内部员工，**只能推向 `published`，永远不能推向 `not_on_facebook`**——这个方向不会造成重复发帖），点击时服务端仍须读到 `exists`，回执记 `publish_confirmation='human_confirmed'` + 确认人 id；首条草稿（§10.4 第 4 步）读回的真实字段存为测试 fixture |

### 10.2 测试（A 级，D15）

- **本机 PG 沙盘真跑**（memory `reference-local-postgres-replay-sandbox`，先造 Supabase 角色/桩）：全部 migration 顺序执行通过；部分唯一索引并发插入只成功一个；`content_reel_authorize` 两个会话并发只成功一个；迁移表每条合法/非法迁移；终态回退抛异常；`video_id` 二次写不同值抛异常；`preflight_failed` 同事务把帖子退回 `approved`；`not_on_facebook` 时间条件；`ON DELETE RESTRICT` 阻止删帖；`anon`/`authenticated` 调 RPC 被拒、`service_role` 可调；`search_path` 设置生效。
- **单元/集成**（fake supabase 按表建模，假 Graph 用 §1.3 实测返回存 fixture：已公开 Reel 的 `status`/`published` 字段、100/33 错误体、组合 id 的 code 10 错误体；草稿字段待首条草稿实测后补）：
  - 授权：非内部员工 403（DEMO_ADMINS、scoped_admin、client-viewer 各一例）；主页名输错拒；正文空/含 CJK/命中内部简称/引用评论（manual）/含 URL；来源缺失；九宫格缺镜；落地页域名不符；有渲染任务；同哈希 30 天内已公开；副本已存在（upsert:false）。
  - 发布函数：`transition_lost` 不调 Graph；`onStarted` 数据库失败 → 抛错且 rupload/finish 调用次数 0；无 video_id 前失败 → `preflight_failed`；有 video_id 后任意失败 → `in_doubt` 且 start 只调一次；全流程**零次**读取 description 或调用 `findExisting`；strict 模式正文不含 U+2063/U+200B/U+200C；历史视频 `published`/`error` → 拦；三开关八种组合只有全真为 PUBLISHED；strict 模式不回退 system token、品牌或页名为空拒；上传用副本地址；`source_video_url` 变 → 拦；GET 确认才写 `published`；回执写入重试 5 次后 `receipt_write_lost`。
  - 核对路由：100/33 但主页探针失败 → 不算缺席；code 10 / 190 / 超时 → 不算缺席、保持 `in_doubt`；首次缺席只记时间；10 分钟内第二次不迁移；两次之间出现 `exists` 清零；满足全部条件才 `not_on_facebook`；查询一律用 `video_id` 本体不用组合 id；`publish_status`/`published`/`video_status` 映射；`confirm_seen_published` 读不到 `exists` 拒、永不推向 `not_on_facebook`。
  - 跟进：仅 PUBLISHED 触发；三本账重跑不重复；`flywheel_actions` 失败不发事件；已有 `execution_item_id` 不插；草稿删除后未取得两次缺席证据记失败；重启事件 id 带 `r<n>`。
  - 测量：工单线 v1 既有测试零改动通过；内容 Reel 事件重绑缺 `authorization_id`/`video_state` 条件任一不命中；幂等键格式。
  - 首评核验：`from_and_url` / `url_only` / 未找到 / 报错。
  - 待办：4 种判据、未解决不过期、状态变化消失、`authorized` 超 30 分钟出现、判据按 `social.publish_post` 行、按钮文案逐字一致、href 绝对。
  - 状态机补丁：`confirm` 从 scheduled/published 拒；`schedule` 对有发布目标客户拒；`/api/posts/[id]` 改 status 拒；batch 改状态/删除拒。
  - 深链 `?post=` 打开抽屉（组件测试）。
  - Inngest 配置读实际 opts：发布 `retries===0`、跟进 `retries===3` 且有 `onFailure`、发布 `concurrency` 按 `client_id` limit 1；`cloudFunctions` +2；`UNSCHEDULED_CRON_ROUTES` +2。
- **Mutation 清单**（冻结 head 跑一次，探针先断言锚点命中）：
  1. `onStarted` 吞掉 `transition_lost`/数据库错误
  2. 缺席判定去掉主页可读探针（100/33 直接当已删）
  2b. `code 10` 当作缺席证据
  2c. 恢复用零宽标记/`findExisting` 判定已发（测试断言 Graph fake 的 description 读取次数为 0）
  3. `confirm` 放宽为任意状态
  4. batch `updateStatus`/`delete` 放行有 attempt 的帖子
  5. `/api/posts/[id]` 放行 status 修改
  6. 授权/重试/跟进/重启事件 id 去掉序号或授权 id
  7. 首评 manual 时放行正文引用评论
  8. 部分唯一索引去掉 `in_doubt`
  9. RPC 迁移表允许终态回退
  10. `not_on_facebook` 去掉两次间隔确认
  11. 开关判断去掉 `CONTENT_REEL_PUBLISH_LIVE` 或 `live_enabled` 任一
  12. strict 模式恢复 system token 回退 / 品牌空放行
  13. 上传改用 `source_video_url` 而非副本
  14. 同哈希 30 天检查删除
  15. 历史 video_id 检查删除
  16. 跟进在 DRAFT 也触发
  17. 测量待办判据改回「事件已发出」
  18. 内部员工判据退回 `role==='admin'`
  19. `storyboard_check` 校验删除
  20. 待办查询读失败返回 `[]`

### 10.3 审查

本 v2 → 子牙 + 魏征复核改动部分（#964 第二轮）。实施后：子牙 + 魏征再审；**狄仁杰**攻击验证（伪造授权事件、跨客户 post、非内部员工调用、绕过入口改状态、RPC 以 anon 调用、副本路径覆盖）。

### 10.4 上线步骤（每个撤不回的动作 PM 显式 go）

0. X1/X2/X4 已由协调方跑完（§1.3），实现按 §10.1「设计采用」列执行；首条草稿读回的字段存 fixture 并确认 X4′ 走哪条分支。
1. 实现 PR 就绪 → **PM go apply migration**（单独一次 go）→ 用 `schema_migrations` 查版本号确认真的在。
2. **PM go merge** → 等 Render 部署 Live → `curl -sS -X PUT https://app.magicengine.com.au/api/inngest`，要求 `modified:true` 且 `GET /api/inngest` 的 `function_count` = 部署前 + 2（测量适配器改 triggers 数组不增数；若退为独立函数则 +3）。
3. 内部员工在设置页填 CTS `publish_rules`（`live_enabled` 保持 false）。
4. 建 `gc_grandtour` 卡片 → 准备 → 内部员工授权**草稿** → 验：主页后台有草稿、attempt `draft_published`、卡片回出片列、没有跟进/测量/首评待办。
5. PM 看草稿后 **go live**：Render 设 `CONTENT_REEL_PUBLISH_LIVE=true`（PM go）+ 设置页把 CTS `live_enabled` 改 true（内部员工，留审计）。
6. 新授权选**公开** → 验：主页公开 Reel、attempt `published`（`publish_confirmation` 值）、`content_posts.status='published'`、`flywheel_actions` 一行 `factory_reel_publish` + 一行 `social.publish_post`（`factory-content-reel:<post>:<video>`）、两条 `daily_plan.post.measure_due`、草稿 attempt `draft_deleted`、首评待办出现 → 人发首评 → 核验通过消失。
7. 首发后建日历提醒（hello@magicengine.cloud，Pacific/Auckland）：+4 小时后的上午 9 点、+3 天上午 9 点各一条，描述写清查 `social_post_measurement_receipts` 两个窗口、reactions/comments 有数、shares `omitted_unverified` 正常、没有行先看待办 `content_reel_measurement_not_started`。另：CTS Meta 授权 2026-11-02 到期，10-30 之后发的 Reel T+72 会撞过期，需建一条到期前提醒（魏征建议 8，交协调方）。
8. 首条跑满 T+72 无残留待办后，其余 4 条逐条准备、逐条授权。

---

## 11. Reuse Statement

- **复用**：`facebookReelAdapter.publish`（上传路径）、`assertBrandMatches`、`normalisePermalink`、`scanRedlineHits` / `scanPublishCaption`、`validateVideoUrl`、`writeThreeBooks`、`factoryReelMeasurementAdapter` 登记与 fan-out、`daily_plan.post.measure_due` 消费者与回执表、`video/route.ts` 挂片、`safeProbeRemoteFile`、`hasActiveRenderJob` 判据、`guardGlobalAdmin` 判据、`clients.brand_redline_phrases`、`price-claim` 口径、`clients.domain`、`clients.facebook_page_id` 绑定、`loadManualItems`、`FactoryConfigPanel`、`cron_run_logs` 运行历史、SECURITY DEFINER RPC 仓库惯例。
- **platform-shared 新增**：内容 Reel 发布 attempt 表与 RPC 状态机、授权记录与门槛、视频锁定副本、`publish_rules` 配置契约、`me/factory.content_reel.published` 事件、适配器 strict/三态查询/对象状态/删除四个加法、4 种待办、`import-video`、首评人工核验路由。
- **industry-specific**：无。
- **client-specific**：CTS `publish_rules`（落地页、UTM、引导句、引用评论句式、语言）、`brand_redline_phrases` 里的内部简称、5 条成片的准备内容；全部为配置或内容行。
- **客户事实进 shared runtime**：没有。换 Oztop 或悉尼地产客户只改 `publish_rules` / `domain` / 绑定；v1 依赖旅游形状的 `verified_cta.departure` 与 `render.creatomate.offers` 已移除（6-A）。
- **学习沉淀**：①「整列读-改-写 jsonb 的共享列不能承载需要锁的状态」；②「以主页身份发评论需 `pages_manage_engagement`，ME 当前不申请」（P3 已核实，可写 memory）。
- **tier-gate 对账**：决策时 = 既有发布能力延伸 + L3 Meta Connector 复用；v2 落点一致，未新增能力目录；首评 Connector 扩展推迟（与子牙意见一致）。

---

## 12. 仍未证实

| # | 假设 | 验证 |
|---|---|---|
| U1 | ~~X1 零宽标记保留~~ **已证伪**（§1.3），设计已不依赖 | — |
| U2 | `video_reels` 列表是否含 DRAFT | 首条草稿上传后只读 GET 列表（设计不依赖） |
| U2b | 草稿对象的 `status.publishing_phase.publish_status` / `published` 取值；处理中对象的字段值 | 首条草稿上传后只读 GET（§10.1 X4′ 已给降级） |
| U3 | 对「token 可读主页但对单个视频无权限」这种情况，100/33 的出现频率（决定 §3.4 第 9 步残余风险大小） | 生产观察；目前无样本 |
| U4 | Graph 评论读取返回 `from` | 首条公开后核验时实测（已给 `url_only` 降级） |
| U5 | 操作人个人号在 CTS 主页有角色、能切换成主页身份发评论 | 首发时真人确认 |
| U6 | `pages_manage_engagement` 是否需 Meta App Review | 查应用后台（PM 业务项） |
| U7 | Render 上单个 Inngest step 最长执行时长；`retries:0` 下 SDK 超时会否重投；超时后原进程是否继续 | 文档 + 实测；§3.4 的 30 分钟下限据此调整 |
| U8 | Creatomate 成片/大文件 rupload 拉副本耗时 | 首条草稿实测 |
| U9 | 授权路由流式复制 + 哈希在 300 秒内完成（1 GB 上限是否合适） | 5 条 mp4 实测大小后定 |
| U10 | inngest ^3.54 `createFunction` triggers 数组的类型支持 | 实现时编译验证（已给退路） |
| U11 | 数据库里有没有别的对象在同事务多次改 `content_posts`（影响不大：v2 已不用 `updated_at` 乐观锁） | 只读查 `pg_trigger` |
| U12 | 5 条片尾是否写「From NZD $4,999」、画面城市是否都在线路内 | 分镜自检 |
| U13 | 带链接的评论是否被 Facebook 限流或隐藏 | 首发后观察 |
| U14 | 客户概览页「Brief」面板与设置页「Facebook 主页」绑定区的准确 URL/锚点 | 实现时读页面路由，待办 href 用真实地址 |

---

## 13. 复审意见 → v2 对照

### 13.1 子牙阻断 1–11

| # | 意见 | v2 落点 |
|---|---|---|
| 1 | 授权角色太宽（1-A） | §4.1：所有 action 与 import-video 要内部员工（`guardGlobalAdmin` 判据，#1649 后换）；比子牙「只正式公开用 global admin」更严（D6） |
| 2 | 缺品牌名/页名放行（1-B）；token 回退 | §2.1 `strict` 模式、§3.4 预检 `brand_mismatch`、不回退 system token（D12）；另加 `page_binding_mismatch` |
| 3 | `onStarted` 落锁无条件（2-A） | §3.4 第 5 步：`transition(['claimed']→'uploading')`，失败抛错中止 |
| 4 | 人工标「没有」致双发（2-B） | §3.4 第 9 步：只认 `video_id` 本体 GET 100/33 + 同 token 主页可读 + 间隔两次 + 无在跑步骤；code 10 当查询失败；删除人工标记按钮（X4 实测后加严） |
| 5 | 补发同 id 被吞；authorized 无待办（2-C） | §3.3 事件 id 加 `r<n>`；§7 authorized 超 30 分钟并入待核对 |
| 6 | 其他入口绕过状态机（2-D） | §3.5 三个入口 + 外键 RESTRICT |
| 7 | 另起事件名（3-A） | §5.1 `me/factory.content_reel.published`；registry 补句放实现 PR |
| 8 | 成绩回收待办判错（3-B） | §7 判据改 `social.publish_post` 行是否存在 |
| 9 | 草稿三本账/跟进 id（3-C） | §5.3 跟进只在 PUBLISHED；草稿只写 attempt 行 |
| 10 | 共用全局开关串线；转正兜底（5-A/5-B） | §4.4 独立开关 + 客户级开关；§1.2 F3′ 更正；§4.5 本期不转正，改重新公开上传 |
| 11 | 落地页配置依赖旅游字段（6-A）；首评人工 + 核验（4-A） | §6.2 `publish_rules.default_landing_url/landing_urls`；§6.3 人工 + 只读核验；删「重连保留勾选」 |
| 建议 | 函数 2 个、核对同步、helper 只加 export、回执与 status 分写、已有执行项不插、渲染中不许授权、原始字符串锁、删 own_comment_count/resend/§3.6、utm.campaign 覆盖、去「报名」、价格复用 gate、待办 4 种、utm_content 降提示 | §2.1、§3.2③、§5.3、§4.2、§5.2、§6.2、§7 均已落；「原始字符串乐观锁」因改用独立表 + 行锁 RPC 不再需要；§3.6 加表方案改为默认方案（D1 否决了子牙「删加表方案」的建议） |

### 13.2 魏征必修 M1–M13

| # | 意见 | v2 落点 |
|---|---|---|
| M1 | 状态不能与他人共用 jsonb 列 | §3.1 独立表 + 部分唯一索引 + RPC 迁移表 + 终态不回退 + 历史 video_id 检查（D1） |
| M2 | confirm / batch / schedule 绕过 | §3.5（D9） |
| M3 | preflight_failed 后换不了片 | §3.2② 同事务退回 approved |
| M4 | 视频与授权一致 | §4.3 不可覆盖副本 + 内容 sha256 + FB 只拉副本 + source 未变检查 + 渲染中不许授权（D7） |
| M5-1 | onStarted 失败必须抛 | §3.4 第 5 步 |
| M5-2 | findExisting 三态 | 协调方 X1 实测后**被取代**：`findExisting` 整体不用（零宽标记被剥），唯一可信源为数据库 `video_id`；Graph 查询三态化落在 `getReelObjectStatus`（`exists` / `absent_confirmed_once` / `error`），§2.1、§3.4 第 3/7/9 步 |
| M5-3 | 阶段只看 video_id/onStarted | §3.4 第 6 步 |
| M5-4 | not_on_facebook 前提 | §3.4 第 9 步、§3.2② SQL 时间条件 |
| M5-5 | 历史 attempt video_id 全查 | §3.4 第 3 步 |
| M6 | 草稿与转正共用跟进 id | 本期无转正（§4.5）；跟进 id 含授权 id、仅 PUBLISHED；重绑加 `video_state`/`client_id`/`authorization_id`（§3.3、§5.2） |
| M7 | v2 request_id 非 uuid | §5.1 `request_id = authorization_id`；回执另用 `trigger_event_ids` |
| M8 | 不许复用全局开关 | §4.4 `CONTENT_REEL_PUBLISH_LIVE` + `live_enabled`（D3） |
| M9 | 转正漏正文、无出路 | 本期删除转正（§4.5，D4）；登记后续（§9-2） |
| M10 | 首评权限与误导正文、按钮不核验 | §6.3 manual 时禁引用评论、引导句来自配置、只读核验；§6.5 业务动作；「自动补救改正文」随自动首评推迟（D5） |
| M11 | 待办不可做 / 过期 / 漏 authorized / 深链 / brand_mismatch how | §7：新事件 id、无人工标记、authorized 并入、不过期、深链同 PR、brand_mismatch 指向 Brief 品牌名（D11 二选一取「how 改指 master brief」） |
| M12a | 分镜与画面声明进门槛 | §4.2 `storyboard_check` + `onscreen_claims`（Creatomate 成片同样强制，依铁律 8） |
| M12b | title 预填中文进正文 | §4.2 / §6.1 正文必须人填 + 语言与内部简称检查 |
| M12c | agent 代点授权 | §4.1 agent 只准备，授权人工点击 + 输入主页名，或 `chat_go` |
| M12d | import 不防重复 | §3.1 导入唯一索引 + §3.2① 同哈希 30 天检查 |
| M13 | 权限函数用错 | §4.1（D6） |
| 建议 1–10 | 原始字符串锁、回执有界重试、GET 确认才 published、上传未完成分类、落地页域名与理由、重绑加条件、长期草稿提醒、授权到期提醒、拆句规则、import 字段核对 | 1：改用行锁 RPC 不再需要；2/3：§3.4 第 7 步；4：并入 X4 探针结果（`processing` 分类），无 video_id 前的失败直接可重新授权；5：§4.2、§6.2；6：§5.2；7：§9-12；8：§10.4 第 7 步交协调方；9：§6.4；10：§12 未列——`format/ratio/source/route` 已由仓库 migration 与既有 `generate`/Launch Hub 写入路径证实存在（`20260528000001`、`20260617000001`、`generate/route.ts:38-47`），实现前仍做一次只读确认 |

### 13.3 协调方探针补充 → v2 落点

| 实测 | v2 落点 |
|---|---|
| X1 零宽标记被剥 | §1.3、§2.1（strict 不写标记、不用 `findExisting`）、§3.3（放弃 FB 侧标记的取舍）、§3.4 第 3/5 步（数据库 `video_id` 唯一可信源）、§3.5（入口防护是该前提）、§9-10、§10.1、§10.2 mutation 2c |
| X2 列表字段 / 无草稿样本 | §2.1 `getReelObjectStatus` 字段映射、§10.1、§12 U2/U2b |
| X4 100/33 不可区分 / 组合 id code 10 | §2.1 只用本体 id、§3.4 第 9/10 步（主页可读探针 + 两次确认 + code 10 当失败）、§5.2 测量说明、§6.3 首评核验、§10.1 X4′ 降级、§10.2 测试与 mutation 2/2b |
