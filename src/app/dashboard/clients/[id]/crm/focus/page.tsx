'use client'

/**
 * 今天该关注谁 —— 只读决策清单（CI-WP01 · 执行锚点 #1009）。
 *
 * 产品方向来源 #999，执行与验收 #1009。第一屏只回答三件事：
 *   谁需要我关注 · 为什么是他 · 下一步建议做什么。
 *
 * 它是「今天该联系谁」看板（../page.tsx）的一个**只读投影**：数据同一个来源
 * （`/api/clients/[id]/crm/today`），排序、DNC 排除、推迟、终端阶段抑制、当天冻结、
 * 失败触达全部沿用后端算好的语义（见 lib/crm/today-focus）。这一页**不写任何东西** ——
 * 没有录入、发消息、打电话、记笔记、改阶段、审批、执行按钮，一个副作用都没有。
 * 要动手仍回看板那一页。
 *
 * 为什么单独一页而不塞进现有导航：#1009 的产品原则是「每多一个按钮都是设计失败，
 * 直到被证明必要」。这一版先把「决策清单」这个形态跑通、交 PO 定夺，所以刻意
 * 不进主导航、不动看板 —— 直达 URL 即可（/dashboard/clients/[id]/crm/focus）。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  buildFocusList,
  focusSummary,
  isFocusPayloadShaped,
  type FocusPayloadInput,
  type FocusRow,
} from '@/lib/crm/today-focus'

interface TodayPayload extends FocusPayloadInput {
  error?: string
}

/** 「约的是：今天 14:00（过了 3 小时）」—— 到期点，打之前一定要看见。 */
function dueText(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day =
    d.toDateString() === now.toDateString()
      ? '今天'
      : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const lateH = Math.floor((now.getTime() - d.getTime()) / 3_600_000)
  if (lateH >= 24) return `${day} ${time}（过了 ${Math.floor(lateH / 24)} 天）`
  if (lateH >= 1) return `${day} ${time}（过了 ${lateH} 小时）`
  return `${day} ${time}`
}

/** 最近触点距今多久 —— 只做上下文，不参与任何判断。 */
function lastTouchText(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return '最近触点：今天'
  if (days === 1) return '最近触点：昨天'
  return `最近触点：${days} 天前`
}

const LAYER_LABEL: Record<FocusRow['layer'], string> = {
  waiting: '客人在等你',
  acted: '还没搭上话',
  queued: '',
}

/** 下一步那一行的配色：能做的醒目，待补的收着，已处理的发绿。 */
const NEXT_STEP_STYLE: Record<FocusRow['nextStep']['kind'], string> = {
  act: 'bg-me-ochre/12 text-me-charcoal border-me-ochre/30',
  defer: 'bg-me-charcoal/5 text-me-charcoal/55 border-me-charcoal/12',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function FocusRowCard({ row }: { row: FocusRow }) {
  // 今天已处理的整张卡变浅，留在原位置 —— 一眼看出还剩哪些没动，不用靠记。
  return (
    <li
      className={`rounded-xl border bg-white p-4 shadow-sm transition ${
        row.doneToday ? 'border-me-charcoal/10 opacity-55' : 'border-me-charcoal/12'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {row.doneToday && <span className="text-[13px] text-me-ochre" title="今天已经处理过了">✓</span>}
        <span className="text-[16px] font-black text-me-charcoal">{row.name}</span>
        {LAYER_LABEL[row.layer] && (
          <span className="rounded-full bg-me-ivory px-2 py-0.5 text-[11px] font-bold text-me-charcoal/55">
            {LAYER_LABEL[row.layer]}
          </span>
        )}
        {/* 同行已在 presenter 层整个排除（PO 裁定只展示终端客户），这里不再需要
            「同行」标记 —— 清单里出现的都是终端客户 / 真实机会。 */}
        {row.stageLabel && (
          <span className="ml-auto truncate rounded-full bg-me-ivory px-2 py-0.5 text-[12px] font-bold text-me-charcoal/55">
            {row.stageLabel}
          </span>
        )}
      </div>

      {/* 为什么是他（why now）。 */}
      <p className="mt-1.5 text-[14px] leading-snug text-me-charcoal/70">{row.whyNow}</p>

      {row.dueAt && (
        <p className="mt-2 inline-block rounded-md bg-[#C2453A]/8 px-2 py-1 text-[13px] font-bold text-[#C2453A]">
          约的是：{dueText(row.dueAt)}
        </p>
      )}

      {/* 下一步建议 —— 只是建议，这一页点不了。 */}
      <div className={`mt-2 rounded-lg border px-3 py-2 text-[14px] font-bold ${NEXT_STEP_STYLE[row.nextStep.kind]}`}>
        <span className="mr-1 text-[12px] font-black uppercase tracking-wide opacity-60">
          {row.nextStep.kind === 'done' ? '已处理' : row.nextStep.kind === 'defer' ? '待补' : '下一步'}
        </span>
        {row.nextStep.text}
      </div>

      {(row.lastTouchAt || row.lastBy) && (
        <p className="mt-2 text-[12px] text-me-charcoal/40">
          {row.lastTouchAt && lastTouchText(row.lastTouchAt)}
          {row.lastTouchAt && row.lastBy && ' · '}
          {row.lastBy && `上次 ${row.lastBy} 跟的`}
        </p>
      )}
    </li>
  )
}

export default function CrmFocusPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<TodayPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/today`, { credentials: 'include' })
      const json = (await res.json()) as TodayPayload
      if (!res.ok) {
        setError(json.error ?? '加载失败')
        return
      }
      // 🔴 结构异常绝不能冒充「今天没人」（failure-as-success）。上游若回了个
      //    200 但没有 buckets / 结构不对，拍平会是空清单 —— 那时必须进「数据异常」
      //    态、给重试，而不是让销售看见「今天没有需要关注的人」以为过关了。
      if (!isFocusPayloadShaped(json)) {
        setError('数据异常：服务器返回的结构不对，先别信这一页，点重试或回看板。')
        return
      }
      setData(json)
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const rows = data ? buildFocusList(data) : []
  const summary = focusSummary(rows)

  return (
    <div className="mx-auto max-w-[720px] px-4 py-6">
      <header className="mb-4">
        <Link
          href={`/dashboard/clients/${clientId}/crm`}
          className="text-sm text-me-charcoal/40 hover:text-me-charcoal"
        >
          ← 今天该联系谁（看板 · 可动手）
        </Link>
        <h1 className="mt-2 text-2xl font-black text-me-charcoal">今天该关注谁</h1>
        <p className="mt-1 text-sm text-me-charcoal/45">
          谁需要关注 · 为什么是他 · 下一步建议。这一页只读 —— 要动手请回上面的看板。
        </p>
      </header>

      {loading && !data && (
        <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>
      )}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm font-black underline">
            重试
          </button>
        </div>
      )}

      {!error && data && (
        <>
          {rows.length > 0 && (
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-me-ivory px-3 py-1.5 text-xs font-black text-me-charcoal/70">
              <span className="tabular-nums">
                今天 {summary.total} 个要关注 · 动过 {summary.done} ·{' '}
                <b className="text-me-ochre">还剩 {summary.left}</b>
              </span>
            </p>
          )}

          {rows.length === 0 ? (
            <p className="py-16 text-center text-sm text-me-charcoal/45">
              今天没有需要特别关注的人。
            </p>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((r) => (
                <FocusRowCard key={r.contactId} row={r} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
