'use client'

import { useState } from 'react'
import type { GroupTourRecord } from '@/lib/group-tours/store'

/**
 * 板桥意见1：按钮不能叫"发布上线"——点完之后只是开了一个 GitHub Draft PR，
 * 团页并没有真的上线，还要有人去 GitHub 上点 merge。这里用三步进度条把这件事
 * 说清楚，而不是显示 pr_open 这种只有懂行的人才看得懂的状态值。
 */
export default function PublishPanel({
  clientId,
  tour,
  onUpdated,
}: {
  clientId: string
  tour: GroupTourRecord
  onUpdated: (tour: GroupTourRecord) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const publish = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/group-tours/${tour.id}/publish`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || '提交发布申请失败，请稍后重试；仍不行请联系 Ray。')
      setMessage(json.message)
      onUpdated({ ...tour, status: 'pr_open', pr_url: json.prUrl, pr_number: json.prNumber })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交发布申请失败')
    } finally {
      setBusy(false)
    }
  }

  const step = stepOf(tour.status)

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <h2 className="mb-3 font-black text-me-charcoal">发布</h2>

      <ol className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold">
        <StepChip label="① 你确认好，提交发布申请" active={step === 1} done={step > 1} />
        <Arrow />
        <StepChip label="② 等技术同事在 GitHub 上确认合并" active={step === 2} done={step > 2} />
        <Arrow />
        <StepChip label="③ 团页真的出现在官网" active={step === 3} done={step > 3} />
      </ol>

      {tour.status === 'published' && <p className="text-sm font-bold text-[#5C8A4A]">已上线，团页已经在官网了。</p>}

      {tour.status === 'pr_open' && (
        <div className="rounded-lg border border-[#C88A2E]/30 bg-[#C88A2E]/8 p-3">
          <p className="text-sm font-bold text-me-charcoal">
            你这步已经做完了——还没真上线，需要有人去 GitHub 上确认合并，通常几小时内会处理。
          </p>
          {tour.pr_url && (
            <a href={tour.pr_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-me-ochre underline">
              查看 GitHub 上的发布申请 →
            </a>
          )}
        </div>
      )}

      {(tour.status === 'draft' || tour.status === 'review' || tour.status === 'ready') && (
        <>
          <button
            type="button"
            onClick={publish}
            disabled={busy}
            className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre disabled:opacity-50"
          >
            {busy ? '提交中…' : '提交发布申请'}
          </button>
          <p className="mt-2 text-xs font-semibold text-me-charcoal/45">
            点这个按钮不等于团页立刻上线——会先提交给技术同事在 GitHub 上确认，合并后才真的上线。
          </p>
        </>
      )}

      {message && <p className="mt-3 text-sm font-semibold text-me-charcoal/70">{message}</p>}
      {error && <p className="mt-3 text-sm font-bold text-[#C2453A]">{error}</p>}
    </section>
  )
}

function stepOf(status: GroupTourRecord['status']): number {
  if (status === 'published') return 4
  if (status === 'pr_open') return 2
  return 1
}

function StepChip({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  const cls = done
    ? 'border-[#5C8A4A]/40 bg-[#5C8A4A]/10 text-[#5C8A4A]'
    : active
    ? 'border-[#C88A2E]/40 bg-[#C88A2E]/10 text-[#C88A2E]'
    : 'border-black/10 bg-me-ivory text-me-charcoal/40'
  return <span className={`rounded-full border px-3 py-1 ${cls}`}>{label}</span>
}

function Arrow() {
  return <span className="text-me-charcoal/25">→</span>
}
