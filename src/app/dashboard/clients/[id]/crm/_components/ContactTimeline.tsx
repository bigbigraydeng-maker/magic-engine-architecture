'use client'

/**
 * 一个人的全渠道往来记录。
 *
 * 看板上点开一个人时展示：他填过的表单、我们打过的每通电话、双方发过的每条
 * 私信（以后是邮件、外呼录音），按时间**从旧到新**合成一条线（最新在最下面）。
 * 顺序由接口给定，这里原样渲染 —— 聊天记录倒着排会把回答排在提问前面，读不通。
 *
 * 「以后会接更多沟通渠道进来」这件事在这里是**零改动**的：渲染按 `kind` 分派，
 * 触点只认 `channel` 字段取一个图标 —— 新渠道进来自动出现在同一条线上，
 * 认不出的渠道退回一个中性图标，不会漏掉也不会炸。
 *
 * 数据来自 GET /crm/contacts/[cid]/timeline（CRM 页面线建的读模型，直接复用）。
 */

import { useCallback, useEffect, useState } from 'react'
import { AUTO_TAG_ACTOR } from '@/lib/crm/qualified-buyer'

/**
 * 「谁改的」的显示名。系统自动打标写的是一个英文标记（审计要机器可读），
 * 中介看到的必须是人话 —— 而且必须看得出这一档不是同事标的。
 */
function changedByLabel(raw: string): string {
  if (raw === AUTO_TAG_ACTOR) return '系统自动'
  return raw.split('@')[0]
}

export interface TimelineEntry {
  kind: 'touch' | 'stage' | 'message'
  at: string
  // touch
  channel?: string
  direction?: 'inbound' | 'outbound'
  summary?: string | null
  tour?: string | null
  outcome?: string | null
  travelWindow?: string | null
  callbackAt?: string | null
  competitor?: string | null
  // stage
  fromLabel?: string | null
  toLabel?: string | null
  changedBy?: string | null
  note?: string | null
  // message
  senderName?: string | null
  body?: string
}

interface Payload {
  contact: { name: string; phone: string | null; email: string | null; stageLabel: string | null }
  timeline: TimelineEntry[]
  omittedMessages?: number
  error?: string
}

/** 渠道 → 一眼能认的图标。认不出的新渠道给中性圆点，绝不空白。 */
const CHANNEL_ICON: Record<string, string> = {
  phone: '📞',
  meta_lead_form: '📝',
  web_form: '📝',
  messenger: '💬',
  email: '✉️',
  whatsapp: '💬',
}

const CHANNEL_NAME: Record<string, string> = {
  phone: '电话',
  meta_lead_form: 'Facebook 表单',
  web_form: '网站表单',
  messenger: '私信',
  email: '邮件',
  whatsapp: 'WhatsApp',
}

/**
 * 「系统给他上了闸」这一类判决 —— 必须一眼认出来，不能混在普通往来里。
 *
 * ## 为什么单独一档（PM 2026-08-17）
 *
 * 这两个结论跟别的结论**不是一回事**：其它结论只是记录「这次聊得怎么样」，
 * 这两个直接决定**还能不能联系这个人**。`do_not_contact` 一旦成立，
 * 电话、邮件、私信全停；解闸只能靠人明确说「判错了」。
 *
 * 而在这之前，它们在时间线上跟一条普通电话记录长得一模一样 —— 销售翻记录
 * 只看得到一句话，看不到「就是这一句让系统把他全渠道停了」。于是最该被复核的
 * 那一刻，恰恰是最看不见的。
 *
 * 🔴 **原话一定要留在旁边**：判断「是不是判错了」全靠原话（早前的词表把
 * 「我不打算去」当成过「别再联系」）。所以这里只给卡片加一条头和一道红边，
 * **不替换卡片内容**。
 */
const VERDICT_ROW: Record<string, { icon: string; text: string; tone: 'stop' | 'clear' }> = {
  do_not_contact: {
    icon: '🔒',
    // 说后果，不说结论名。销售要知道的是「所以现在怎么样」。
    text: '就是这一句让系统停了他 —— 从这天起电话 / 邮件 / 私信全都不再发给他',
    tone: 'stop',
  },
  dnc_cleared: {
    icon: '🔓',
    text: '有人判断上面那次是误判，把他放回了名单 —— 现在可以正常联系',
    tone: 'clear',
  },
}

/**
 * 其余结论 → 人话。
 *
 * 只挑**会影响销售下一步动作**的那几种；`spoke` / `unknown` 是兜底值
 * （任何没命中规则的备注都会落成 `spoke`），标出来只会变成满屏噪音。
 */
const OUTCOME_CHIP: Record<string, string> = {
  bad_number: '这个号打不通',
  no_answer: '打了没人接',
  not_interested: '他说不买了',
  not_interested_now: '这次先不去',
}

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const date = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  if (days <= 0) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (days === 1) return '昨天'
  if (days < 30) return `${date}（${days} 天前）`
  return date
}

export function ContactTimeline({ clientId, contactId }: { clientId: string; contactId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/timeline`)
      const json = (await res.json()) as Payload
      if (!res.ok) throw new Error(json.error ?? '加载失败')
      setData(json)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId, contactId])

  useEffect(() => { void load() }, [load])

  if (loading) return <p className="py-6 text-center text-xs text-me-charcoal/40">加载往来记录…</p>
  if (err) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-[#C2453A]">{err}</p>
        <button onClick={() => void load()} className="mt-1 text-xs font-bold underline">重试</button>
      </div>
    )
  }
  if (!data || data.timeline.length === 0) {
    return <p className="py-6 text-center text-xs text-me-charcoal/40">还没有往来记录。</p>
  }

  /**
   * 「他是从哪来的」—— 时间线**从旧到新**，所以第一条就是他第一次出现在我们面前。
   *
   * 单独提一行的理由（CTS 销售视角）：接手一个陌生人，第一个要判断的是「这人
   * 值不值得马上打」，而来源就是最强的那个信号 —— 填过表单的人跟一句
   * 「洗牙多少钱」进来的人，开场白根本不该一样。原先这条信息埋在最上面那张
   * 卡片的小字里，跟后面十几条长得一模一样，扫过去看不见。
   */
  const first = data.timeline[0]
  const originName =
    first?.kind === 'touch'
      ? (CHANNEL_NAME[first.channel ?? ''] ?? first.channel ?? null)
      : first?.kind === 'message'
        ? '私信'
        : null

  return (
    <div className="space-y-2.5">
      {originName && (
        <p className="px-1 text-[11px] text-me-charcoal/45">
          👋 他是从<span className="font-bold text-me-charcoal/70">{originName}</span>来的 ·{' '}
          {when(first.at)}
        </p>
      )}
      {data.timeline.map((e, i) => {
        // 客人说的话 —— 白底靠左；我们说的 —— 灰底靠右缩进。一眼分得出谁在说。
        if (e.kind === 'message') {
          const inbound = e.direction === 'inbound'
          return (
            <div key={i} className={inbound ? '' : 'pl-8'}>
              <div className={`rounded-xl px-3 py-2 ${inbound ? 'bg-white border border-me-charcoal/10' : 'bg-me-ivory'}`}>
                <p className="mb-0.5 text-[10px] font-bold text-me-charcoal/40">
                  {inbound ? (e.senderName || '客人') : '我们'} · {when(e.at)}
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-me-charcoal/85">{e.body}</p>
              </div>
            </div>
          )
        }

        if (e.kind === 'stage') {
          return (
            <div key={i} className="flex items-baseline gap-2 px-1 text-[11px] text-me-charcoal/45">
              <span>🔀</span>
              <span>
                {e.fromLabel ?? '还没标'} → <span className="font-bold text-me-charcoal/70">{e.toLabel}</span>
                {e.changedBy ? ` · ${changedByLabel(e.changedBy)}` : ''} · {when(e.at)}
              </span>
            </div>
          )
        }

        // 触点：电话 / 表单 / 以后的任何新渠道
        const icon = CHANNEL_ICON[e.channel ?? ''] ?? '•'
        const name = CHANNEL_NAME[e.channel ?? ''] ?? e.channel ?? '接触'
        const chips = [
          e.tour && `想去：${e.tour}`,
          e.travelWindow && `${e.travelWindow} 走`,
          e.competitor && `提到 ${e.competitor}`,
          e.callbackAt && '约了回电',
          e.outcome ? OUTCOME_CHIP[e.outcome] : null,
        ].filter(Boolean) as string[]

        const verdict = e.outcome ? VERDICT_ROW[e.outcome] : undefined
        const stop = verdict?.tone === 'stop'

        return (
          <div
            key={i}
            className={`rounded-xl border bg-white px-3 py-2 ${
              verdict
                ? `border-l-4 ${stop ? 'border-l-[#C2453A] border-[#C2453A]/25' : 'border-l-me-ochre border-me-ochre/30'}`
                : 'border-me-charcoal/10'
            }`}
          >
            <p className="text-[10px] font-bold text-me-charcoal/40">
              {icon} {name}
              {e.direction === 'inbound' ? ' · 客人来的' : ''} · {when(e.at)}
            </p>
            {e.summary && (
              <p className="mt-0.5 text-[13px] leading-relaxed text-me-charcoal/85">{e.summary}</p>
            )}
            {/* 判决摆在原话**下面** —— 先读客人说了什么，再看系统据此做了什么。 */}
            {verdict && (
              <p
                className={`mt-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold leading-relaxed ${
                  stop ? 'bg-[#C2453A]/8 text-[#C2453A]' : 'bg-me-ochre/12 text-me-ochre'
                }`}
              >
                {verdict.icon} {verdict.text}
              </p>
            )}
            {chips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {chips.map((c) => (
                  <span key={c} className="rounded-full bg-me-ochre/12 px-2 py-0.5 text-[10px] font-bold text-me-ochre">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {!!data.omittedMessages && (
        <p className="pt-1 text-center text-[10px] text-me-charcoal/30">
          另有 {data.omittedMessages} 条图片 / 表情，没有文字
        </p>
      )}
    </div>
  )
}
