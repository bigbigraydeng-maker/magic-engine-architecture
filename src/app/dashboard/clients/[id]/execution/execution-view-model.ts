import type {
  ExecutionItem,
  ExecutionLog,
  LinkedContentPost,
  PrescriptionStatus,
} from '@/types/diagnostic'

export const AUTONOMOUS_GROUP_ID = '__autonomous__'

export interface PrescriptionMeta {
  id: string
  status: PrescriptionStatus
  supplements_id: string | null
  supersedes_id: string | null
  generated_at: string | null
}

export interface OutcomeSummary {
  verdict: 'confirmed' | 'inconclusive' | 'reversed'
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number
  computed_at: string
}

export type ItemWithLogs = ExecutionItem & {
  logs: ExecutionLog[]
  outcome?: OutcomeSummary | null
  linked_post?: LinkedContentPost | null
  source_kind?: 'execution_item' | 'flywheel_action'
  flywheel_action_id?: string
}

export interface GroupData {
  pid: string
  items: ItemWithLogs[]
  meta?: PrescriptionMeta
  label: string
  weight: number
  archived: boolean
  derivable: boolean
  editable: boolean    // 是否允许新增/编辑执行项（自主行动泳道为 false）
}

const METRIC_DISPLAY: Record<string, string> = {
  'geo.query.mention_rate':      'Mention rate',
  'geo.query.brand_prominence':  'Brand prominence',
  'geo.query.sentiment_score':   'Sentiment score',
  'seo.keyword.ranking':         'Keyword ranking',
  'ads.roas':                    'ROAS',
  'social.engagement_rate':      'Engagement rate',
}

/** Pure helper — used by OutcomeChip and unit tests (P12.A.10). */
export function formatOutcomeLabel(outcome: OutcomeSummary): string {
  const metricLabel = METRIC_DISPLAY[outcome.metric_key] ?? outcome.metric_key
  const deltaPctStr = outcome.delta_pct !== null
    ? `${outcome.delta_pct > 0 ? '+' : ''}${Math.round(outcome.delta_pct)}%`
    : outcome.delta !== null
      ? `${outcome.delta > 0 ? '+' : ''}${Number(outcome.delta).toFixed(2)}`
      : ''
  const confidenceStr = `confidence ${outcome.confidence.toFixed(2)}`
  return deltaPctStr
    ? `${metricLabel} ${deltaPctStr}, ${outcome.verdict} (${confidenceStr})`
    : `${metricLabel} ${outcome.verdict} (${confidenceStr})`
}

export function isAutonomousItem(item: ItemWithLogs): boolean {
  return item.source_kind === 'flywheel_action' || item.prescription_id === AUTONOMOUS_GROUP_ID
}

export function buildExecutionGroups(
  items: ItemWithLogs[],
  prescriptions: PrescriptionMeta[],
): GroupData[] {
  const presMap = new Map(prescriptions.map(p => [p.id, p]))
  const itemsByPrescription: Record<string, ItemWithLogs[]> = {}
  for (const item of items) {
    const pid = isAutonomousItem(item) ? AUTONOMOUS_GROUP_ID : item.prescription_id
    ;(itemsByPrescription[pid] ??= []).push(item)
  }

  return Object.entries(itemsByPrescription)
    .map(([pid, groupItems]) => buildGroup(pid, groupItems, presMap.get(pid)))
    .sort((a, b) =>
      a.weight - b.weight ||
      (a.meta?.generated_at ?? '').localeCompare(b.meta?.generated_at ?? ''),
    )
}

function buildGroup(
  pid: string,
  groupItems: ItemWithLogs[],
  meta?: PrescriptionMeta,
): GroupData {
  if (pid === AUTONOMOUS_GROUP_ID) {
    return {
      pid, items: groupItems, label: '飞轮自主行动',
      weight: 0, archived: false, derivable: false, editable: false,
    }
  }

  let label = '处方'; let weight = 5; let archived = false; let derivable = false
  if (meta) {
    if (meta.status === 'superseded') { label = '已归档 · 被修订取代'; weight = 9; archived = true }
    else if (meta.supersedes_id)      { label = '修订版';   weight = 2; derivable = meta.status === 'approved' }
    else if (meta.supplements_id)     { label = '补充处方'; weight = 3; derivable = meta.status === 'approved' }
    else                              { label = '原处方';   weight = 1; derivable = meta.status === 'approved' }
  }

  return { pid, items: groupItems, meta, label, weight, archived, derivable, editable: !archived }
}
