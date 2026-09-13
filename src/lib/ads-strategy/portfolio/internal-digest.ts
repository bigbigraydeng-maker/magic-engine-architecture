/**
 * 广告只读诊断 · 内部版日报（ads IMPACT 阶段 1 第 7 步，设计 §6 / §9 / §14 C6）。
 *
 * 🔴 只发内部邮箱。收件人按域名白名单过滤，客户邮箱一律丢弃（不静默：丢了几个写进回执，D7 另报一条）。
 *    客户版是阶段 3 的事：默认关闭、每周一封、Gmail 通道、按收件人语言——**不在这里**。
 * 🔴 只读诊断，不出任何挪预算/改广告的操作建议。
 *
 * 结构（给 PM/FDE 看，中文、人话）：先一句结论 → 按漏斗角色分组列命中 → 判不了的（折叠）→ 被排除的
 * （Meta 实验 / 共用账户）→ 老体检里还需要动手的广告系列。每个数字都带样本量。
 * 防疲劳：有命中才发；前一天有命中、今天没有 → 发一封「恢复」；周一发一封周报；其余不发。
 *
 * 为什么暂不上 Inngest（CLAUDE.md 铁律 3 要求写明）：这是单步、只发内部邮箱、与原日报同一条 cron 同一个
 * 发送点的替换，没有跨步骤接力；回执落在 ad_health_narratives（payload.portfolio_diagnoses +
 * email_status）。恢复条件：阶段 2 诊断开始驱动处方（§4.4 `ads.diagnosis.created` 事件链）时迁入 Inngest。
 */

import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import type { Diagnosis, DiagnosisRun } from './diagnostics/types'
import type { FunnelRole } from './roles'
import { INTERNAL_EMAIL_DOMAINS } from './diagnostics/thresholds'

export type InternalDigestDecision = 'alert' | 'recovery' | 'weekly' | 'skip'

const ROLE_ORDER: Array<{ key: FunnelRole | 'account'; label: string }> = [
  { key: 'account', label: '账户层面' },
  { key: 'awareness', label: '破冰（让没见过的人看到）' },
  { key: 'acquisition', label: '获客（冷流量要留资/私信）' },
  { key: 'retargeting', label: '再营销（找回看过/互动过的人）' },
  { key: 'expansion', label: '扩量（类似人群）' },
  { key: 'mixed', label: '角色说不清' },
  { key: 'unknown', label: '角色未识别' },
]

const NOT_COMPARABLE_LABEL: Record<string, string> = {
  no_hourly_data: '没拿到按小时数据',
  night_trough: '夜间低谷',
  scheduled_delivery: '排期投放',
  report_lag: '报表还没到',
  target_cost_not_configured: '没配目标单次成本',
  outcome_not_configured: '没配结果阶梯',
  primary_result_unknown: '主结果归不到广告',
  primary_not_attributable: '主结果归不到广告',
  audience_below_floor: '受众人数在下限',
  audience_too_new: '受众刚建',
  page_audience_unverifiable: '主页受众无法确认',
  cbo_internal: '同一系列内部不比',
  shared_account: '共用账户',
  below_min_sample: '数量太少',
  single_unit: '只有一个单位',
}

export function isInternalRecipient(email: string): boolean {
  const e = email.trim().toLowerCase()
  const domain = e.split('@')[1] ?? ''
  const extra = [process.env.AD_HEALTH_DIGEST_TO, ME_MAIL_TO_ADDRESS].filter((x): x is string => !!x).map(x => x.toLowerCase())
  return INTERNAL_EMAIL_DOMAINS.some(d => domain === d) || extra.includes(e)
}

/** 只留内部收件人；一个都不剩就发内部默认收件箱。 */
export function resolveInternalRecipients(configured: string[]): { to: string[]; dropped: number } {
  const internal = configured.filter(isInternalRecipient)
  const fallback = process.env.AD_HEALTH_DIGEST_TO || ME_MAIL_TO_ADDRESS
  return { to: internal.length > 0 ? internal : [fallback], dropped: configured.length - internal.length }
}

export function decideInternalSend(hitCount: number, previousHitCount: number | null, isWeeklyDay: boolean): InternalDigestDecision {
  if (hitCount > 0) return 'alert'
  if ((previousHitCount ?? 0) > 0) return 'recovery'
  if (isWeeklyDay) return 'weekly'
  return 'skip'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function roleOf(d: Diagnosis): FunnelRole | 'account' {
  const u = d.units[0]
  if (!u || u.level === 'account') return 'account'
  return u.role ?? 'unknown'
}

function sampleLine(d: Diagnosis): string {
  return d.sample.length > 0 ? d.sample.map(s => `${s.label} ${s.value}`).join(' · ') : ''
}

function unitLine(d: Diagnosis): string {
  return d.units.filter(u => u.level !== 'account').map(u => `${u.name ?? u.id}`).join('、')
}

function hitCard(d: Diagnosis): string {
  const task = d.manualTask
    ? `<div style="margin-top:6px;font-size:12px;color:#7c2d12"><b>要人处理：</b>${esc(task_(d))}</div>`
    : ''
  const units = unitLine(d)
  return `
    <div style="margin:10px 0;padding:10px 12px;background:#fef2f2;border-radius:8px">
      <div style="font-weight:600;color:#0f172a">${esc(d.title)}</div>
      ${units ? `<div style="margin-top:3px;font-size:12px;color:#475569">涉及：${esc(units)}</div>` : ''}
      <div style="margin-top:3px;font-size:12px;color:#64748b">${esc(d.reasons.join('；'))}</div>
      ${sampleLine(d) ? `<div style="margin-top:3px;font-size:11px;color:#94a3b8">样本：${esc(sampleLine(d))}</div>` : ''}
      ${task}
    </div>`
}

function task_(d: Diagnosis): string {
  const t = d.manualTask!
  return `${t.what} 怎么做：${t.how}${t.href ? ` 链接：${t.href}` : ''}`
}

export interface LegacyCampaign {
  campaign_name: string
  verdict: string
  headline: string
}

export function buildInternalDigest(opts: {
  clientName: string
  date: string
  run: DiagnosisRun
  decision: Exclude<InternalDigestDecision, 'skip'>
  legacyNeedsAction: LegacyCampaign[]
  droppedRecipients: number
}): { subject: string; html: string } {
  const hits = opts.run.diagnoses.filter(d => d.status === 'hit')
  const nc = opts.run.diagnoses.filter(d => d.status === 'not_comparable')
  const lead = opts.decision === 'alert'
    ? `🔴 ${opts.date} 发现 ${hits.length} 件要看的事`
    : opts.decision === 'recovery'
      ? `🟢 ${opts.date} 之前报的问题今天没再出现`
      : `🟢 本周诊断没有发现需要动手的事`
  const subjectLabel = opts.decision === 'alert' ? `🔴 ${hits.length} 件要看` : opts.decision === 'recovery' ? '🟢 已恢复' : '🟢 周报'

  const groups = ROLE_ORDER.map(({ key, label }) => {
    const items = hits.filter(d => roleOf(d) === key)
    return items.length > 0 ? `<h3 style="font-size:14px;margin:16px 0 4px;color:#334155">${esc(label)}</h3>${items.map(hitCard).join('')}` : ''
  }).join('')

  const ncBlock = nc.length > 0
    ? `<details style="margin-top:14px"><summary style="font-size:13px;color:#64748b;cursor:pointer">判不了的 ${nc.length} 条（不是没问题，是数据不够下结论）</summary>
        <ul style="font-size:12px;color:#64748b">${nc.map(d => `<li>${esc(d.title)}（${esc(NOT_COMPARABLE_LABEL[d.notComparableReason ?? ''] ?? '判不了')}${sampleLine(d) ? ` · ${esc(sampleLine(d))}` : ''}）</li>`).join('')}</ul></details>`
    : ''

  const excludedBlock = opts.run.excluded.length > 0
    ? `<p style="margin-top:12px;font-size:12px;color:#64748b"><b>没参与诊断：</b>${opts.run.excluded.map(e => esc(`${e.name ?? e.id}（${e.reason === 'meta_experiment' ? '在 Meta 对比测试中，测试结束前不下结论' : '共用广告账户，只看账户层面'}）`)).join('；')}</p>`
    : ''

  const legacyBlock = opts.legacyNeedsAction.length > 0
    ? `<h3 style="font-size:14px;margin:16px 0 4px;color:#334155">原有体检：还需要动手的广告系列</h3><ul style="font-size:12px;color:#475569">${opts.legacyNeedsAction.map(c => `<li>${esc(c.campaign_name)}：${esc(c.headline)}</li>`).join('')}</ul>`
    : ''

  const droppedNote = opts.droppedRecipients > 0
    ? `<p style="margin-top:12px;font-size:11px;color:#b45309">⚠️ 设置里有 ${opts.droppedRecipients} 个非内部收件人，这封内部日报没有发给他们。</p>`
    : ''

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="font-size:16px;font-weight:600;margin:0 0 6px">${esc(lead)}</p>
      <p style="font-size:12px;color:#64748b;margin:0">只读诊断，没有改任何广告和预算。仅限内部。</p>
      ${groups}
      ${ncBlock}
      ${excludedBlock}
      ${legacyBlock}
      ${droppedNote}
      <p style="margin-top:18px;font-size:11px;color:#94a3b8">Magic Engine 广告诊断（内部版）· 有事才发，周一发周报。</p>
    </div>`
  return { subject: `[${opts.clientName} 广告诊断·内部] ${opts.date} · ${subjectLabel}`, html }
}

export interface InternalDigestResult {
  decision: InternalDigestDecision
  sent: boolean
  recipients_dropped: number
  persisted: boolean
  error?: string
}

/**
 * 把诊断结果并进当天的 ad_health_narratives.payload，按规则决定发不发，只发内部。尽力而为，不抛。
 */
export async function persistAndSendInternalDigest(opts: {
  clientId: string
  clientName: string
  date: string
  run: DiagnosisRun
  configuredRecipients: string[]
}): Promise<InternalDigestResult> {
  const hitCount = opts.run.diagnoses.filter(d => d.status === 'hit').length
  const { to, dropped } = resolveInternalRecipients(opts.configuredRecipients)
  try {
    const [today, prev] = await Promise.all([
      supabaseAdmin.from('ad_health_narratives').select('payload, email_status').eq('client_id', opts.clientId).eq('insight_date', opts.date).maybeSingle(),
      supabaseAdmin.from('ad_health_narratives').select('payload').eq('client_id', opts.clientId).lt('insight_date', opts.date).order('insight_date', { ascending: false }).limit(1).maybeSingle(),
    ])
    const payload = (today.data?.payload ?? null) as Record<string, unknown> | null
    const prevDiag = (prev.data?.payload as { portfolio_diagnoses?: { hit_count?: number } } | null)?.portfolio_diagnoses
    const decision = decideInternalSend(hitCount, prevDiag?.hit_count ?? null, new Date(`${opts.date}T00:00:00Z`).getUTCDay() === 1)

    let persisted = false
    if (payload) {
      const { error } = await supabaseAdmin.from('ad_health_narratives')
        .update({ payload: { ...payload, portfolio_diagnoses: { ...opts.run, hit_count: hitCount } }, updated_at: new Date().toISOString() })
        .eq('client_id', opts.clientId).eq('insight_date', opts.date)
      persisted = !error
    }

    if (decision === 'skip') return { decision, sent: false, recipients_dropped: dropped, persisted }
    if (today.data?.email_status === 'sent') return { decision, sent: false, recipients_dropped: dropped, persisted }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return { decision, sent: false, recipients_dropped: dropped, persisted, error: 'RESEND_API_KEY not configured' }

    const campaigns = ((payload?.campaigns ?? []) as LegacyCampaign[]).filter(c => c.verdict === 'alert' || c.verdict === 'watch')
    const { subject, html } = buildInternalDigest({ clientName: opts.clientName, date: opts.date, run: opts.run, decision, legacyNeedsAction: campaigns, droppedRecipients: dropped })
    const { error } = await new Resend(apiKey).emails.send({ from: meMailFrom('Magic Engine 广告诊断（内部）'), to, subject, html })
    if (error) return { decision, sent: false, recipients_dropped: dropped, persisted, error: error.message }
    if (payload) {
      await supabaseAdmin.from('ad_health_narratives').update({ email_status: 'sent', updated_at: new Date().toISOString() })
        .eq('client_id', opts.clientId).eq('insight_date', opts.date)
    }
    return { decision, sent: true, recipients_dropped: dropped, persisted }
  } catch (err) {
    return { decision: 'skip', sent: false, recipients_dropped: dropped, persisted: false, error: err instanceof Error ? err.message : String(err) }
  }
}
