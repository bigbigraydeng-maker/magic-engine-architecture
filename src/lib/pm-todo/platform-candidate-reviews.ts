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
    name: '品牌 VI 强制执行（brand tokens 中央注入所有客户交付物 · logo / 色 / 字体 / 风格）',
    reviewDate: '2026-09-28',
  },
  {
    name: '客户官网结构化素材抓取（sitemap → 产品页 → 图片 → 品牌片段）',
    reviewDate: '2026-09-28',
  },
  {
    name: 'HTML → PDF 多页排版渲染（A4/A3 print / 品牌一致的多章节 brochure）',
    reviewDate: '2026-09-28',
  },
  {
    name: 'ME 旅游版 Catalogue Chapter Playbook（旅游行业 catalogue 的 chapter 结构 / 素材抓取通道 / 版式规则）',
    reviewDate: '2026-09-28',
  },
  {
    name: 'Lead 温度打分（多因子：邮件打开频次+最近打开衰减+注册新旧+备注文字里的时间意向 → Hot/Warm/Cold）',
    reviewDate: '2026-09-09',
  },
]
