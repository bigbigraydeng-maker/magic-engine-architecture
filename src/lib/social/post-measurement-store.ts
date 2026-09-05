/**
 * Act→Check 的落库层：发布动作行、测量回执、测量数字。
 *
 * ## 幂等全部压在数据库唯一约束上
 *
 * 「先查询、再插入」在并发下必漏 —— T+4 与 T+72 是两个独立 Inngest run，事件重放
 * 还可能让同一窗口同时跑两份。所以每处写入都是 insert → 撞 23505 → 回读/更新。
 * 三条约束见 `20260905000001_social_post_measurement_receipts.sql`。
 *
 * ## expected_metric 必须是 NULL
 *
 * 通用归因（`flywheel/attribution/job.ts`）按 `client_id + metric_key + 时间窗` 找
 * 基线与结果，**不看帖子身份**：同一客户两条帖子写同一个 `social.post.likes`，后一条
 * 的基线会捞到前一条的读数，delta 毫无意义。`loadAttributableActions` 只加载
 * `expected_metric IS NOT NULL` 的行，所以写 NULL = 通用归因根本不加载本动作，
 * 从结构上杜绝串帖。本期不接 Tune，单帖效果靠 action_id / idempotency_key 直查。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const UNIQUE_VIOLATION = '23505'

export const SOCIAL_PUBLISH_ACTION_TYPE = 'social.publish_post'

export const POST_METRIC_KEYS = {
  likes: 'social.post.likes',
  comments: 'social.post.comments',
  shares: 'social.post.shares',
} as const

export type PostMetricField = keyof typeof POST_METRIC_KEYS
export type ReceiptStatus = 'ok' | 'partial' | 'unmeasurable'

export interface PublishActionInput {
  clientId: string
  idempotencyKey: string
  postId: string
  pageId: string
  permalink: string
  campaignId: string
  planId: string
  publishedAt: string
  scheduledPublishTime?: string
  measureAt: { hours: number; at: string }[]
}

/**
 * 记录「这条帖子已经发出去了」这个既成事实。隔离校验通过后立刻写，**此时不检查
 * token** —— 帖子已经在 Facebook 上，令牌能不能读表现是后面的事，不该抹掉发布事实。
 *
 * 不复用 `logSocialPublishedAction`：它把 vendor 写死 `publer`、source 写死
 * `ai_factory`、还带 `expected_metric`，硬套会污染归因。
 */
export async function recordPublishAction(
  supabase: SupabaseClient,
  input: PublishActionInput,
): Promise<string> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .insert({
      client_id: input.clientId,
      flywheel: 'social',
      action_type: SOCIAL_PUBLISH_ACTION_TYPE,
      execution_mode: 'in_house',
      vendor: 'meta_graph',
      // 🔴 见文件头：NULL 让通用归因完全不加载本行，杜绝跨帖串台。
      expected_metric: null,
      expected_delta: null,
      // 公开时刻，不是提交时刻。排期帖两者可以差几天。
      executed_at: input.scheduledPublishTime ?? input.publishedAt,
      payload: {
        source: 'daily_plan',
        idempotency_key: input.idempotencyKey,
        post_id: input.postId,
        page_id: input.pageId,
        permalink: input.permalink,
        campaign_id: input.campaignId,
        plan_id: input.planId,
        published_at: input.publishedAt,
        ...(input.scheduledPublishTime ? { scheduled_publish_time: input.scheduledPublishTime } : {}),
        // 回执**不**写在这里 —— 两个窗口并发 read-modify-write 会互相覆盖。
        measure_at: input.measureAt,
      },
    })
    .select('id')
    .single()

  if (!error && data) return (data as { id: string }).id

  if (error && (error as { code?: string }).code === UNIQUE_VIOLATION) {
    // 并发或重放已经写过 —— 回读那一行，不再插。
    const { data: existing, error: readError } = await supabase
      .from('flywheel_actions')
      .select('id')
      .eq('client_id', input.clientId)
      .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
      .eq('payload->>idempotency_key', input.idempotencyKey)
      .maybeSingle()
    if (readError || !existing) {
      throw new Error(
        `recordPublishAction: unique conflict but row not readable — ${readError?.message ?? 'not found'}`,
      )
    }
    return (existing as { id: string }).id
  }

  throw new Error(`recordPublishAction: ${error?.message ?? 'insert returned no row'}`)
}

export interface ReceiptInput {
  clientId: string
  actionId: string
  idempotencyKey: string
  postId: string
  pageId: string
  windowHours: number
  targetAt: string
  measuredAt: string | null
  status: ReceiptStatus
  values: Record<string, number>
  missing: Record<string, string>
  reason?: string | null
  graphCode?: number | null
  graphSubcode?: number | null
}

/**
 * 写一条测量回执。同一 (action_id, window_hours) 重跑更新同一行，不新增。
 *
 * 「读不到」只存在于这里 —— `flywheel_metrics.metric_value` 是 NOT NULL，
 * 无法测量绝不能伪装成一个指标行。
 */
export async function upsertMeasurementReceipt(
  supabase: SupabaseClient,
  input: ReceiptInput,
): Promise<string> {
  const { data, error } = await supabase
    .from('social_post_measurement_receipts')
    .upsert(
      {
        client_id: input.clientId,
        action_id: input.actionId,
        idempotency_key: input.idempotencyKey,
        post_id: input.postId,
        page_id: input.pageId,
        window_hours: input.windowHours,
        target_at: input.targetAt,
        measured_at: input.measuredAt,
        status: input.status,
        values: input.values,
        missing: input.missing,
        reason: input.reason ?? null,
        graph_code: input.graphCode ?? null,
        graph_subcode: input.graphSubcode ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'action_id,window_hours' },
    )
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`upsertMeasurementReceipt: ${error?.message ?? 'upsert returned no row'}`)
  }
  return (data as { id: string }).id
}

export interface MetricInput {
  clientId: string
  metricKey: string
  value: number
  actionId: string
  idempotencyKey: string
  postId: string
  pageId: string
  windowHours: number
  targetAt: string
  receiptId: string
  measuredAt: string
}

/**
 * 写一个测量数字。只在 Meta 明确返回 number 时调用。
 * 重复执行撞唯一约束 → 视为已写，不产生重复数字。
 */
export async function writePostMetric(
  supabase: SupabaseClient,
  input: MetricInput,
): Promise<'inserted' | 'already_present'> {
  const { error } = await supabase.from('flywheel_metrics').insert({
    client_id: input.clientId,
    flywheel: 'social',
    metric_key: input.metricKey,
    metric_value: input.value,
    source: 'meta_graph',
    source_ref: {
      action_id: input.actionId,
      idempotency_key: input.idempotencyKey,
      post_id: input.postId,
      page_id: input.pageId,
      window_hours: input.windowHours,
      target_at: input.targetAt,
      receipt_id: input.receiptId,
    },
    measured_at: input.measuredAt,
  })

  if (!error) return 'inserted'
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'already_present'
  throw new Error(`writePostMetric(${input.metricKey}): ${error.message}`)
}
