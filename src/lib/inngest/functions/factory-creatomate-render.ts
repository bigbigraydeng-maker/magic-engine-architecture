/**
 * Creatomate 渲染工作流（spec docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4）。
 *
 * 🔴 付费步骤（prepare-assets / submit）一律 `retries: 0`——Inngest 默认对失败的 step
 *    重放整个 step，而这两步花的是真钱（gpt-image/Muapi/Creatomate），重放 = 重复扣钱
 *    （子牙+鲁班复审交叉指出）。幂等靠"先查 job 行有没有已经做过"，不是禁止重试本身。
 *
 * 🔴 webhook 不可信：无法验证来源（官方文档没给签名机制，spec §3.3/§6.1）。events.ts 里
 *    webhook 事件类型上就不带 status/url，物理上不给"直接采信"的机会——不管是被 webhook
 *    唤醒还是等满超时，下一步永远是独立调 GET /v2/renders/{id} 拿真实状态。
 *
 * 🔴 卡死回收：旧 ffmpeg 路径的 `reapStale()` 随 2026-09-02 退役一起死了（子牙 ❌B4）。
 *    这条新路径不依赖它，超时后有限次数轮询兜底，仍未到终态就转人工待办
 *    （`src/lib/pm-todo/manual-items.ts`），不会安静卡在 `rendering` 里没人知道。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRunId, cronRunHandle } from '@/lib/cron/run-logger'
import {
  CREATOMATE_RENDER_REQUESTED_EVENT,
  CREATOMATE_RENDER_WEBHOOK_RECEIVED_EVENT,
  CreatomateRenderRequestedSchema,
} from '@/lib/creatomate/events'
import { prepareSceneAssets, type PreparedScene } from '@/lib/creatomate/scene-assets'
import { buildModifications } from '@/lib/creatomate/modifications'
import { submitRender, getRender } from '@/lib/creatomate/render'
import { isTerminalStatus, type CreatomateRender, type CreatomateTemplateContract } from '@/lib/creatomate/types'
import { storeCreatomateResult } from '@/lib/creatomate/store-result'
import { projectFactoryConfig } from '@/lib/factory/client-config'

const REPOLL_ATTEMPTS = 10
const REPOLL_INTERVAL = '2m'

interface JobRow {
  id: string
  client_id: string
  content_post_id: string
  status: string
  scenes: PreparedScene[] | null
  creatomate_render_id: string | null
}

async function patchJob(supabase: SupabaseClient, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('content_factory_render_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) throw new Error(`patchJob(${jobId}) 失败: ${error.message}`)
}

async function readJob(supabase: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data, error } = await supabase
    .from('content_factory_render_jobs')
    .select('id, client_id, content_post_id, status, scenes, creatomate_render_id')
    .eq('id', jobId)
    .single()
  if (error || !data) throw new Error(`render job not found: ${jobId}`)
  return data as JobRow
}

/** 只读一次 factory_config，原样传下去——不拼凑/强转出第二份假形状（避免接口跟真实
 *  生产者对不上，见 memory feedback-as-unknown-as-hides-shape-mismatch）。 */
async function readFactoryConfig(supabase: SupabaseClient, clientId: string): Promise<unknown> {
  const { data } = await supabase.from('clients').select('factory_config').eq('id', clientId).single()
  return data?.factory_config ?? null
}

/** 复用 client-config.ts::projectFactoryConfig 同一份解析逻辑（Settings UI 的 GET 端点
 *  也走它）——两处各写一份容易在字段名（snake_case 存储 vs camelCase 内存）上悄悄岔开。 */
function extractTemplateContract(factoryConfig: unknown, clientId: string): CreatomateTemplateContract {
  const c = projectFactoryConfig(factoryConfig).render?.creatomate
  if (!c) {
    throw new Error(`该客户未配置 Creatomate 模板（clients.factory_config.render.creatomate，client=${clientId}）`)
  }
  return c
}

async function readPostFields(
  supabase: SupabaseClient,
  postId: string,
): Promise<{ title: string; script: string }> {
  const { data, error } = await supabase.from('content_posts').select('title, script').eq('id', postId).single()
  if (error || !data) throw new Error(`content_posts not found: ${postId}`)
  if (!data.script?.trim()) throw new Error('选题没有逐字稿，无法做片')
  return { title: data.title ?? '', script: data.script }
}

async function finalizeSuccess(
  supabase: SupabaseClient,
  job: JobRow,
  render: CreatomateRender,
): Promise<void> {
  if (!render.url) throw new Error(`Creatomate 状态 succeeded 但没有 url（render_id=${render.id}）`)
  const { storageUrl } = await storeCreatomateResult({
    resultUrl: render.url,
    clientId: job.client_id,
    jobId: job.id,
  })
  await patchJob(supabase, job.id, { status: 'ready_for_review', output_url: storageUrl })
  await supabase.from('content_posts').update({ source_video_url: storageUrl }).eq('id', job.content_post_id)
}

async function finalizeFailure(supabase: SupabaseClient, job: JobRow, reason: string): Promise<void> {
  await patchJob(supabase, job.id, { status: 'failed', error: reason })
  // 人工待办见 src/lib/pm-todo/manual-items.ts::pushCreatomateRenderItems（读这张表的
  // failed 行，不在这里直接写待办表——同一份"扫失败行"逻辑复用，不建第二条通道）。
}

export function createFactoryCreatomateRender(deps: { supabase: SupabaseClient }) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}factory-creatomate-render`,
      name: 'Factory: Creatomate template render',
      concurrency: { limit: 3, key: 'event.data.client_id' },
    },
    { event: CREATOMATE_RENDER_REQUESTED_EVENT },
    async ({ event, step }) => {
      const parsed = CreatomateRenderRequestedSchema.safeParse(event.data)
      if (!parsed.success) return { ok: false, reason: 'invalid_payload' }
      const { job_id: jobId } = parsed.data

      // job_name 必须是静态字面量（不能拼 jobId 进去）——registry.test.ts 用 AST 静态扫描
      // startCronRun(Id) 的入参来认领监控清单，动态值会读不出来、也会让 job_name 无限增殖，
      // 这套回执机制是给"稳定命名的任务"用的，具体是哪条 render 由 summary.source_record_id 区分。
      const runId = await step.run('start-receipt', () => startCronRunId('creatomate-render'))
      const startedAt = Date.now()

      try {
        const result = await runWorkflow(deps.supabase, jobId, step)
        await step.run('finish-receipt', () =>
          cronRunHandle('creatomate-render', runId, startedAt).finish({
            completed: result.ok ? 1 : 0,
            failed: result.ok ? 0 : 1,
            summary: {
              request_id: runId,
              client_id: result.clientId,
              source_record_id: jobId,
              cost_usd: result.costUsd,
              no_publish: true,
            },
            error: result.ok ? undefined : result.reason,
          }),
        )
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await step.run('finish-receipt-error', () =>
          cronRunHandle('creatomate-render', runId, startedAt).finish({ failed: 1, error: message }),
        )
        throw e
      }
    },
  )
}

type StepTools = GetStepTools<typeof inngest>

async function runWorkflow(
  supabase: SupabaseClient,
  jobId: string,
  step: StepTools,
): Promise<{ ok: boolean; reason?: string; clientId: string; costUsd: number }> {
  const job = await step.run('check-existing', () => readJob(supabase, jobId))

  const scenes = job.scenes ?? (await ensureSceneAssets(supabase, step, job))
  const costUsd = scenes.reduce((sum, s) => sum + s.costUsd, 0)

  const renderId = job.creatomate_render_id ?? (await ensureSubmitted(supabase, step, job, scenes))

  await step.waitForEvent(`wait-webhook-${jobId}`, {
    event: CREATOMATE_RENDER_WEBHOOK_RECEIVED_EVENT,
    timeout: '15m',
    match: 'data.job_id',
  })

  const render = await resolveTerminal(step, renderId)
  if (!render) {
    await step.run('finalize-timeout', () => finalizeFailure(supabase, job, 'Creatomate 渲染超时未完成'))
    return { ok: false, reason: 'timeout', clientId: job.client_id, costUsd }
  }
  if (render.status === 'succeeded') {
    await step.run('finalize-success', () => finalizeSuccess(supabase, job, render))
    return { ok: true, clientId: job.client_id, costUsd }
  }

  const reason = render.errorMessage ?? `Creatomate 渲染失败（状态：${render.status}）`
  await step.run('finalize-failure', () => finalizeFailure(supabase, job, reason))
  return { ok: false, reason, clientId: job.client_id, costUsd }
}

async function ensureSceneAssets(
  supabase: SupabaseClient,
  step: StepTools,
  job: JobRow,
): Promise<PreparedScene[]> {
  return step.run('prepare-assets', async () => {
    const { title, script } = await readPostFields(supabase, job.content_post_id)
    const factoryConfig = await readFactoryConfig(supabase, job.client_id)
    const scenes = await prepareSceneAssets({
      clientId: job.client_id,
      jobId: job.id,
      title,
      script,
      factoryConfig,
    })
    await patchJob(supabase, job.id, { status: 'rendering', scenes })
    return scenes
  })
}

async function ensureSubmitted(
  supabase: SupabaseClient,
  step: StepTools,
  job: JobRow,
  scenes: PreparedScene[],
): Promise<string> {
  const renderId = await step.run('submit', async () => {
    const factoryConfig = await readFactoryConfig(supabase, job.client_id)
    const contract = extractTemplateContract(factoryConfig, job.client_id)
    const modifications = buildModifications(scenes, contract)
    const webhookUrl = `${requireBaseUrl()}/api/webhooks/creatomate`
    const { renderId } = await submitRender({ templateId: contract.templateId, modifications, webhookUrl }, contract)
    return renderId
  })
  await step.run('persist-render-id', () => patchJob(supabase, job.id, { creatomate_render_id: renderId }))
  return renderId
}

async function resolveTerminal(step: StepTools, renderId: string): Promise<CreatomateRender | null> {
  let render = await step.run('confirm-status', () => getRender(renderId))
  for (let attempt = 0; attempt < REPOLL_ATTEMPTS && !isTerminalStatus(render.status); attempt++) {
    await step.sleep(`repoll-wait-${attempt}`, REPOLL_INTERVAL)
    render = await step.run(`repoll-${attempt}`, () => getRender(renderId))
  }
  return isTerminalStatus(render.status) ? render : null
}

function requireBaseUrl(): string {
  // APP_URL 优先于 NEXT_PUBLIC_APP_URL —— 沿用 gbp/start/route.ts 等既有路由的同款惯例。
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('缺少 APP_URL / NEXT_PUBLIC_APP_URL，webhook_url 拼不出来')
  return url
}

export const factoryCreatomateRender = createFactoryCreatomateRender({ supabase: supabaseAdmin })
