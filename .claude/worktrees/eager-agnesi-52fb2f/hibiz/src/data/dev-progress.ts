/**
 * HiBiz 开发进度数据源 — 改这里即可；Obsidian 备份见 Second-Brain/01-Magiclab/Projects/HiBiz/10-开发进度.md
 */

export type ItemStatus = "done" | "in_progress" | "todo" | "blocked";

export interface ProgressItem {
  id: string;
  label: string;
  status: ItemStatus;
  /** 可选：额外说明（看板上小号字） */
  note?: string;
}

export interface ProgressPhase {
  id: string;
  title: string;
  summary: string;
  items: ProgressItem[];
}

/** 与 Obsidian「最后同步」保持习惯性一致；发布看板前可顺手改日期 */
export const DEV_PROGRESS_LAST_UPDATED = "2026-04-07";

export const DEV_PROGRESS_PHASES: ProgressPhase[] = [
  {
    id: "foundation",
    title: "底座",
    summary: "Supabase、Auth、RLS、Schema",
    items: [
      { id: "db", label: "核心表与迁移（projects / intents / microsites / forms / submissions）", status: "done" },
      { id: "rls-owner", label: "商家数据 RLS（按 user_id / project）", status: "done" },
      { id: "auth", label: "Magic Link + `/auth/callback` + session 刷新", status: "done" },
      { id: "rls-public", label: "公开读已发布微站 + 匿名 inserts submissions（迁移 public_rls）", status: "done" },
    ],
  },
  {
    id: "workbench",
    title: "商家工作台",
    summary: "项目管线、生成、预览",
    items: [
      { id: "projects", label: "项目列表 / 新建 / 详情", status: "done" },
      { id: "compile", label: "规则编译器 + Analyse（intent）", status: "done" },
      { id: "openai", label: "OpenAI 生成 draft_model + 表单预设", status: "done" },
      { id: "preview", label: "草稿预览 `?preview=1` + 登录回跳保留深链", status: "done" },
      { id: "publish-ui", label: "一键发布 / 从草稿更新线上", status: "done" },
    ],
  },
  {
    id: "public",
    title: "发布与公开面",
    summary: "访客可访问的页面",
    items: [
      { id: "site", label: "公开微站 `/site/[slug]`（published_model）", status: "done" },
      { id: "form-standalone", label: "独立表单 `/forms/[public_slug]`", status: "done" },
      { id: "submit", label: "留资 Server Action + 字段校验", status: "done" },
      { id: "seo-meta", label: "公开页 metadata（SEO 基础）", status: "done", note: "沿用模型内 seo 字段" },
    ],
  },
  {
    id: "verticals",
    title: "模板与垂直场景",
    summary: "双行业预设、房产海报、商家联系信息（无 listing 同步）",
    items: [
      { id: "preset-lib", label: "`template-presets.ts` + 新建项目 `?preset=` 填充示例文案", status: "done" },
      {
        id: "merchant-profile",
        label: "`microsites.merchant_profile` + 电话/邮箱/地址 + Contact 区块覆盖",
        status: "done",
        note: "迁移 20260405120000；视图含 merchant_profile",
      },
      {
        id: "re-poster",
        label: "房产：HTTPS 图片 URL、TradeMe 链接、打印海报 `/app/projects/[id]/poster`",
        status: "done",
        note: "gallery + 多层提取、质量门、Storage 代理已接 merchant_profile",
      },
      {
        id: "trademe-extract-v2",
        label: "TradeMe 房源提取优化：质量检测门 + __NEXT_DATA__ 解析 + Jina fallback",
        status: "done",
        note: "Layer 1: __NEXT_DATA__ → Layer 2: Jina + OpenAI；failed 不写入并带 missing",
      },
      {
        id: "image-proxy",
        label: "图片代理到 Supabase Storage（绕防盗链、长期保存）",
        status: "done",
        note: "bucket listing-images；导入时 Referer 拉取后写 Storage，失败则保留原图 URL",
      },
    ],
  },
  {
    id: "skeleton",
    title: "骨架模板系统 (v0.2.2)",
    summary: "预制骨架 + AI 填肉 + 手动房源 + 表单模板",
    items: [
      { id: "skeleton-types", label: "TemplateSkeleton 类型 + RenderModuleType 扩展", status: "done" },
      { id: "skeleton-data", label: "3 套房产骨架（Classic Agent / Property Showcase / Bilingual Pro）", status: "done" },
      { id: "profile-extend", label: "MerchantProfile 扩展（logo、QR、WhatsApp、property_listings）", status: "done" },
      { id: "create-flow", label: "分步创建流程（选行业 → 选骨架 → 填信息 → 预览）", status: "done" },
      { id: "property-manual", label: "手动房源管理（名称、地址、图片上传、介绍、TradeMe 链接）", status: "done" },
      { id: "skeleton-fill", label: "确定性填充 + AI 文案生成（中英文）", status: "done" },
      { id: "poster-auto", label: "联系方式自动带入海报（name/phone/email/logo/QR）", status: "done" },
      { id: "module-toggle", label: "模块开关 + 配色切换 + 行内编辑", status: "done" },
      { id: "form-templates", label: "表单模板（Open Home / Buyer Inquiry / Valuation）", status: "done" },
    ],
  },
  {
    id: "social",
    title: "社媒内容营销 (v0.3.1)",
    summary: "社媒文案 AI 生成 + 模板海报 + 分享包导出",
    items: [
      { id: "content-types", label: "内容类型模板（Just Listed / Just Sold / Open Home / 市场周报 / 买房贴士）", status: "done" },
      { id: "social-copy-ai", label: "AI 社媒文案生成（中英双语，适配平台字数）", status: "done" },
      { id: "poster-template", label: "模板化海报生成（HTML-to-image，社交媒体尺寸）", status: "done" },
      { id: "share-pack", label: "发布包导出（图片 + 文案，长按保存）", status: "done" },
      { id: "native-share", label: "`navigator.share` 系统分享调用", status: "done" },
    ],
  },
  {
    id: "social-publish",
    title: "社媒一键发布 (v0.3.2)",
    summary: "Meta / LinkedIn API + 小红书内容包",
    items: [
      { id: "meta-api", label: "Meta Graph API 集成（Facebook + Instagram 发帖）", status: "todo" },
      { id: "linkedin-api", label: "LinkedIn API 集成", status: "todo" },
      { id: "xhs-wechat", label: "小红书 / 微信：生成内容包（无官方 API，图文导出）", status: "todo" },
    ],
  },
  {
    id: "dashboard",
    title: "数据仪表盘 (v0.3.3)",
    summary: "微站访问量 + 表单转化率 + UTM 追踪",
    items: [
      {
        id: "visit-tracking",
        label: "微站访问量统计（中间件计数 或 Umami）",
        status: "done",
        note: "middleware + site_visits；迁移 20260407120000",
      },
      { id: "form-conversion", label: "表单提交数 + 转化率统计", status: "done" },
      { id: "utm-tracking", label: "UTM 参数追踪（来源渠道归因）", status: "done" },
      { id: "recent-leads", label: "最近提交列表（仪表盘汇总视图）", status: "done" },
    ],
  },
  {
    id: "hybrid-v04",
    title: "混合编译器 (v0.4)",
    summary: "Rule Guard + LLM Compiler V2 + Form Builder + Plugin",
    items: [
      {
        id: "v04-types",
        label: "Phase 0：`CompiledIntentV2` / `rule-guard` / `form-builder` 类型与字段池",
        status: "done",
      },
      {
        id: "v04-rule-guard",
        label: "Phase 1：Rule Guard（`applyRuleGuard` + 城市/行业/语言/黑名单）",
        status: "done",
        note: "Vitest：`src/lib/compiler/rule-guard.test.ts`",
      },
      {
        id: "v04-llm-compiler",
        label: "Phase 2：LLM Compiler V2（`compileLLMV2` / `compileIntentHybrid`）",
        status: "done",
        note: "gpt-4o-mini + json_object；`buildCompiledIntentV2FromLlmJson`；Vitest mock",
      },
      {
        id: "v04-form-builder",
        label: "Phase 3：Form Builder（规则表 + `buildFormFieldsFromRules`）+ 后台工作流侧栏",
        status: "done",
        note: "迁移 20260408120000 compiled_intent_v2；compile-intent-v2-action",
      },
      { id: "v04-plugins", label: "Phase 5–6：行业插件 + Server Actions 集成", status: "todo" },
    ],
  },
  {
    id: "ops",
    title: "运营与体验",
    summary: "线索、风控、编辑能力",
    items: [
      { id: "inbox", label: "商家后台：线索列表（/app/projects/[id]/leads）", status: "done" },
      {
        id: "rate-limit",
        label: "公开提交：honeypot + RPC 限流（每表单/小时 & 每 IP 十分钟）",
        status: "done",
        note: "迁移 20260404200000；可选环境变量 HIBIZ_LEAD_SALT",
      },
      { id: "notify", label: "新线索邮件或 webhook", status: "todo" },
      {
        id: "content-edit",
        label: "Hero 快编 + 商家资料（含房产图 URL 进 hero）",
        status: "done",
        note: "区块级全量编辑与 Storage 仍待扩展",
      },
      { id: "observability", label: "日志与产品事件（与规格 06 对齐）", status: "todo" },
    ],
  },
];

/* ──────────────────────────────────────────────
 * 版本路线图数据（/progress/roadmap 使用）
 * ────────────────────────────────────────────── */

export type VersionStatus = "released" | "current" | "next" | "planned";

export interface RoadmapVersion {
  id: string;
  version: string;
  title: string;
  status: VersionStatus;
  date: string | null;
  highlights: string[];
}

export const ROADMAP_VERSIONS: RoadmapVersion[] = [
  {
    id: "v0.1",
    version: "v0.1",
    title: "底座与主链路",
    status: "released",
    date: "2026-04-04",
    highlights: [
      "Supabase Auth (Magic Link) + RLS",
      "Rule-based 意图编译器",
      "OpenAI 文案生成 (gpt-4o-mini)",
      "RenderModel 装配 + 草稿预览 + 发布",
      "公开微站 /site/[slug]",
      "独立表单 /forms/[public_slug]",
    ],
  },
  {
    id: "v0.2",
    version: "v0.2",
    title: "模板预设 + 商家信息",
    status: "released",
    date: "2026-04-05",
    highlights: [
      "6 个行业场景预设（房产 3 + 移民 3）",
      "商家联系信息 (merchant_profile)",
      "房产推广 + TradeMe 链接 + 打印海报",
      "留资风控：蜜罐 + 限流",
    ],
  },
  {
    id: "v0.2.1",
    version: "v0.2.1",
    title: "URL 提取管线 + Render 部署",
    status: "released",
    date: "2026-04-07",
    highlights: [
      "三层提取管线：API → __NEXT_DATA__ → Jina + OpenAI",
      "TradeMe OAuth 1.0a 集成",
      "图片代理到 Supabase Storage",
      "提取质量门 (0-100 评分)",
      "Render 生产部署 (hibiz-service.onrender.com)",
    ],
  },
  {
    id: "v0.2.2",
    version: "v0.2.2",
    title: "骨架模板系统",
    status: "released",
    date: "2026-04-06",
    highlights: [
      "预制骨架 + AI 填肉（3 套房产骨架）",
      "分步创建：选行业 → 选骨架 → 填信息 → 预览",
      "手动房源管理（上传图片、TradeMe 跳转）",
      "联系方式自动带入海报",
      "表单模板：Open Home / Buyer Inquiry / Valuation",
      "模块开关 + 配色切换 + 行内编辑",
    ],
  },
  {
    id: "v0.3",
    version: "v0.3",
    title: "社媒内容营销 + 数据仪表盘",
    status: "released",
    date: "2026-04-07",
    highlights: [
      "社媒文案 AI（5 类型 × 4 平台中英 + 字数约束）",
      "海报预览 / html-to-image 导出 / Storage 上传",
      "分享包：复制文案、下载 PNG、navigator.share",
      "中间件 site_visits + UTM + 仪表盘（recharts）",
    ],
  },
  {
    id: "v0.4",
    version: "v0.4",
    title: "AI 编译器升级 + 多行业",
    status: "next",
    date: null,
    highlights: [
      "混合编译器（Rule + LLM）",
      "留学移民骨架",
      "行业插件架构",
    ],
  },
  {
    id: "v1.0",
    version: "v1.0",
    title: "公开发布",
    status: "planned",
    date: null,
    highlights: [
      "自定义域名",
      "付费增值功能",
      "安全审计",
    ],
  },
];

/* ────────────────────────────────────────────── */

export function itemWeight(s: ItemStatus): number {
  switch (s) {
    case "done":
      return 1;
    case "in_progress":
      return 0.55;
    case "blocked":
      return 0;
    default:
      return 0;
  }
}

export function phaseCompletion(items: ProgressItem[]): { pct: number; done: number; total: number } {
  const total = items.length;
  if (total === 0) {
    return { pct: 0, done: 0, total: 0 };
  }
  const sum = items.reduce((acc, i) => acc + itemWeight(i.status), 0);
  const done = items.filter((i) => i.status === "done").length;
  return { pct: Math.round((sum / total) * 100), done, total };
}

export function overallCompletion(phases: ProgressPhase[]): { pct: number; done: number; total: number } {
  const flat = phases.flatMap((p) => p.items);
  return phaseCompletion(flat);
}
