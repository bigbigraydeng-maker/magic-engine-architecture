/**
 * 成交/咨询回传管道：每天自动跑一遍（PM 拍板 2026-09-15："每天有新客户咨询,
 * 为何被判定太老了" → 查出根因是同步这一步还是纯手动、没有每天自动跑 → PM 拍板
 * "做"）。
 *
 * 四步顺序执行，一步失败不挡下一步（各自用 try/catch 包起来，互不连坐）：
 *   1. `sync-nal`    —— 扫 NAL 私信，判有效咨询，写 `me_sale_outcomes`（pending_review）
 *   2. `sync-cts`    —— 扫 CTS 表格，同上
 *   3. `ai-review-nal` —— 对 NAL 的 `pending_review` 记录跑 AI 判断+自动发送
 *   4. `ai-review-cts` —— 对 CTS 同上
 *
 * 先同步再审核，同一天新同步进来的记录当天就能被审核到，不用等下一轮。
 *
 * 🔴 **这是本仓第一次让"会真花钱/真发数据出去"的步骤（③④）接上自动定时**——
 *    之前两轮设计复审明确建议"先观察几天判断质量和熔断阈值，再决定要不要接定时"
 *    （见 `ai-auto-review-run.ts` 文件头），这次是 PM 在看到一次干净的手动试跑结果
 *    （15 条：14 条正确判过期不发送、1 条 AI 拿不准放着、0 条误发）之后明确拍板"做"，
 *    不是我自己绕过那条建议——这条历史必须留在这里，不然以后有人以为这是随手加的。
 *
 * 🔴 **不做成"派单+单客户 event"两段式**（对照 `flywheel-seo-weekly.ts` 的两段模式）：
 *    那边要两段是因为客户名单是动态查出来的、数量不定，用 event fan-out 天然并发；
 *    这里永远只有 NAL/CTS 两个写死的客户，四步顺序执行一个函数就够，没必要为"看起来
 *    更像标准范式"而引入用不上的复杂度。
 *
 * 🔴 **`retries: 0`**——③④两步会真的调用 AI + 真的发 Meta CAPI，函数内部的钱已经花出去
 *    了；整条函数重试 = 再判一次、可能再发一次（虽然 CAS 幂等能挡住真正的重复发送，
 *    但重跑一遍①②两步去重新扫全量数据、多打一轮 AI token，没必要——明天这个时间点
 *    自然会再跑一遍，等不及就手动调 `POST /api/admin/conversions/ai-auto-review-run`）。
 *
 * 🔴 **`ai_auto_review_enabled` 开关 + 异常刹车原样生效**——这个函数不判断"要不要跑
 *    AI 审核"，`runAiAutoReviewForClient()` 内部自己会先查开关、查熔断，关着的客户
 *    这里调了也是直接跳过，不需要在这一层重复判断。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { runNalMessengerLeadSync } from '@/lib/conversions/nal-messenger-lead-sync-run'
import { runCtsCrmSync } from '@/lib/conversions/cts-crm-sheet-sync-run'
import { runAiAutoReviewForClient } from '@/lib/conversions/ai-auto-review-run'
import { metaCapiWriter } from '@/lib/meta/capi/writer'

export const CONVERSION_DAILY_PIPELINE_JOB = 'conversion-daily-pipeline'
export const CONVERSION_DAILY_PIPELINE_TZ = 'Pacific/Auckland'
/** 早上 6 点——给 PM/FDE 早上上班时今日待办里就能看到前一晚的结果。 */
export const CONVERSION_DAILY_PIPELINE_CRON = '0 6 * * *'

const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

type StepResult<T> = { ok: true; summary: T } | { ok: false; error: string }

async function guarded<T>(label: string, fn: () => Promise<T>): Promise<StepResult<T>> {
  try {
    return { ok: true, summary: await fn() }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[${CONVERSION_DAILY_PIPELINE_JOB}] ${label} 失败：${error}`)
    return { ok: false, error }
  }
}

/**
 * 依赖注入版，便于测试注入假的同步/审核实现，不碰真 Supabase/AI/Meta。
 *
 * 三个依赖的返回值类型故意留成 `unknown`（不是各自真实的 Summary/RunSummary 类型）：
 * 这个函数本身不读、不判断这些返回值的内部字段，只是原样塞进运行记录的 summary 里，
 * 用真实类型反而会把"这个装配层不关心业务细节"这件事，跟"业务细节碰巧长这样"混为一谈。
 */
export function createConversionDailyPipelineFunction(deps: {
  supabase: SupabaseClient
  syncNal: () => Promise<unknown>
  syncCts: () => Promise<unknown>
  reviewClient: (clientId: string) => Promise<unknown>
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}conversion-daily-pipeline`,
      name: 'Conversions: daily sync + AI auto-review',
      concurrency: { limit: 1 },
      retries: 0,
    },
    { cron: `TZ=${CONVERSION_DAILY_PIPELINE_TZ} ${CONVERSION_DAILY_PIPELINE_CRON}` },
    async ({ step }) => {
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(CONVERSION_DAILY_PIPELINE_JOB),
        startedAt: Date.now(),
      }))
      const run = cronRunHandle(CONVERSION_DAILY_PIPELINE_JOB, started.runId, started.startedAt)

      const nalSync = await step.run('sync-nal', () => guarded('sync-nal', deps.syncNal))
      const ctsSync = await step.run('sync-cts', () => guarded('sync-cts', deps.syncCts))
      const nalReview = await step.run('ai-review-nal', () =>
        guarded('ai-review-nal', () => deps.reviewClient(NAL_CLIENT_ID)),
      )
      const ctsReview = await step.run('ai-review-cts', () =>
        guarded('ai-review-cts', () => deps.reviewClient(CTS_CLIENT_ID)),
      )

      const results = { nalSync, ctsSync, nalReview, ctsReview }
      const failedCount = Object.values(results).filter((r) => !r.ok).length

      await step.run('log-finish', async () => {
        await run.finish({
          processed: 4,
          completed: 4 - failedCount,
          failed: failedCount,
          summary: results,
          error: failedCount > 0 ? `${failedCount}/4 步失败，看 summary 具体哪步` : undefined,
        })
        return null
      })

      return results
    },
  )
}

/** 生产实例。 */
export const conversionDailyPipeline = createConversionDailyPipelineFunction({
  supabase: supabaseAdmin,
  syncNal: () => runNalMessengerLeadSync(),
  syncCts: () => runCtsCrmSync(),
  reviewClient: (clientId) =>
    runAiAutoReviewForClient(clientId, {
      supabase: supabaseAdmin,
      sendDeps: { writer: metaCapiWriter, fetcher: fetch },
    }),
})
