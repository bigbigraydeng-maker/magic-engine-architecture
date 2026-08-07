/**
 * Phase 23.C — L3 记忆自动抽取器
 *
 * 从 flywheel_outcomes + flywheel_actions 中规则化地推导 L3 记忆条目：
 *
 *   1. confirmed outcomes (confidence ≥ 0.6) → client_proven_patterns
 *   2. reversed  outcomes (confidence ≥ 0.6) → client_failed_experiments
 *   3. 同 action_type ≥ MIN_OCCURRENCES 次 confirmed → client_learned_preferences
 *   4. client_decision_history.outcome_verdict 回填（时间窗内匹配 outcomes）
 *
 * 设计原则：
 *   - 纯规则版本，无 LLM 调用 — 廉价、可解释、易回滚
 *   - 幂等：通过 (source_table='flywheel_actions', source_id=action.id) 去重
 *   - 失败不阻塞：单条出错记入 errors，继续处理其余
 *   - 不删除已有记忆 — 抽取器只追加 + 标记，FDE 可在 P23.E 中清理
 *
 * 🔴 **幂等键必须挂 action.id，绝对不能挂 outcome.id。**
 *
 *    归因作业每 6 小时对每个动作 `delete().eq('action_id', id)` 再 insert 一条新的
 *    （`flywheel/attribution/job.ts:127-149`），而 `flywheel_outcomes.id` 是
 *    `gen_random_uuid()` 默认值 —— **同一条归因结论的 id 每 6 小时换一次**。
 *
 *    早先这里用的正是 outcome.id。那样接上每日 cron 的后果是：
 *    第 1 天写一条经验；归因重跑换了 id；第 2 天去重集合对不上，**再写一条一模一样的**；
 *    每天 +1，永不收敛。而诸葛亮读记忆只取最新 15 条（`memory/service.ts` loadPatterns）
 *    —— 两周后那 15 条会全是同一条经验的 15 个副本，**比现在空着更糟**。
 *
 *    `action_id` 是安全的：归因按 action_id 整条删，所以一个动作恒有且仅有一条
 *    outcome，一对一；而 `flywheel_actions` 行本身从不被重建。
 *
 * ⚠️ 已知局限（有意不处理）：同一个动作的 verdict 若从 confirmed 翻成 reversed，
 *    会同时留下一条「这招有效」和一条「这招失败」——因为两者查的是不同的表。
 *    翻转本身罕见（要指标反向越过阈值），而两条互相矛盾的记忆远好过 365 条重复。
 *    真要治，等 P23.E 的 FDE 清理界面，或给记忆加 supersede 关系。
 *
 * Reference: ROADMAP.md Phase 23.C
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import {
  saveProvenPattern,
  saveFailedExperiment,
  savePreference,
  updateDecisionOutcome,
} from './service'
import type { FlywheelName, PatternType, PreferenceType } from './types'

/**
 * 记忆行的溯源表名。**改这个常量等于让全部历史去重记录失效**（旧行的
 * source_table 对不上，会被当成「没抽取过」重写一遍），所以只有在同时
 * 准备好数据迁移时才改。
 */
const MEMORY_SOURCE_TABLE = 'flywheel_actions'

// ── 配置参数 ──────────────────────────────────────────────────────────────────

/** 写入 patterns/experiments 的最低 outcome confidence */
const MIN_OUTCOME_CONFIDENCE = 0.6

/** 同 action_type 连续 confirmed ≥ N 次才生成 learned_preference */
const MIN_OCCURRENCES_FOR_PREFERENCE = 3

/** decision → outcome 匹配的时间窗（天） */
const DECISION_MATCH_WINDOW_DAYS = 14

// ── 公共类型 ──────────────────────────────────────────────────────────────────

export interface ExtractorResult {
  outcomes_processed: number
  patterns_added: number
  experiments_added: number
  preferences_added: number
  decisions_updated: number
  errors: string[]
}

export interface ExtractorBatchResult {
  clients_processed: number
  aggregate: ExtractorResult
  per_client_errors: Array<{ client_id: string; error: string }>
}

// ── 内部类型 ──────────────────────────────────────────────────────────────────

interface OutcomeJoinRow {
  outcome_id: string
  client_id: string
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number | null
  verdict: 'confirmed' | 'inconclusive' | 'reversed'
  computed_at: string
  window_days: number
  action_id: string
  action_type: string
  flywheel: FlywheelName
  vendor: string | null
  executed_at: string
}

// ── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 为单个客户跑抽取器。
 * 任何 step 失败都会记入 errors，不会抛出。
 */
export async function runExtractorForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ExtractorResult> {
  const result: ExtractorResult = {
    outcomes_processed: 0,
    patterns_added: 0,
    experiments_added: 0,
    preferences_added: 0,
    decisions_updated: 0,
    errors: [],
  }

  // 1. 拉取该客户所有 high-confidence outcomes + JOIN action
  let outcomes: OutcomeJoinRow[] = []
  try {
    outcomes = await loadOutcomesWithActions(supabase, clientId)
    result.outcomes_processed = outcomes.length
  } catch (err) {
    result.errors.push(`load outcomes: ${msgOf(err)}`)
    return result
  }

  if (outcomes.length === 0) {
    return result
  }

  // 2. 拉取已抽取的 source_id 集合（去重用）
  //
  // 🔴 读不回来就**不写** patterns/experiments，而不是「照写、大不了重复」。
  //    这个任务每天跑：一次读失败换来的不是一条冗余，是从此每天一条冗余
  //    （下次跑同样读不到自己上次写的，就再写一条）。少记一天经验可以补，
  //    污染了的记忆表要人去捞。
  let existingPatternSourceIds = new Set<string>()
  let existingExperimentSourceIds = new Set<string>()
  let dedupReady = true
  try {
    existingPatternSourceIds = await loadExistingSourceIds(
      supabase, clientId, 'client_proven_patterns',
    )
    existingExperimentSourceIds = await loadExistingSourceIds(
      supabase, clientId, 'client_failed_experiments',
    )
  } catch (err) {
    dedupReady = false
    result.errors.push(`load existing（本轮跳过经验写入，避免写重）: ${msgOf(err)}`)
  }

  // 3. 逐条处理 outcomes
  for (const out of dedupReady ? outcomes : []) {
    try {
      // 🔴 去重键是 action_id，不是 outcome_id —— 理由见文件头。
      //    写入后随手把 id 加进集合：同一批里同一个动作出现两次也不会写两条。
      if (out.verdict === 'confirmed' && (out.confidence ?? 0) >= MIN_OUTCOME_CONFIDENCE) {
        if (!existingPatternSourceIds.has(out.action_id)) {
          const saved = await saveProvenPattern(supabase, {
            client_id: out.client_id,
            pattern_type: actionToPatternType(out.action_type),
            pattern_content: describePattern(out),
            performance_metric: describeMetric(out),
            flywheel: out.flywheel,
            source_table: MEMORY_SOURCE_TABLE,
            source_id: out.action_id,
          })
          if (saved) {
            result.patterns_added++
            existingPatternSourceIds.add(out.action_id)
          }
        }
      } else if (out.verdict === 'reversed' && (out.confidence ?? 0) >= MIN_OUTCOME_CONFIDENCE) {
        if (!existingExperimentSourceIds.has(out.action_id)) {
          const saved = await saveFailedExperiment(supabase, {
            client_id: out.client_id,
            experiment_description: describeExperiment(out),
            failure_reason: describeFailure(out),
            dimension: flywheelToDimension(out.flywheel),
            tried_at: out.executed_at,
            source_table: MEMORY_SOURCE_TABLE,
            source_id: out.action_id,
          })
          if (saved) {
            result.experiments_added++
            existingExperimentSourceIds.add(out.action_id)
          }
        }
      }
    } catch (err) {
      result.errors.push(`outcome ${out.outcome_id}: ${msgOf(err)}`)
    }
  }

  // 4. 聚合 action_type 频次 → 生成 preferences
  try {
    const added = await extractPreferencesFromActionTypes(
      supabase, clientId, outcomes,
    )
    result.preferences_added += added
  } catch (err) {
    result.errors.push(`extract preferences: ${msgOf(err)}`)
  }

  // 5. 回填 decision_history.outcome_verdict
  try {
    const updated = await backfillDecisionOutcomes(supabase, clientId)
    result.decisions_updated += updated
  } catch (err) {
    result.errors.push(`backfill decisions: ${msgOf(err)}`)
  }

  return result
}

/**
 * 跑全部客户。返回每客户级聚合 + 错误名单。
 */
export async function runExtractorForAllClients(
  supabase: SupabaseClient,
): Promise<ExtractorBatchResult> {
  const aggregate: ExtractorResult = {
    outcomes_processed: 0,
    patterns_added: 0,
    experiments_added: 0,
    preferences_added: 0,
    decisions_updated: 0,
    errors: [],
  }
  const perClientErrors: Array<{ client_id: string; error: string }> = []

  // 仅处理在 outcomes 表里出现过的客户（无 outcome 客户跳过）
  const { data: rows, error } = await supabase
    .from('flywheel_outcomes')
    .select('client_id')
    .order('client_id')

  if (error) {
    return {
      clients_processed: 0,
      aggregate,
      per_client_errors: [{ client_id: '*', error: `list clients: ${error.message}` }],
    }
  }

  const clientIds = Array.from(new Set((rows ?? []).map(r => r.client_id))).filter(Boolean)
  let processed = 0

  for (const clientId of clientIds) {
    try {
      const r = await runExtractorForClient(supabase, clientId)
      processed++
      aggregate.outcomes_processed   += r.outcomes_processed
      aggregate.patterns_added       += r.patterns_added
      aggregate.experiments_added    += r.experiments_added
      aggregate.preferences_added    += r.preferences_added
      aggregate.decisions_updated    += r.decisions_updated
      if (r.errors.length > 0) {
        perClientErrors.push({ client_id: clientId, error: r.errors.join(' | ') })
      }
    } catch (err) {
      perClientErrors.push({ client_id: clientId, error: msgOf(err) })
    }
  }

  return { clients_processed: processed, aggregate, per_client_errors: perClientErrors }
}

// ── 数据加载 helpers ──────────────────────────────────────────────────────────

async function loadOutcomesWithActions(
  supabase: SupabaseClient,
  clientId: string,
): Promise<OutcomeJoinRow[]> {
  // 单跑 JOIN 在 PostgREST 风格里不直观；用两步查询并在内存里合并
  //
  // 🔴 必须走 fetchAll：PostgREST 单次查询硬顶 1000 行且**不报错**。
  //    直接 select 的话，攒够一千条归因结论之后，最老的那些会静默消失 ——
  //    而经验恰恰是越老越该记住的那种东西（见 supabase-paginate.ts 的实测事故）。
  type OutcomeRow = {
    id: string; client_id: string; action_id: string; metric_key: string
    delta: number | null; delta_pct: number | null; confidence: number | null
    verdict: 'confirmed' | 'inconclusive' | 'reversed'
    computed_at: string; window_days: number
  }
  const outcomeRows = await fetchAll<OutcomeRow>((from, to) =>
    supabase
      .from('flywheel_outcomes')
      .select('id, client_id, action_id, metric_key, delta, delta_pct, confidence, verdict, computed_at, window_days')
      .eq('client_id', clientId)
      .in('verdict', ['confirmed', 'reversed'])
      // 分页必须配稳定排序；computed_at 会撞（同一轮归因批量写入），
      // 补 id 做次级排序，否则页与页之间会漏行/重行
      .order('computed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )

  if (outcomeRows.length === 0) return []

  const actionIds = Array.from(new Set(outcomeRows.map(r => r.action_id).filter(Boolean)))
  if (actionIds.length === 0) return []

  // action 侧按 id 批量取。`.in()` 的入参也不能无限长 —— 切块查，
  // 每块内部再 fetchAll 兜住 1000 行上限。
  type ActionRow = {
    id: string; action_type: string; flywheel: FlywheelName
    vendor: string | null; executed_at: string
  }
  const actionRows: ActionRow[] = []
  const IN_CHUNK = 200
  for (let i = 0; i < actionIds.length; i += IN_CHUNK) {
    const chunk = actionIds.slice(i, i + IN_CHUNK)
    const rows = await fetchAll<ActionRow>((from, to) =>
      supabase
        .from('flywheel_actions')
        .select('id, action_type, flywheel, vendor, executed_at')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    )
    actionRows.push(...rows)
  }

  const actionMap = new Map<string, { action_type: string; flywheel: FlywheelName; vendor: string | null; executed_at: string }>()
  for (const a of actionRows) {
    actionMap.set(a.id, {
      action_type: a.action_type,
      flywheel: a.flywheel,
      vendor: a.vendor ?? null,
      executed_at: a.executed_at,
    })
  }

  const joined: OutcomeJoinRow[] = []
  for (const o of outcomeRows) {
    const a = actionMap.get(o.action_id)
    if (!a) continue
    joined.push({
      outcome_id: o.id,
      client_id: o.client_id,
      metric_key: o.metric_key,
      delta: o.delta,
      delta_pct: o.delta_pct,
      confidence: o.confidence,
      verdict: o.verdict,
      computed_at: o.computed_at,
      window_days: o.window_days,
      action_id: o.action_id,
      action_type: a.action_type,
      flywheel: a.flywheel,
      vendor: a.vendor,
      executed_at: a.executed_at,
    })
  }
  return joined
}

/**
 * 读回这个客户已经抽取过哪些动作。
 *
 * 🔴 出错必须**抛**，不能吞掉返回空集合 —— 空集合的意思是「一条都没抽过」，
 *    调用方会照着它把所有经验重写一遍。读失败和真的没有，是完全相反的两件事。
 *    （原来这里 catch 完 return new Set()，正是那个「静默重写」的入口。）
 *
 * 同样必须 fetchAll：老客户的经验条数会超过 1000，截断了的去重集合
 * 等于部分失效，照样写重。
 */
async function loadExistingSourceIds(
  supabase: SupabaseClient,
  clientId: string,
  table: 'client_proven_patterns' | 'client_failed_experiments',
): Promise<Set<string>> {
  const rows = await fetchAll<{ source_id: string | null }>((from, to) =>
    supabase
      .from(table)
      .select('source_id')
      .eq('client_id', clientId)
      .eq('source_table', MEMORY_SOURCE_TABLE)
      .not('source_id', 'is', null)
      .order('source_id', { ascending: true })
      .range(from, to),
  )
  return new Set(rows.map((r) => r.source_id).filter((v): v is string => !!v))
}

// ── Preference 聚合 ───────────────────────────────────────────────────────────

/**
 * 同一 action_type 在该客户上 confirmed 次数达到阈值，生成 learned_preference。
 *
 * 🔴 去重认的是 **(flywheel, preference_type, action_type)**，不认整条 content。
 *    content 里带着次数（「3 次 confirmed: …」），而次数会随着归因累积一直涨 ——
 *    拿整条 content 当键，等于 3 次写一条、4 次再写一条、5 次又一条，
 *    同一个结论在库里堆成一串只有数字不同的行，全都是「有效」的同义反复。
 *    次数变化只是同一条经验变得更可信，该更新 confidence，不该新增一行。
 */
async function extractPreferencesFromActionTypes(
  supabase: SupabaseClient,
  clientId: string,
  outcomes: OutcomeJoinRow[],
): Promise<number> {
  // 按 (flywheel, action_type) 聚合 confirmed 数量
  const grouped = new Map<string, { count: number; flywheel: FlywheelName; actionType: string; samples: OutcomeJoinRow[] }>()
  for (const o of outcomes) {
    if (o.verdict !== 'confirmed') continue
    if ((o.confidence ?? 0) < MIN_OUTCOME_CONFIDENCE) continue
    const key = `${o.flywheel}::${o.action_type}`
    const entry = grouped.get(key) ?? { count: 0, flywheel: o.flywheel, actionType: o.action_type, samples: [] }
    entry.count++
    if (entry.samples.length < 3) entry.samples.push(o)
    grouped.set(key, entry)
  }

  // 已有 auto_extracted preferences → 归一成 (flywheel, type, action_type) 身份集
  const existing = await fetchAll<{ content: string; flywheel: string | null; preference_type: string }>(
    (from, to) =>
      supabase
        .from('client_learned_preferences')
        .select('content, flywheel, preference_type')
        .eq('client_id', clientId)
        .eq('source', 'auto_extracted')
        .order('content', { ascending: true })
        .range(from, to),
  )

  const existingKeys = new Set<string>()
  for (const r of existing) {
    const actionType = actionTypeOfPreferenceContent(r.content)
    if (!actionType) continue // 不是本抽取器写的格式，不参与去重
    existingKeys.add(preferenceKey(r.flywheel ?? 'global', r.preference_type, actionType))
  }

  let added = 0
  for (const entry of Array.from(grouped.values())) {
    if (entry.count < MIN_OCCURRENCES_FOR_PREFERENCE) continue

    const preferenceType: PreferenceType = 'format'
    const key = preferenceKey(entry.flywheel, preferenceType, entry.actionType)
    if (existingKeys.has(key)) continue

    // confidence_score 与样本数挂钩（cap 0.95）
    const confidence = Math.min(0.95, 0.5 + (entry.count - MIN_OCCURRENCES_FOR_PREFERENCE) * 0.1)

    const sample = entry.samples[0]
    const saved = await savePreference(supabase, {
      client_id: clientId,
      preference_type: preferenceType,
      content: `${entry.count} 次 confirmed: action_type='${entry.actionType}' 在 ${entry.flywheel} 飞轮持续跑赢`,
      source: 'auto_extracted',
      confidence_score: confidence,
      flywheel: entry.flywheel,
      // 溯源同样挂动作，不挂归因结论 —— 理由见文件头
      extracted_from_table: MEMORY_SOURCE_TABLE,
      extracted_from_id: sample?.action_id,
    })
    if (saved) {
      added++
      existingKeys.add(key)
    }
  }
  return added
}

/** 偏好条目的稳定身份：跟次数无关，只认「哪个飞轮的哪种动作」。 */
function preferenceKey(flywheel: string, preferenceType: string, actionType: string): string {
  return `${flywheel}::${preferenceType}::${actionType}`
}

/**
 * 从既有 content 里把 action_type 还原出来。
 * 只认本抽取器写的 `action_type='...'` 格式；认不出返回 null（那行不参与去重）。
 */
function actionTypeOfPreferenceContent(content: string): string | null {
  const m = /action_type='([^']+)'/.exec(content)
  return m ? m[1] : null
}

// ── Decision verdict backfill ─────────────────────────────────────────────────

/**
 * 把 client_decision_history.outcome_verdict 是 null 的记录补全：
 * 在 created_at + window 天内查该客户 outcomes，按 majority verdict 决定。
 */
async function backfillDecisionOutcomes(
  supabase: SupabaseClient,
  clientId: string,
): Promise<number> {
  const { data: decisions, error } = await supabase
    .from('client_decision_history')
    .select('id, created_at')
    .eq('client_id', clientId)
    .is('outcome_verdict', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(error.message)
  }
  if (!decisions || decisions.length === 0) return 0

  let updated = 0
  for (const d of decisions) {
    const start = new Date(d.created_at)
    const end = new Date(start)
    end.setDate(end.getDate() + DECISION_MATCH_WINDOW_DAYS)

    const { data: outcomes, error: oErr } = await supabase
      .from('flywheel_outcomes')
      .select('verdict')
      .eq('client_id', clientId)
      .gte('computed_at', start.toISOString())
      .lte('computed_at', end.toISOString())

    if (oErr) continue
    if (!outcomes || outcomes.length === 0) continue

    const verdict = aggregateVerdicts(outcomes.map((o: { verdict: string }) => o.verdict))
    if (!verdict) continue

    await updateDecisionOutcome(supabase, d.id, verdict, `auto-derived from ${outcomes.length} outcomes within ${DECISION_MATCH_WINDOW_DAYS}d window`)
    updated++
  }
  return updated
}

function aggregateVerdicts(verdicts: string[]): 'success' | 'failure' | 'inconclusive' | null {
  let confirmed = 0
  let reversed = 0
  let inconclusive = 0
  for (const v of verdicts) {
    if (v === 'confirmed') confirmed++
    else if (v === 'reversed') reversed++
    else if (v === 'inconclusive') inconclusive++
  }
  const total = confirmed + reversed + inconclusive
  if (total === 0) return null
  if (confirmed > reversed && confirmed >= total / 2) return 'success'
  if (reversed > confirmed && reversed >= total / 2) return 'failure'
  return 'inconclusive'
}

// ── Action-type → pattern_type / description mapping ──────────────────────────

function actionToPatternType(actionType: string): PatternType {
  const a = actionType.toLowerCase()
  if (a.includes('hook') || a.includes('headline') || a.includes('title')) return 'headline'
  if (a.includes('cta')) return 'cta'
  if (a.includes('structure') || a.includes('layout')) return 'structure'
  if (a.includes('publish') || a.includes('post') || a.includes('compose')) return 'format'
  return 'angle'
}

function describePattern(out: OutcomeJoinRow): string {
  const dPct = out.delta_pct != null ? `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}%` : 'positive delta'
  return `${out.flywheel} 飞轮 '${out.action_type}' 在 ${out.window_days} 天窗口内 ${dPct} 提升 ${out.metric_key}（confidence ${round2(out.confidence ?? 0)}）`
}

function describeMetric(out: OutcomeJoinRow): string {
  if (out.delta_pct != null) {
    return `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}% on ${out.metric_key} (${out.window_days}d window)`
  }
  if (out.delta != null) {
    return `Δ ${round2(out.delta)} on ${out.metric_key} (${out.window_days}d window)`
  }
  return `confirmed on ${out.metric_key}`
}

function describeExperiment(out: OutcomeJoinRow): string {
  return `${out.flywheel} 飞轮尝试 action_type='${out.action_type}'（目标指标 ${out.metric_key}）`
}

function describeFailure(out: OutcomeJoinRow): string {
  const dPct = out.delta_pct != null ? `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}%` : '反向变动'
  return `${out.window_days} 天窗口内 ${out.metric_key} ${dPct}，verdict=reversed（confidence ${round2(out.confidence ?? 0)}）`
}

function flywheelToDimension(fw: FlywheelName): 'seo' | 'ai_visibility' | 'ads' | 'social' {
  switch (fw) {
    case 'geo':    return 'ai_visibility'
    case 'seo':    return 'seo'
    case 'ads':    return 'ads'
    case 'social': return 'social'
  }
}

// ── Misc utils ────────────────────────────────────────────────────────────────

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
