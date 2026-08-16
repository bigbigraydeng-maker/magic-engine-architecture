'use client'

/**
 * ME2 产品地图控制台 —— 三视图。
 *
 * 顺序按「PM 打开是为了做决定」排(板桥 S1):等你拍板 → 各条线做到哪了 → 一件件看。
 * 依赖关系并进「一件件看」的行展开(板桥 S2),不做独立视图。
 */

import { Fragment, useMemo, useState } from 'react'
import {
  MeButton,
  MeChip,
  MePanel,
  MePanelHeader,
  MePill,
  MeStatCard,
  MeTable,
  MeTd,
  MeTh,
  MeTr,
} from '@/components/ui/me-primitives'
import { cx } from '@/components/ui/me-theme'
import { BUCKET_LABEL } from '@/lib/product-map/presenter'
import type { ComponentView, ConsolePresentation, DecisionView } from '@/lib/product-map/presenter'

type ViewKey = 'decisions' | 'lanes' | 'list'

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'decisions', label: '等你拍板' },
  { key: 'lanes', label: '各条线做到哪了' },
  { key: 'list', label: '一件件看' },
]

function trustTone(v: ConsolePresentation['trust']): 'track' | 'exec' | 'rej' {
  if (v.loadOutcome === 'sync_error' || v.health === 'run_error') return 'rej'
  if (v.loadOutcome === 'ok' && v.health === 'fresh') return 'track'
  return 'exec'
}

/** 数据可信度横幅:第一行给结论,不是并列状态词。 */
function TrustBanner({ trust }: { trust: ConsolePresentation['trust'] }) {
  const tone = trustTone(trust)
  const bg =
    tone === 'track'
      ? 'border-[#5C8A4A]/25 bg-[#5C8A4A]/[.06]'
      : tone === 'rej'
        ? 'border-[#C2453A]/30 bg-[#C2453A]/[.06]'
        : 'border-[#C4912E]/30 bg-[#C4912E]/[.06]'
  return (
    <MePanel className={bg}>
      <div className="font-display text-[15px] font-semibold text-me-charcoal">{trust.verdict}</div>
      <p className="mt-1 text-[13px] text-black/60">{trust.detail}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <MeChip>{trust.freshnessText}</MeChip>
        <MeChip>来源:{trust.factsSourceLabel}</MeChip>
      </div>
      {trust.coverageGapPrs.length > 0 && (
        <p className="mt-2.5 rounded-lg bg-white/70 px-3 py-2 text-[12.5px] text-black/70">
          ⚠️ 有 {trust.coverageGapPrs.length} 个 PR 这轮没同步到(
          {trust.coverageGapPrs.map((n) => `#${n}`).join('、')})——
          <strong>相关条目的进度可能被低估</strong>,不是它们没做。
        </p>
      )}
      {trust.syncIssues.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-white/70 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-me-charcoal">这轮没拉全的部分</div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-black/65">
            {trust.syncIssues.slice(0, 8).map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        </div>
      )}
      {trust.registryWarnings.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-white/70 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-me-charcoal">
            这张表自己查出 {trust.registryWarnings.length} 处要留意的(agent 的活)
          </div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-black/65">
            {trust.registryWarnings.slice(0, 5).map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>
      )}
      {trust.registryErrors.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-[#C2453A]/30 bg-white/70 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-[#C2453A]">
            这张表自己查出 {trust.registryErrors.length} 处对不上(agent 的活)
          </div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-black/65">
            {trust.registryErrors.slice(0, 5).map((e) => (
              <li key={e}>· {e}</li>
            ))}
          </ul>
        </div>
      )}
    </MePanel>
  )
}

function MaturityCell({ c }: { c: ComponentView }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12.5px] text-me-charcoal">{c.maturityLabel}</span>
      {c.isLegacy && <span className="text-[11px] text-black/40">{c.legacyNote}</span>}
    </div>
  )
}

function RunPill({ c }: { c: ComponentView }) {
  const tone = c.bucket === 'operating' ? 'track' : c.bucket === 'built_not_live' ? 'exec' : 'attn'
  return <MePill tone={tone}>{c.operationalLabel}</MePill>
}

function DecisionCard({ d, muted }: { d: DecisionView; muted?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-xl border p-4',
        muted ? 'border-black/10 bg-[#FBF8F3]' : 'border-me-ochre/30 bg-me-ochre/[.07]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[15px] font-semibold text-me-charcoal">{d.componentName}</span>
        <MeChip>{d.kindLabel}</MeChip>
        {typeof d.unresolvedThreads === 'number' && (
          <MeChip gold={d.unresolvedThreads > 0}>
            {d.unresolvedThreads > 0 ? `复审还有 ${d.unresolvedThreads} 条没解决` : '复审意见已清'}
          </MeChip>
        )}
      </div>
      {d.waitingReason && (
        <p className="mt-1.5 text-[12.5px] font-semibold text-black/55">{d.waitingReason}</p>
      )}
      <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-black/75">{d.decision}</p>
      {d.links.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {d.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12.5px] font-semibold text-me-ochre hover:underline"
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function DecisionsView({ data }: { data: ConsolePresentation }) {
  return (
    <div className="space-y-6">
      <MePanel>
        <MePanelHeader title={`现在就等你一句话(${data.decisionsNow.length} 件)`} />
        {data.decisionsNow.length === 0 ? (
          <p className="text-[13px] text-black/55">目前没有需要你拍板的事。</p>
        ) : (
          <div className="space-y-3">
            {data.decisionsNow.map((d, i) => (
              <DecisionCard key={`${d.componentName}-${i}`} d={d} />
            ))}
          </div>
        )}
      </MePanel>

      {data.decisionsLater.length > 0 && (
        <MePanel>
          <MePanelHeader title={`条件到了会来找你(${data.decisionsLater.length} 件)`} />
          <p className="mb-3 text-[12.5px] text-black/50">
            这些还没轮到你 —— 每条下面写了在等什么,条件到了会自动挪到上面那一栏。
          </p>
          <div className="space-y-3">
            {data.decisionsLater.map((d, i) => (
              <DecisionCard key={`${d.componentName}-later-${i}`} d={d} muted />
            ))}
          </div>
        </MePanel>
      )}

      <MePanel>
        <MePanelHeader title={`卡住的事(${data.blocked.length} 件)`} />
        {data.blocked.length === 0 ? (
          <p className="text-[13px] text-black/55">没有卡住的事。</p>
        ) : (
          <div className="overflow-x-auto">
            <MeTable>
              <thead>
                <MeTr>
                  <MeTh>是什么</MeTh>
                  <MeTh>在不在跑</MeTh>
                  <MeTh>卡在哪</MeTh>
                </MeTr>
              </thead>
              <tbody>
                {data.blocked.map((c) => (
                  <MeTr key={c.key}>
                    <MeTd>
                      <div className="text-[13px] text-me-charcoal">{c.businessOutcome}</div>
                      <div className="text-[11.5px] text-black/45">{c.name}</div>
                    </MeTd>
                    <MeTd>
                      <RunPill c={c} />
                    </MeTd>
                    <MeTd>
                      <div className="space-y-1">
                        {c.blockers.map((b) => (
                          <div key={b.summary} className="text-[12.5px] text-black/70">
                            <MeChip>{b.kindLabel}</MeChip> <span className="ml-1">{b.summary}</span>
                          </div>
                        ))}
                        {c.blockedByUpstream.map((name) => (
                          <div key={name} className="text-[12.5px] text-black/55">
                            在等「{name}」先做完
                          </div>
                        ))}
                      </div>
                    </MeTd>
                  </MeTr>
                ))}
              </tbody>
            </MeTable>
          </div>
        )}
      </MePanel>
    </div>
  )
}

function LanesView({ data }: { data: ConsolePresentation }) {
  const [showUnclassified, setShowUnclassified] = useState(false)
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MeStatCard value={data.buckets.operating} label={BUCKET_LABEL.operating} tone="track" goldValue />
        <MeStatCard value={data.buckets.built_not_live} label={BUCKET_LABEL.built_not_live} tone="ochre" />
        <MeStatCard value={data.buckets.building} label={BUCKET_LABEL.building} tone="stone" />
      </section>

      {data.lanes.map((lane) => (
        <MePanel key={lane.laneLabel}>
          <MePanelHeader title={`${lane.laneLabel}(${lane.components.length})`} />
          <div className="space-y-2">
            {lane.components.map((c) => (
              <div
                key={c.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-black/[.07] bg-[#FBF8F3] px-3 py-2"
              >
                <RunPill c={c} />
                <span className="text-[13px] text-me-charcoal">{c.businessOutcome}</span>
                <span className="text-[11.5px] text-black/40">{c.name}</span>
                <span className="ml-auto text-[12px] text-black/55">{c.maturityLabel}</span>
                {c.isBlocked && <span className="text-[12px] text-[#C2453A]">● 卡住</span>}
                {c.isLegacy && (
                  <span className="w-full text-[11px] text-black/40">{c.legacyNote}</span>
                )}
              </div>
            ))}
          </div>
        </MePanel>
      ))}

      {data.unclassified.length > 0 && (
      <MePanel>
        <button
          type="button"
          onClick={() => setShowUnclassified((v) => !v)}
          className="text-[12.5px] text-black/50 hover:text-black/75"
        >
          {data.unclassified.length} 项代码活儿还没挂到具体事项上(agent 的活,不用你管){showUnclassified ? ' ▲' : ' ▼'}
        </button>
        {showUnclassified && (
          <ul className="mt-3 space-y-1">
            {data.unclassified.map((u) => (
              <li key={`${u.kind}-${u.number}`} className="text-[12.5px] text-black/65">
                <a href={u.url} target="_blank" rel="noreferrer" className="text-me-ochre hover:underline">
                  {u.kind === 'pr' ? 'PR' : 'Issue'} #{u.number}
                </a>{' '}
                {u.title}
              </li>
            ))}
          </ul>
        )}
      </MePanel>
      )}
    </div>
  )
}

function ComponentDetail({ c }: { c: ComponentView }) {
  return (
    <div className="space-y-3 rounded-lg border border-black/[.07] bg-[#FBF8F3] p-4">
      <p className="text-[13px] leading-relaxed text-black/75">{c.description}</p>

      <div className="flex flex-wrap gap-1.5">
        <MeChip>{c.typeLabel}</MeChip>
        {c.stageLabels.map((s) => (
          <MeChip key={s}>{s}</MeChip>
        ))}
      </div>

      {c.isLegacy ? (
        <div className="text-[12.5px] text-black/65">
          <strong className="text-me-charcoal">老系统:</strong>
          它天天在生产干活。这里只算它「接进新体系的程度」,所以看着分低不是问题。
        </div>
      ) : (
        <div className="text-[12.5px] text-black/65">
          <strong className="text-me-charcoal">现有证据只能证明到:</strong>
          {c.ceilingLabel} —— {c.ceilingReasonHuman}
          {c.evidenceUnverified && (
            <span className="ml-1 text-[#C4912E]">(这条是人手工填的,程序还没去复核)</span>
          )}
        </div>
      )}

      {c.productionEvidence.length > 0 && (
        <div className="rounded-lg border border-[#5C8A4A]/25 bg-[#5C8A4A]/[.06] px-3 py-2 text-[12.5px] text-black/75">
          <strong className="text-me-charcoal">真跑过:</strong>
          {c.productionEvidence.map((e) => (
            <div key={e.ref}>
              {e.observedAt ? `${e.observedAt} · ` : ''}
              {e.ref}
              {e.note ? `(${e.note})` : ''}
            </div>
          ))}
        </div>
      )}

      {c.coverageGapPrs.length > 0 && (
        <p className="text-[12.5px] text-[#C4912E]">
          ⚠️ 进度可能被低估:{c.coverageGapPrs.map((n) => `#${n}`).join('、')} 这轮没同步到。
        </p>
      )}

      {(c.upstream.length > 0 || c.downstream.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {c.upstream.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-black/40">要先有它</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {c.upstream.map((u) => (
                  <MeChip key={u.name}>
                    {u.name}({u.note})
                  </MeChip>
                ))}
              </div>
            </div>
          )}
          {c.downstream.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-black/40">它在等这件事</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {c.downstream.map((d) => (
                  <MeChip key={d.name}>
                    {d.name}({d.note})
                  </MeChip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(c.linkedPrs.length > 0 || c.linkedIssues.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {c.linkedPrs.map((pr) => (
            <a
              key={pr.url}
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-me-ochre hover:underline"
            >
              PR #{pr.number}({pr.stateLabel}
              {typeof pr.unresolvedThreads === 'number' && pr.unresolvedThreads > 0
                ? `,复审剩 ${pr.unresolvedThreads} 条`
                : ''}
              )↗
            </a>
          ))}
          {c.linkedIssues.map((i) => (
            <a
              key={i.url}
              href={i.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-black/55 hover:underline"
            >
              #{i.number}({i.stateLabel})↗
            </a>
          ))}
        </div>
      )}

      {c.nextMilestone && (
        <div className="text-[12.5px] text-black/65">
          <strong className="text-me-charcoal">下一步到:</strong>
          {c.nextMilestone.targetLabel}
          {c.nextMilestone.unlockedBy.length > 0 && (
            <span> —— 要先解决:{c.nextMilestone.unlockedBy.join(';')}</span>
          )}
        </div>
      )}

      <div className="text-[11.5px] text-black/40">谁在做:{c.ownerLabel}</div>
    </div>
  )
}

function ListView({ data }: { data: ConsolePresentation }) {
  const [lane, setLane] = useState<string>('全部')
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const laneOptions = useMemo(() => ['全部', ...data.lanes.map((l) => l.laneLabel)], [data.lanes])
  const rows = useMemo(
    () =>
      data.components.filter(
        (c) => (lane === '全部' || c.laneLabel === lane) && (!onlyBlocked || c.isBlocked),
      ),
    [data.components, lane, onlyBlocked],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
          {laneOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLane(opt)}
              className={cx(
                'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                lane === opt ? 'bg-me-charcoal text-[#FBF8F3]' : 'text-black/55 hover:bg-me-stone',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOnlyBlocked((v) => !v)}
          className={cx(
            'rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition',
            onlyBlocked
              ? 'border-me-ochre bg-me-ochre/10 text-me-ochre'
              : 'border-black/10 bg-white text-black/55 hover:border-me-ochre/40',
          )}
        >
          只看卡住的
        </button>
        <span className="text-[12px] text-black/40">
          {rows.length} / {data.totalComponents}
        </span>
      </div>

      <MePanel>
        <div className="overflow-x-auto">
          <MeTable>
            <thead>
              <MeTr>
                <MeTh>这东西是干嘛的</MeTh>
                <MeTh>在不在跑</MeTh>
                <MeTh>建到哪一步</MeTh>
                <MeTh>哪条线</MeTh>
                <MeTh> </MeTh>
              </MeTr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Fragment key={c.key}>
                  <MeTr>
                    <MeTd>
                      <div className="text-[13px] text-me-charcoal">{c.businessOutcome}</div>
                      <div className="text-[11.5px] text-black/45">
                        {c.name}
                        {c.isBlocked && <span className="ml-1.5 text-[#C2453A]">● 卡住</span>}
                      </div>
                    </MeTd>
                    <MeTd>
                      <RunPill c={c} />
                    </MeTd>
                    <MeTd>
                      <MaturityCell c={c} />
                    </MeTd>
                    <MeTd>{c.laneLabel}</MeTd>
                    <MeTd>
                      <button
                        type="button"
                        onClick={() => setOpenKey(openKey === c.key ? null : c.key)}
                        className="text-[12px] font-semibold text-me-ochre hover:underline"
                      >
                        {openKey === c.key ? '收起' : '详情'}
                      </button>
                    </MeTd>
                  </MeTr>
                  {openKey === c.key && (
                    <MeTr>
                      {/* colSpan 铺满 —— 否则详情被挤进第一列的宽度里 */}
                      <MeTd colSpan={5} className="p-0">
                        <div className="px-4 pb-4">
                          <ComponentDetail c={c} />
                        </div>
                      </MeTd>
                    </MeTr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </MeTable>
        </div>
      </MePanel>
    </div>
  )
}

export default function ProductMapClient({ data }: { data: ConsolePresentation }) {
  const [view, setView] = useState<ViewKey>('decisions')

  return (
    <div className="font-sans">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">ME2 产品地图</h1>
          <p className="mt-0.5 text-[13px] text-black/55">
            这是 ME2 自己的建设进度表,数据来自代码仓库 + GitHub。<strong>不含客户业绩数据。</strong>
          </p>
        </div>
        <MeButton href="/dashboard" variant="secondary" size="sm">
          ← 回总览
        </MeButton>
      </header>

      <div className="space-y-6 px-8 py-7">
        <TrustBanner trust={data.trust} />

        <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
          {VIEWS.map((v) => {
            const active = view === v.key
            const count =
              v.key === 'decisions' ? data.decisionsNow.length : v.key === 'list' ? data.totalComponents : undefined
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={cx(
                  'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                  active ? 'bg-me-charcoal text-[#FBF8F3]' : 'text-black/55 hover:bg-me-stone',
                )}
              >
                {v.label}
                {count !== undefined && (
                  <span className={cx('ml-1.5 tabular-nums', active ? 'text-[#FBF8F3]/65' : 'text-black/35')}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {view === 'decisions' && <DecisionsView data={data} />}
        {view === 'lanes' && <LanesView data={data} />}
        {view === 'list' && <ListView data={data} />}
      </div>
    </div>
  )
}
