/**
 * Review-due dates for docs/registry/platform-candidates.md rows.
 *
 * The markdown table is the single authoritative record of what a candidate
 * IS (owner, evidence, status, links) — this file is only the minimal mirror
 * needed to plug the monthly review into the existing pm-daily-todo cron
 * (already scheduled in render.yaml, runs NZ weekday mornings) instead of
 * leaving it as "当值 FDE 记得每月第一个周一" — a calendar SOP with nothing
 * in code that ever creates the task (CLAUDE.md 铁律 3: 遇卡点必自动化,
 * 管道不许断头).
 *
 * Whoever adds a row to the registry, or updates its 复查日 after a review,
 * MUST add/update the matching entry here in the SAME commit — otherwise the
 * reminder silently stops firing and the registry is back to relying on
 * memory. `me-platform-tier-gate` §默认降级·强制候选登记 references this file.
 */
export interface PlatformCandidateReview {
  /** Must match the 候选名 column in docs/registry/platform-candidates.md. */
  name: string
  /** YYYY-MM-DD, must match the 复查日 column. */
  reviewDate: string
}

export const PLATFORM_CANDIDATE_REGISTRY_URL =
  'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md'

export const PLATFORM_CANDIDATE_REVIEWS: PlatformCandidateReview[] = [
  {
    // 必须与 docs/registry/platform-candidates.md 里的候选名完全一致
    name: '借助 Claude Design 生成品牌 VI 视觉资产（logo · 品牌手册 · 视觉规范）',
    reviewDate: '2026-09-27',
  },
  {
    name: 'Current-Sponsored Competitor Discovery（当前活跃广告主实时发现 + diff 竞品清单）',
    reviewDate: '2026-09-28',
  },
  {
    name: '创作者专属 collection + 独立 UTM（每个合作创作者一个可归因落地页）',
    reviewDate: '2026-09-30',
  },
  {
    name: '内容排产输入从"想主题"改成"读客户 products.json 上新 feed"',
    reviewDate: '2026-09-30',
  },
  {
    name: '促销走购物车层折扣叠加、不批量改 `compare_at_price`',
    reviewDate: '2026-09-30',
  },
  {
    name: '电商 SEO 检测方向：aggregateRating 空评分 / hreflang 适用性判断 / sitemap 内部垃圾过滤',
    reviewDate: '2026-09-30',
  },
  {
    name: 'AI agent 能否直接购买（Shopify UCP / agents.md 是否平台默认开放）作为 AI 可见度测量口径候选维度',
    reviewDate: '2026-09-30',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '跨源交叉验证与对照实验设计（用独立数据源互证结论 · 用对照组排除替代解释）',
    reviewDate: '2026-09-30',
  },
]
