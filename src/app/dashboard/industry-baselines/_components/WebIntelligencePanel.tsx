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
const split = (s: string) => s.split(/[\n,]/).map(v => v.trim()).filter(Boolean)

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
    <p className="text-sm">Detect website changes, understand market signals and review recommendations. Recommended actions are never executed automatically.</p>
    <label className="block max-w-md text-sm font-bold">Client
      <select className={field} value={clientId} onChange={e => setClientId(e.target.value)} disabled={loading}>
        <option value="">{loading ? 'Loading clients…' : 'Select a client'}</option>
        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="text-status-rej">{error}</p>}
    {!loading && !error && clients.length === 0 && <p>No accessible clients.</p>}
    {clientId && <ClientIntelligence key={clientId} clientId={clientId} />}
  </section>
}

function ClientIntelligence({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/web-intelligence`
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    request<Payload>(endpoint).then(value => { if (alive) setData(value) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Unable to load intelligence') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [endpoint, refresh])
  const reload = () => setRefresh(n => n + 1)
  return <div className="space-y-4">
    <button className={button} onClick={reload} disabled={loading}>Refresh intelligence</button>
    {loading && <p role="status">Loading intelligence…</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
    {data && <>
      <div className={card}>
        <h2 className="text-lg font-bold">{data.client.name} · Monthly budget</h2>
        <p>Accounted: NZ${money(data.budget.accounted_nzd)} · Reserved: NZ${money(data.budget.reserved_nzd)}</p>
        <p className="text-sm">Target: NZ${money(data.settings?.target_nzd ?? 30)} · Hard stop: NZ${money(data.settings?.hard_stop_nzd ?? 50)}. Collection stops when the reserved and accounted total reaches the limit.</p>
      </div>
      <SettingsForm key={`settings-${refresh}`} settings={data.settings} canEdit={data.can_edit} endpoint={endpoint} onSaved={reload} />
      <div className="space-y-3">
        <h2 className="text-lg font-bold">Existing competitor watchlist</h2>
        <p className="text-sm">Reuses the client competitor list and Industry Baseline matches. Add or remove domains through the existing competitor workflow.</p>
        {!data.can_run && <p className="text-sm">Collection is unavailable until this client is enabled, entitled and approved for the pilot with a valid budget configuration.</p>}
        {data.competitors.length === 0 && <p>No existing competitors found.</p>}
        {data.competitors.map(c => <CompetitorCard key={`${c.domain}-${refresh}`} competitor={c} clientId={clientId} endpoint={endpoint} canEdit={data.can_edit} canRun={data.can_run} onSaved={reload} />)}
      </div>
      <Signals signals={data.signals} evidence={data.evidence} />
      <Runs runs={data.runs} />
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
    <h2 className="text-lg font-bold">Monitoring settings</h2>
    {!settings && <p className="text-sm">Not configured. Monitoring is disabled by default. Confirm the subscription currency and collection budget before enabling.</p>}
    <fieldset disabled={!canEdit || saving} className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <label><input type="checkbox" checked={draft.enabled} onChange={e => set('enabled', e.target.checked)} /> Monitoring enabled</label>
        <label><input type="checkbox" checked={draft.entitled} onChange={e => set('entitled', e.target.checked)} /> Advanced membership entitled</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Membership price / month<input className={field} value="499" readOnly /></label>
        <label className="text-sm">Membership currency<select className={field} value={draft.entitlement_currency ?? ''} onChange={e => set('entitlement_currency', (e.target.value || null) as Settings['entitlement_currency'])}><option value="">Not confirmed</option>{['NZD', 'AUD', 'USD'].map(v => <option key={v}>{v}</option>)}</select></label>
        {([
          ['target_nzd', 'Monthly target (NZD)', 0.01, 30], ['hard_stop_nzd', 'Monthly hard stop (NZD)', 0.01, 50],
          ['usd_to_nzd', 'USD to NZD rate', 0.0001, 9.9999], ['capture_limit_usd', 'Per-capture limit (USD)', 0.01, 1],
          ['overhead_nzd', 'Per-capture overhead reserve (NZD)', 0.02, 1],
        ] as const).map(([key, label, min, max]) => <label key={key} className="text-sm">{label}<input className={field} type="number" min={min} max={max} step="any" required value={draft[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}
        <label className="text-sm">Exchange rate date<input className={field} type="date" required value={draft.fx_as_of} onChange={e => set('fx_as_of', e.target.value)} /></label>
        <label className="text-sm">Collector version<input className={field} required pattern="[0-9]+\.[0-9]+\.[0-9]+" placeholder="0.0.1" value={draft.actor_build} onChange={e => set('actor_build', e.target.value)} /></label>
      </div>
      <label className="block text-sm">Client interpretation context<textarea className={field} rows={3} maxLength={2000} value={draft.context} onChange={e => set('context', e.target.value)} /></label>
      {canEdit && <button className={button} type="submit">{saving ? 'Saving…' : 'Save settings'}</button>}
    </fieldset>
    {!canEdit && <p className="text-sm">Settings are read-only for your account.</p>}
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
        const result = await request<{ request_id: string }>(endpoint, 'POST', { domain: competitor.domain, url })
        setMessage(`Collection queued. Request: ${result.request_id}. Refresh to check progress.`)
      } else {
        await request(`/api/clients/${encodeURIComponent(clientId)}/competitor-domains`, 'PATCH', { monitoring: { ...draft, tags: split(tags), urls: split(urls) } })
        onSaved()
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed') }
    finally { setBusy(false) }
  }
  const sources = Array.from(new Set([...sourceOptions, ...draft.sources]))
  return <article className={card}>
    <h3 className="break-all font-bold">{competitor.domain}</h3>
    <form onSubmit={e => { e.preventDefault(); void mutate(false) }}>
      <fieldset disabled={!canEdit || busy} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Tier<select className={field} value={draft.tier} onChange={e => setDraft(d => ({ ...d, tier: e.target.value as Competitor['tier'] }))}>{['core', 'secondary', 'benchmark', 'watch'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="text-sm">Status<select className={field} value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as Competitor['status'] }))}>{['active', 'emerging', 'archive'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="text-sm">Interval (hours)<input className={field} type="number" min="24" max="720" required value={draft.interval_hours} onChange={e => setDraft(d => ({ ...d, interval_hours: Number(e.target.value) }))} /></label>
        </div>
        <fieldset><legend className="text-sm">Discovery sources</legend><div className="flex flex-wrap gap-3">{sources.map(source => <label key={source} className="text-sm"><input type="checkbox" checked={draft.sources.includes(source)} onChange={e => setDraft(d => ({ ...d, sources: e.target.checked ? [...d.sources, source] : d.sources.filter(s => s !== source) }))} /> {source}</label>)}</div></fieldset>
        <label className="block text-sm">Tags (comma separated)<input className={field} value={tags} onChange={e => setTags(e.target.value)} /></label>
        <label className="block text-sm">Monitored website URLs (up to 3, one per line)<textarea className={field} rows={2} value={urls} onChange={e => setUrls(e.target.value)} /></label>
        {canEdit && <button className={button} type="submit">Save competitor settings</button>}
      </fieldset>
    </form>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void mutate(true) }}>
      <label className="min-w-0 flex-1 text-sm">URL to collect<select className={field} value={url} onChange={e => setUrl(e.target.value)} disabled={busy || !canRun}><option value="">Select a saved URL</option>{competitor.urls.map(u => <option key={u}>{u}</option>)}</select></label>
      <button className={button} disabled={busy || !canRun || competitor.status === 'archive' || !url} type="submit">Collect website</button>
    </form>
    {message && <p role="status" className="break-all text-sm">{message}</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
  </article>
}

function EvidenceCard({ evidence, label }: { evidence: Evidence | undefined; label: string }) {
  if (!evidence) return <p className="text-sm">{label}: No linked evidence (initial observation or evidence unavailable).</p>
  const safeUrl = /^https?:\/\//i.test(evidence.source_url) ? evidence.source_url : null
  return <div className="min-w-0 space-y-1 rounded-lg bg-me-ivory p-3 text-sm">
    <p className="font-bold">{label}</p>
    {safeUrl ? <a className="break-all underline" href={safeUrl} target="_blank" rel="noopener noreferrer">{evidence.source_url}</a> : <p className="break-all">{evidence.source_url}</p>}
    <p>Observed: {evidence.observed_at}</p>
    <blockquote className="whitespace-pre-wrap break-words">{evidence.excerpt}</blockquote>
    <details><summary>Evidence reference</summary><p className="break-all">{evidence.id} · {evidence.content_hash}</p></details>
  </div>
}

function Signals({ signals, evidence }: { signals: Signal[]; evidence: Evidence[] }) {
  return <section className="space-y-3" aria-label="Market signals">
    <h2 className="text-lg font-bold">Market signals and recommendations</h2>
    {signals.length === 0 && <p className="text-sm">No signals yet. The first successful capture establishes a baseline; later captures can reveal changes.</p>}
    {signals.map(s => <article className={card} key={s.id}>
      <h3 className="break-all font-bold">{s.domain} · {s.kind}</h3>
      <p className="text-sm">{s.classification ?? 'Awaiting classification'} · Interpretation: {s.interpretation_status} · {s.created_at}</p>
      <p>{s.interpretation?.summary ?? 'Interpretation is not available yet.'}</p>
      {s.interpretation?.confidence != null && <p className="text-sm">Confidence: {s.interpretation.confidence}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <EvidenceCard label="Before" evidence={evidence.find(e => e.id === s.before_evidence_id)} />
        <EvidenceCard label="After" evidence={evidence.find(e => e.id === s.after_evidence_id)} />
      </div>
      <p className="text-sm"><strong>Recommended action:</strong> {s.recommended_action ?? 'No recommendation yet.'}</p>
      <p className="text-xs font-bold">Recommendation only · No action executed</p>
    </article>)}
  </section>
}

function Runs({ runs }: { runs: Run[] }) {
  return <section className="space-y-3" aria-label="Collection runs">
    <h2 className="text-lg font-bold">Collection history</h2>
    {runs.length === 0 && <p className="text-sm">No collection runs yet.</p>}
    {runs.map(r => <article className={card} key={r.id}>
      <p className="break-all font-bold">{r.domain} · {r.status}</p>
      <p className="break-all text-sm">{r.url}</p>
      <p className="text-sm">{r.created_at} · Collection status: {r.provider_status ?? 'Pending'}</p>
      <p className="text-sm">Collection US${money(r.capture_cost_usd)} · Interpretation US${money(r.interpretation_cost_usd)} · Accounted NZ${money(r.accounted_nzd)} · Reserved NZ${money(r.reserved_nzd)}</p>
      {r.error_code && <p className="text-sm text-status-rej">Error: {r.error_code}</p>}
      <details className="text-xs"><summary>Request reference</summary><p className="break-all">{r.id}</p></details>
    </article>)}
  </section>
}
