'use client'

/**
 * 老板摘要——把 `ConsolePresentation` 里已经算好的 ~50 个组件，
 * 按业务线收成一行一张卡片。2026-08-19 起是默认视图（PM 现场反馈拍板），
 * 其余 7 个技术标签页收进 `ProductMapClient.tsx` 的「查看技术细节」入口。
 */

import { useMemo } from 'react'
import { MeChip, MePanel, MePill } from '@/components/ui/me-primitives'
import type { StatusTone } from '@/components/ui/me-theme'
import { buildLaneSummaries, type LaneStatusTone } from '@/lib/product-map/summary'
import type { ConsolePresentation } from '@/lib/product-map/presenter'

const TONE_MAP: Readonly<Record<LaneStatusTone, StatusTone>> = {
  operating: 'track',
  built_not_live: 'exec',
  building: 'attn',
  blocked: 'rej',
}

export function SummaryView({ data }: { data: ConsolePresentation }) {
  const summaries = useMemo(
    () => buildLaneSummaries({ lanes: data.lanes, roadmap: data.roadmap, decisionsNow: data.decisionsNow }),
    [data],
  )

  if (summaries.length === 0) {
    return (
      <MePanel>
        <p className="text-[13px] text-black/55">还没有登记任何业务线的组件。</p>
      </MePanel>
    )
  }

  return (
    <div className="space-y-3">
      {summaries.map((s) => (
        <div
          key={s.laneLabel}
          className="rounded-xl border border-black/[.07] bg-white p-4 shadow-[0_1px_2px_rgba(26,26,26,.04)]"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <MePill tone={TONE_MAP[s.statusTone]}>{s.statusLabel}</MePill>
            <span className="font-display text-[15px] font-semibold text-me-charcoal">{s.laneLabel}</span>
            <span className="ml-auto text-[13px] tabular-nums text-black/55">
              {s.operatingCount}/{s.totalCount} 在跑
              {s.smallSample && <span className="text-black/35">（样本少，只登记了 {s.totalCount} 项）</span>}
            </span>
            {s.blockedCount > 0 && <MeChip gold>{s.blockedCount} 项被卡住</MeChip>}
            {s.needsYourCall && <MeChip gold>等你拍板</MeChip>}
          </div>

          {s.legacyOperatingNote && (
            <p className="mt-2 text-[12px] text-black/45">{s.legacyOperatingNote}</p>
          )}
          {s.nextStepLabel && (
            <p className="mt-2 text-[12.5px] text-me-ochre">下一步：{s.nextStepLabel}</p>
          )}
        </div>
      ))}
    </div>
  )
}
