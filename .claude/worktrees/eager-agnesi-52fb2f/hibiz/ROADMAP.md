# HiBiz — 路线图

> 最后更新：2026-04-08

## 版本规划总览

```
v0.1 (已完成)  ─── 底座 + 主链路跑通
v0.2 (已完成)  ─── 模板预设 + 商家信息 + 留资风控
v0.2.1 (已完成) ─── URL 提取管线 + Render 部署
v0.2.2 (已完成) ─── 骨架模板系统 + 表单模板 + 手动房源
v0.3 (已完成)   ─── 社媒内容营销 + 数据仪表盘
v0.4 (当前)    ─── AI 编译器升级 + 多行业扩展
v0.5 (规划中)  ─── 广告投放工具 + 高级运营
v1.0 (里程碑)  ─── 公开发布
```

### 战略方向（2026-04-08 锁定）

- **获客工作台（Workbench）**：在 App 内增加以 **战役** 为中心的里程碑、模块任务、社媒发帖表与落地页联动；**专注澳新商家**，**首期行业：房产中介**；留学移民中介垂直 **暂缓**，不阻塞工作台主线。详见 [WORKBENCH_PLAN.md](./WORKBENCH_PLAN.md)。
- **实施顺序**：优先 **建站 + 表单** 能力，通过 **封装第三方**（Plasmic/Builder/无头 CMS；Tally/Typeform/Webhook 或 Formbricks）落地，见 [WORKBENCH_PLAN.md](./WORKBENCH_PLAN.md) §0。

---

## v0.1 — 底座与主链路 [已完成]

**目标**：最小可用链路跑通

- [x] Supabase 项目初始化、Auth (Magic Link)、RLS
- [x] 项目 CRUD + 列表页
- [x] Rule-based 意图编译器 (`compiler@0.2.0-rule`)
- [x] OpenAI 文案生成 (`gpt-4o-mini`)
- [x] RenderModel 装配 + 草稿预览
- [x] 发布流程：`published_model` + 表单 `active`
- [x] 公开微站 `/site/[slug]`
- [x] 独立表单 `/forms/[public_slug]`
- [x] 匿名表单提交（Server Action）

## v0.2 — 模板预设 + 商家信息 [已完成]

**目标**：垂直行业可用性

- [x] 模板预设系统 (`template-presets.ts`, `?preset=` 快捷入口)
- [x] 商家联系信息 (`merchant_profile`)
- [x] 房产推广字段 + TradeMe 链接粘贴
- [x] 打印海报 (`/app/projects/[id]/poster`)
- [x] Hero 草稿快编
- [x] 提交记录页 (`/app/projects/[id]/leads`)
- [x] 留资风控：蜜罐字段 + `check_lead_rate_limit`

---

## v0.2.1 — URL 提取管线 + 部署 [已完成]

**目标**：TradeMe 房源自动提取 + 生产环境上线

### 提取管线（三层 fallback）

- [x] Layer 0: TradeMe Official API（OAuth 1.0a，待 production key）
- [x] Layer 1: `__NEXT_DATA__` HTML 解析（零 LLM）
- [x] Layer 2: Jina Reader Pro + OpenAI Structured Output
- [x] `extraction-layers.ts` 多层编排
- [x] `quality-gate.ts` 提取质量评分（0-100 分，good/partial/failed）
- [x] `image-proxy.ts` 图片代理到 Supabase Storage（绕防盗链）

### 部署（Render）

- [x] `render.yaml` 配置（Root Directory: `hibiz/`）
- [x] Auth callback 适配反向代理（`X-Forwarded-Host`）
- [x] Supabase URL Configuration 对齐生产域名
- [x] 环境变量配置（OPENAI_API_KEY, Supabase, Jina, NODE_OPTIONS）

### 待完成

- [ ] TradeMe production API key（等审批）
- [ ] 添加 `TRADEME_CONSUMER_KEY` / `TRADEME_CONSUMER_SECRET` 到 Render

---

## v0.2.2 — 骨架模板系统 [已完成 2026-04-06]

**目标**：预制骨架 + AI 填肉 + 手动房源管理 + 行业表单模板

**设计原则**：骨架不是新的渲染层，而是 CompiledIntent 的一组预设值，最终走现有 assembleRenderModel 管线。

### 0.2.2.1 — 类型与骨架数据（Phase 0）

- [ ] `src/types/skeleton.ts` — TemplateSkeleton、SkeletonModule、SkeletonTheme 类型
- [ ] 扩展 `RenderModuleType` — 新增 listings、testimonials、openHome、services 模块类型
- [ ] 扩展 `MerchantProfileV1` — 新增 logo_url、wechat_qr_url、whatsapp 字段
- [ ] 3 套房产骨架 JSON 定义：
  - `classic-agent` — 经典中介（深蓝配金，agent 品牌导向）
  - `property-showcase` — 房源展示（图片驱动，极简白底）
  - `bilingual-pro` — 中英双语（华人社区导向）
- [ ] `src/data/skeletons/index.ts` — 骨架索引 + 查询函数

### 0.2.2.2 — 创建流程 UI（Phase 1）

- [ ] 分步创建流程（4 步 stepper）：
  - Step 1: 选行业（大卡片，手机 1 列）
  - Step 2: 选骨架（预览卡片网格，手机 1 列）
  - Step 3: 填基本信息（姓名、公司、电话、邮箱、logo、微信QR、WhatsApp）
  - Step 4: 预览 + 微调（开关模块、换配色、改文字、换图）
- [ ] 骨架预览图制作（3 张 PNG）
- [ ] 手动房源管理 UI：
  - 房源卡片列表（名称、地址、图片、介绍、TradeMe 链接）
  - 新增/编辑/删除房源
  - 图片上传到 Supabase Storage
  - 可选填写 TradeMe 链接（跳转而非同步）

### 0.2.2.3 — AI 填充引擎（Phase 2）

- [ ] `skeleton-fill.ts` — 确定性填充（profile 数据 → 模块内容）
- [ ] 联系方式自动带入海报（name、phone、email、logo、QR 码）
- [ ] `generateSkeletonCopy()` — AI 生成个人简介、服务描述（中英文）
- [ ] Logo 主色提取 → 推荐配色方案
- [ ] 修改 `assembleRenderModel()` 支持骨架模式

### 0.2.2.4 — 微调编辑（Phase 3）

- [ ] 模块开关（toggle switch 列表）
- [ ] 配色方案切换（3-5 个预设 palette）
- [ ] 行内文字编辑（contentEditable wrapper）
- [ ] 图片替换（点击上传）
- [ ] 骨架切换（保留数据，重新装配）

### 0.2.2.5 — 表单模板（Phase 4）

- [ ] Open Home Registration 模板（姓名、电话、邮箱、人数、备注）
- [ ] Buyer Inquiry 模板（预算、偏好区域、房型、时间线）
- [ ] Property Valuation 模板（地址、房型、卧室数）
- [ ] 骨架关联默认表单模板

### 数据映射（联系方式 → 海报 / 微站）

| 用户输入 | → 微站填充 | → 海报填充 |
|---------|-----------|-----------|
| name | hero.title / about.name | 海报 agent 姓名 |
| phone | contact.phone / hero CTA | 海报联系电话 |
| email | contact.email | 海报联系邮箱 |
| logo | navbar / footer | 海报 logo |
| wechat_qr | contact.wechat_qr | 海报二维码 |
| whatsapp | contact.whatsapp_link | 海报 WhatsApp |
| avatar | about.image | 海报头像 |

### 手动房源数据模型

```typescript
interface PropertyListing {
  id: string;
  name: string;           // 房源名称
  address: string;        // 地址
  description: string;    // 介绍
  images: string[];       // 上传的图片 URL
  bedrooms?: number;
  bathrooms?: number;
  price_hint?: string;    // 价格提示
  trademe_url?: string;   // 可选 TradeMe 跳转链接
  sort_order: number;
}
```

存储位置：`merchant_profile.property_listings[]`（JSON 数组），不新增数据库表。

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 骨架存储 | 代码内 JSON | 数量少（<10），不需要动态管理 |
| 编辑器 | contentEditable + toggle | 手机端 drag & drop 体验差 |
| 配色方案 | 预设 palette 选择 | 自定义颜色选择器手机上不好用 |
| 房源管理 | merchant_profile JSON 数组 | 不新增表，简化架构 |
| 海报联系方式 | 自动从 profile 带入 | 用户无需重复输入 |
| 骨架切换 | 保留数据重新装配 | 数据和布局解耦 |

---

## v0.3 — 社媒内容营销 + 数据仪表盘 [已完成 2026-04-07]

**目标**：帮助中介日常内容创作和跟踪效果

### 0.3.1 — 社媒文案生成 ✅

- [x] 内容类型模板（Just Listed、Just Sold、Open Home 预告、市场周报、买房贴士）
- [x] AI 文案生成（中英双语，适配平台字数）
- [x] 模板化海报生成（HTML-to-image，社交媒体尺寸）
- [x] "发布包"导出（图片 + 文案，长按保存）
- [x] `navigator.share` 调用系统分享

### 0.3.2 — 社媒一键发布 ⏳

- [ ] Meta Graph API 集成（Facebook + Instagram）
- [ ] LinkedIn API 集成
- [x] 小红书 / 微信：生成内容包（无官方 API）

### 0.3.3 — 数据仪表盘 ✅

- [x] 微站访问量统计（中间件计数）
- [x] 表单提交数 + 转化率
- [x] UTM 参数追踪
- [x] 最近提交列表

---

## v0.4 — AI 编译器升级 + 多行业扩展 [当前阶段]

**目标**：增强 AI 能力 + 扩展行业覆盖

### 编译器升级

- [ ] 混合编译器（Rule + LLM）
- [ ] CompiledIntentV2 + module_selection
- [ ] LLM Form Builder（字段池选取）

### 多行业

- [ ] 留学移民顾问骨架（Consultant Pro、School Guide）
- [ ] 行业插件架构（新行业 = 新骨架 + 新字段池 + 新合规规则）

---

## v0.5 — 广告投放工具 + 高级运营 [规划中]

**目标**：闭环营销工具

- [ ] Google Ads 投放指南 + UTM 生成器
- [ ] Meta Lead Ads 对接（Webhook 同步提交到 HiBiz）
- [ ] 小红书聚光平台内容适配
- [ ] Landing Page 模式（隐藏导航，突出 CTA）
- [ ] A/B 测试框架
- [ ] 完整数据分析面板

---

## v1.0 — 公开发布 [里程碑]

**准入条件**：

- [ ] 至少 3 个行业 preset 稳定运行
- [ ] 自定义域名支持
- [ ] 生产环境 Runbook 完成
- [ ] 付费增值功能上线
- [ ] 安全审计通过
- [ ] 性能基线：生成 < 15 秒，页面加载 < 2 秒

---

## 未来探索（仅预留，不排期）

- Facebook/Google 广告创意 AI 生成
- MCP 集成
- 多语言扩展（不限于中英）
- 学习层（用户编辑反馈 → 优化生成质量）
- 组织/团队协作
- Magic Lab 官网导流 API
- CRM 集成（客户生命周期管理）
