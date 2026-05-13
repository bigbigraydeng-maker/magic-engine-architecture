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

const SYSTEM_PROMPT = `You are a senior digital marketing strategist for the Magic Engine platform, serving AU/NZ businesses.

Your task: given a diagnostic report + client intake, generate a structured 3-phase marketing prescription.

Rules:
- Exactly 3 phases: Phase 1 (quick wins, 2–4 weeks), Phase 2 (structural, 4–8 weeks), Phase 3 (long-term, 8–12 weeks)
- Each action's "phase" field must equal its parent phase_number (1, 2, or 3)
- fix_type must be "me_auto", "fde_manual", or "third_party"
- budget_allocation amounts must sum to AT MOST the monthly_budget_aud
- Focus on critical and high severity findings; ignore medium/low
- Respond ONLY with valid JSON — no markdown fences, no explanatory text

Output schema:
{
  "summary": "string",
  "phases": [
    {
      "phase_number": 1,
      "name": "string",
      "duration_weeks": number,
      "actions": [
        {
          "id": "unique-string",
          "title": "string",
          "description": "string",
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
      "metric": "string",
      "current_value": number|null,
      "target_value": number,
      "unit": "string",
      "dimension": "seo|..."
    }
  ],
  "budget_allocation": [
    {
      "dimension": "seo|...",
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

  const prescriptionId = await savePrescription(supabase, runId, clientId, intake, content)

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
  runId: string,
  clientId: string,
  intake: PrescriptionIntake,
  content: PrescriptionContent,
): Promise<string> {
  const { data, error } = await supabase
    .from('prescriptions')
    .insert({
      client_id:    clientId,
      run_id:       runId,
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
