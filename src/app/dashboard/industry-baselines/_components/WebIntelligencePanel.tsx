'use client'

import { useEffect, useState } from 'react'

type Settings = {
  enabled: boolean; entitled: boolean; entitlement_price: number
  entitlement_currency: 'NZD' | 'AUD' | 'USD' | null
  target_nzd: number; hard_stop_nzd: number; usd_to_nzd: number
  fx_as_of: string; actor_build: string; capture_limit_usd: number
  overhead_nzd: number; context: string
}
type Competitor = {
  domain: string; tier: 'core' | 'secondary' | 'benchmark' | 'watch'
  status: 'active' | 'emerging' | 'archive'; sources: string[]; tags: string[]
  urls: string[]; interval_hours: number
}
type Evidence = { id: string; source_url: string; excerpt: string; observed_at: string; content_hash: string }
type Signal = {
  id: string; domain: string; kind: string; before_evidence_id: string | null
  after_evidence_id: string | null; interpretation_status: string
  classification: string | null; interpretation: { summary?: string; confidence?: number; evidence_ids?: string[] } | null
  recommended_action: string | null; created_at: string
}
type Run = {
  id: string; domain: string; url: string; status: string; provider_status: string | null
  error_code: string | null; created_at: string; capture_cost_usd: number | null
  interpretation_cost_usd: number | null; accounted_nzd: number | null; reserved_nzd: number
}
type Payload = {
  client: { id: string; name: string }; settings: Settings | null; competitors: Competitor[]
  signals: Signal[]; evidence: Evidence[]; runs: Run[]
  budget: { accounted_nzd: number; reserved_nzd: number }; can_edit: boolean; can_run: boolean
}
const field = 'mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm disabled:bg-black/5'
const button = 'rounded-lg bg-me-ochre px-3 py-2 text-sm font-bold text-white disabled:opacity-40'
const card = 'space-y-3 rounded-xl border border-black/10 bg-white p-4'
const sourceOptions = ['manual', 'google_serp', 'meta_ads', 'ai_visibility', 'me_discovery']
const defaults: Settings = {
  enabled: false, entitled: false, entitlement_price: 499, entitlement_currency: null,
  target_nzd: 30, hard_stop_nzd: 50, usd_to_nzd: 0, fx_as_of: '', actor_build: '',
  capture_limit_usd: 0, overhead_nzd: 0, context: '',
}
const money = (n: number | null | undefined) => n == null ? '—' : n.toFixed(2)
const date = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d) }
const split = (s: string) => s.split(/[\n,]/).map(v => v.trim()).filter(Boolean)
const pagePurpose = (raw: string) => {
  let path = ''
  try { path = new URL(raw).pathname.toLowerCase() } catch { return '业务页面' }
  if (path === '/') return '首页'
  if (/new-tours|(?:^|\/)tours\/?$|escorted-tours|private-tours/.test(path)) return '产品列表'
  if (/\/tours\/[^/]+/.test(path)) return '产品详情'
  if (/offer|deal|promotion|sale/.test(path)) return '优惠活动'
  return '业务页面'
}

const normaliseFact = (value: string) => value.toLowerCase().replace(/[*_`#>[\]()]/g, '').replace(/\s+/g, ' ').trim()
const factScore = (value: string) => {
  let score = 0
  if (/[$€£]\s?\d|\b(?:nzd|aud|usd)\s?\d/i.test(value)) score += 5
  if (/available|availability|sold out|spaces? left|in stock|out of stock|book now/i.test(value)) score += 4
  if (/sale|save|offer|discount|promotion|launch|earlybird|new /i.test(value)) score += 3
  if (/\b20\d{2}\b|departure|start date|end date/i.test(value)) score += 2
  if (/price|pricing|review|rating|product|service|package|tour|hiring|partner|technology/i.test(value)) score += 1
  return score
}
const facts = (value = '') => Array.from(new Map(value.split(/\n+/)
  .map(line => line.trim()).filter(line => line.length >= 6 && line.length <= 220)
  .map(line => [normaliseFact(line), line])).values())
const changedFacts = (from: Evidence | undefined, to: Evidence | undefined) => {
  const before = facts(from?.excerpt)
  const after = facts(to?.excerpt)
  const beforeSet = new Set(before.map(normaliseFact))
  const afterSet = new Set(after.map(normaliseFact))
  const select = (items: string[], seen: Set<string>) => items
    .filter(item => !seen.has(normaliseFact(item)))
    .map((text, order) => ({ text, order, score: factScore(text) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3).map(item => item.text)
  return { added: select(after, beforeSet), removed: select(before, afterSet) }
}
const isBaselineReset = (signal: Signal) => /采集器|采集方式|完整读取|新基线|无法证明/.test(signal.interpretation?.summary ?? '')
const impactCopy = (classification: string | null) => classification === 'threat'
  ? '可能削弱我方竞争力，需要评估是否跟进。'
  : classification === 'opportunity'
    ? '出现可抢占空间，值得评估先行动。'
    : '当前证据不支持调整策略。'

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, { method, cache: 'no-store', ...(body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) })
  const data = await res.json()
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`)
  return data as T
}

export function WebIntelligencePanel() {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    request<{ clients: { id: string; name: string }[] }>('/api/clients')
      .then(data => { if (alive) setClients(data.clients) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Unable to load clients') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  return <section className="space-y-4 text-me-charcoal" aria-label="Web intelligence">
    <p className="text-sm">关注竞品发生了什么、意味着什么，以及是否值得回应。</p>
    <label className="block max-w-md text-sm font-bold">客户
      <select className={field} value={clientId} onChange={e => setClientId(e.target.value)} disabled={loading}>
        <option value="">{loading ? '正在加载客户…' : '选择客户'}</option>
        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="text-status-rej">{error}</p>}
    {!loading && !error && clients.length === 0 && <p>暂无可访问的客户。</p>}
    {clientId && <ClientIntelligence key={clientId} clientId={clientId} />}
  </section>
}

function ClientIntelligence({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<'signals' | 'competitors' | 'settings'>('signals')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/web-intelligence`
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    request<Payload>(endpoint).then(value => { if (alive) { setData(value); setRevision(n => n + 1) } })
      .catch(() => { if (alive) setError('未能读取最新情报，请重试。') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [endpoint, refresh])
  const reload = () => setRefresh(n => n + 1)
  const monitored = data?.competitors.filter(c => c.status !== 'archive' && c.urls.length).length ?? 0
  return <div className="space-y-5">
    {loading && <p role="status" className="text-sm">正在更新情报…</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
    {error && !data && <button className={button} onClick={reload} disabled={loading}>重新读取</button>}
    {data && <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-me-ivory p-4">
        <div><h2 className="font-bold">{data.client.name}</h2><p className="mt-1 text-sm">{monitored} 家竞品已配置监控 · 本月已用 NZ${money(data.budget.accounted_nzd)}{data.budget.reserved_nzd > 0 && ` · 待结算 NZ$${money(data.budget.reserved_nzd)}`}</p></div>
        <button className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm disabled:opacity-40" onClick={reload} disabled={loading}>刷新结果</button>
      </div>
      <nav aria-label="情报视图" className="flex gap-2 border-b border-black/10">
        {([['signals', '情报'], ['competitors', '监控对象'], ['settings', '设置']] as const).map(([key, label]) => <button key={key} aria-current={view === key ? 'page' : undefined} className={`px-4 py-3 text-sm ${view === key ? 'border-b-2 border-me-ochre font-bold text-me-charcoal' : 'text-me-charcoal/60'}`} onClick={() => setView(key)}>{label}</button>)}
      </nav>
      {view === 'signals' && <>
        <p className="text-sm text-me-charcoal/70">当前仅分析“监控对象”中已配置的页面，不代表竞品全站。招聘、人员、合作与公益、评论、技术专项尚未接入。</p>
        <Signals signals={data.signals} evidence={data.evidence} />
        <details className="rounded-xl border border-black/10 p-4"><summary className="cursor-pointer text-sm font-bold">采集记录 · {data.runs.length} 次</summary><div className="mt-4"><Runs runs={data.runs} /></div></details>
      </>}
      {view === 'competitors' && <div className="space-y-3">
        <h2 className="text-lg font-bold">监控对象</h2>
        <p className="text-sm text-me-charcoal/70">沿用已有竞品名单。优先配置真正会更新价格、产品、优惠和余位的业务页面；首页只适合发现线索。</p>
        {!data.can_run && <p className="text-sm">该客户尚未开放采集，请在设置中检查监控资格与预算。</p>}
        {data.competitors.length === 0 && <p>尚未找到已有竞品。</p>}
        {data.competitors.map(c => <details key={c.domain} className="rounded-xl border border-black/10 bg-white p-4">
          <summary className="cursor-pointer break-all text-sm"><strong>{c.domain}</strong><span className="ml-3 text-me-charcoal/60">{c.status === 'archive' ? '已归档' : c.urls.length ? `${c.urls.length} 个页面 · 每 ${c.interval_hours} 小时` : '尚未配置监控'}</span></summary>
          <div className="mt-4"><CompetitorCard key={`${c.domain}-${revision}`} competitor={c} clientId={clientId} endpoint={endpoint} canEdit={data.can_edit} canRun={data.can_run} onSaved={reload} /></div>
        </details>)}
      </div>}
      {view === 'settings' && <>
        <p className="text-sm">月度目标 NZ${money(data.settings?.target_nzd ?? 30)} · 停止上限 NZ${money(data.settings?.hard_stop_nzd ?? 50)}。费用与待结算占用合计达到上限后停止新增采集。</p>
        <SettingsForm key={`settings-${revision}`} settings={data.settings} canEdit={data.can_edit} endpoint={endpoint} onSaved={reload} />
      </>}
    </>}
  </div>
}

function SettingsForm({ settings, canEdit, endpoint, onSaved }: { settings: Settings | null; canEdit: boolean; endpoint: string; onSaved: () => void }) {
  const [draft, setDraft] = useState<Settings>(settings ?? defaults)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft(d => ({ ...d, [key]: value }))
  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try { await request(endpoint, 'PATCH', { settings: draft }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save settings') }
    finally { setSaving(false) }
  }
  return <form className={card} onSubmit={save}>
    <h2 className="text-lg font-bold">监控设置</h2>
    {!settings && <p className="text-sm">尚未配置。请先确认监控资格、币种和费用上限，再开启监控。</p>}
    <fieldset disabled={!canEdit || saving} className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <label><input type="checkbox" checked={draft.enabled} onChange={e => set('enabled', e.target.checked)} /> 开启监控</label>
        <label><input type="checkbox" checked={draft.entitled} onChange={e => set('entitled', e.target.checked)} /> 已具备高级会员资格</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">会员月费预留<input className={field} value="499" readOnly /></label>
        <label className="text-sm">会员币种<select className={field} value={draft.entitlement_currency ?? ''} onChange={e => set('entitlement_currency', (e.target.value || null) as Settings['entitlement_currency'])}><option value="">未确认</option>{['NZD', 'AUD', 'USD'].map(v => <option key={v}>{v}</option>)}</select></label>
        {([
          ['target_nzd', '月度费用目标（NZD）', 0.01, 30], ['hard_stop_nzd', '月度停止上限（NZD）', 0.01, 50],
          ['usd_to_nzd', '美元兑纽币汇率', 0.0001, 9.9999], ['capture_limit_usd', '单次采集上限（USD）', 0.01, 1],
          ['overhead_nzd', '单次间接成本（NZD）', 0.02, 1],
        ] as const).map(([key, label, min, max]) => <label key={key} className="text-sm">{label}<input className={field} type="number" min={min} max={max} step="any" required value={draft[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}
        <label className="text-sm">汇率日期<input className={field} type="date" required value={draft.fx_as_of} onChange={e => set('fx_as_of', e.target.value)} /></label>
        <label className="text-sm">采集器版本<input className={field} required pattern="[0-9]+\.[0-9]+\.[0-9]+" placeholder="0.0.1" value={draft.actor_build} onChange={e => set('actor_build', e.target.value)} /></label>
      </div>
      <label className="block text-sm">客户分析背景<textarea className={field} rows={3} maxLength={2000} value={draft.context} onChange={e => set('context', e.target.value)} /></label>
      {canEdit && <button className={button} type="submit">{saving ? '保存中…' : '保存设置'}</button>}
    </fieldset>
    {!canEdit && <p className="text-sm">你的账号只能查看设置。</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
  </form>
}

function CompetitorCard({ competitor, clientId, endpoint, canEdit, canRun, onSaved }: { competitor: Competitor; clientId: string; endpoint: string; canEdit: boolean; canRun: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState(competitor)
  const [tags, setTags] = useState(competitor.tags.join(', '))
  const [urls, setUrls] = useState(competitor.urls.join('\n'))
  const [url, setUrl] = useState(competitor.urls[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function mutate(capture: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      if (capture) {
        await request<{ request_id: string }>(endpoint, 'POST', { domain: competitor.domain, url })
        setMessage(`已加入采集队列。回到“情报”刷新结果查看进度。`)
      } else {
        await request(`/api/clients/${encodeURIComponent(clientId)}/competitor-domains`, 'PATCH', { monitoring: { ...draft, tags: split(tags), urls: split(urls) } })
        onSaved()
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed') }
    finally { setBusy(false) }
  }
  const sources = Array.from(new Set([...sourceOptions, ...draft.sources]))
  return <article className={card}>
    <p className="text-sm font-bold">监控配置</p>
    <form onSubmit={e => { e.preventDefault(); void mutate(false) }}>
      <fieldset disabled={!canEdit || busy} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">竞品层级<select className={field} value={draft.tier} onChange={e => setDraft(d => ({ ...d, tier: e.target.value as Competitor['tier'] }))}>{['core', 'secondary', 'benchmark', 'watch'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="text-sm">监控状态<select className={field} value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as Competitor['status'] }))}>{['active', 'emerging', 'archive'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="text-sm">检查间隔（小时）<input className={field} type="number" min="24" max="720" required value={draft.interval_hours} onChange={e => setDraft(d => ({ ...d, interval_hours: Number(e.target.value) }))} /></label>
        </div>
        <fieldset><legend className="text-sm">发现来源</legend><div className="flex flex-wrap gap-3">{sources.map(source => <label key={source} className="text-sm"><input type="checkbox" checked={draft.sources.includes(source)} onChange={e => setDraft(d => ({ ...d, sources: e.target.checked ? [...d.sources, source] : d.sources.filter(s => s !== source) }))} /> {source}</label>)}</div></fieldset>
        <label className="block text-sm">标签（逗号分隔）<input className={field} value={tags} onChange={e => setTags(e.target.value)} /></label>
        <label className="block text-sm">业务监控网址（最多3个，每行一个）<textarea className={field} rows={3} value={urls} onChange={e => setUrls(e.target.value)} /><span className="mt-1 block text-xs text-me-charcoal/60">建议：产品列表、新品/优惠、核心产品详情各 1 个。</span></label>
        {split(urls).length > 0 && <ul className="space-y-1 text-xs text-me-charcoal/70">{split(urls).map(value => <li className="break-all" key={value}><strong>{pagePurpose(value)}</strong> · {value}</li>)}</ul>}
        {canEdit && <button className={button} type="submit">保存竞品设置</button>}
      </fieldset>
    </form>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void mutate(true) }}>
      <label className="min-w-0 flex-1 text-sm">采集网址<select className={field} value={url} onChange={e => setUrl(e.target.value)} disabled={busy || !canRun}><option value="">选择已保存的网址</option>{competitor.urls.map(u => <option key={u}>{u}</option>)}</select></label>
      <button className={button} disabled={busy || !canRun || competitor.status === 'archive' || !url} type="submit">采集此页面</button>
    </form>
    {message && <p role="status" className="break-all text-sm">{message}</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
  </article>
}

function EvidenceCard({ evidence, label }: { evidence: Evidence | undefined; label: string }) {
  if (!evidence) return <p className="text-sm">{label}：暂无关联证据。</p>
  const safeUrl = /^https?:\/\//i.test(evidence.source_url) ? evidence.source_url : null
  return <div className="min-w-0 space-y-2 rounded-lg border border-black/10 bg-white p-3 text-sm">
    <p className="font-bold">{label}</p>
    <p className="text-xs text-me-charcoal/60">{date(evidence.observed_at)} NZ · {evidence.excerpt.length.toLocaleString()} 字符</p>
    {safeUrl ? <a className="break-all underline" href={safeUrl} target="_blank" rel="noopener noreferrer">查看来源网页</a> : <p>来源链接不可用</p>}
    <details><summary className="cursor-pointer">查看完整证据</summary><blockquote className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">{evidence.excerpt}</blockquote></details>
    <details><summary className="cursor-pointer text-xs text-me-charcoal/60">证据编号</summary><p className="break-all text-xs">{evidence.id} · {evidence.content_hash}</p></details>
  </div>
}

function SignalCard({ signal: s, evidence }: { signal: Signal; evidence: Evidence[] }) {
  const complete = s.interpretation_status === 'complete'
  const labels: Record<string, string> = { threat: '值得警惕', opportunity: '值得关注的机会', ignore: '无需行动' }
  const label = complete ? labels[s.classification ?? ''] ?? '已分析' : s.interpretation_status === 'failed' ? '分析未完成' : '正在分析'
  const summary = s.interpretation?.summary
  const action = s.recommended_action === 'No action recommended.' ? '无需采取行动。' : s.recommended_action
  const before = evidence.find(e => e.id === s.before_evidence_id)
  const after = evidence.find(e => e.id === s.after_evidence_id)
  const source = after?.source_url
  const highlights = changedFacts(before, after)
  const baselineReset = isBaselineReset(s)
  return <article className={card}>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${!complete ? 'bg-amber-50 text-amber-800' : s.classification === 'threat' ? 'bg-red-50 text-red-800' : s.classification === 'opportunity' ? 'bg-green-50 text-green-800' : 'bg-black/5 text-me-charcoal/60'}`}>{label}</span><time className="text-xs text-me-charcoal/60" dateTime={s.created_at}>{date(s.created_at)} NZ</time></div>
    <h3 className="break-all text-lg font-bold">{s.domain}{source ? ` · ${pagePurpose(source)}` : ''}</h3>
    {complete ? <>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg bg-me-ivory p-4"><p className="text-xs font-bold text-me-charcoal/60">发生了什么</p><p className="mt-2 text-sm leading-6">{summary ?? '分析已完成，暂无文字摘要。'}</p></div>
        <div className={`rounded-lg p-4 ${s.classification === 'threat' ? 'bg-red-50' : s.classification === 'opportunity' ? 'bg-green-50' : 'bg-black/[0.03]'}`}><p className="text-xs font-bold text-me-charcoal/60">对我们的影响</p><p className="mt-2 text-sm font-bold leading-6">{impactCopy(s.classification)}</p></div>
        <div className="rounded-lg border border-me-ochre/30 bg-me-ochre/10 p-4"><p className="text-xs font-bold text-me-charcoal/60">如何调衡</p><p className="mt-2 text-sm font-bold leading-6">{action ?? '暂无建议。'}</p></div>
      </div>
      {baselineReset ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><strong>本次是采集方式升级</strong><p>变化前的证据不完整，变化后首次读到完整业务区块。本次只建立新基线，不作为竞争动作；下一次采集才可可靠比较价格、档期和余位。</p></div> : <ChangeHighlights added={highlights.added} removed={highlights.removed} />}
    </> : <p className="text-sm leading-7">{s.interpretation_status === 'failed' ? '已保留页面变化，但本次分析未能生成有效结论。请查看采集记录中的原因。' : '已发现页面差异，正在整理结论。'}</p>}
    <p className="text-xs text-me-charcoal/60">{s.kind === 'business_page_changed' ? '业务内容变化' : '网站页面变化'} · 仅供判断，未自动执行{complete && s.interpretation?.confidence != null ? ` · 判断置信度 ${Math.round(s.interpretation.confidence * 100)}%` : ''}</p>
    <details className="rounded-lg bg-me-ivory p-3"><summary className="cursor-pointer text-sm font-bold">查看变化前后证据</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><EvidenceCard label="之前快照" evidence={before} /><EvidenceCard label="当前快照" evidence={after} /></div></details>
  </article>
}

function ChangeHighlights({ added, removed }: { added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return <div className="rounded-lg border border-black/10 p-4 text-sm"><strong>关键差异</strong><p className="mt-2 text-me-charcoal/70">没有提取到明确的价格、优惠、档期、余位或产品事实增减，请结合上方结论判断。</p></div>
  return <section className="space-y-3" aria-label="关键差异">
    <h4 className="text-sm font-bold">关键差异</h4>
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-red-100 bg-red-50/60 p-4"><p className="text-xs font-bold text-red-800">减少或不再出现</p>{removed.length ? <ul className="mt-2 space-y-2 text-sm">{removed.map(value => <li key={value}>− {value}</li>)}</ul> : <p className="mt-2 text-sm text-me-charcoal/60">未发现高信号事实减少</p>}</div>
      <div className="rounded-lg border border-green-100 bg-green-50/60 p-4"><p className="text-xs font-bold text-green-800">新增或发生改变</p>{added.length ? <ul className="mt-2 space-y-2 text-sm">{added.map(value => <li key={value}>+ {value}</li>)}</ul> : <p className="mt-2 text-sm text-me-charcoal/60">未发现高信号事实新增</p>}</div>
    </div>
  </section>
}

function Signals({ signals, evidence }: { signals: Signal[]; evidence: Evidence[] }) {
  const sources = new Map(evidence.map(e => [e.id, e.source_url]))
  const seen = new Set<string>()
  const latest: Signal[] = []
  const history: Signal[] = []
  const timestamp = (s: Signal) => Date.parse(s.created_at) || 0
  for (const signal of [...signals].sort((a, b) => timestamp(b) - timestamp(a))) {
    const source = signal.after_evidence_id ? sources.get(signal.after_evidence_id) : undefined
    // Missing page identity must not hide another page's unresolved result.
    const key = JSON.stringify([signal.domain, signal.kind, source || signal.id])
    if (seen.has(key)) history.push(signal)
    else { seen.add(key); latest.push(signal) }
  }
  return <section className="space-y-4" aria-label="竞品情报">
    <div><h2 className="text-xl font-bold">最新变化结果</h2><p className="mt-1 text-sm text-me-charcoal/60">按页面和情报方向显示最近一条变化结果，包括无需行动的结论。这里不代表每次采集的状态，完整状态请查看采集记录。</p></div>
    {signals.length === 0 && <div className={card}><p className="font-bold">还没有变化情报</p><p className="text-sm">首次采集建立对照基准，后续采集才会比较变化。可在“监控对象”中查看已配置页面。</p></div>}
    {latest.map(s => <SignalCard key={s.id} signal={s} evidence={evidence} />)}
    {history.length > 0 && <details className="rounded-xl border border-black/10 p-4"><summary className="cursor-pointer text-sm font-bold">历史变化与分析记录 · {history.length} 条</summary><p className="mt-3 text-sm text-me-charcoal/60">以下是同一页面较早的记录。后续结果不代表旧问题已解决，原有结论和失败原因均保留。</p><div className="mt-4 space-y-3">{history.map(s => <SignalCard key={s.id} signal={s} evidence={evidence} />)}</div></details>}
  </section>
}

function Runs({ runs }: { runs: Run[] }) {
  const labels: Record<string, string> = { complete: '已完成', failed: '未完成', reserved: '排队中', capturing: '采集中', captured: '已采集', reconciliation: '费用待核对' }
  return <section className="space-y-3" aria-label="采集记录">
    {runs.length === 0 && <p className="text-sm">暂无采集记录。</p>}
    {runs.map(r => <article className={card} key={r.id}>
      <p className="break-all text-sm font-bold">{r.domain} · {labels[r.status] ?? '处理中'}</p>
      <p className="text-sm">{date(r.created_at)} NZ · {r.accounted_nzd == null ? `待结算 NZ$${money(r.reserved_nzd)}` : `已结算 NZ$${money(r.accounted_nzd)}`}</p>
      {r.error_code && <p className="text-sm text-status-rej">{r.error_code.startsWith('interpretation_') ? '网页已采集，但分析结果未完成。' : r.status === 'reconciliation' ? '费用需要核对后才能继续采集。' : '本次采集未完成。'}</p>}
      <details className="text-xs"><summary className="cursor-pointer">查看诊断信息</summary><div className="mt-2 space-y-2 break-all"><p>{r.url}</p><p>请求编号：{r.id}</p><p>采集状态：{r.provider_status ?? '等待中'} · 采集 US${money(r.capture_cost_usd)} · 分析 US${money(r.interpretation_cost_usd)}</p>{r.error_code && <p>{r.error_code}</p>}</div></details>
    </article>)}
  </section>
}
