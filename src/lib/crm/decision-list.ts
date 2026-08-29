/**
 * 只读「今天需要关注谁」决策清单 —— CI-WP01（Issue #1009）。
 *
 * 不新增判据、不新增数据源：直接吃 `/api/clients/[id]/crm/today` 已经算好的桶
 * （lib/crm/segments + lib/crm/day-list + lib/crm/worklist-groups 那一整套冻结
 * 名单算法），把它拍平成一条按优先级排好的只读清单，每行只答三件事——
 * 这是谁 / 为什么现在处理 / 建议下一步。判据只有一份，这里不重新判断冷热。
 *
 * 三条防御性过滤（跟 today/route.ts 的判据是同一份事实，这里只是再挡一次，
 * 不代表这两处允许各写一套）：
 *   · 今天已经处理过的人不算「需要关注」——他不该出现在只读清单上
 *   · 被标「别再联系」的人绝不许出现，即使上游意外把他带了进来
 *   · 空清单必须说清是「都处理完了」还是「压根没有数据」，不能长得一样
 */

export type SuggestedChannel = 'phone' | 'sms' | 'email' | 'messenger' | 'none'

export interface DecisionSuggestedStage {
  toStage: string
  label: string
  why: string
  stillFollowed?: boolean
}

export interface DecisionSourceRow {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  reason: string
  suggestedChannel: SuggestedChannel
  phoneUnusable?: boolean
  doNotContact?: boolean
  doneToday?: boolean
  pinned?: boolean
  suggestedStage?: DecisionSuggestedStage | null
}

export interface DecisionBucketSource {
  layer: 'waiting' | 'acted' | 'queued'
  label: string
  people: DecisionSourceRow[]
  /** 这个桶命中的总人数（含被本页过滤掉的）—— `/crm/today` 每桶只回前 300 人。 */
  total?: number
  /** 这个桶命中的人比返回的 `people` 多 —— 清单没能显示全部，必须如实提示。 */
  truncated?: boolean
}

export interface DecisionRow {
  contactId: string
  name: string
  /** 纯文本联系方式，没有可点击的 tel:/mailto: —— 这份清单只读，不给动手的入口。 */
  contact: string
  why: string
  nextAction: string
  layerLabel: string
  pinned: boolean
}

const CHANNEL_ACTION_LABEL: Record<SuggestedChannel, string> = {
  phone: '建议致电',
  sms: '建议发短信',
  email: '建议发邮件',
  messenger: '建议在私信回复',
  none: '建议先核实联系方式',
}

function contactText(phone: string | null, email: string | null, phoneUnusable?: boolean): string {
  if (phone && !phoneUnusable) return phone
  if (phone && phoneUnusable) return email ? `${phone}（打不通）· ${email}` : `${phone}（打不通）`
  if (email) return email
  return '没留联系方式'
}

function nextActionText(row: DecisionSourceRow): string {
  const channel = CHANNEL_ACTION_LABEL[row.suggestedChannel]
  if (row.suggestedStage) {
    return `${channel} · 系统建议改状态为「${row.suggestedStage.label}」（${row.suggestedStage.why}）`
  }
  return channel
}

/**
 * 空清单是「今天该处理的都处理了」还是「今天压根没有到期的跟进」——
 * 两句话意思完全不同，不能靠 `totalContacts > 0` 瞎猜（客户有 300 个联系人，
 * 但今天全部在推迟 / 未来培育 / 已终止阶段，跟「今天处理完了」是两回事）。
 * 判据：桶里（过滤前）有没有出现过 `doneToday` 的人。
 */
export function hasHandledToday(buckets: DecisionBucketSource[]): boolean {
  return buckets.some((b) => b.people.some((p) => p.doneToday === true))
}

/** 是否有桶因为人数超过单桶上限而没能显示全部 —— 必须提示，不能悄悄截断。 */
export function hasTruncatedBucket(buckets: DecisionBucketSource[]): boolean {
  return buckets.some((b) => b.truncated === true)
}

/** 把 `/crm/today` 的桶拍平成一条只读决策清单，按桶原有的优先级顺序。 */
export function buildDecisionList(buckets: DecisionBucketSource[]): DecisionRow[] {
  const rows: DecisionRow[] = []
  for (const bucket of buckets) {
    for (const p of bucket.people) {
      // 防御性过滤：不重判，只是不让这两类人以任何理由出现在只读清单上。
      if (p.doNotContact) continue
      if (p.doneToday) continue
      rows.push({
        contactId: p.contactId,
        name: p.name,
        contact: contactText(p.phone, p.email, p.phoneUnusable),
        why: p.reason,
        nextAction: nextActionText(p),
        layerLabel: bucket.label,
        pinned: p.pinned === true,
      })
    }
  }
  return rows
}
