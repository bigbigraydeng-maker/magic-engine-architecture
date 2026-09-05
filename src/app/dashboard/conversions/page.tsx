'use client'

/**
 * /dashboard/conversions —— 成交/咨询核对页（Issue #1397 PR3）
 *
 * PM 每天在这里花 3 分钟：看一眼客人和金额对不对，对就告诉广告平台，不对就不发。
 *
 * 设计取舍（板桥复审的必改项）：
 *   · 一页看全，不是点进详情再返回 —— 一天十来条要能连着批完。
 *   · 键盘 Y / N 直接批，鼠标可选。
 *   · 「告诉广告平台」撤不回，所以必须弹二次确认；「不发送」要选原因。
 *   · 邮箱电话一律打码 —— 这一页会被截图、会投屏。
 *
 * 路径放 /dashboard 下是因为登录保护只覆盖 /dashboard/*（中间件 matcher）。
 * 放 /admin 下会是一个不需要登录就能打开的页面。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

type Outcome = {
  id: string
  outcome_kind: 'purchase' | 'balance' | 'lead'
  order_ref: string | null
  amount_minor: number | null
  currency: string | null
  occurred_at: string
  review_status: string
  reject_reason: string | null
  redacted_at: string | null
  source_kind: string
  created_at: string
}

const REJECT_REASONS: Array<{ value: string; label: string }> = [
  { value: 'customer_opted_out', label: '客人明确说过别用他的信息' },
  { value: 'not_real_sale', label: '不是真成交（补开发票之类）' },
  { value: 'duplicate', label: '重复了，同一笔已经有一条' },
  { value: 'other', label: '其它（下面写一句）' },
]

function money(o: Outcome): string {
  if (o.amount_minor == null || !o.currency) return '—'
  const exp = { NZD: 2, AUD: 2, USD: 2 }[o.currency.toUpperCase()] ?? 2
  return `${o.currency} ${(o.amount_minor / 10 ** exp).toLocaleString('en-NZ', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  })}`
}

function kindLabel(k: Outcome['outcome_kind']): string {
  return k === 'purchase' ? '收到定金' : k === 'balance' ? '收到尾款' : '有效咨询'
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export default function ConversionsPage() {
  const [clientId, setClientId] = useState<string>('')
  const [rows, setRows] = useState<Outcome[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<string>('')
  const [rejectNote, setRejectNote] = useState('')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    setClientId(p.get('client') ?? '')
  }, [])

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/conversions/outcomes?client_id=${encodeURIComponent(clientId)}&review_status=pending_review`,
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '读取失败')
      setRows(body.outcomes ?? [])
      setCursor(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const current = rows[cursor]

  const approve = useCallback(
    async (o: Outcome) => {
      // 撤不回，所以每一条都要点头一次。
      const ok = window.confirm(
        `确定把这条告诉广告平台吗？\n\n` +
          `${kindLabel(o.outcome_kind)} ${money(o)}${o.order_ref ? `（单号 ${o.order_ref}）` : ''}\n\n` +
          `⚠️ 发出去之后撤不回 —— 广告平台没有提供删除的办法。`,
      )
      if (!ok) return

      setBusy(o.id)
      try {
        const res = await fetch(`/api/admin/conversions/outcomes/${o.id}/review`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', confirm: true }),
        })
        const body = await res.json()
        setFlash({
          id: o.id,
          text: body.message ?? (res.ok ? '已处理' : '出错了'),
          ok: res.ok && body.send_status !== 'error',
        })
        if (res.ok) {
          setRows((rs) => rs.filter((r) => r.id !== o.id))
          setCursor((c) => Math.max(0, Math.min(c, rows.length - 2)))
        }
      } catch (e) {
        setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setBusy(null)
      }
    },
    [rows.length],
  )

  const reject = useCallback(async (o: Outcome, reason: string, note: string) => {
    setBusy(o.id)
    try {
      const res = await fetch(`/api/admin/conversions/outcomes/${o.id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', rejectReason: reason, rejectNote: note }),
      })
      const body = await res.json()
      setFlash({ id: o.id, text: body.message ?? (res.ok ? '已记为不发送' : '出错了'), ok: res.ok })
      if (res.ok) {
        setRows((rs) => rs.filter((r) => r.id !== o.id))
        setRejecting(null)
        setRejectReason('')
        setRejectNote('')
      }
    } catch (e) {
      setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
    } finally {
      setBusy(null)
    }
  }, [])

  // 键盘：Y 告诉平台 / N 不发送 / ↑↓ 换一条
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (rejecting || busy || !current) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'y' || e.key === 'Y') void approve(current)
      if (e.key === 'n' || e.key === 'N') setRejecting(current.id)
      if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, rows.length - 1))
      if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, rejecting, busy, rows.length, approve])

  const summary = useMemo(() => {
    const purchases = rows.filter((r) => r.outcome_kind !== 'lead')
    const total = purchases.reduce((s, r) => s + (r.amount_minor ?? 0), 0)
    const cur = purchases[0]?.currency ?? 'NZD'
    return { count: rows.length, purchases: purchases.length, total, cur }
  }, [rows])

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>成交与咨询 · 待核对</h1>
      <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>
        核对无误后点「告诉广告平台」，平台就会去找更多像这位客人一样的人。
        <strong>发出去撤不回</strong>，所以每条都会再确认一次。
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0' }}>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="客户 ID"
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6 }}
        />
        <button onClick={() => void load()} style={btn()}>
          刷新
        </button>
      </div>

      {error && <div style={box('#fee', '#c00')}>读取出错：{error}</div>}
      {loading && <div style={{ color: '#666' }}>读取中…</div>}

      {!loading && !error && rows.length === 0 && clientId && (
        <div style={box('#f4f9f4', '#276')}>没有待核对的记录 —— 都处理完了。</div>
      )}

      {rows.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 14, color: '#444' }}>
          共 <strong>{summary.count}</strong> 条待核对
          {summary.purchases > 0 && (
            <>
              ，其中 {summary.purchases} 笔成交合计{' '}
              <strong>
                {summary.cur} {(summary.total / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
              </strong>
            </>
          )}
          。快捷键：<kbd>Y</kbd> 告诉平台 · <kbd>N</kbd> 不发送 · <kbd>↑</kbd><kbd>↓</kbd> 换一条
        </div>
      )}

      {rows.map((o, i) => {
        const age = daysAgo(o.occurred_at)
        const expired = age > 7
        const focused = i === cursor
        return (
          <div
            key={o.id}
            onClick={() => setCursor(i)}
            style={{
              border: focused ? '2px solid #2563eb' : '1px solid #ddd',
              borderRadius: 8,
              padding: 14,
              marginBottom: 10,
              background: expired ? '#fffbe6' : '#fff',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {kindLabel(o.outcome_kind)}
                  {o.outcome_kind !== 'lead' && ` · ${money(o)}`}
                  {o.order_ref && <span style={{ color: '#888', fontWeight: 400 }}> · 单号 {o.order_ref}</span>}
                </div>
                <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
                  {age === 0 ? '今天' : `${age} 天前`}
                  {' · 来源：'}
                  {{
                    manual_seed: '人工录入',
                    inbox_extract: '邮箱抓取',
                    web_form: '网站表单',
                    meta_lead_form: '广告表单',
                    api: '接口',
                  }[o.source_kind] ?? o.source_kind}
                </div>
                {expired && (
                  <div style={{ color: '#a15c00', fontSize: 13, marginTop: 6 }}>
                    ⚠️ 已过去 {age} 天，广告平台只收 7 天内的 —— 现在发也收不进去，选「不发送」即可。
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <button
                  disabled={busy === o.id || expired}
                  onClick={(e) => {
                    e.stopPropagation()
                    void approve(o)
                  }}
                  title={expired ? '超过 7 天，平台不收' : '告诉广告平台（会再确认一次）'}
                  style={btn(expired ? '#eee' : '#16a34a', expired ? '#999' : '#fff')}
                >
                  ✓ 告诉广告平台
                </button>
                <button
                  disabled={busy === o.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRejecting(o.id)
                  }}
                  style={btn('#f3f4f6', '#333')}
                >
                  ✕ 不发送
                </button>
              </div>
            </div>

            {rejecting === o.id && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>为什么不发送？（必选，将来复查要用）</div>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  style={{ padding: 8, borderRadius: 6, border: '1px solid #ccc', width: '100%' }}
                >
                  <option value="">请选择…</option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {rejectReason === 'other' && (
                  <input
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="写一句原因"
                    style={{ marginTop: 8, padding: 8, borderRadius: 6, border: '1px solid #ccc', width: '100%' }}
                  />
                )}
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button
                    disabled={!rejectReason || busy === o.id}
                    onClick={() => void reject(o, rejectReason, rejectNote)}
                    style={btn(rejectReason ? '#374151' : '#eee', rejectReason ? '#fff' : '#999')}
                  >
                    确认不发送
                  </button>
                  <button onClick={() => setRejecting(null)} style={btn('#f3f4f6', '#333')}>
                    取消
                  </button>
                </div>
              </div>
            )}

            {flash?.id === o.id && (
              <div style={{ marginTop: 10, fontSize: 13, color: flash.ok ? '#276' : '#c00' }}>{flash.text}</div>
            )}
          </div>
        )
      })}

      {flash && !rows.some((r) => r.id === flash.id) && (
        <div style={box(flash.ok ? '#f4f9f4' : '#fee', flash.ok ? '#276' : '#c00')}>{flash.text}</div>
      )}
    </div>
  )
}

function btn(bg = '#f3f4f6', fg = '#111'): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid rgba(0,0,0,0.1)',
    background: bg,
    color: fg,
    fontSize: 14,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

function box(bg: string, fg: string): React.CSSProperties {
  return { background: bg, color: fg, padding: 12, borderRadius: 8, fontSize: 14, marginBottom: 12 }
}
