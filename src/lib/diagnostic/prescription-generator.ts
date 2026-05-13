/**
 * Prescription Generator (§4 — P8.5.16)
 *
 * generatePrescription(supabase, runId, clientId, intake)
 *   1. Fetches run data + critical/high findings from DB
 *   2. Builds a structured prompt (§4.2)
 *   3. Calls Claude Sonnet (SDK init inside function per CLAUDE.md)
 *   4. Parses JSON response as PrescriptionContent
 *   5. Validates budget allocation does not exceed monthly_budget_aud
 *   6. Inserts a draft Prescription record and returns its id + content
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DiagnosticRun,
  DiagnosticFinding,
  PrescriptionContent,
  PrescriptionIntake,
} from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import { getAnthropicClient, parseJsonResponse, MODEL_SONNET } from '@/lib/anthropic/client'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GeneratePrescriptionResult {
  prescriptionId: string
  content: PrescriptionContent
}

// ---------------------------------------------------------------------------
// System prompt (strategy layer — Claude Sonnet)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是 Magic Engine 平台的资深数字营销策略师，服务于 AU/NZ（澳大利亚/新西兰）市场的企业。

任务：根据诊断报告 + 客户意向，生成一份结构化的「三阶段营销处方」。

## 输出语言规则（⚠️ 关键）

所有面向人类阅读的文本字段**必须用中文**，包括：
- summary
- phases[].name
- actions[].title / actions[].description
- kpi_targets[].metric / kpi_targets[].unit
- budget_allocation[].dimension（用中文维度名，如"SEO"、"社媒"、"口碑"、"AI可见度"、"广告"、"竞品"）

**只有枚举值保持英文**（technical fields）：
- actions[].dimension: "seo" | "ai_visibility" | "ads" | "social" | "reputation" | "competitor"
- actions[].fix_type: "me_auto" | "fde_manual" | "third_party"
- actions[].effort / actions[].impact: "low" | "medium" | "high"

## 结构规则

- 恰好 3 个阶段：阶段 1（快速见效，2–4 周）、阶段 2（结构性建设，4–8 周）、阶段 3（长期护城河，8–12 周）
- 每个 action 的 "phase" 字段必须等于其父 phase_number（1、2 或 3）
- budget_allocation 各项金额之和**最多**等于客户输入的 monthly_budget_aud（绝不可超过）
- 优先处理 critical 和 high 级别的问题，忽略 medium/low

## KPI 目标的撰写要求

- 每个 KPI 必须给出 current_value（从诊断分数推断）和 target_value（合理估算）
- 时间窗口要匹配客户的 timeline_urgency
- 优先选择**可量化、可追踪**的指标（如月有机流量、Google 评分、AI 平台提及率），避免模糊指标
- target_value 要现实：6 个月内 SEO 流量增长 30–80% 是合理的，2 倍以上需谨慎

## 输出格式

只输出原始 JSON，**不要 Markdown 代码块，不要解释文字**。

输出 schema：
{
  "summary": "string（中文，2–3 句话概括整套处方的核心思路）",
  "phases": [
    {
      "phase_number": 1,
      "name": "string（中文，如「第一阶段：止血与快速见效」）",
      "duration_weeks": number,
      "actions": [
        {
          "id": "unique-string",
          "title": "string（中文动作标题）",
          "description": "string（中文，1–2 句具体执行说明）",
          "dimension": "seo|ai_visibility|ads|social|reputation|competitor",
          "fix_type": "me_auto|fde_manual|third_party",
          "phase": 1,
          "effort": "low|medium|high",
          "impact": "low|medium|high",
          "finding_ids": ["finding-id"]
        }
      ]
    }
  ],
  "kpi_targets": [
    {
      "metric": "string（中文 KPI 名称，如「月有机搜索流量」）",
      "current_value": number|null,
      "target_value": number,
      "unit": "string（中文单位，如「次/月」「分」「%」）",
      "dimension": "seo|ai_visibility|ads|social|reputation|competitor"
    }
  ],
  "budget_allocation": [
    {
      "dimension": "string（中文维度名）",
      "amount_aud": number,
      "percentage": number
    }
  ]
}`

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generatePrescription(
  supabase: SupabaseClient,
  runId: string,
  clientId: string,
  intake: PrescriptionIntake,
): Promise<GeneratePrescriptionResult> {
  const [run, findings] = await fetchRunData(supabase, runId, clientId)
  const prompt = buildPrescriptionPrompt(run, findings, intake)

  // Init Anthropic client inside function (per CLAUDE.md — never at module top level)
  const client = getAnthropicClient()
  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')

  const content = parseJsonResponse<PrescriptionContent>(rawText)

  // Clamp budget allocation so it never exceeds intake budget
  clampBudgetAllocation(content, intake.monthly_budget_aud)

  const prescriptionId = await savePrescription(supabase, { runId }, clientId, intake, content)

  return { prescriptionId, content }
}

// ---------------------------------------------------------------------------
// Prompt builder (§4.2)
// ---------------------------------------------------------------------------

export function buildPrescriptionPrompt(
  run: Pick<DiagnosticRun, 'id' | 'overall_score' | 'dimension_scores'>,
  findings: DiagnosticFinding[],
  intake: PrescriptionIntake,
): string {
  const dimensionScoresText = run.dimension_scores
    ? Object.entries(run.dimension_scores)
        .map(([dim, score]) => `  ${dim}: ${score}/100`)
        .join('\n')
    : '  (no dimension scores)'

  const findingsText = findings.length === 0
    ? '  (no critical or high findings)'
    : findings.map(f =>
        `  [${f.id}] [${f.severity.toUpperCase()}] [${f.dimension}] ${f.title}\n` +
        `    → ${f.recommendation}`
      ).join('\n')

  const priorityDims = intake.priority_dimensions.length > 0
    ? intake.priority_dimensions.join(', ')
    : 'all dimensions'

  return `## Diagnostic Report

Overall Score: ${run.overall_score ?? 'N/A'}/100

Dimension Scores:
${dimensionScoresText}

## Critical & High Severity Findings
${findingsText}

## Client Intake

Business Goal: ${intake.business_goal}
Timeline Urgency: ${intake.timeline_urgency}
Monthly Budget: AUD ${intake.monthly_budget_aud}
Priority Dimensions: ${priorityDims}
Additional Notes: ${intake.notes ?? 'None'}

## Instructions

Generate a 3-phase prescription JSON for this AU/NZ business.
Budget: AUD ${intake.monthly_budget_aud}/month — allocations must NOT exceed this total.
Focus on the critical and high severity findings listed above.`
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function fetchRunData(
  supabase: SupabaseClient,
  runId: string,
  clientId: string,
): Promise<[DiagnosticRun, DiagnosticFinding[]]> {
  const [runRes, findingsRes] = await Promise.all([
    supabase
      .from('diagnostic_runs')
      .select('id, overall_score, dimension_scores')
      .eq('id', runId)
      .single(),
    supabase
      .from('diagnostic_findings')
      .select('*')
      .eq('run_id', runId)
      .eq('client_id', clientId)
      .in('severity', ['critical', 'high']),
  ])

  if (runRes.error || !runRes.data) {
    throw new Error(`Diagnostic run not found: ${runRes.error?.message ?? 'unknown'}`)
  }

  const run = runRes.data as DiagnosticRun
  const findings = (findingsRes.data ?? []) as DiagnosticFinding[]

  return [run, findings]
}

function clampBudgetAllocation(content: PrescriptionContent, maxBudget: number): void {
  if (!content.budget_allocation || content.budget_allocation.length === 0) return

  const total = content.budget_allocation.reduce((sum, b) => sum + b.amount_aud, 0)
  if (total <= maxBudget) return

  // Scale down proportionally
  const ratio = maxBudget / total
  for (const item of content.budget_allocation) {
    item.amount_aud = Math.floor(item.amount_aud * ratio)
    item.percentage = Math.round(item.percentage * ratio)
  }
}

async function savePrescription(
  supabase: SupabaseClient,
  source: { runId?: string; discoveryId?: string },
  clientId: string,
  intake: PrescriptionIntake,
  content: PrescriptionContent,
): Promise<string> {
  const { data, error } = await supabase
    .from('prescriptions')
    .insert({
      client_id:    clientId,
      run_id:       source.runId ?? null,
      discovery_id: source.discoveryId ?? null,
      status:       'draft',
      intake,
      content,
      generated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to save prescription: ${error?.message ?? 'unknown'}`)
  }

  return (data as { id: string }).id
}

// ---------------------------------------------------------------------------
// Discovery-sourced prescription (Zhangqian → Prescription)
// ---------------------------------------------------------------------------

/**
 * Build a prescription prompt from a confirmed Zhangqian DiscoveryReport.
 * Translates the diagnosis block into the same format the prescription
 * generator expects, so the same Claude prompt template applies.
 */
export function buildPrescriptionPromptFromDiscovery(
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
): string {
  const d = discovery.diagnosis
  const scores = d?.scores
  const dimensionScoresText = scores
    ? [
        `  seo: ${scores.seo}/100`,
        `  social: ${scores.social}/100`,
        `  reputation: ${scores.reputation}/100`,
        `  ai_visibility: ${scores.ai_visibility}/100`,
        `  overall: ${scores.overall}/100`,
      ].join('\n')
    : '  (no dimension scores)'

  // Flatten action blocks into finding-like items
  const actions = d?.actions
  const findingLines: string[] = []
  if (actions) {
    for (const text of actions.quick_fix ?? []) {
      findingLines.push(`  [HIGH] [quick_fix] ${text}`)
    }
    for (const text of actions.important ?? []) {
      findingLines.push(`  [HIGH] [important] ${text}`)
    }
    for (const text of actions.talk_to_us ?? []) {
      findingLines.push(`  [CRITICAL] [talk_to_us] ${text}`)
    }
  }
  const findingsText = findingLines.length > 0
    ? findingLines.join('\n')
    : '  (no action items from discovery)'

  const crisisContext = d?.crisis_type
    ? `Crisis Type: ${d.crisis_type}\nKey Finding: ${d.key_finding ?? '(none)'}\n`
    : ''

  const priorityDims = intake.priority_dimensions.length > 0
    ? intake.priority_dimensions.join(', ')
    : 'all dimensions'

  return `## Brand Health Discovery (Zhangqian)

Domain: ${discovery.domain}
Business: ${discovery.business.name} — ${discovery.business.industry.join(', ')}
${crisisContext}
Overall Score: ${scores?.overall ?? 'N/A'}/100

Dimension Scores:
${dimensionScoresText}

## Recommended Actions (from discovery)
${findingsText}

## Client Intake

Business Goal: ${intake.business_goal}
Timeline Urgency: ${intake.timeline_urgency}
Monthly Budget: AUD ${intake.monthly_budget_aud}
Priority Dimensions: ${priorityDims}
Additional Notes: ${intake.notes ?? 'None'}

## Instructions

Generate a 3-phase prescription JSON for this AU/NZ business.
Budget: AUD ${intake.monthly_budget_aud}/month — allocations must NOT exceed this total.
Focus on the crisis type and recommended actions listed above.`
}

/**
 * Generate a prescription from a confirmed Zhangqian discovery (no diagnostic run needed).
 */
export async function generatePrescriptionFromDiscovery(
  supabase: SupabaseClient,
  discoveryId: string,
  clientId: string,
  intake: PrescriptionIntake,
  discovery: DiscoveryReport,
): Promise<GeneratePrescriptionResult> {
  const prompt = buildPrescriptionPromptFromDiscovery(discovery, intake)

  const client = getAnthropicClient()
  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')

  const content = parseJsonResponse<PrescriptionContent>(rawText)
  clampBudgetAllocation(content, intake.monthly_budget_aud)

  const prescriptionId = await savePrescription(
    supabase,
    { discoveryId },
    clientId,
    intake,
    content,
  )

  return { prescriptionId, content }
}
