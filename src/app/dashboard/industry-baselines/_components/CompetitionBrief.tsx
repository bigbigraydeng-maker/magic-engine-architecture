import type { BriefDimension, BriefStatus, CompetitionBrief as Brief } from '@/lib/web-intelligence/competition-brief'

const statusLabel: Record<BriefStatus, string> = {
  ready: '可直接比较', limited: '仅有单方数据', stale: '需要更新', unconfigured: '尚未配置',
  no_observation: '暂无记录', failed: '读取失败', not_connected: '尚未接入',
}
const statusStyle: Record<BriefStatus, string> = {
  ready: 'bg-green-50 text-green-800', limited: 'bg-amber-50 text-amber-800', stale: 'bg-amber-50 text-amber-800',
  unconfigured: 'bg-black/5 text-me-charcoal/60', no_observation: 'bg-black/5 text-me-charcoal/60',
  failed: 'bg-red-50 text-red-800', not_connected: 'bg-black/5 text-me-charcoal/60',
}
const observed = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : '尚无观测日期'
const generated = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

function DimensionCard({ item }: { item: BriefDimension }) {
  return <article className="rounded-xl border border-black/10 bg-white p-4">
    <div className="flex items-start justify-between gap-2">
      <h3 className="font-bold">{item.label}</h3>
      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${statusStyle[item.status]}`}>{statusLabel[item.status]}</span>
    </div>
    <p className="mt-3 text-sm font-bold leading-6">{item.headline}</p>
    <p className="mt-2 text-sm leading-6 text-me-charcoal/75">{item.detail}</p>
    {item.items && item.items.length > 0 && <ul className="mt-3 divide-y divide-black/5 rounded-lg bg-me-ivory px-3">{item.items.map(value => <li key={value} className="py-2 text-sm leading-6">{value}</li>)}</ul>}
    <div className="mt-4 border-t border-black/5 pt-3 text-xs leading-5 text-me-charcoal/55">
      <p>{item.source} · {observed(item.observed_at)}</p>
      <p>{item.coverage}</p>
    </div>
  </article>
}

export function CompetitionBrief({ brief }: { brief: Brief }) {
  return <section className="space-y-4" aria-label="竞争简报">
    <div className="rounded-2xl border border-me-ochre/30 bg-gradient-to-br from-me-ochre/10 to-white p-5">
      <p className="text-xs font-bold tracking-wide text-me-charcoal/55">经营判断 · {generated(brief.as_of)} NZ</p>
      <h2 className="mt-2 text-2xl font-black leading-tight">{brief.headline}</h2>
      <p className="mt-2 text-sm text-me-charcoal/70">{brief.summary}</p>
      <div className="mt-5 rounded-xl bg-white/80 p-4">
        <h3 className="font-bold">本周建议</h3>
        <ol className="mt-2 space-y-2 text-sm leading-6">{brief.actions.slice(0, 3).map((action, index) => <li key={action}><strong>{index + 1}.</strong> {action}</li>)}</ol>
      </div>
    </div>
    {brief.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm" role="status"><strong>数据限制</strong><ul className="mt-2 space-y-1">{brief.warnings.map(item => <li key={item}>• {item}</li>)}</ul></div>}
    <div>
      <h2 className="text-xl font-bold">四个经营维度</h2>
      <p className="mt-1 text-sm text-me-charcoal/60">各维度口径不同，分别用于判断产品、获客、信任与 AI 推荐表现，不合成虚假总分。</p>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">{brief.dimensions.map(item => <DimensionCard key={item.key} item={item} />)}</div>
    <details className="rounded-xl border border-black/10 bg-white p-4">
      <summary className="cursor-pointer text-sm font-bold">其他监控维度 · {brief.gaps.length} 项待补齐</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{brief.gaps.map(gap => <div key={gap.label} className="rounded-lg bg-black/[0.03] p-3 text-sm"><strong>{gap.label}</strong><p className="mt-1 text-me-charcoal/60">{gap.reason}</p></div>)}</div>
    </details>
  </section>
}
