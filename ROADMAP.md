# Magic Engine — Roadmap

> 最后更新：2026-04-28

---

## 架构决策（已定）

1. **Supabase = 单一数据源**，Magic Engine 可独立运行，不依赖 Airtable
2. **Airtable = 可选策划工具**，通过 Sync 导入，通过 Write-back 展示结果
3. **同步方向：** Airtable → Supabase（导入）；Supabase → Airtable（写回输出）
4. **禁止双向实时同步**（避免冲突）
5. **Magic Engine UI 是主界面**，未来 Airtable 以 Embed 形式嵌入展示

---

## ✅ 已完成

### 核心引擎
- [x] 多客户管理（clients 表，per-client Airtable 配置）
- [x] 内容生成（Route A/B/C，OpenAI GPT-4o-mini）
- [x] AI 图片生成（WaveSpeed Flux-dev via Atlas Cloud）
- [x] AI 视频生成（Seedance 2.0 via Atlas Cloud）
- [x] 生成状态轮询 + Supabase Storage 存储

### Airtable 集成
- [x] pull-content：从 Airtable sync 内容到 Supabase（新/旧表双模式）
- [x] 状态过滤（`LOWER({Status}) = 'ready'`）
- [x] Image_URL 写回 Airtable
- [x] Publer_Post_ID 写回 Airtable
- [x] per-client 自定义 `airtable_content_table_id`

### Content Workbench（主操作台）
- [x] Airtable 风格表格（列：Status / Format / Platform / Date / Headline / Caption / Prompt / Hashtags / Asset）
- [x] 所有字段点击即可编辑（text / textarea / datetime / hashtags / status dropdown）
- [x] 编辑 blur 后自动保存到 Supabase + 写回 Airtable（`PATCH /api/posts/[id]`）
- [x] Generate 按钮：自动识别 Format 字段选择图片/视频 API
- [x] 生成中：每秒计时器 + 阶段提示
- [x] 生成完成：缩略图预览 + Publer 一键发布
- [x] format/ratio 字段：从 Airtable 同步，驱动图片尺寸

### Publer 集成
- [x] 账号列表、媒体上传、帖子调度
- [x] 发布时自动写回 Airtable Publer_Post_ID

### 其他
- [x] SEMrush 关键词抓取
- [x] Dashboard 侧边栏导航
- [x] Keywords 页面
- [x] Analytics 页面（基础）

---

## 🔄 近期（Next Sprint）

优先级从高到低：

### 1. Visuals — Gallery 视图切换
- 表格视图（已有）和 Gallery 视图（卡片网格）之间切换
- Gallery 展示：缩略图大图 + 状态 + Platform + 发布时间
- 工具栏加 Toggle 按钮

### 2. Workbench — 直接新建帖子
- 表格顶部加 "+ New Post" 按钮
- 直接写入 Supabase，无需 Airtable
- 使用默认字段（status=draft，client_id=当前选中）

### 3. Airtable Embed 页面
- Dashboard 增加 "Airtable" 区块（嵌入只读 embed view）
- 每个客户可配置不同的 embed URL
- 用途：Keywords、SEO Strategy、Social Calendar 策划视图

### 4. Keywords 每日同步（Cron）
- Airtable Keywords 表 → Supabase keywords 表
- 新增 `/api/airtable/sync-keywords` 路由
- Render Cron 每天 08:00 NZT 执行

---

## 📋 中期规划

### Phase 6 — 自动化调度
- [ ] 每日 Cron：自动 sync Airtable → Supabase（内容 + 关键词）
- [ ] 批量生成：一键为所有 approved 状态帖子生成图片
- [ ] 批量发布：所有已生成帖子推送到 Publer

### Phase 7 — 客户数据完整性
- [ ] 客户 Portal（client-facing view，只看自己的内容）
- [ ] Dashboard 登录验证（Supabase Auth 或简单密码）
- [ ] 内容审批流程（draft → review → approved）

### Phase 8 — Analytics & 反馈循环
- [ ] Publer Webhook 接收发布后数据（点赞、评论、触达）
- [ ] 按内容类型 / 平台 / 时间段分析互动率
- [ ] 基于高互动内容自动优化 prompt 参数

### Phase 9 — 平台扩展
- [ ] 小红书支持
- [ ] LinkedIn 支持
- [ ] TikTok 视频自动剪辑

---

## 技术债

- [ ] Content Workbench 编辑失败无错误提示（当前静默失败）
- [ ] 图片生成失败后无法手动重试（需刷新页面）
- [ ] Supabase MCP 未连接 Magic Engine 项目（需加 `glbdnayojixmexgofbsd`）
- [ ] 缺少 Supabase Row Level Security 规则
