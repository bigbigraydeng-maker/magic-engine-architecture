'use client'

/**
 * 选品工作台主组件。
 *
 * 🔴 「改参数重算」全在前端：扫描 API 返回 canonical ProductCandidate（自带 demand/
 *    localMarket），改成本假设时本地 `rankCandidates(candidates, assumptions)` 重新
 *    判定+排序 —— 零回服务器、零重新烧钱。扫描（花钱的 IO）才走 API。
 *
 * 🔴 数据诚实：本地价/需求带 provenance + asOf 展示；用户一旦改过成本假设，
 *    显著标注「参数已改过，非平台默认」，别让改过的数被当成平台观测事实。
 */

import { useMemo, useState } from 'react'
import { rankCandidates } from '@/lib/commerce/product-intel/score'
import type { CostAssumptions } from '@/lib/commerce/product-intel/landed-cost'
import type {
  ProductCandidate,
  ScoredCandidate,
  Verdict,
} from '@/lib/commerce/product-intel/types'

type Assumptions = Omit<CostAssumptions, 'chargeableWeightKg'>

/** 默认成本假设（PM 2026-08-15 费率）。与 scripts/commerce-cost-assumptions.ts 同值。 */
const DEFAULT_ASSUMPTIONS: Assumptions = {
  fxUsdToNzd: 1.6981, freightNzdPerKg: 2.0, importLevyNzd: 2.21, dutyRatePct: 0,
  domesticDeliveryNzd: 3.99, paymentFeePct: 2.9, paymentFeeFixedNzd: 0.3,
  gstRatePct: 15, asOf: '2026-08-15',
}

const ASSUMPTION_FIELDS: ReadonlyArray<{ key: keyof Assumptions; label: string }> = [
  { key: 'fxUsdToNzd', label: '汇率 USD→NZD' },
  { key: 'freightNzdPerKg', label: '运费 NZD/kg' },
  { key: 'importLevyNzd', label: '进口征费 NZD' },
  { key: 'dutyRatePct', label: '关税率 %' },
  { key: 'domesticDeliveryNzd', label: '本地配送 NZD' },
  { key: 'paymentFeePct', label: '支付费率 %' },
  { key: 'paymentFeeFixedNzd', label: '支付固定费 NZD' },
  { key: 'gstRatePct', label: 'GST %' },
]

const VERDICT_META: Record<Verdict, { label: string; cls: string }> = {
  TEST_NOW: { label: '✅ 值得测', cls: 'bg-green-100 text-green-800' },
  WATCH: { label: '👀 观察', cls: 'bg-amber-100 text-amber-800' },
  UNKNOWN: { label: '❓ 判不了', cls: 'bg-slate-100 text-slate-600' },
  REJECT: { label: '❌ 排除', cls: 'bg-red-100 text-red-700' },
}
const VERDICT_ORDER: readonly Verdict[] = ['TEST_NOW', 'WATCH', 'UNKNOWN', 'REJECT']

/** 一个种子词的扫描结果（对应 API 的 SeedScanResult，scored 里含完整 candidate）。 */
interface SeedResult {
  seedKeyword: string
  scored: ScoredCandidate[]
  error?: string
}

function parseSeeds(text: string): string[] {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
}

function money(v: number | null | undefined): string {
  return v == null ? '—' : `NZ$${v.toFixed(2)}`
}

export default function CommerceWorkbench() {
  const [seedsText, setSeedsText] = useState('')
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [rawResults, setRawResults] = useState<SeedResult[]>([])
  const [errorMsg, setErrorMsg] = useState('')

  const assumptionsChanged = useMemo(
    () => ASSUMPTION_FIELDS.some((f) => assumptions[f.key] !== DEFAULT_ASSUMPTIONS[f.key]),
    [assumptions],
  )

  // 🔴 前端重算：改成本假设时，对已扫回的 candidate 本地重新判定+排序，不回服务器。
  const recomputed = useMemo(
    () => rawResults.map((r) => ({
      seedKeyword: r.seedKeyword,
      error: r.error,
      scored: r.error ? [] : rankCandidates(r.scored.map((s) => s.candidate), assumptions),
    })),
    [rawResults, assumptions],
  )

  const tally = useMemo(() => {
    const counts: Record<Verdict, number> = { TEST_NOW: 0, WATCH: 0, UNKNOWN: 0, REJECT: 0 }
    for (const r of recomputed) for (const s of r.scored) counts[s.verdict] += 1
    return counts
  }, [recomputed])

  async function runScan(): Promise<void> {
    const seeds = parseSeeds(seedsText)
    if (seeds.length === 0) { setErrorMsg('请先输入种子词'); setStatus('error'); return }
    setStatus('scanning'); setErrorMsg(''); setRawResults([]); setProgress({ done: 0, total: seeds.length, current: seeds[0] })

    try {
      const res = await fetch('/api/commerce/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds, market: 'NZ', assumptions, opts: { maxResults: 10, enrichCount: 3 } }),
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        setErrorMsg(j.error ?? `扫描失败（HTTP ${res.status}）`); setStatus('error'); return
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.replace(/^data: /, '').trim()
          if (!line) continue
          const msg = JSON.parse(line)
          if (msg.type === 'progress') setProgress({ done: msg.done, total: msg.total, current: msg.current })
          else if (msg.type === 'done') { setRawResults(msg.results); setProgress(null); setStatus('done') }
          else if (msg.type === 'error') { setErrorMsg(msg.error); setStatus('error') }
        }
      }
      setStatus((s) => (s === 'scanning' ? 'done' : s))
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err)); setStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      <SeedInput
        seedsText={seedsText} onSeedsChange={setSeedsText}
        scanning={status === 'scanning'} onScan={runScan}
      />

      <AssumptionsForm
        assumptions={assumptions} changed={assumptionsChanged}
        onChange={setAssumptions} onReset={() => setAssumptions(DEFAULT_ASSUMPTIONS)}
      />

      {status === 'scanning' && progress && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          扫描中… {progress.done}/{progress.total} · 当前「{progress.current}」（一个词约 1–2 分钟，别关页面）
        </div>
      )}
      {status === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
      )}

      {recomputed.length > 0 && (
        <ResultsView
          recomputed={recomputed} tally={tally}
          assumptions={assumptions} assumptionsChanged={assumptionsChanged}
        />
      )}
    </div>
  )
}

function SeedInput(props: {
  seedsText: string; onSeedsChange: (v: string) => void
  scanning: boolean; onScan: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="block text-sm font-medium text-slate-700">
        种子词（逗号或换行分隔，一次最多 5 个）
      </label>
      <textarea
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        rows={3} placeholder="portable blender, dog nail grinder, phone tripod"
        value={props.seedsText} onChange={(e) => props.onSeedsChange(e.target.value)}
        disabled={props.scanning}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={props.onScan} disabled={props.scanning}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {props.scanning ? '扫描中…' : '开始扫描'}
        </button>
        <span className="text-xs text-slate-400">扫描会调用付费数据源，仅管理员可用</span>
      </div>
    </div>
  )
}

function AssumptionsForm(props: {
  assumptions: Assumptions; changed: boolean
  onChange: (a: Assumptions) => void; onReset: () => void
}) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-5" open={props.changed}>
      <summary className="cursor-pointer text-sm font-medium text-slate-700">
        成本参数（改了当场重算利润，不重新扫描）
        {props.changed && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">已改过，非平台默认</span>}
      </summary>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ASSUMPTION_FIELDS.map((f) => (
          <label key={f.key} className="text-xs text-slate-500">
            {f.label}
            <input
              type="number" step="any"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
              value={props.assumptions[f.key] as number}
              onChange={(e) => props.onChange({ ...props.assumptions, [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      {props.changed && (
        <button onClick={props.onReset} className="mt-3 text-xs text-slate-500 underline">恢复平台默认费率</button>
      )}
    </details>
  )
}

function ResultsView(props: {
  recomputed: Array<{ seedKeyword: string; error?: string; scored: readonly ScoredCandidate[] }>
  tally: Record<Verdict, number>
  assumptions: Assumptions
  assumptionsChanged: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {VERDICT_ORDER.map((v) => (
          <span key={v} className={`rounded-full px-3 py-1 text-xs font-medium ${VERDICT_META[v].cls}`}>
            {VERDICT_META[v].label} {props.tally[v]}
          </span>
        ))}
      </div>
      {props.assumptionsChanged && (
        <p className="text-xs text-amber-700">
          ⚠️ 下面的利润与判定是按你改过的成本参数算的，不是平台默认费率 —— 别当成平台观测事实。
        </p>
      )}
      {props.recomputed.map((r) => (
        <div key={r.seedKeyword} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">
            种子词「{r.seedKeyword}」
            <span className="ml-2 text-xs text-slate-400">
              ⚠️ 需求与本地价是这个品类词的量，不是单品
            </span>
          </div>
          {r.error && <p className="text-sm text-red-600">这个词没扫成：{r.error}</p>}
          {!r.error && r.scored.length === 0 && <p className="text-sm text-slate-400">没有候选</p>}
          <div className="space-y-2">
            {r.scored.slice(0, 8).map((s, i) => (
              <CandidateRow key={i} scored={s} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CandidateRow(props: { scored: ScoredCandidate }) {
  const c: ProductCandidate = props.scored.candidate
  const econ = props.scored.gates.find((g) => g.gate === 'unit_economics')
  const local = c.localMarket?.medianPriceNzd
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-slate-800">{c.title.slice(0, 64)}</span>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${VERDICT_META[props.scored.verdict].cls}`}>
          {VERDICT_META[props.scored.verdict].label}
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        美国已售 {c.cumulativeSold.value?.toLocaleString() ?? '—'} · 本地中位 {money(local?.value)}
        {local?.collectedAt && <span className="text-slate-400"> · {local.provenance}·{local.source.slice(0, 40)}</span>}
      </div>
      {econ && <div className="mt-1 text-xs text-slate-600">{econ.reason}</div>}
    </div>
  )
}
