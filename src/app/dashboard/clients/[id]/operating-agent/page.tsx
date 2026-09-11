'use client'

import { useEffect, useState } from 'react'
import type { OperatingBrief } from '@/lib/web-intelligence/operating-brief'
import type { TourLandscape } from '@/lib/web-intelligence/tour-landscape'

type Payload = { operating: OperatingBrief; client: { domain: string | null }; can_run: boolean; client_product_source?: { kind: 'master_brief' | 'first_party_feed' | 'web_snapshot' | 'none'; count: number }; runs?: Array<{ id: string; status: string; provider_status: string | null }> }
type ComparisonResult = { summary: string; client_strengths: string[]; competitor_strengths: string[]; differences: string[]; recommendations: string[]; unknowns: string[]; confidence: number; evidence_urls: string[] }
type CapturePhase = 'idle' | 'queued' | 'capturing' | 'analysing' | 'complete' | 'failed'

const statusLabel = {
  comparable: '找到相近竞品',
  out_of_scope: '不在本次范围',
  insufficient_evidence: '资料还不够',
} as const

export default function OperatingAgentPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<OperatingBrief | null>(null)
  const [clientProductSource, setClientProductSource] = useState<Payload['client_product_source']>()
  const [clientDomain, setClientDomain] = useState<string | null>(null)
  const [canRun, setCanRun] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [captureRequestId, setCaptureRequestId] = useState<string | null>(null)
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle')
  const [completionReloaded, setCompletionReloaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('暂时无法读取经营上下文。')
        return response.json() as Promise<Payload>
      })
      .then(value => {
        setData(value.operating); setClientProductSource(value.client_product_source); setClientDomain(value.client.domain); setCanRun(value.can_run)
        if (captureRequestId) {
          const run = value.runs?.find(item => item.id === captureRequestId)
          if (run?.status === 'complete') setCapturePhase('complete')
          else if (run?.status === 'failed' || run?.status === 'reconciliation') setCapturePhase('failed')
          else if (run?.provider_status) setCapturePhase('analysing')
          else if (run) setCapturePhase('capturing')
          else setCapturePhase('queued')
        }
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : '暂时无法读取经营上下文。'))
  }, [params.id, refresh, captureRequestId])

  useEffect(() => {
    if (!captureRequestId || capturePhase === 'complete' || capturePhase === 'failed') return
    const timer = window.setTimeout(() => setRefresh(value => value + 1), 4000)
    return () => window.clearTimeout(timer)
  }, [captureRequestId, capturePhase, refresh])

  useEffect(() => {
    if (capturePhase !== 'complete' || completionReloaded) return
    setCompletionReloaded(true)
    const first = window.setTimeout(() => setRefresh(value => value + 1), 750)
    const second = window.setTimeout(() => setRefresh(value => value + 1), 4000)
    return () => { window.clearTimeout(first); window.clearTimeout(second) }
  }, [capturePhase, completionReloaded])

  async function captureClientProducts() {
    if (!clientDomain) return
    setCompletionReloaded(false)
    setCapturePhase('capturing')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: clientDomain, url: `https://${clientDomain}/` }),
      })
      const payload = await response.json() as { error?: string; request_id?: string }
      if (!response.ok) throw new Error(payload.error ?? '暂时无法读取 CTS 官网。')
      setCaptureRequestId(payload.request_id ?? null)
      setCapturePhase('queued')
      setRefresh(value => value + 1)
    } catch { setCaptureRequestId(null); setCapturePhase('failed') }
  }

  if (error) return <main className="mx-auto max-w-5xl p-6"><p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p></main>
  if (!data) return <main className="mx-auto max-w-5xl p-6"><p role="status" className="text-sm text-me-charcoal/60">正在整理客户经营上下文…</p></main>

  const { decision } = data
  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-me-charcoal">
    <header className="rounded-2xl bg-me-charcoal p-6 text-white">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-me-gold">经营 Agent · Detect / Understand / Recommend</p>
      <h1 className="mt-2 text-2xl font-bold">{data.client_name} 当前该关注什么</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">先把 CTS 自己的 Tour 资料读出来，再和主要竞品比较。所有动作仍需人工复核。</p>
      <div className="mt-4 space-y-3">
        <button type="button" onClick={() => void captureClientProducts()} disabled={!canRun || !clientDomain || ['queued', 'capturing', 'analysing'].includes(capturePhase)} className="rounded-lg bg-me-gold px-3 py-2 text-sm font-bold text-me-charcoal disabled:opacity-50">{['queued', 'capturing', 'analysing'].includes(capturePhase) ? '正在读取…' : capturePhase === 'complete' ? '重新读取 CTS 产品' : '读取 CTS 官网产品'}</button>
        {capturePhase !== 'idle' && <CaptureProgress phase={capturePhase} />}
      </div>
    </header>

    <section className="grid gap-4 md:grid-cols-3" aria-label="客户上下文">
      <ContextCard title="当前目标" values={decision.context} />
      <ContextCard title="客户产品范围" values={data.product_scope.labels.length ? [`${data.product_scope.labels.join('、')}（${data.product_scope.source}）`] : ['尚无可靠产品范围']} />
      <ContextCard title="授权边界" values={['本页只提供建议', '不调价、不改广告、不发布']} />
    </section>
    <ProductSourceStatus source={clientProductSource} />

    <section className="rounded-2xl border border-me-ochre/30 bg-me-ochre/10 p-5">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">本轮经营问题</p>
      <h2 className="mt-2 text-xl font-bold">{decision.question}</h2>
      <p className="mt-3 text-sm leading-6">{decision.impact}</p>
      <p className="mt-4 rounded-xl bg-white p-4 text-sm font-bold leading-6">建议：{decision.recommendation}</p>
    </section>

    <TourComparisonSection clientId={params.id} candidates={data.comparison_candidates} marketScope={data.product_scope.labels} />

    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-black/10 bg-white p-5">
        <h2 className="text-lg font-bold">竞品情报</h2>
        {decision.external_signal.length ? <ul className="mt-3 space-y-2 text-sm leading-6">{decision.external_signal.map(item => <li key={`${item.source_url}-${item.observed_at ?? 'unknown'}`} className="rounded-lg bg-me-ivory p-3"><p>{item.statement}</p><p className="mt-2 text-xs text-me-charcoal/60"><a className="underline" href={item.source_url} target="_blank" rel="noreferrer">来源</a> · 观察于 {item.observed_at ? new Date(item.observed_at).toLocaleString('zh-CN') : '时间未知'} · 有效至 {item.valid_until ? new Date(item.valid_until).toLocaleDateString('zh-CN') : '未知'}</p></li>)}</ul> : <p className="mt-3 text-sm text-me-charcoal/60">尚无可用竞品产品证据。</p>}
      </article>
      <article className="rounded-2xl border border-black/10 bg-white p-5">
        <h2 className="text-lg font-bold">同类产品判断</h2>
        <ProductMatches matches={data.matches} />
      </article>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <EvidenceCard title="证据" evidence={decision.evidence} />
      <article className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="text-lg font-bold">还缺什么信息？下一步怎么做</h2><ul className="mt-3 space-y-2 text-sm leading-6">{decision.unknowns.map(item => <li key={item} className="rounded-lg bg-black/[0.03] p-3">{item}</li>)}</ul><p className="mt-4 border-t border-black/5 pt-4 text-sm leading-6"><strong>下一步：</strong>{decision.check_and_tune}</p></article>
    </section>
    <p className="text-xs text-me-charcoal/45">截至 {new Date(data.as_of).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}（Pacific/Auckland）· 事实、推断、建议和未知已分开显示。</p>
  </main>
}

function CaptureProgress({ phase }: { phase: Exclude<CapturePhase, 'idle'> }) {
  const details: Record<Exclude<CapturePhase, 'idle'>, { label: string; copy: string; width: number; tone: string }> = {
    queued: { label: '已排队', copy: '请求已提交，等待读取服务开始。页面会自动检查状态。', width: 20, tone: 'text-amber-100' },
    capturing: { label: '正在读取网页', copy: '正在读取 CTS 官网内容，暂时不用手动刷新。', width: 48, tone: 'text-amber-100' },
    analysing: { label: '正在整理产品资料', copy: '网页已读到，正在整理 Tour、路线、天数和价格。', width: 78, tone: 'text-amber-100' },
    complete: { label: '本次官网读取已完成', copy: '网页读取已完成。若 CTS 第一方产品源已部署，刷新后产品盘面会使用它；否则暂时沿用已有资料。', width: 100, tone: 'text-green-200' },
    failed: { label: '读取未完成', copy: '这次没有完成读取，可以稍后点击按钮重试。', width: 100, tone: 'text-red-200' },
  }
  const detail = details[phase]
  return <div role="status" className="max-w-2xl rounded-xl border border-white/15 bg-white/10 p-3">
    <div className="flex items-center justify-between gap-3 text-xs font-bold"><span className={detail.tone}>{detail.label}</span><span className="text-white/60">{phase === 'complete' || phase === 'failed' ? '无需等待' : '自动更新中'}</span></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={detail.width} aria-valuetext={detail.label}><div className={`h-full rounded-full transition-all duration-500 ${phase === 'failed' ? 'bg-red-300' : phase === 'complete' ? 'bg-green-300' : 'animate-pulse bg-me-gold'}`} style={{ width: `${detail.width}%` }} /></div>
    <p className="mt-2 text-xs leading-5 text-white/75">{detail.copy}</p>
  </div>
}

function ProductSourceStatus({ source }: { source?: Payload['client_product_source'] }) {
  const details = {
    master_brief: { label: '客户已确认产品资料', copy: '当前经营判断使用客户已确认的产品资料。', tone: 'border-green-200 bg-green-50 text-green-900' },
    first_party_feed: { label: '已读取 CTS 第一方产品库', copy: `已读到 ${source?.count ?? 0} 条 active Tour；页面不需要再手动刷新。`, tone: 'border-green-200 bg-green-50 text-green-900' },
    web_snapshot: { label: '当前使用官网网页快照', copy: `已读到 ${source?.count ?? 0} 条产品；第一方产品库尚未成为当前来源。`, tone: 'border-amber-200 bg-amber-50 text-amber-900' },
    none: { label: '尚未读到 CTS 产品', copy: '当前没有可用于经营比较的 CTS 产品资料。', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  } as const
  const detail = details[source?.kind ?? 'none']
  return <section className={`rounded-xl border p-4 ${detail.tone}`} role="status"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{detail.label}</strong><span className="text-xs font-bold">{source?.count ?? 0} 条</span></div><p className="mt-1 text-sm">{detail.copy}</p></section>
}

function ProductMatches({ matches }: { matches: OperatingBrief['matches'] }) {
  return <details className="mt-3 rounded-lg bg-black/[0.03] p-3"><summary className="cursor-pointer text-sm font-bold">查看逐条候选（{matches.length} 条，仅作证据参考）</summary><div className="mt-3 space-y-2">{matches.length ? matches.map(match => <div key={`${match.client_product ?? 'missing'}-${match.competitor_product ?? 'missing'}`} className="rounded-lg border border-black/5 bg-white p-3 text-sm"><div className="flex items-start justify-between gap-3"><strong>{match.client_product ?? 'CTS 产品未提供'}</strong><span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{statusLabel[match.status]}</span></div>{match.client_product && <p className="mt-2 text-xs text-me-charcoal/60">CTS：{match.client_duration_days ? `${match.client_duration_days} 天` : '天数待补'} · {match.client_price ?? '价格待补'}</p>}<p className="mt-2 text-xs font-bold text-me-charcoal/55">竞品候选（不是 CTS 产品）</p><p className="mt-1 text-me-charcoal/65">{match.competitor_product ?? '没有可确认的竞品对位'}</p>{match.competitor_domain && <p className="mt-1 text-xs text-me-charcoal/60">竞品：{match.competitor_domain} · {match.competitor_duration_days ? `${match.competitor_duration_days} 天` : '天数未知'} · {match.competitor_price ?? '价格未知'}</p>}<p className="mt-2 text-xs leading-5 text-me-charcoal/55">{match.reason}</p></div>) : <p className="text-sm text-me-charcoal/60">尚无可判断的产品记录。</p>}</div></details>
}

function TourComparisonSection({ clientId, candidates, marketScope }: { clientId: string; candidates: OperatingBrief['comparison_candidates']; marketScope: string[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, ComparisonResult>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [landscape, setLandscape] = useState<TourLandscape | null>(null)
  const [landscapeBusy, setLandscapeBusy] = useState(false)
  const [landscapeError, setLandscapeError] = useState('')
  if (!candidates.length) return <section className="rounded-2xl border border-black/10 bg-white p-5"><p className="text-xs font-bold text-me-charcoal/55">AI 产品对比</p><h2 className="mt-1 text-lg font-bold">暂时没有足够接近的竞品候选</h2><p className="mt-2 text-sm text-me-charcoal/65">需要先读取 CTS 产品和竞品 Tour 的路线、天数、价格及包含项目，才能进行可靠的优劣势分析。</p></section>
  async function analyse(index: number) {
    const candidate = candidates[index]
    setSelected(index); setBusy(index); setError('')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/web-intelligence/tour-comparison`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market_scope: marketScope, client_product: { name: candidate.client_product.name, record: { name: candidate.client_product.name, duration_days: candidate.client_product.duration_days, price: candidate.client_product.price, route: candidate.client_product.route, departure_window: candidate.client_product.departure_window, includes: candidate.client_product.includes, positioning: candidate.client_product.positioning, audience: candidate.client_product.audience } }, competitor_product: candidate.competitor_product }) })
      const payload = await response.json() as { comparison?: ComparisonResult; error?: string }
      if (!response.ok || !payload.comparison) throw new Error(payload.error ?? '对比失败')
      setResults(previous => ({ ...previous, [index]: payload.comparison! }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法生成对比。') }
    finally { setBusy(null) }
  }
  const result = selected == null ? null : results[selected]
  async function summariseLandscape() {
    setLandscapeBusy(true); setLandscapeError('')
    try { const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/web-intelligence/tour-landscape`, { method: 'POST' }); const payload = await response.json() as { landscape?: TourLandscape; error?: string }; if (!response.ok || !payload.landscape) throw new Error(payload.error ?? '总览生成失败'); setLandscape(payload.landscape) }
    catch (reason) { setLandscapeError(reason instanceof Error ? reason.message : '暂时无法生成竞品总览。') }
    finally { setLandscapeBusy(false) }
  }
  return <section className="space-y-4 rounded-2xl border border-me-ochre/30 bg-me-ochre/5 p-5" aria-label="AI Tour 产品总览">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">AI 竞品总览</p><h2 className="mt-1 text-xl font-bold">市场上正在卖什么，CTS 该关注什么？</h2><p className="mt-2 text-sm leading-6 text-me-charcoal/70">AI 会综合多个竞品的城市、天数、价格和定位，给出消费者视角的整体判断，不强行把不同 Tour 一一配对。</p></div><button type="button" onClick={() => void summariseLandscape()} disabled={landscapeBusy} className="rounded-lg bg-me-ochre px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{landscapeBusy ? '正在汇总…' : landscape ? '重新生成总览' : '生成竞品总览'}</button></div>
    {landscapeError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{landscapeError}</p>}
    {landscape && <article className="space-y-4 rounded-xl border border-black/10 bg-white p-5"><div><p className="text-xs font-bold text-me-charcoal/55">整体结论</p><h3 className="mt-1 text-lg font-black">{landscape.headline}</h3><p className="mt-2 text-sm leading-6">{landscape.market_summary}</p></div><div className="grid gap-3 md:grid-cols-2"><ComparisonList title="CTS 可以利用的机会" items={landscape.client_opportunities} tone="green" /><ComparisonList title="需要留意的风险" items={landscape.client_risks} tone="amber" /><ComparisonList title="建议优先关注" items={landscape.recommended_focus} tone="ochre" /><ComparisonList title="还缺什么证据" items={landscape.unknowns} tone="muted" /></div><p className="border-t border-black/5 pt-3 text-xs text-me-charcoal/50">Haiku 汇总 · 置信度 {Math.round(landscape.confidence * 100)}% · 仅供人工复核</p></article>}
    {!landscape && <p className="rounded-xl bg-white/70 p-4 text-sm text-me-charcoal/65">点击“生成竞品总览”，查看当前市场组合的整体判断。</p>}
    <details className="rounded-xl border border-black/10 bg-white p-4"><summary className="cursor-pointer text-sm font-bold">查看逐条候选证据（{candidates.length} 条）</summary><div className="mt-4 grid gap-3 lg:grid-cols-2">{candidates.map((candidate, index) => <button type="button" key={`${candidate.client_product.name}-${candidate.competitor_product.source_url}`} onClick={() => void analyse(index)} disabled={busy !== null} className={`text-left rounded-xl border bg-white p-4 transition ${selected === index ? 'border-me-ochre ring-2 ring-me-ochre/20' : 'border-black/10 hover:border-me-ochre/50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-me-charcoal/55">CTS：{candidate.client_product.name}</p><p className="mt-1 font-black">竞品：{candidate.competitor_product.name}</p></div><span className="shrink-0 rounded-full bg-me-ivory px-2 py-1 text-[11px] font-bold">相似度 {candidate.match_score}</span></div><p className="mt-3 text-xs font-bold text-me-ochre">{busy === index ? '正在分析…' : results[index] ? '重新生成对比' : '点击查看优劣势对比 →'}</p></button>)}</div></details>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {result && <article className="space-y-4 rounded-xl border border-black/10 bg-white p-5"><div><p className="text-xs font-bold text-me-charcoal/55">结论</p><h3 className="mt-1 text-lg font-black leading-7">{result.summary}</h3><p className="mt-2 text-xs text-me-charcoal/55">AI 置信度 {Math.round(result.confidence * 100)}% · 来源已锁定为客户与竞品页面</p></div><div className="grid gap-3 md:grid-cols-2"><ComparisonList title="CTS 的优势" items={result.client_strengths} tone="green" /><ComparisonList title="竞品的优势" items={result.competitor_strengths} tone="amber" /></div><ComparisonList title="消费者能感知的差异" items={result.differences} /><ComparisonList title="可以考虑的方向" items={result.recommendations} tone="ochre" />{result.unknowns.length > 0 && <ComparisonList title="仍需补证的信息" items={result.unknowns} tone="muted" />}<div className="border-t border-black/5 pt-3 text-xs text-me-charcoal/55">仅供人工评估，不代表已调整产品或执行营销动作。{result.evidence_urls.map(url => <a key={url} className="ml-3 underline" href={url} target="_blank" rel="noreferrer">查看来源</a>)}</div></article>}
  </section>
}

function ComparisonList({ title, items, tone = 'muted' }: { title: string; items: string[]; tone?: 'green' | 'amber' | 'ochre' | 'muted' }) {
  const styles = { green: 'bg-green-50/70', amber: 'bg-amber-50/70', ochre: 'bg-me-ochre/10', muted: 'bg-black/[0.03]' }
  return <div className={`rounded-lg p-4 ${styles[tone]}`}><h4 className="text-sm font-bold">{title}</h4>{items.length ? <ul className="mt-2 space-y-2 text-sm leading-6">{items.map(item => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-sm text-me-charcoal/55">暂无足够证据。</p>}</div>
}

function ContextCard({ title, values }: { title: string; values: string[] }) {
  return <article className="rounded-xl border border-black/10 bg-white p-4"><h2 className="text-sm font-bold text-me-charcoal/60">{title}</h2><ul className="mt-2 space-y-1 text-sm leading-6">{values.map(value => <li key={value}>{value}</li>)}</ul></article>
}

function EvidenceCard({ title, evidence }: Pick<{ title: string; evidence: OperatingBrief['decision']['evidence'] }, 'title' | 'evidence'>) {
  return <article className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="text-lg font-bold">{title}</h2>{evidence.length ? <ul className="mt-3 space-y-2 text-sm leading-6">{evidence.map(item => <li key={item.id} className="rounded-lg bg-me-ivory p-3"><p>{item.statement}</p><p className="mt-1 text-xs text-me-charcoal/50">{/^https?:\/\//i.test(item.source) ? <a className="font-bold underline" href={item.source} target="_blank" rel="noreferrer">打开竞品产品页面</a> : item.source} · {item.observed_at ? new Date(item.observed_at).toLocaleDateString('en-NZ') : '时间未知'} · {item.confidence}</p></li>)}</ul> : <p className="mt-3 text-sm text-me-charcoal/60">尚无可展示的证据。</p>}</article>
}
