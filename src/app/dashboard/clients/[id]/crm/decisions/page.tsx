'use client'

/**
 * 今日决策清单（只读）—— CI-WP01（Issue #1009）。
 *
 * 读的是「今天要联系」那一页同一个只读接口（`/api/clients/[id]/crm/today`），
 * 只是换一种呈现：拍平成一条清单，每行只答三件事——这是谁 / 为什么现在处理 /
 * 建议下一步。**这一页不提供任何写操作**（不打电话、不发信、不改状态、不推迟）
 * —— 那些动作留在「今天要联系」看板上做；这一页只给「看」，给不需要亲自
 * 动手、只想知道「今天该关注谁」的人用（PO / 非跟进角色）。
 *
 * 排序 / 冷热 / DNC / snooze / terminal-stage 判据全部不重新算，照抄
 * `/crm/today` 已经算好的桶（lib/crm/segments + day-list + worklist-groups）。
 * 拍平逻辑在 `lib/crm/decision-list.ts`，纯函数，单测钉死。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CrmTabs } from '../_components/CrmTabs'
import {
  buildDecisionList,
  hasHandledToday,
  hasTruncatedBucket,
  type DecisionBucketSource,
  type DecisionRow,
} from '@/lib/crm/decision-list'

interface Payload {
  buckets?: DecisionBucketSource[]
  totalContacts?: number
  generatedAt?: string
  error?: string
}

export default function CrmDecisionsPage() {
  const params = useParams()
  const clientId = params.id as string

  const [rows, setRows] = useState<DecisionRow[] | null>(null)
  const [totalContacts, setTotalContacts] = useState(0)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [handledToday, setHandledToday] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/today`)
      const json = (await res.json()) as Payload
      if (!res.ok) {
        setError(json.error ?? '加载失败 —— 请确认您有权限查看这个客户')
        setRows(null)
        return
      }
      setRows(buildDecisionList(json.buckets ?? []))
      setTotalContacts(json.totalContacts ?? 0)
      setGeneratedAt(json.generatedAt ?? null)
      setHandledToday(hasHandledToday(json.buckets ?? []))
      setTruncated(hasTruncatedBucket(json.buckets ?? []))
    } catch {
      setError('加载失败，检查网络后再试。')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-me-charcoal">今日决策清单（只读）</h1>
          <CrmTabs clientId={clientId} active="decisions" />
        </div>
        <p className="mt-1 text-sm text-me-charcoal/45">
          谁需要关注、为什么、建议怎么办 —— 只看不改。要联系客人，去「今天要联系」那一页操作。
        </p>
      </div>

      {loading && rows === null && !error && (
        <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>
      )}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-sm font-black text-me-charcoal underline"
          >
            重试
          </button>
        </div>
      )}

      {!error && !loading && rows !== null && (
        <>
          <p className="text-xs font-bold text-me-charcoal/50">
            {rows.length > 0
              ? truncated
                ? `至少 ${rows.length} 位客人需要关注 —— 部分分类人数过多，清单未显示全部`
                : `今天有 ${rows.length} 位客人需要关注`
              : totalContacts > 0
                ? handledToday
                  ? '今天没有人需要关注 —— 该处理的都处理了'
                  : '今天没有人需要关注 —— 现在没有到期的跟进'
                : '这个客户还没有任何客人数据'}
          </p>

          {truncated && (
            <div className="rounded-xl border border-me-ochre/30 bg-me-ochre/8 p-3">
              <p className="text-xs font-semibold text-me-charcoal/70">
                ⚠️ 部分分类超过单桶显示上限，清单没能显示全部客人，目前没有能看到全部名单的入口
                ——「今天要联系」那一页同样只显示每桶前 300 人。
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-xl border border-black/10 bg-white p-8 text-center">
              <p className="text-sm text-me-charcoal/60">
                {totalContacts > 0
                  ? handledToday
                    ? '今天没有需要关注的客人。'
                    : '现在没有到期的跟进，都在推迟、未来培育或已终止阶段。'
                  : '还没有同步到任何客人。'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.contactId} className="rounded-xl border border-black/10 bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-black text-me-charcoal">
                      {r.pinned && <span className="mr-1 text-me-ochre">📌</span>}
                      {r.name}
                    </p>
                    <span className="text-xs font-semibold text-me-charcoal/40">{r.layerLabel}</span>
                  </div>
                  <p className="mt-1 text-xs text-me-charcoal/50">{r.contact}</p>
                  <p className="mt-2 text-sm text-me-charcoal/75">{r.why}</p>
                  <p className="mt-1 text-sm font-semibold text-me-charcoal/70">→ {r.nextAction}</p>
                </li>
              ))}
            </ul>
          )}

          {generatedAt && (
            <p className="text-center text-[11px] text-me-charcoal/30">
              数据生成于 {new Date(generatedAt).toLocaleString('zh-CN')} · 只读，不产生任何写操作
            </p>
          )}
        </>
      )}
    </div>
  )
}
