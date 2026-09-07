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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatMoney } from '@/lib/conversions/money'

/**
 * Meta 只收 7 天内的事件（官方硬限制）。
 * 🔴 这里**不能** import metaCapiWriter 来取这个数 —— 这是 'use client' 组件，
 *    writer 牵连出 hasher → node 的 crypto，拖进浏览器 bundle 会让整页闪一下就崩
 *    （2026-09-06 线上实测）。宁可写死这个常数，也不把服务端模块拉进客户端。
 */
const MAX_AGE_DAYS = 7

type Writeback = {
  id: string
  status: string
  last_error: string | null
  next_attempt_at: string | null
}

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
  me_conversion_writebacks?: Writeback[]
}

/** 这条记录当前的发送状态（一个事实目前只发一个平台，取第一条即可）。 */
function sendState(o: Outcome): Writeback | null {
  return o.me_conversion_writebacks?.[0] ?? null
}

const REJECT_REASONS: Array<{ value: string; label: string }> = [
  { value: 'customer_opted_out', label: '客人明确说过别用他的信息' },
  { value: 'not_real_sale', label: '不是真成交（补开发票之类）' },
  { value: 'duplicate', label: '重复了，同一笔已经有一条' },
  { value: 'other', label: '其它（下面写一句）' },
]

/**
 * 金额一律走 `money.ts` 那一份。
 * 🔴 这里曾经自己抄过一份带 `?? 2` 兜底的小数位表 —— 正是 money.ts 文件头
 *    声讨的那个事故的第 4 份复制。而这一页是人按下撤不回按钮前**唯一**核对金额的地方，
 *    兜底值在这里最不该存在。
 */
function money(o: Outcome): string {
  return formatMoney(o.amount_minor, o.currency) ?? '—'
}

function kindLabel(k: Outcome['outcome_kind']): string {
  return k === 'purchase' ? '收到定金' : k === 'balance' ? '收到尾款' : '有效咨询'
}

/** 精确天数。判"过没过期"用它，跟服务端同一口径；显示时才取整。 */
function daysAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

export default function ConversionsPage() {
  const [clientId, setClientId] = useState<string>('')
  const [rows, setRows] = useState<Outcome[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writebackDisabled, setWritebackDisabled] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  const [stuck, setStuck] = useState<Outcome[]>([])
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<string>('')
  const [rejectNote, setRejectNote] = useState('')

  /**
   * 深链参数：今日待办邮件里的两条 kind 都会带上：
   *   · conversion_needs_review → ?client=<id>&focus=<outcomeId>
   *   · conversion_send_in_doubt → ?client=<id>&status=in_doubt
   * 这两个是**一次性**动作——加载完数据自动跳到对的位置就消费掉，
   * 别再影响用户后续手动切换（否则改 URL 或 pushState 一次它又跳一次）。
   * 2026-09-07 每日待办 href 落地页审计 (PR #1467) 修复项。
   */
  const [focusOutcomeId, setFocusOutcomeId] = useState<string | null>(null)
  const [autoScrollStatus, setAutoScrollStatus] = useState<string | null>(null)
  const stuckSectionRef = useRef<HTMLDivElement | null>(null)
  const outcomeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    setClientId(p.get('client') ?? '')
    setFocusOutcomeId(p.get('focus'))
    setAutoScrollStatus(p.get('status'))
  }, [])

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    setWritebackDisabled(false)
    try {
      const base = `/api/admin/conversions/outcomes?client_id=${encodeURIComponent(clientId)}&limit=200`
      // 已批准但没走完的：发出去没下文的、失败可重试的。send_status 交给接口在 SQL
      // 层筛（不是先按最新 200 条截断再筛）—— 否则堆积超过 200 条时，卡住的老记录
      // 会先被"最新 N 条"的窗口挤掉，压根轮不到这一步筛选。
      const [pendingRes, stuckRes] = await Promise.all([
        fetch(`${base}&review_status=pending_review`),
        fetch(`${base}&review_status=approved&send_status=in_doubt,failed`),
      ])
      const pending = await pendingRes.json()
      if (!pendingRes.ok) {
        // 成交回写那张表还没建（migration 未 apply）时，查询会报"表不存在"。
        // 这不是坏了，是那部分还没启用 —— 平静地说明，别弹红。名单下载不受影响。
        const msg = String(pending.error ?? '')
        if (/does not exist|relation|42P01|PGRST205|could not find the table/i.test(msg)) {
          setWritebackDisabled(true)
          setRows([])
          setStuck([])
          return
        }
        throw new Error(pending.error ?? '读取失败')
      }
      setRows(pending.outcomes ?? [])
      setCursor(0)

      // 今日待办叫人来点这里的按钮 —— 不列出来就是让人扑空（管道断头）。
      const stuckBody = await stuckRes.json()
      setStuck(stuckBody.outcomes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 邮件深链 ?focus=<outcomeId>：数据到手后，把 cursor 跳到那条 + scrollIntoView。
   * 待核对堆积超过 200 条时，目标可能比默认列表窗口更老、根本不在 `rows` 里
   * ——这种情况按 id 直查一次（不受 limit/排序影响），把这一条插到列表最前面。
   * 直查也找不到才是真的没了（可能已经被人处理掉了、或 outcomeId 拼错）——
   * 静默不动，用户看到普通列表，不弹错。跳完清空 focusOutcomeId，同一 URL 不会二次跳。
   */
  useEffect(() => {
    if (!focusOutcomeId || rows.length === 0) return
    const id = focusOutcomeId
    const idx = rows.findIndex((r) => r.id === id)
    if (idx >= 0) {
      setCursor(idx)
      // ref 可能因为渲染时序还没设上，用 setTimeout 让 React 提交完再 scroll
      setTimeout(() => outcomeRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
      setFocusOutcomeId(null)
      return
    }
    if (!clientId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/conversions/outcomes?client_id=${encodeURIComponent(clientId)}&id=${encodeURIComponent(id)}`,
        )
        const body = await res.json()
        if (cancelled || !res.ok) return
        const found: Outcome | undefined = (body.outcomes ?? [])[0]
        if (!found || found.review_status !== 'pending_review') return
        setRows((rs) => (rs.some((r) => r.id === found.id) ? rs : [found, ...rs]))
        setCursor(0)
        setTimeout(() => outcomeRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
      } finally {
        if (!cancelled) setFocusOutcomeId(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [focusOutcomeId, rows, clientId])

  /**
   * 邮件深链 ?status=in_doubt：数据到手后 scroll 到「需要你动手」区块，
   * 让 PM 直接看到 doubt 那条卡片。stuck 空的时候啥也不做（可能已经解决完了）。
   * 跳完清空 autoScrollStatus，别在后续 stuck 变化时重复 scroll。
   */
  useEffect(() => {
    if (autoScrollStatus !== 'in_doubt' || stuck.length === 0) return
    setTimeout(() => stuckSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    setAutoScrollStatus(null)
  }, [autoScrollStatus, stuck])

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
          setRows((rs) => {
            const next = rs.filter((r) => r.id !== o.id)
            setCursor((c) => Math.min(c, Math.max(0, next.length - 1)))
            return next
          })
        }
      } catch (e) {
        setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setBusy(null)
      }
    },
    [],
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
        setRows((rs) => {
          const next = rs.filter((r) => r.id !== o.id)
          setCursor((c) => Math.min(c, Math.max(0, next.length - 1)))
          return next
        })
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

  const resolve = useCallback(
    async (o: Outcome, resolution: 'confirmed' | 'resend') => {
      const wb = sendState(o)
      if (!wb) return
      if (resolution === 'confirmed') {
        const ok = window.confirm(
          '你在广告平台后台确认看到这一笔了吗？\n\n' +
            '看到了才点确定 —— 记成"已收到"之后就不会再发了。',
        )
        if (!ok) return
      } else {
        const ok = window.confirm(
          '确认平台**没有**收到，要重新发一次吗？\n\n' +
            '⚠️ 如果其实已经收到了，这一下会让同一笔算成两笔，而且撤不回。\n' +
            '请先在平台后台确认真的没有再点。',
        )
        if (!ok) return
      }

      setBusy(o.id)
      try {
        const res = await fetch(`/api/admin/conversions/writebacks/${wb.id}/resolve-doubt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ resolution }),
        })
        const body = await res.json()
        if (res.ok && resolution === 'resend') {
          // 放回队列还不算发出去 —— 真正再发一次走这个接口。
          const sendRes = await fetch(`/api/admin/conversions/outcomes/${o.id}/send`, { method: 'POST' })
          const sendBody = await sendRes.json()
          setFlash({ id: o.id, text: sendBody.message ?? '已重新发送', ok: sendRes.ok })
        } else {
          setFlash({ id: o.id, text: body.message ?? '已处理', ok: res.ok })
        }
        if (res.ok) void load()
      } catch (e) {
        setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const retry = useCallback(
    async (o: Outcome) => {
      setBusy(o.id)
      try {
        const res = await fetch(`/api/admin/conversions/outcomes/${o.id}/send`, { method: 'POST' })
        const body = await res.json()
        setFlash({ id: o.id, text: body.message ?? (res.ok ? '已重试' : '出错了'), ok: res.ok })
        if (res.ok) void load()
      } catch (e) {
        setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // 键盘：Y 告诉平台 / N 不发送 / ↑↓ 换一条
  const [aud, setAud] = useState<Record<string, Record<string, number | string>>>({})
  const [audienceLoading, setAudienceLoading] = useState(false)
  const [keyLock, setKeyLock] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 🔴 window.confirm 是阻塞的，期间的第二次按键拿到的还是旧的 busy=null，
      //    不锁住会连发两个请求。
      if (rejecting || busy || keyLock || !current) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'y' || e.key === 'Y') {
        setKeyLock(true)
        void approve(current).finally(() => setKeyLock(false))
      }
      if (e.key === 'n' || e.key === 'N') setRejecting(current.id)
      if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, rows.length - 1))
      if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, rejecting, busy, keyLock, rows.length, approve])

  const checkAudience = useCallback(async () => {
    if (!clientId) return
    setAudienceLoading(true)
    const base = `/api/admin/conversions/audience-export?client_id=${encodeURIComponent(clientId)}&format=stats`
    const next: Record<string, Record<string, number | string>> = {}
    for (const source of ['fbleads']) {
      try {
        const res = await fetch(`${base}&source=${source}`)
        const body = await res.json()
        next[source] = res.ok ? body : { error: 1, note: body.error ?? '出错' }
      } catch (e) {
        next[source] = { error: 1, note: e instanceof Error ? e.message : String(e) }
      }
    }
    setAud(next)
    setAudienceLoading(false)
  }, [clientId])

  const summary = useMemo(() => {
    const purchases = rows.filter((r) => r.outcome_kind !== 'lead' && r.amount_minor != null)
    const currencies = new Set(purchases.map((r) => r.currency))
    // 🔴 混币种不给合计。把 NZD 和 AUD 加在一起再贴上第一条的币种标签，
    //    是一个**看起来很正常的错数字** —— 比不显示危险得多。
    const total =
      currencies.size === 1
        ? formatMoney(
            purchases.reduce((sum, r) => sum + (r.amount_minor ?? 0), 0),
            purchases[0]?.currency ?? null,
          )
        : null
    return { count: rows.length, purchases: purchases.length, total, mixed: currencies.size > 1 }
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

      <div style={{ border: '1px solid #d4c4a6', background: '#faf6ec', borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Meta 客户名单（做 lookalike 用）</div>
        <div style={{ fontSize: 13, color: '#6a5f4a', margin: '4px 0 10px' }}>
          只含<strong>终端客户</strong>（旅行社同行、员工、拒联的自动排除）。看够不够 100 人再下载。
        </div>
        <button onClick={() => void checkAudience()} disabled={!clientId || audienceLoading} style={btn()}>
          {audienceLoading ? '统计中…' : '① 先看人数'}
        </button>

        {(['fbleads'] as const).map((source) => {
          const st = aud[source]
          if (!st) return null
          const today = new Date().toISOString().slice(0, 10)
          return (
            <div key={source} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e8ddc9', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 130 }}>FB 广告来的</strong>
                {st.error ? (
                  <span style={{ color: '#c00' }}>出错：{String(st.note)}</span>
                ) : (
                  <>
                    <span>可上传 <strong>{st.kept}</strong> 人</span>
                    <a
                      href={`/api/admin/conversions/audience-export?client_id=${encodeURIComponent(clientId)}&format=csv&source=${source}`}
                      style={{ ...btn('#16a34a', '#fff'), textDecoration: 'none', padding: '4px 10px' }}
                    >
                      下载（命名 CTS · LIST · fbleads · {today.replace(/-/g, '')}）
                    </a>
                  </>
                )}
              </div>
              {!st.error && <div style={{ color: '#8a7d64', marginTop: 4 }}>{st.note}</div>}
            </div>
          )
        })}

        {Object.keys(aud).length > 0 && (
          <div style={{ color: '#a15c00', marginTop: 10, fontSize: 13 }}>
            🔴 下载后到 Meta 后台建 Customer List 上传（Meta 自己加密）。<strong>传完请删掉文件。</strong>
            退订/未订阅的人已自动不在名单里。
          </div>
        )}
      </div>

      {writebackDisabled && (
        <div style={box('#f5efe4', '#6a5f4a')}>
          成交回写功能尚未启用（需先建数据表并重新连接 Meta）。上面的「客户名单下载」不受影响，可以正常使用。
        </div>
      )}
      {error && <div style={box('#fee', '#c00')}>读取出错：{error}</div>}
      {loading && <div style={{ color: '#666' }}>读取中…</div>}

      {!loading && !error && !writebackDisabled && rows.length === 0 && stuck.length === 0 && clientId && (
        <div style={box('#f4f9f4', '#276')}>没有待核对的记录 —— 都处理完了。</div>
      )}

      {stuck.length > 0 && (
        <div ref={stuckSectionRef} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>需要你动手（{stuck.length}）</h2>
          {stuck.map((o) => {
            const wb = sendState(o)!
            const doubt = wb.status === 'in_doubt'
            return (
              <div
                key={o.id}
                style={{
                  border: '1px solid #f0c36d',
                  background: '#fffbe6',
                  borderRadius: 8,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {kindLabel(o.outcome_kind)}
                  {o.outcome_kind !== 'lead' && ` · ${money(o)}`}
                  {o.order_ref && <span style={{ color: '#888', fontWeight: 400 }}> · 单号 {o.order_ref}</span>}
                </div>
                <div style={{ fontSize: 13, color: '#7a5c00', margin: '6px 0 10px' }}>
                  {doubt
                    ? '这一笔发出去时断线了，不确定平台收到没有。系统不会自己重发 —— 重发一次就是把同一笔算成两笔，撤不回。'
                    : `上次发送没成功：${wb.last_error ?? '未知原因'}。可以再试一次。`}
                </div>
                {doubt ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button disabled={busy === o.id} onClick={() => void resolve(o, 'confirmed')} style={btn('#16a34a', '#fff')}>
                      平台后台看到了 · 记为已收到
                    </button>
                    <button disabled={busy === o.id} onClick={() => void resolve(o, 'resend')} style={btn('#b45309', '#fff')}>
                      确认没收到 · 重新发送
                    </button>
                  </div>
                ) : (
                  <button disabled={busy === o.id} onClick={() => void retry(o)} style={btn('#374151', '#fff')}>
                    再试一次
                  </button>
                )}
                {flash?.id === o.id && (
                  <div style={{ marginTop: 10, fontSize: 13, color: flash.ok ? '#276' : '#c00' }}>{flash.text}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 14, color: '#444' }}>
          共 <strong>{summary.count}</strong> 条待核对
          {summary.purchases > 0 && (
            <>
              ，其中 {summary.purchases} 笔成交
              {summary.total ? (
                <>
                  合计 <strong>{summary.total}</strong>
                </>
              ) : summary.mixed ? (
                <span style={{ color: '#888' }}>（多种币种，不显示合计）</span>
              ) : null}
            </>
          )}
          。快捷键：<kbd>Y</kbd> 告诉平台 · <kbd>N</kbd> 不发送 · <kbd>↑</kbd><kbd>↓</kbd> 换一条
        </div>
      )}

      {rows.map((o, i) => {
        const age = daysAgo(o.occurred_at)
        const expired = age > MAX_AGE_DAYS
        const focused = i === cursor
        return (
          <div
            key={o.id}
            ref={(el) => {
              outcomeRefs.current[o.id] = el
            }}
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
                  {age < 1 ? '今天' : `${Math.floor(age)} 天前`}
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
                    ⚠️ 已过去 {Math.floor(age)} 天，广告平台只收 {MAX_AGE_DAYS} 天内的 —— 现在发也收不进去，选「不发送」即可。
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
