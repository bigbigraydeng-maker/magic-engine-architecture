'use client'

import { useEffect, useState } from 'react'
import type { OperatingBrief } from '@/lib/web-intelligence/operating-brief'

type Payload = { operating: OperatingBrief; client: { domain: string | null }; can_run: boolean }
type ComparisonResult = { summary: string; client_strengths: string[]; competitor_strengths: string[]; differences: string[]; recommendations: string[]; unknowns: string[]; confidence: number; evidence_urls: string[] }

const statusLabel = {
  comparable: '找到相近竞品',
  out_of_scope: '不在本次范围',
  insufficient_evidence: '资料还不够',
} as const

export default function OperatingAgentPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<OperatingBrief | null>(null)
  const [clientDomain, setClientDomain] = useState<string | null>(null)
  const [canRun, setCanRun] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [captureState, setCaptureState] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('暂时无法读取经营上下文。')
        return response.json() as Promise<Payload>
      })
      .then(value => { setData(value.operating); setClientDomain(value.client.domain); setCanRun(value.can_run) })
      .catch(reason => setError(reason instanceof Error ? reason.message : '暂时无法读取经营上下文。'))
  }, [params.id, refresh])

  async function captureClientProducts() {
    if (!clientDomain) return
    setCaptureState('正在读取 CTS 官网…')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: clientDomain, url: `https://${clientDomain}/` }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? '暂时无法读取 CTS 官网。')
      setCaptureState('已开始读取，稍后刷新即可看到 CTS 产品。')
      window.setTimeout(() => setRefresh(value => value + 1), 8000)
    } catch (reason) { setCaptureState(reason instanceof Error ? reason.message : '暂时无法读取 CTS 官网。') }
  }

  if (error) return <main className="mx-auto max-w-5xl p-6"><p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p></main>
  if (!data) return <main className="mx-auto max-w-5xl p-6"><p role="status" className="text-sm text-me-charcoal/60">正在整理客户经营上下文…</p></main>

  const { decision } = data
  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-me-charcoal">
    <header className="rounded-2xl bg-me-charcoal p-6 text-white">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-me-gold">经营 Agent · Detect / Understand / Recommend</p>
      <h1 className="mt-2 text-2xl font-bold">{data.client_name} 当前该关注什么</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">先把 CTS 自己的 Tour 资料读出来，再和主要竞品比较。所有动作仍需人工复核。</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void captureClientProducts()} disabled={!canRun || !clientDomain || captureState.startsWith('正在')} className="rounded-lg bg-me-gold px-3 py-2 text-sm font-bold text-me-charcoal disabled:opacity-50">{captureState.startsWith('正在') ? captureState : '读取 CTS 官网产品'}</button>{captureState && !captureState.startsWith('正在') && <span className="text-xs text-white/75">{captureState}</span>}</div>
    </header>

    <section className="grid gap-4 md:grid-cols-3" aria-label="客户上下文">
      <ContextCard title="当前目标" values={decision.context} />
      <ContextCard title="客户产品范围" values={data.product_scope.labels.length ? [`${data.product_scope.labels.join('、')}（${data.product_scope.source}）`] : ['尚无可靠产品范围']} />
      <ContextCard title="授权边界" values={['本页只提供建议', '不调价、不改广告、不发布']} />
    </section>

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
        <div className="mt-3 space-y-2">{data.matches.length ? data.matches.map(match => <div key={`${match.client_product ?? 'missing'}-${match.competitor_product ?? 'missing'}`} className="rounded-lg border border-black/5 p-3 text-sm"><div className="flex items-start justify-between gap-3"><strong>{match.client_product ?? 'CTS 产品未提供'}</strong><span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{statusLabel[match.status]}</span></div><p className="mt-1 text-me-charcoal/65">{match.competitor_product ?? '没有可确认的竞品对位'}</p><p className="mt-2 text-xs leading-5 text-me-charcoal/55">{match.reason}</p></div>) : <p className="text-sm text-me-charcoal/60">尚无可判断的产品记录。</p>}</div>
      </article>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <EvidenceCard title="证据" evidence={decision.evidence} />
      <article className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="text-lg font-bold">还缺什么信息？下一步怎么做</h2><ul className="mt-3 space-y-2 text-sm leading-6">{decision.unknowns.map(item => <li key={item} className="rounded-lg bg-black/[0.03] p-3">{item}</li>)}</ul><p className="mt-4 border-t border-black/5 pt-4 text-sm leading-6"><strong>下一步：</strong>{decision.check_and_tune}</p></article>
    </section>
    <p className="text-xs text-me-charcoal/45">截至 {new Date(data.as_of).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}（Pacific/Auckland）· 事实、推断、建议和未知已分开显示。</p>
  </main>
}

function TourComparisonSection({ clientId, candidates, marketScope }: { clientId: string; candidates: OperatingBrief['comparison_candidates']; marketScope: string[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, ComparisonResult>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
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
  return <section className="space-y-4 rounded-2xl border border-me-ochre/30 bg-me-ochre/5 p-5" aria-label="AI Tour 产品对比">
    <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">AI 产品对比</p><h2 className="mt-1 text-xl font-bold">我们的团，和最接近的竞品团各自强在哪里？</h2><p className="mt-2 text-sm leading-6 text-me-charcoal/70">先由规则找到相似候选，再由 AI 解释消费者真正能感知的差异。价格和路线不同不是错误，而是比较内容。</p></div>
    <div className="grid gap-3 lg:grid-cols-2">{candidates.map((candidate, index) => <button type="button" key={`${candidate.client_product.name}-${candidate.competitor_product.source_url}`} onClick={() => void analyse(index)} disabled={busy !== null} className={`text-left rounded-xl border bg-white p-4 transition ${selected === index ? 'border-me-ochre ring-2 ring-me-ochre/20' : 'border-black/10 hover:border-me-ochre/50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-me-charcoal/55">CTS：{candidate.client_product.name}</p><p className="mt-1 font-black">竞品：{candidate.competitor_product.name}</p></div><span className="shrink-0 rounded-full bg-me-ivory px-2 py-1 text-[11px] font-bold">相似度 {candidate.match_score}</span></div><p className="mt-3 text-xs font-bold text-me-ochre">{busy === index ? '正在分析…' : results[index] ? '重新生成对比' : '点击查看优劣势对比 →'}</p></button>)}</div>
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
