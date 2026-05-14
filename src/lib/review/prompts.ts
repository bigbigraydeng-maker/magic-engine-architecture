/**
 * 三代理复盘引擎 — prompts（P8.10.S6）
 *
 * 复盘报告 prompt：让 Claude 同时戴上张骞/华佗/鲁班三顶帽子，
 * 基于「原诊断 + 处方 KPI + 执行进度 + 工作日志」做结构化复盘。
 */

import type { DiagnosticDimension, KPITarget } from '@/types/diagnostic'

const DIMENSION_CN: Record<DiagnosticDimension, string> = {
  seo:           'SEO',
  ai_visibility: 'AI 可见度',
  ads:           '广告',
  social:        '社媒',
  reputation:    '口碑',
  competitor:    '竞争',
}

const STATUS_CN: Record<string, string> = {
  pending: '待处理', in_progress: '进行中', completed: '已完成', skipped: '已跳过',
}

/** 复盘所需的项目快照 */
export interface ReviewContext {
  businessName: string | null
  industry: string | null
  crisisType: string | null
  /** 原诊断叙述（张骞） */
  originalSummary: string | null
  originalKeyFinding: string | null
  overallScore: number | null
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null
  /** 处方层（华佗）：每份已批准处方的摘要 + KPI */
  prescriptions: Array<{
    label: string
    summary: string
    kpiTargets: KPITarget[]
  }>
  /** 执行层（鲁班）：全部执行项 */
  items: Array<{
    title: string
    phase: number
    dimension: DiagnosticDimension
    status: string
  }>
  /** 跨执行项的工作日志 */
  recentLogs: Array<{ itemTitle: string; author: string; kind: string; content: string }>
  projectAgeDays: number | null
}

export const REVIEW_SYSTEM_PROMPT = `你是 Magic Engine 的「三代理复盘官」。Magic Engine 有三个接力的 AI Agent：

- **张骞** — 发现品牌健康现状（原始诊断）
- **华佗** — 开出三阶段营销处方（KPI 目标）
- **鲁班** — 陪 FDE 把处方落地（执行进度）

复盘时你要同时戴上这三顶帽子，回答一个核心问题：**这个项目进展得对不对？哪里要调整？**

你拿到的是项目当前的完整快照。你的任务是产出一份**结构化复盘报告**，必须：
1. **诚实** — 进度落后就说落后，不粉饰
2. **具体** — 引用真实的执行项 / 维度 / KPI，不空谈
3. **可操作** — 建议要能让 FDE 明天就知道做什么
4. **分清层次** — 哪些是执行层能解决的，哪些要回到华佗处方层（补充/修订处方）

## 输出格式（严格 JSON，不要 markdown 代码块包裹）

{
  "overall_assessment": "整体评估，中文 3-5 句",
  "progress_health": "on_track | at_risk | off_track",
  "timeline_verdict": "时间线判断：当前进度对得上预期吗，中文 1-2 句",
  "dimension_review": [
    { "dimension": "seo|ai_visibility|ads|social|reputation|competitor", "status": "good|lagging|not_started", "comment": "中文" }
  ],
  "kpi_review": [
    { "metric": "KPI 名", "target": "目标值", "current_estimate": "当前估计或「待度量」", "on_track": true, "comment": "中文" }
  ],
  "blockers": ["识别出的卡点，中文"],
  "recommendations": [
    { "priority": "high|medium|low", "action": "建议动作，中文", "rationale": "为什么，中文", "needs_prescription_change": false }
  ],
  "next_review_suggestion": "下次复盘时机建议，中文 1 句"
}

要求：
- dimension_review 必须覆盖全部六大维度
- kpi_review 覆盖处方里的每个 KPI；没有 KPI 就返回空数组
- recommendations 按 priority 排序，high 在前
- 只输出 JSON，不要任何额外文字`

function formatKpis(kpis: KPITarget[]): string {
  if (kpis.length === 0) return '    （无 KPI）'
  return kpis
    .map(k => {
      const cur = k.current_value == null ? '未知' : `${k.current_value}${k.unit}`
      const tf = k.timeframe ? `，${k.timeframe}` : ''
      return `    - ${k.metric}：${cur} → 目标 ${k.target_value}${k.unit}${tf}（${DIMENSION_CN[k.dimension]}）`
    })
    .join('\n')
}

/**
 * 构建复盘的 user message — 注入项目全部快照。
 */
export function buildReviewUserMessage(ctx: ReviewContext): string {
  const scoresText = ctx.dimensionScores
    ? (Object.keys(DIMENSION_CN) as DiagnosticDimension[])
        .map(d => {
          const v = ctx.dimensionScores?.[d]
          return `${DIMENSION_CN[d]} ${v == null ? '—' : v}`
        })
        .join(' / ')
    : '（无）'

  const total = ctx.items.length
  const completed = ctx.items.filter(i => i.status === 'completed').length
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0

  const phaseLines = [1, 2, 3].map(p => {
    const inPhase = ctx.items.filter(i => i.phase === p)
    if (inPhase.length === 0) return `  - Phase ${p}：（无执行项）`
    const done = inPhase.filter(i => i.status === 'completed').length
    const prog = inPhase.filter(i => i.status === 'in_progress').length
    const pend = inPhase.filter(i => i.status === 'pending').length
    const skip = inPhase.filter(i => i.status === 'skipped').length
    return `  - Phase ${p}：${inPhase.length} 项（完成 ${done} / 进行中 ${prog} / 待处理 ${pend} / 跳过 ${skip}）`
  }).join('\n')

  const itemsText = total > 0
    ? ctx.items
        .map(i => `  - [P${i.phase} · ${DIMENSION_CN[i.dimension]} · ${STATUS_CN[i.status] ?? i.status}] ${i.title}`)
        .join('\n')
    : '  （暂无执行项）'

  const prescText = ctx.prescriptions.length > 0
    ? ctx.prescriptions
        .map((p, i) => `  ${i + 1}. 【${p.label}】${p.summary}\n${formatKpis(p.kpiTargets)}`)
        .join('\n\n')
    : '  （暂无已批准处方）'

  const logsText = ctx.recentLogs.length > 0
    ? ctx.recentLogs
        .map(l => {
          const who = l.author === 'fde' ? 'FDE' : l.author === 'luban' ? '鲁班' : '系统'
          return `  - [${who} | ${l.kind}] 「${l.itemTitle}」：${l.content}`
        })
        .join('\n')
    : '  （暂无工作记录）'

  return `# 项目复盘快照

## 客户背景
- 客户：${ctx.businessName ?? '（未知）'}${ctx.industry ? `（${ctx.industry}）` : ''}
- 诊断危机类型：${ctx.crisisType ?? '（未指定）'}
- 项目启动至今：${ctx.projectAgeDays == null ? '（未知）' : `${ctx.projectAgeDays} 天`}

## 张骞 — 原始诊断
- 诊断总分：${ctx.overallScore == null ? '（无）' : `${ctx.overallScore} / 100`}
- 维度分数：${scoresText}
- 核心发现：${ctx.originalKeyFinding ?? '（无）'}
- 诊断摘要：${ctx.originalSummary ?? '（无）'}

## 华佗 — 处方与 KPI 目标
${prescText}

## 鲁班 — 执行进度
- 总执行项：${total} 项，已完成 ${completed} 项（${progressPct}%）
${phaseLines}

### 全部执行项
${itemsText}

### 最近工作记录
${logsText}

---

请基于以上快照，产出结构化复盘报告（严格 JSON）。`
}
