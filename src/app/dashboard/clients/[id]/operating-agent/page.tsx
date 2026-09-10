'use client'

import { useEffect, useState } from 'react'
import type { OperatingBrief } from '@/lib/web-intelligence/operating-brief'

type Payload = { operating: OperatingBrief }

const statusLabel = {
  comparable: '候选可比',
  out_of_scope: '范围外',
  insufficient_evidence: '证据不足',
} as const

export default function OperatingAgentPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<OperatingBrief | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('暂时无法读取经营上下文。')
        return response.json() as Promise<Payload>
      })
      .then(value => setData(value.operating))
      .catch(reason => setError(reason instanceof Error ? reason.message : '暂时无法读取经营上下文。'))
  }, [params.id])

  if (error) return <main className="mx-auto max-w-5xl p-6"><p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p></main>
  if (!data) return <main className="mx-auto max-w-5xl p-6"><p role="status" className="text-sm text-me-charcoal/60">正在整理客户经营上下文…</p></main>

  const { decision } = data
  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-me-charcoal">
    <header className="rounded-2xl bg-me-charcoal p-6 text-white">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-me-gold">经营 Agent · Detect / Understand / Recommend</p>
      <h1 className="mt-2 text-2xl font-bold">{data.client_name} 当前该关注什么</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">先看客户目标与产品范围，再看主要竞品，最后只给有证据支持的下一步。所有动作仍需人工复核。</p>
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
      <article className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="text-lg font-bold">未知与回流</h2><ul className="mt-3 space-y-2 text-sm leading-6">{decision.unknowns.map(item => <li key={item} className="rounded-lg bg-black/[0.03] p-3">{item}</li>)}</ul><p className="mt-4 border-t border-black/5 pt-4 text-sm leading-6"><strong>Check / Tune：</strong>{decision.check_and_tune}</p></article>
    </section>
    <p className="text-xs text-me-charcoal/45">截至 {new Date(data.as_of).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}（Pacific/Auckland）· 事实、推断、建议和未知已分开显示。</p>
  </main>
}

function ContextCard({ title, values }: { title: string; values: string[] }) {
  return <article className="rounded-xl border border-black/10 bg-white p-4"><h2 className="text-sm font-bold text-me-charcoal/60">{title}</h2><ul className="mt-2 space-y-1 text-sm leading-6">{values.map(value => <li key={value}>{value}</li>)}</ul></article>
}

function EvidenceCard({ title, evidence }: Pick<{ title: string; evidence: OperatingBrief['decision']['evidence'] }, 'title' | 'evidence'>) {
  return <article className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="text-lg font-bold">{title}</h2>{evidence.length ? <ul className="mt-3 space-y-2 text-sm leading-6">{evidence.map(item => <li key={item.id} className="rounded-lg bg-me-ivory p-3"><p>{item.statement}</p><p className="mt-1 text-xs text-me-charcoal/50">{item.source} · {item.observed_at ? new Date(item.observed_at).toLocaleDateString('en-NZ') : '时间未知'} · {item.confidence}</p></li>)}</ul> : <p className="mt-3 text-sm text-me-charcoal/60">尚无可展示的证据。</p>}</article>
}
