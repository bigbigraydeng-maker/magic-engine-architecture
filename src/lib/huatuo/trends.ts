/**
 * 华佗 Trends — SEMrush 历史趋势分析。
 *
 * Reference: ROADMAP.md P8.10.S3.2
 *
 * 把 12 个月的有机流量曲线提炼成几个关键指标：
 *   - latest        — 最近一个月的流量/关键词数（current_value 锚点）
 *   - growth_pct_3m — 近 3 月环比增长率
 *   - growth_pct_6m — 近 6 月环比增长率
 *   - trajectory    — 'rising' / 'flat' / 'declining'
 *
 * 这些数据进 prompt 后，华佗就能"基于真实历史"判断 target_value 是否激进，
 * 而不是纯凭基准库猜测。
 */

import type { DomainTrendPoint } from '@/lib/semrush/client'

export type Trajectory = 'rising' | 'flat' | 'declining' | 'no_data'

export interface TrendSummary {
  has_data: boolean
  latest: { month: string; organic_traffic: number; organic_keywords: number } | null
  earliest: { month: string; organic_traffic: number; organic_keywords: number } | null
  growth_pct_3m: number | null     // 最近 3 月 vs 之前 3 月的环比
  growth_pct_6m: number | null     // 最近 6 月 vs 之前 6 月的环比
  growth_pct_12m: number | null    // 12 个月首尾比
  trajectory: Trajectory
  monthly_avg_traffic: number | null
  data_points: number
}

/**
 * 把原始月度趋势点折叠成单一摘要对象。
 */
export function summarizeTrend(points: DomainTrendPoint[]): TrendSummary {
  if (!points || points.length === 0) {
    return {
      has_data: false,
      latest: null,
      earliest: null,
      growth_pct_3m: null,
      growth_pct_6m: null,
      growth_pct_12m: null,
      trajectory: 'no_data',
      monthly_avg_traffic: null,
      data_points: 0,
    }
  }

  // points 已按时间升序（最早→最新）
  const latest = points[points.length - 1]
  const earliest = points[0]
  const totalTraffic = points.reduce((sum, p) => sum + p.organic_traffic, 0)
  const monthlyAvgTraffic = Math.round(totalTraffic / points.length)

  const growth3m = computeWindowGrowth(points, 3)
  const growth6m = computeWindowGrowth(points, 6)
  const growth12m = points.length >= 2
    ? safePctChange(earliest.organic_traffic, latest.organic_traffic)
    : null

  // Trajectory 判定：用最稳定的可用指标（优先 6m，回退 3m）
  const trajectoryBase = growth6m ?? growth3m ?? growth12m
  const trajectory: Trajectory =
    trajectoryBase == null   ? 'no_data' :
    trajectoryBase >= 10     ? 'rising' :
    trajectoryBase <= -10    ? 'declining' :
                               'flat'

  return {
    has_data: true,
    latest,
    earliest,
    growth_pct_3m: growth3m,
    growth_pct_6m: growth6m,
    growth_pct_12m: growth12m,
    trajectory,
    monthly_avg_traffic: monthlyAvgTraffic,
    data_points: points.length,
  }
}

/**
 * 计算"最近 N 月平均"与"之前 N 月平均"的环比增长率。
 * 返回 null 表示数据不足。
 */
function computeWindowGrowth(points: DomainTrendPoint[], n: number): number | null {
  if (points.length < n * 2) return null

  const recent = points.slice(-n)
  const previous = points.slice(-n * 2, -n)

  const recentAvg = recent.reduce((s, p) => s + p.organic_traffic, 0) / n
  const previousAvg = previous.reduce((s, p) => s + p.organic_traffic, 0) / n

  return safePctChange(previousAvg, recentAvg)
}

function safePctChange(from: number, to: number): number | null {
  if (from <= 0) return null
  return Math.round(((to - from) / from) * 100)
}

// ─── Prompt formatting ────────────────────────────────────────────────────────

/**
 * 把趋势摘要格式化成 Claude prompt 里嵌入的中文段落。
 */
export function formatTrendForPrompt(summary: TrendSummary): string {
  if (!summary.has_data) {
    return `## 域名历史流量趋势（SEMrush）\n\n**无历史数据**（域名权威分过低或注册时间过短）。target_value 估算请完全依赖行业基准。`
  }

  const trajectoryLabel: Record<Trajectory, string> = {
    rising:     '📈 上升',
    flat:       '➡️ 平稳',
    declining:  '📉 下降',
    no_data:    '无数据',
  }

  const lines: string[] = [
    `## 域名历史流量趋势（SEMrush 过去 ${summary.data_points} 个月）`,
    '',
    `**最近月份（${summary.latest?.month}）**：有机流量 ${summary.latest?.organic_traffic.toLocaleString()} 次 / 关键词数 ${summary.latest?.organic_keywords.toLocaleString()}`,
    `**最早月份（${summary.earliest?.month}）**：有机流量 ${summary.earliest?.organic_traffic.toLocaleString()} 次 / 关键词数 ${summary.earliest?.organic_keywords.toLocaleString()}`,
    `**月均流量**：${summary.monthly_avg_traffic?.toLocaleString()} 次`,
    '',
    `**实际增长率**：`,
    `  - 近 3 月环比：${summary.growth_pct_3m != null ? summary.growth_pct_3m + '%' : '数据不足'}`,
    `  - 近 6 月环比：${summary.growth_pct_6m != null ? summary.growth_pct_6m + '%' : '数据不足'}`,
    `  - 12 个月首尾比：${summary.growth_pct_12m != null ? summary.growth_pct_12m + '%' : '数据不足'}`,
    '',
    `**当前轨迹**：${trajectoryLabel[summary.trajectory]}`,
    '',
    `**重要约束**：`,
    `1. KPI 的 current_value 必须使用最近月份的真实数字（${summary.latest?.organic_traffic.toLocaleString()}），不要凭空估算。`,
    `2. target_value 增长率不应远超过去实际增速 × 2 倍（如过去 6 月增长 ${summary.growth_pct_6m ?? '?'}%，6 月目标增长上限约 ${summary.growth_pct_6m != null ? summary.growth_pct_6m * 2 : '?'}%）。超出请明确标记 realism_confidence ≤ 0.4 并在 notes 解释介入加速理由。`,
    summary.trajectory === 'declining'
      ? `3. ⚠️ 流量呈下降趋势——处方第一阶段必须包含"止血"动作（修复已掉排名的关键词、识别流量流失原因），而非盲目追加新内容。`
      : summary.trajectory === 'flat'
        ? `3. 流量持平——需识别突破点（新关键词类目、内容飞轮缺口）。`
        : `3. 流量上升中——保持现有节奏，处方重心是放大已验证的赢利点。`,
  ]

  return lines.join('\n')
}
