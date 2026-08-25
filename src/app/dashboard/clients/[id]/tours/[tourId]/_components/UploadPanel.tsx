'use client'

import { useRef, useState } from 'react'
import type { GroupTourRecord } from '@/lib/group-tours/store'

/**
 * 上传团资料 → 解析。文件损坏 / AI 读不出关键信息等失败场景都要落成人话 +
 * 明确下一步（板桥意见3），不能是原始 error message。
 */
export default function UploadPanel({
  clientId,
  tourId,
  onParsed,
}: {
  clientId: string
  tourId: string
  onParsed: (tour: GroupTourRecord) => void
}) {
  const itineraryRef = useRef<HTMLInputElement>(null)
  const sellingRef = useRef<HTMLInputElement>(null)
  const [sellingText, setSellingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const upload = async () => {
    const itineraryFile = itineraryRef.current?.files?.[0]
    if (!itineraryFile) {
      setError('请先选一份团资料文件（行程文档：Word / PDF / 纯文本）。')
      return
    }
    setBusy(true)
    setError(null)
    setOk(false)
    try {
      const form = new FormData()
      form.append('itineraryFile', itineraryFile)
      const sellingFile = sellingRef.current?.files?.[0]
      if (sellingFile) form.append('sellingPointsFile', sellingFile)
      if (sellingText.trim()) form.append('sellingPointsText', sellingText.trim())

      const res = await fetch(`/api/clients/${clientId}/group-tours/${tourId}/import`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || '解析失败，请检查文件是否完整，或换成 PDF 重新上传；仍不行请联系 Ray。')

      onParsed(json.tour)
      setOk(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败，请重试；仍不行请联系 Ray。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <h2 className="mb-1 font-black text-me-charcoal">上传团资料</h2>
      <p className="mb-4 text-xs font-semibold text-me-charcoal/45">
        上传行程文档，AI 自动读出行程、价格、日期。重新上传会覆盖当前解析结果（不会动你已经手动改过的字段之外的内容）。
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-black uppercase tracking-wide text-me-charcoal/50">行程文档（必选）</span>
          <input
            ref={itineraryRef}
            type="file"
            accept=".docx,.pdf,.txt,.md"
            className="block w-full text-sm font-semibold text-me-charcoal/70"
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-black uppercase tracking-wide text-me-charcoal/50">客户卖点材料（可选）</span>
          <input ref={sellingRef} type="file" accept=".docx,.pdf,.txt,.md" className="block w-full text-sm font-semibold text-me-charcoal/70" />
        </div>
      </div>
      <textarea
        className="mt-3 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none"
        rows={2}
        placeholder="或者直接粘贴客户的卖点文案（可选，不是行程事实来源，只影响文案角度）"
        value={sellingText}
        onChange={(e) => setSellingText(e.target.value)}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={upload}
          disabled={busy}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre disabled:opacity-50"
        >
          {busy ? '解析中…（可能要 1-2 分钟）' : '上传并解析'}
        </button>
        {ok && <span className="text-xs font-bold text-[#5C8A4A]">解析完成，请往下核对</span>}
        {error && <span className="text-xs font-bold text-[#C2453A]">{error}</span>}
      </div>
    </section>
  )
}
