/**
 * 读已有的邮件 / 私信 / 电话记录，把空着的「跟进到哪一步」填上。
 *
 * 判断在 `stage-from-conversation.ts`（含为什么这么设计），这里只负责
 * **取数 → 问模型 → 落库 + 留痕**。分工照 `qualified-buyer.ts` /
 * `qualified-buyer-autotag.ts` 那一对。
 *
 * ## 挂在哪
 *
 * 挂在**已经在跑**的 `messenger-brief-hourly` 上，不新注册 cron ——
 * 理由与 `qualified-buyer-autotag` 同一条：新 cron 要手工 link 密钥的环境变量组，
 * 漏了就每天 401 静默失败（daily-cron-digest 哑了 51 天那次就是这么来的）。
 *
 * ## 为什么不会每小时重复烧钱
 *
 * 候选人只从 `stage IS NULL` 里挑，填上一个就少一个。556 个人分几轮跑完之后，
 * 后面每小时捞到的就是 0 个，一次模型调用都不会发生。
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  STAGE_SYSTEM_PROMPT,
  StageVerdictSchema,
  SAFE_STAGES,
  renderTranscript,
  usableStage,
  worthReading,
  type SafeStage,
  type StageVerdict,
  type TranscriptLine,
} from './stage-from-conversation'

/**
 * 改阶段的人写在审计里的名字。
 *
 * 人工改阶段写的是操作者邮箱，两者永远分得开 —— 以后才答得出「AI 填错了多少」，
 * 也才有可能一键回滚这一批。跟 `AUTO_TAG_ACTOR` 是两个不同的名字：那是「自动标
 * 真买家」，这是「读对话填阶段」，出了问题要分得清是哪一套干的。
 */
export const STAGE_INFER_ACTOR = 'ai:conversation-read'

/** 一轮最多问模型这么多次 —— 某天数据暴涨也不会变成一张失控的账单。 */
const MAX_CONTACTS_PER_RUN = 60

/** PostgREST 的 .in() 一次塞太多会把 URL 撑爆。 */
const IN_CHUNK = 100

export interface StageInferResult {
  /** 捞出来的空阶段联系人。 */
  candidates: number
  /** 真的问了模型的。 */
  asked: number
  /** 填上阶段的。 */
  filled: number
  /** 模型有答案、但没过验证（证据编的 / 阶段不许落）而丢掉的。 */
  rejected: number
  /** 写库失败的。 */
  failed: number
}

const EMPTY: StageInferResult = { candidates: 0, asked: 0, filled: 0, rejected: 0, failed: 0 }

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function modelName(): string {
  return process.env.CRM_STAGE_INFER_MODEL ?? 'gpt-4o-mini'
}

/**
 * 问模型这个人到哪一步了。没配 API key 就直接不判（返回 null）——
 * dev / 测试永远不依赖一次网络调用，也绝不假装读出了什么。
 */
export async function askStage(transcript: string): Promise<StageVerdict | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })
  const res = await client.responses.create({
    model: modelName(),
    input: [
      { role: 'system', content: STAGE_SYSTEM_PROMPT },
      { role: 'user', content: `Conversation:\n${transcript}` },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'stage_verdict',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['stage', 'evidence', 'reason'],
          properties: {
            stage: {
              type: 'string',
              enum: ['contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon', 'unclear'],
            },
            evidence: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  } as Parameters<typeof client.responses.create>[0])

  const text = (res as { output_text?: string }).output_text ?? '{}'
  const parsed = StageVerdictSchema.safeParse(JSON.parse(text))
  // 模型答歪了就当没答 —— 空着比写一个残缺的判断强。
  return parsed.success ? parsed.data : null
}

/**
 * 哪些客户配了「还会继续跟」的那几档 —— 一档都没配的客户，这套东西一步都不走。
 *
 * 作用范围天然收口（同 `qualified-buyer-autotag` 的做法）：不需要再维护一份
 * 客户白名单，配置里没有那些档的客户结构上就碰不到。
 */
async function loadClientsWithSafeStages(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('client_id')
    .in('stage_key', [...SAFE_STAGES])
  return Array.from(new Set(((data ?? []) as { client_id: string }[]).map((s) => s.client_id)))
}

/** 这个客户配置里真的有哪些阶段。没配的不许写进去。 */
async function loadConfiguredStages(clientId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key')
    .eq('client_id', clientId)
  return new Set(((data ?? []) as { stage_key: string }[]).map((s) => s.stage_key))
}

/**
 * 一个人的全部往来内容 —— 邮件正文、私信原文、销售手打的电话记录。
 *
 * 三样都要：只读其中一样，正是这套系统原来的毛病（只看了 295 条电话记录、
 * 漏掉 523 封邮件和 2099 条私信，于是 556 个人的阶段一直空着）。
 */
export async function loadTranscriptLines(
  clientId: string,
  contactId: string,
): Promise<TranscriptLine[]> {
  const [{ data: convs }, { data: touches }] = await Promise.all([
    supabaseAdmin.from('conversations').select('id').eq('client_id', clientId).eq('contact_id', contactId),
    supabaseAdmin
      .from('contact_touchpoints')
      .select('channel, direction, occurred_at, raw, summary')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .neq('channel', 'messenger')
      .order('occurred_at', { ascending: false })
      .limit(200),
  ])

  const lines: TranscriptLine[] = []

  for (const t of (touches ?? []) as {
    channel: string
    direction: 'inbound' | 'outbound'
    occurred_at: string
    raw: string | null
    summary: string | null
  }[]) {
    // 电话触点的原话在 raw；raw 空的（FB 表单之类）退回 summary。
    const body = (t.raw ?? t.summary ?? '').trim()
    if (body) lines.push({ at: t.occurred_at, direction: t.direction, body, channel: t.channel })
  }

  const convIds = ((convs ?? []) as { id: string }[]).map((c) => c.id)
  if (convIds.length > 0) {
    const { data: msgs } = await supabaseAdmin
      .from('conversation_messages')
      .select('direction, body, sent_at')
      .in('conversation_id', convIds)
      .order('sent_at', { ascending: false })
      .limit(500)
    for (const m of (msgs ?? []) as {
      direction: 'inbound' | 'outbound'
      body: string | null
      sent_at: string
    }[]) {
      const body = (m.body ?? '').trim()
      if (body) lines.push({ at: m.sent_at, direction: m.direction, body, channel: 'message' })
    }
  }

  return lines
}

/**
 * 落一个人的阶段 + 审计。
 *
 * 🔴 UPDATE 的 WHERE 里**再判一次 stage 仍为空**：取数和写库之间，销售完全
 * 可能已经在手机上把这个人标好了。只靠内存里那份快照会把他刚做的判断盖掉 ——
 * 而「绝不覆盖人工判断」是这套自动化能存在的前提。人一旦动过，这条 UPDATE
 * 命中 0 行、什么都不发生，返回 false（被抢先了，不算失败）。
 */
async function applyStage(
  clientId: string,
  contactId: string,
  stage: SafeStage,
  verdict: StageVerdict,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString()
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .update({ stage, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', contactId)
    .eq('client_id', clientId)
    .is('stage', null)
    .select('id')

  if (error) throw new Error(`填阶段失败: ${error.message}`)
  if (!data || data.length === 0) return false

  // 留痕：为什么这么判 + 依据的原话。销售在时间线上看得到，不服可以直接改。
  await supabaseAdmin.from('contact_stage_events').insert({
    client_id: clientId,
    contact_id: contactId,
    from_stage: null,
    to_stage: stage,
    changed_by: STAGE_INFER_ACTOR,
    note: `读往来记录判的：${verdict.reason}｜原话：「${verdict.evidence.slice(0, 200)}」`,
  })

  return true
}

/**
 * 跑一轮。
 *
 * @param now 用于 `stage_updated_at`
 * @param ask 问模型那一步。留成参数是为了**把「模型说了什么」和「我们据此做了
 *            什么」分开测** —— 那几道闸（证据是不是编的、终结档接不接、有没有
 *            覆盖人工判断）才是这套东西的全部价值，它们必须能在没有网络的情况下
 *            逐条验证。默认就是真的去问。
 */
export async function inferStagesFromConversations(
  now: Date,
  ask: (transcript: string) => Promise<StageVerdict | null> = askStage,
): Promise<StageInferResult> {
  // 没配 key 就一步都不走：绝不假装读出了什么。
  if (!process.env.OPENAI_API_KEY) return { ...EMPTY }

  const clientIds = await loadClientsWithSafeStages()
  if (clientIds.length === 0) return { ...EMPTY }

  const result: StageInferResult = { ...EMPTY }

  // 空阶段的人 —— 结构上就够不着已经标过的人。
  const candidates: { id: string; client_id: string }[] = []
  for (const ids of chunk(clientIds, IN_CHUNK)) {
    const { data } = await supabaseAdmin
      .from('contacts')
      .select('id, client_id')
      .in('client_id', ids)
      .is('stage', null)
      .eq('do_not_contact', false)
      .limit(MAX_CONTACTS_PER_RUN * 4)
    candidates.push(...((data ?? []) as { id: string; client_id: string }[]))
  }
  result.candidates = candidates.length
  if (candidates.length === 0) return result

  const configuredByClient = new Map<string, Set<string>>()
  for (const clientId of Array.from(new Set(candidates.map((c) => c.client_id)))) {
    configuredByClient.set(clientId, await loadConfiguredStages(clientId))
  }

  for (const c of candidates) {
    if (result.asked >= MAX_CONTACTS_PER_RUN) break
    try {
      const lines = await loadTranscriptLines(c.client_id, c.id)
      // 只有我们单方面发过、对方一个字没回的：读了也读不出什么，不花这一次钱。
      if (!worthReading(lines)) continue

      const transcript = renderTranscript(lines)
      if (!transcript) continue

      result.asked++
      const verdict = await ask(transcript)
      if (!verdict) {
        result.rejected++
        continue
      }

      const stage = usableStage(verdict, transcript, configuredByClient.get(c.client_id) ?? new Set())
      if (!stage) {
        result.rejected++
        continue
      }

      if (await applyStage(c.client_id, c.id, stage, verdict, now)) result.filled++
    } catch (err) {
      result.failed++
      console.warn(`[stage-infer] ${c.id} 读失败：`, err instanceof Error ? err.message : err)
    }
  }

  return result
}
