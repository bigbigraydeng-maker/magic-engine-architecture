/**
 * 华佗 Hua Tuo — Prescription Agent (multi-step orchestration).
 *
 * Reference: ROADMAP.md P8.10.S3
 *
 * Pipeline:
 *   1. Lookup     — 行业基准库查询（+ 未来：SEMrush 趋势 + 案例库）
 *   2. Generate   — Claude Sonnet 生成处方 JSON
 *   3. Self-grade — 独立 Claude 调用做 7 维 0-10 分自评
 *   4. Refine     — 如果 overall < 7.0，带着 weaknesses 再生成一次
 *
 * 成本上限：3 次 Claude 调用（generate + grade + 可选 refine）= 约 $0.15–0.30 / 处方
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicClient, parseJsonResponse, MODEL_SONNET } from '@/lib/anthropic/client'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionContent, PrescriptionIntake } from '@/types/diagnostic'
import type {
  HuatuoPrescriptionResult,
  HuatuoLookupContext,
  SelfGrade,
} from './types'
import { fetchBenchmarks, extractBenchmarkIds } from './benchmarks'
import { mapIndustryToCategory } from './industry-mapper'
import {
  HUATUO_GENERATION_SYSTEM_PROMPT,
  HUATUO_SELFGRADE_SYSTEM_PROMPT,
  buildHuatuoGenerationPrompt,
  buildHuatuoSelfGradePrompt,
} from './prompts'

// ─── Constants ────────────────────────────────────────────────────────────────

export const HUATUO_AGENT_VERSION = '1.0.0'

const MAX_OUTPUT_TOKENS_GENERATION = 4096
const MAX_OUTPUT_TOKENS_SELFGRADE = 1024

const REFINE_THRESHOLD = 7.0       // 自评低于此分触发 refine
const MAX_PASSES = 2                // 最多生成两次（不含 self-grade）

// Sonnet 4.5 pricing per million tokens
const PRICE_INPUT_PER_M = 3.0
const PRICE_OUTPUT_PER_M = 15.0

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RunHuatuoOptions {
  /** 跳过 self-grade（用于测试或预览） */
  skipSelfGrade?: boolean
  /** 跳过 refine 即使自评低分（用于 A/B 测试） */
  skipRefine?: boolean
  /** 进度回调（UI 显示阶段提示） */
  onProgress?: (note: string) => void | Promise<void>
}

/**
 * 华佗主入口：从张骞 discovery + 客户意向生成处方（含自评 + 基准引用）。
 */
export async function runHuatuo(
  supabase: SupabaseClient,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  options: RunHuatuoOptions = {},
): Promise<HuatuoPrescriptionResult> {
  const startedAt = Date.now()
  const onProgress = options.onProgress ?? (() => undefined)

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let passes = 0

  // ── Step 1: Lookup（基准库 + 行业映射）────────────────────────────────────
  await onProgress('查询行业基准库…')
  const industryCategory = mapIndustryToCategory(discovery.business.industry)
  const benchmarks = await fetchBenchmarks(supabase, {
    industryCategory,
    businessSize: 'small',
    market: 'AU_NZ',
  })
  const lookup: HuatuoLookupContext = {
    benchmarks,
    industry_category: industryCategory,
  }

  // ── Step 2: Generate（pass 1）────────────────────────────────────────────
  await onProgress('华佗正在开方…')
  const client = getAnthropicClient()
  const pass1 = await generatePrescription(client, discovery, intake, lookup)
  passes = 1
  totalInputTokens += pass1.usage.input
  totalOutputTokens += pass1.usage.output

  let content = pass1.content
  let selfGrade: SelfGrade | null = null

  // ── Step 3: Self-grade ───────────────────────────────────────────────────
  if (!options.skipSelfGrade) {
    await onProgress('华佗自检处方…')
    const grade1 = await selfGradePrescription(client, content, intake, lookup, { pass: 1 })
    totalInputTokens += grade1.usage.input
    totalOutputTokens += grade1.usage.output
    selfGrade = grade1.grade

    // ── Step 4: Refine if grade too low ──────────────────────────────────
    if (
      !options.skipRefine &&
      selfGrade.overall < REFINE_THRESHOLD &&
      passes < MAX_PASSES
    ) {
      await onProgress(`首轮自评 ${selfGrade.overall}/10 偏低，华佗精修中…`)
      const pass2 = await generatePrescriptionWithFeedback(
        client, discovery, intake, lookup,
        { previousContent: content, weaknesses: selfGrade.weaknesses },
      )
      passes = 2
      totalInputTokens += pass2.usage.input
      totalOutputTokens += pass2.usage.output
      content = pass2.content

      // Re-grade pass 2
      const grade2 = await selfGradePrescription(client, content, intake, lookup, {
        pass: 2,
        previousWeaknesses: selfGrade.weaknesses,
      })
      totalInputTokens += grade2.usage.input
      totalOutputTokens += grade2.usage.output
      selfGrade = grade2.grade
    }
  }

  // ── Step 5: Enforce budget ceiling ───────────────────────────────────────
  clampBudgetAllocation(content, intake.monthly_budget_aud)

  // ── Assemble result ──────────────────────────────────────────────────────
  const costUsd =
    (totalInputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_M

  return {
    content,
    self_grade: selfGrade ?? makeDefaultGrade(),
    benchmarks_used: extractBenchmarkIds(benchmarks),
    meta: {
      agent_version: HUATUO_AGENT_VERSION,
      passes,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      cost_usd: Number(costUsd.toFixed(4)),
      duration_ms: Date.now() - startedAt,
      industry_category_used: industryCategory,
    },
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface ClaudeCallResult<T> {
  content: T
  usage: { input: number; output: number }
}

async function generatePrescription(
  client: ReturnType<typeof getAnthropicClient>,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
): Promise<ClaudeCallResult<PrescriptionContent>> {
  const userPrompt = buildHuatuoGenerationPrompt(discovery, intake, lookup)
  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_OUTPUT_TOKENS_GENERATION,
    system: HUATUO_GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const rawText = extractText(message.content)
  const parsed = parseJsonResponse<PrescriptionContent>(rawText)
  return {
    content: parsed,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}

async function generatePrescriptionWithFeedback(
  client: ReturnType<typeof getAnthropicClient>,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
  feedback: { previousContent: PrescriptionContent; weaknesses: string[] },
): Promise<ClaudeCallResult<PrescriptionContent>> {
  const basePrompt = buildHuatuoGenerationPrompt(discovery, intake, lookup)
  const feedbackBlock = `\n\n## 上一轮的处方与自检反馈\n\n上一轮你生成的处方有以下问题，请在本轮**针对性修复**（不要重新发明，保留好的部分，只改薄弱处）：\n\n${feedback.weaknesses.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n\n上一轮处方 JSON：\n\`\`\`json\n${JSON.stringify(feedback.previousContent, null, 2)}\n\`\`\`\n\n现在输出修订后的完整处方 JSON。`
  const userPrompt = basePrompt + feedbackBlock

  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_OUTPUT_TOKENS_GENERATION,
    system: HUATUO_GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const rawText = extractText(message.content)
  const parsed = parseJsonResponse<PrescriptionContent>(rawText)
  return {
    content: parsed,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}

interface GradeCallResult {
  grade: SelfGrade
  usage: { input: number; output: number }
}

async function selfGradePrescription(
  client: ReturnType<typeof getAnthropicClient>,
  prescription: PrescriptionContent,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
  options: { pass: number; previousWeaknesses?: string[] },
): Promise<GradeCallResult> {
  const userPrompt = buildHuatuoSelfGradePrompt(prescription, intake, lookup, options)
  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_OUTPUT_TOKENS_SELFGRADE,
    system: HUATUO_SELFGRADE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const rawText = extractText(message.content)
  const parsed = parseJsonResponse<SelfGrade>(rawText)
  // Sanity-clamp to 0–10
  parsed.overall = clamp(parsed.overall, 0, 10)
  if (parsed.dimensions) {
    for (const key of Object.keys(parsed.dimensions) as Array<keyof typeof parsed.dimensions>) {
      parsed.dimensions[key] = clamp(parsed.dimensions[key], 0, 10)
    }
  }
  return {
    grade: parsed,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}

function extractText(blocks: Array<{ type: string; text?: string }>): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clampBudgetAllocation(content: PrescriptionContent, maxBudget: number): void {
  if (!content.budget_allocation || content.budget_allocation.length === 0) return
  const total = content.budget_allocation.reduce((sum, b) => sum + b.amount_aud, 0)
  if (total <= maxBudget) return
  const ratio = maxBudget / total
  for (const item of content.budget_allocation) {
    item.amount_aud = Math.floor(item.amount_aud * ratio)
    item.percentage = Math.round(item.percentage * ratio)
  }
}

function makeDefaultGrade(): SelfGrade {
  return {
    overall: 0,
    dimensions: {
      realism: 0, completeness: 0, fde_actionability: 0, roi_alignment: 0,
      prioritization: 0, resource_match: 0, innovation: 0,
    },
    weaknesses: ['自评步骤被跳过'],
    improvements_made: [],
  }
}
