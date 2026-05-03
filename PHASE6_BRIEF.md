# Magic Engine — Phase 6 Brief

> 日期：2026-04-28  
> 优先级顺序：P1 → P2 → P3  
> 部署分支：`master`（Render 监听 master，不是 main）

---

## P1 — VI Prompt Injection（最高优先级）

**目标：** 图片/视频生成时，自动把客户的品牌 VI 信息注入到 prompt 前缀，确保视觉一致性。

### 背景

`master_briefs` 表已有以下字段（已在 schema 中存在，无需新建列）：
- `visual_style` — 品牌视觉风格描述（如 "warm, natural, lifestyle photography"）
- `color_palette` — 主色调描述（如 "warm oranges, forest greens, earthy tones"）
- `image_preference` — 图片偏好（如 "real people, outdoor settings, authentic moments"）

### 需要修改的文件

**1. `/src/app/api/visual/image/route.ts`**

在调用 `wavespeed.ts` 生成图片之前，先查询当前 client 的 active master brief，拼接 VI prefix：

```typescript
// 伪代码逻辑
const brief = await supabaseAdmin
  .from('master_briefs')
  .select('visual_style, color_palette, image_preference')
  .eq('client_id', clientId)
  .eq('is_active', true)
  .order('version', { ascending: false })
  .limit(1)
  .single()

const viPrefix = brief ? [
  brief.visual_style,
  brief.color_palette ? `Color palette: ${brief.color_palette}` : '',
  brief.image_preference,
].filter(Boolean).join('. ') : ''

const finalPrompt = viPrefix ? `${viPrefix}. ${originalPrompt}` : originalPrompt
```

**2. `/src/app/api/visual/video/route.ts`**

同上，在调用 Seedance 前拼接 VI prefix（video prompt 前缀）。

**3. `/src/app/dashboard/clients/[id]/page.tsx`（Master Brief 编辑器）**

在 Master Brief 表单中增加「Visual Identity」区块，包含以下字段的编辑器：
- `visual_style`（textarea）
- `color_palette`（textarea）  
- `image_preference`（textarea）

区块标题：`🎨 Visual Identity`，放在现有 master brief 字段的最后面。
保存逻辑：跟随现有 master brief PATCH/PUT 一起保存，无需单独 API。

---

## P2 — 批量操作（Batch Generate + Batch Schedule）

### P2-A：批量生成图片/视频

**新建路由：** `POST /api/visual/batch-generate`

**逻辑：**
1. 接收 `{ client_id, asset_type: 'image' | 'video' }` 参数
2. 查询 `content_posts`：`client_id = ?` AND `status = 'ready'` AND 没有对应 `visual_assets`（LEFT JOIN / NOT EXISTS）
3. 对每条 post 串行触发生成（不并发，避免 Atlas Cloud 限流）
   - 图片：调用 `/api/visual/image` 内部逻辑（或直接调 wavespeed）
   - 视频：调用 `/api/visual/video` 内部逻辑（或直接调 seedance）
4. 返回 `{ triggered: number, post_ids: string[] }`

**Dashboard 入口：** 在 `dashboard/visuals/page.tsx` 工具栏加「Batch Generate」按钮，点击后弹出确认框，选择 client + asset_type，再触发。

---

### P2-B：批量发布到 Publer

**新建路由：** `POST /api/publer/batch-schedule`

**逻辑：**
1. 接收 `{ client_id, account_id, start_datetime, interval_hours }` 参数
   - `start_datetime`：第一篇从什么时间开始
   - `interval_hours`：每篇间隔多少小时（如 24 = 每天一篇）
2. 查询 `visual_assets`：`generation_status = 'ready'`，且 post 属于该 client，且尚未被发布（无 `publer_job_id` 或类似标记）
3. 串行调用 `schedulePost()`，每次 `scheduled_at` 递增 `interval_hours`
4. 写回 Airtable `Publer_Post_ID`（复用现有逻辑）
5. 返回 `{ scheduled: number, job_ids: string[] }`

**Dashboard 入口：** 在 `dashboard/visuals/page.tsx` 工具栏加「Batch Schedule」按钮，点击弹出表单（选 client、选 Publer 账号、选开始时间、设置间隔）。

---

## P3 — Gallery 视图切换

**目标：** Visuals 页面支持表格/卡片两种视图切换。

**文件：** `src/app/dashboard/visuals/page.tsx`

**实现：**
1. 工具栏右侧加两个 Toggle 按钮：`≡ Table` / `⊞ Gallery`
2. Gallery 视图：CSS Grid，4列，每格显示：
   - 大图缩略图（`storage_url`），点击可放大
   - 状态 badge（generating / ready / failed）
   - Platform tag
   - 生成时间
   - 发布到 Publer 按钮（ready 状态才显示）
3. 视图状态用 `useState`，不需要持久化
4. 移动端 Gallery 自动切为 2 列

---

## 其他待处理 Tech Debt（不阻塞 P1-P3，但请顺手修）

- **Dashboard 新建 Client 表单**：表单里有 `industry` 和 `website_url` 字段，但 `clients` 表实际没有这两列（实际列是 `domain`, `plan_tier`）。请把表单字段对齐实际 schema，去掉不存在的列，加上 `domain` 和 `plan_tier`。
- **Content Workbench 编辑失败无提示**：编辑保存失败时当前静默失败，请加 toast 或 inline error 提示。

---

## 验收标准

| 功能 | 验收方法 |
|------|---------|
| VI Prompt Injection | 在 Dashboard Visuals 生成一张图，检查 Supabase `visual_assets.prompt` 字段是否包含 VI prefix |
| Batch Generate | 点击按钮后，多条 `status=ready` 的 posts 出现对应 `visual_assets` 记录 |
| Batch Schedule | 点击后 Publer 出现多条预约帖子，时间间隔正确 |
| Gallery View | 切换按钮有效，卡片显示缩略图 + 状态 |

---

## 注意事项

- 部署分支是 `master`，所有 commit 推到 `master`
- Render URL：`https://crazycontent-27u3.onrender.com`
- Supabase 项目：`glbdnayojixmexgofbsd`（不是 ChinaTravel 的项目）
- Atlas Cloud base URL：`https://api.atlascloud.ai/api/v1`（注意是 `/api/v1` 不是 `/v1`）
- Airtable base ID：`appEqUz46L20wy3JX`
