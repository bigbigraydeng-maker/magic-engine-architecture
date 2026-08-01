/**
 * PM daily to-do email (22.E.S18 前置 · 滚动排班).
 *
 * One short email every NZ weekday morning: today's pillar theme (rolling
 * Mon-Fri schedule the PM signed off 2026-07-31) plus LIVE counts of things
 * actually awaiting him — blog drafts to review, fresh patrol findings,
 * recent pending kanban cards, cron failures. Sections with zero items are
 * omitted; a quiet day sends a one-line all-clear so the rhythm stays daily.
 *
 * Deliberately narrow: counts only cover the FDE focus clients (CTS/Oztop)
 * and only recent items — the kanban holds 400+ historical pending cards
 * that would drown the signal (backlog cleanup is its own task).
 *
 * PM-facing copy is plain Chinese, zero jargon (CLAUDE.md § 跟 PM 说话的格式).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** FDE focus clients: CTS + Oztop. */
export const FOCUS_CLIENT_IDS = [
  'c0000000-0000-0000-0000-000000000000',
  'd5c98811-1c1d-4ded-bdf0-4cefec6afb84',
] as const

/** Pending kanban cards older than this many days are backlog, not to-do. */
const RECENT_CARD_DAYS = 7

const DASHBOARD_BASE = 'https://app.magicengine.com.au/dashboard/clients'

// ── Rolling weekday themes (PM 拍板 2026-07-31) ────────────────────────────────
// 口碑 (Wed) / 竞品 (Thu) slots take over when those pillars come online.
// Exported: the /dashboard/today page and the email render the SAME schedule.

export const DAY_THEMES: Record<number, { title: string; hint: string }> = {
  1: { title: '周报日', hint: '读周报邮件，把里面的「待点头」清单过一遍' },
  2: { title: 'Blog 审稿日', hint: '昨夜自动生成的草稿在等你审，改完点发布' },
  3: { title: 'SEO 发现日', hint: '看看巡逻员这周抓到的排名问题和机会' },
  4: { title: '广告 & 社媒日', hint: '扫一眼广告健康警报和社媒待批事项' },
  5: { title: '收尾日', hint: '清掉本周剩下的待办，下周一见周报' },
}

export interface TodoCounts {
  /**
   * One-off setup actions only a human can complete (OAuth consent screens).
   * Surfaced here so the PM/FDE never has to hunt for them in Settings —
   * these block whole pillars until done.
   */
  setupTasks: Array<{ name: string; id: string; label: string; href: string }>
  /** [{ name, id, drafts }] — clients with blog drafts awaiting review. */
  draftsByClient: Array<{ name: string; id: string; drafts: number }>
  /** [{ name, id, findings }] — clients with fresh patrol findings. */
  findingsByClient: Array<{ name: string; id: string; findings: number }>
  /** [{ name, id, cards }] — focus clients' pending kanban cards (recent only). */
  recentCardsByClient: Array<{ name: string; id: string; cards: number }>
  /** [{ name, id, reels }] — clients with factory clips awaiting review. */
  reelsByClient: Array<{ name: string; id: string; reels: number }>
  /** Cron runs that failed in the last 24h. */
  cronFailures24h: number
}

/** reels_drafts statuses that mean "a human needs to look at this". */
const REEL_REVIEW_STATUSES = ['video_ready', 'images_ready', 'in_review'] as const

const APP_BASE = 'https://app.magicengine.com.au'

/**
 * Clients that need the Google Business Profile consent click.
 *
 * "Should have GBP" is inferred from `gbp_place_id` — a client only gets that
 * field once we've confirmed they have a Google storefront (口碑监测身份).
 * So the list extends itself as more clients are configured; no hardcoded roster.
 *
 * A row in error status counts too: an expired/revoked consent needs the same
 * click, and silently skipping it is how a pillar dies unnoticed.
 */
export async function loadGbpSetupTasks(
  supabase: SupabaseClient,
): Promise<TodoCounts['setupTasks']> {
  const [{ data: clients }, { data: connections }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name')
      .eq('client_status', 'active')
      .not('gbp_place_id', 'is', null),
    supabase
      .from('platform_oauth_connections')
      .select('client_id, status')
      .eq('provider', 'google_gbp'),
  ])

  const connected = new Set(
    ((connections ?? []) as Array<{ client_id: string; status: string }>)
      .filter((c) => c.status === 'active')
      .map((c) => c.client_id),
  )

  return ((clients ?? []) as Array<{ id: string; name: string }>)
    .filter((c) => !connected.has(c.id))
    .map((c) => ({
      name: c.name,
      id: c.id,
      label: '连接 Google 商家页（点一次授权，之后自动发帖）',
      href: `${APP_BASE}/api/auth/google/gbp/start?clientId=${c.id}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── Data loading ────────────────────────────────────────────────────────────────

export async function loadTodoCounts(supabase: SupabaseClient): Promise<TodoCounts> {
  const cardCutoff = new Date()
  cardCutoff.setDate(cardCutoff.getDate() - RECENT_CARD_DAYS)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [drafts, findings, cards, reels, failures, setupTasks] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('client_id, clients(name)')
      .eq('status', 'draft'),
    supabase
      .from('seo_patrol_findings')
      .select('client_id, clients(name)')
      .eq('status', 'fresh'),
    supabase
      .from('execution_items')
      .select('client_id, clients(name)')
      .eq('status', 'pending')
      .in('client_id', [...FOCUS_CLIENT_IDS])
      .gte('created_at', cardCutoff.toISOString()),
    supabase
      .from('reels_drafts')
      .select('client_id, clients(name)')
      .in('status', [...REEL_REVIEW_STATUSES]),
    supabase
      .from('cron_run_logs')
      .select('id, status, failed_count')
      .gte('started_at', since24h),
    loadGbpSetupTasks(supabase),
  ])

  const countByClient = (
    rows: Array<{ client_id: string; clients: { name: string } | { name: string }[] | null }> | null,
  ): Map<string, { name: string; count: number }> => {
    const map = new Map<string, { name: string; count: number }>()
    for (const row of rows ?? []) {
      const rel = row.clients
      const name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? '未知客户'
      const entry = map.get(row.client_id) ?? { name, count: 0 }
      entry.count += 1
      map.set(row.client_id, entry)
    }
    return map
  }

  const toList = (map: Map<string, { name: string; count: number }>, key: 'drafts' | 'findings' | 'cards' | 'reels') =>
    Array.from(map.entries())
      .map(([id, v]) => ({ name: v.name, id, [key]: v.count }))
      .sort((a, b) => a.name.localeCompare(b.name))

  const failedRuns = ((failures.data ?? []) as Array<{ status: string; failed_count: number | null }>)
    .filter((r) => r.status === 'failed' || (r.failed_count ?? 0) > 0)

  return {
    setupTasks,
    draftsByClient: toList(countByClient(drafts.data as never), 'drafts') as TodoCounts['draftsByClient'],
    findingsByClient: toList(countByClient(findings.data as never), 'findings') as TodoCounts['findingsByClient'],
    recentCardsByClient: toList(countByClient(cards.data as never), 'cards') as TodoCounts['recentCardsByClient'],
    reelsByClient: toList(countByClient(reels.data as never), 'reels') as TodoCounts['reelsByClient'],
    cronFailures24h: failedRuns.length,
  }
}

// ── Email building (pure) ───────────────────────────────────────────────────────

export function nzWeekday(now: Date): number {
  // 0=Sun..6=Sat in Pacific/Auckland
  const s = now.toLocaleDateString('en-US', { timeZone: 'Pacific/Auckland', weekday: 'short' })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s)
}

export interface TodoEmail {
  subject: string
  html: string
  /** Total actionable items (drives the subject line). */
  totalItems: number
}

export const ZH_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function buildTodoEmail(weekday: number, counts: TodoCounts, nzDateLabel: string): TodoEmail {
  const theme = DAY_THEMES[weekday] ?? { title: '日常', hint: '' }

  const sections: string[] = []

  const sectionCard = (emoji: string, title: string, rows: string[]) => `
    <div style="margin:0 0 14px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0f172a">${emoji} ${title}</p>
      ${rows.join('')}
    </div>`

  const linkRow = (label: string, href: string, count: number, unit: string) => `
    <p style="margin:0 0 4px;font-size:14px;color:#334155">
      ${label}：<b>${count}</b> ${unit} · <a href="${href}" style="color:#0891b2">去处理</a>
    </p>`

  // Setup first: these are one-off consent clicks that block a whole pillar
  // until done, so they outrank the day's routine review queue.
  if (counts.setupTasks.length > 0) {
    sections.push(sectionCard('🔌', '要你点一次的授权（一次搞定，之后全自动）',
      counts.setupTasks.map((t) => `
        <p style="margin:0 0 4px;font-size:14px;color:#334155">
          ${t.name}：${t.label} · <a href="${t.href}" style="color:#0891b2">去授权</a>
        </p>`),
    ))
  }

  const totalDrafts = counts.draftsByClient.reduce((s, c) => s + c.drafts, 0)
  if (totalDrafts > 0) {
    sections.push(sectionCard('📝', 'Blog 草稿待审', counts.draftsByClient.map((c) =>
      linkRow(c.name, `${DASHBOARD_BASE}/${c.id}/blog`, c.drafts, '篇'),
    )))
  }

  const totalFindings = counts.findingsByClient.reduce((s, c) => s + c.findings, 0)
  if (totalFindings > 0) {
    sections.push(sectionCard('🔎', 'SEO 巡逻新发现', counts.findingsByClient.map((c) =>
      linkRow(c.name, `${DASHBOARD_BASE}/${c.id}/execution`, c.findings, '条'),
    )))
  }

  const totalCards = counts.recentCardsByClient.reduce((s, c) => s + c.cards, 0)
  if (totalCards > 0) {
    sections.push(sectionCard('🗂', '本周新建议卡待处理', counts.recentCardsByClient.map((c) =>
      linkRow(c.name, `${DASHBOARD_BASE}/${c.id}/execution`, c.cards, '张'),
    )))
  }

  const totalReels = counts.reelsByClient.reduce((s, c) => s + c.reels, 0)
  if (totalReels > 0) {
    sections.push(sectionCard('🎬', '社媒成片待审', counts.reelsByClient.map((c) =>
      linkRow(c.name, 'https://app.magicengine.com.au/dashboard/factory', c.reels, '条'),
    )))
  }

  if (counts.cronFailures24h > 0) {
    sections.push(sectionCard('⚠️', '系统有活儿没跑成', [
      linkRow('过去 24 小时', 'https://app.magicengine.com.au/dashboard/admin/cron-health', counts.cronFailures24h, '次失败'),
    ]))
  }

  const totalItems =
    counts.setupTasks.length + totalDrafts + totalFindings + totalCards + totalReels + counts.cronFailures24h

  const body = sections.length > 0
    ? sections.join('')
    : `<p style="margin:0 0 14px;font-size:14px;color:#059669">今天没有待办 ✅ 系统都在正常跑。</p>`

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a">📋 今日待办 · ${ZH_DAYS[weekday]} ${nzDateLabel}</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#64748b">
        <b>${theme.title}</b>${theme.hint ? ` — ${theme.hint}` : ''}
      </p>
      ${body}
      <p style="margin-top:18px;font-size:12px;color:#94a3b8">
        这封信每个工作日早上自动发，数字实时统计，办完的第二天自动消失。
        随时可在后台 <a href="https://app.magicengine.com.au/dashboard/today" style="color:#0891b2">今日待办</a> 页查看同一份清单。
      </p>
    </div>`

  const subject = totalItems > 0
    ? `📋 今日待办 · ${ZH_DAYS[weekday]} · ${totalItems} 件`
    : `📋 今日待办 · ${ZH_DAYS[weekday]} · 无事 ✅`

  return { subject, html, totalItems }
}
