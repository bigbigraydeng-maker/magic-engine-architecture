/**
 * 「这个客户的 Mailchimp audience id 是多少」—— 全仓唯一入口。
 *
 * ⚠️ **不要直接 `select('mailchimp_audience_id')`。**
 *
 * 那一列由 `supabase/migrations/20260826010000_mailchimp_audience_id.sql` 定义，
 * 但那条 migration **至今没有应用到生产**（文件头写明 Issue #1188 要求
 * `migration_applied = false`）。直接选它，整条 PostgREST 查询会 400：
 *
 *   {"code":"42703","message":"column clients.mailchimp_audience_id does not exist"}
 *
 * 这不是推测 —— 2026-09-02 与 2026-09-03 两次对生产库（`glbdnayojixmexgofbsd`）
 * 实测都是这个结果。后果是 `crm/meta-lead.ts` 的 Mailchimp 出口每小时都走
 * 「读配置失败」分支静默 skip，Meta 表单进来的人**从来没有**被同步进 audience，
 * Mailchimp 里也从来没出现过 `facebook_leadgen` 标签。
 *
 * 所以这里的读法是：
 *   1. 先探专列（apply 之后自动优先用它，将来不用回来改代码）；
 *   2. **只有 42703「这一列不存在」这一种错**才降级 —— 权限被回收、网络抖动、
 *      schema cache 没刷新都必须如实报错，不许一起吞掉（本仓反复吃过的
 *      「空有三种来路」）；
 *   3. 落脚 `clients.leads_config`（jsonb，一定存在）里的 `mailchimp_audience_id`。
 *
 * 平台边界：这里只读 provider 配置，不含任何客户名 / 行业判断。CTS 的具体
 * audience id 存在数据库的 `leads_config` 里，不在代码里。
 */

import { supabaseAdmin } from '@/lib/supabase'

/** PostgREST 的 undefined_column。只有这一种错该被当成「专列还没 apply」。 */
export function isUndefinedColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === '42703' || /does not exist/i.test(err.message ?? '')
}

/** `clients.leads_config.mailchimp_audience_id` —— 专列没 apply 时的落脚点。 */
export function audienceFromLeadsConfig(leadsConfig: unknown): string {
  const cfg = (leadsConfig ?? {}) as { mailchimp_audience_id?: unknown }
  return typeof cfg.mailchimp_audience_id === 'string' ? cfg.mailchimp_audience_id.trim() : ''
}

export type AudienceIdRead =
  /** 读到了配置。`audienceId` 为空串 = 这个客户明确没配（出口关闭，零 provider 调用）。 */
  | { ok: true; audienceId: string }
  /** 真的读不到 —— 不是「没配」。上游必须如实上报，不许当成「没有」。 */
  | { ok: false; message: string }

interface ClientAudienceRow {
  leads_config?: unknown
  mailchimp_audience_id?: unknown
}

/**
 * 专列查询成功时，**专列就是唯一权威 —— 包括它是空的时候**。
 *
 * 为什么不是 `专列 || leads_config`：那一列的 migration 注释把语义写死成
 * 「NULL disables the outlet for this client (zero provider calls)」。如果空值
 * 还会掉回 `leads_config` 的旧值，运营把专列清空来关出口就关不掉，会给本该
 * 停掉的人继续发订阅 —— 一个「关不掉的开关」比读不到配置更糟。
 *
 * ⚠️ **apply 那条 migration 之前必须先把 `leads_config` 里配过的 audience id
 * 搬进专列**，否则专列一出现（除 CTS 由 migration 自己种下之外全是 NULL），
 * 那些客户的出口会当场静默关闭。2026-09-03 全库只有 CTS 一家配过。
 */
function dedicatedAudienceId(row: ClientAudienceRow | null): string {
  return typeof row?.mailchimp_audience_id === 'string' ? row.mailchimp_audience_id.trim() : ''
}

/**
 * 单个客户的 audience id。
 *
 * 客户行不存在时返回 `{ ok: true, audienceId: '' }` —— 「查得到、就是没配」，
 * 跟「查不到」是两件事，上游的 skip 理由不一样。
 */
export async function readAudienceId(clientId: string): Promise<AudienceIdRead> {
  const withDedicated = await supabaseAdmin
    .from('clients')
    .select('mailchimp_audience_id')
    .eq('id', clientId)
    .maybeSingle()

  if (!withDedicated.error) {
    // 专列在 → 只认专列（空值 = 明确关闭出口，不许掉回 leads_config）。
    return { ok: true, audienceId: dedicatedAudienceId(withDedicated.data as ClientAudienceRow | null) }
  }
  if (!isUndefinedColumn(withDedicated.error)) {
    return { ok: false, message: withDedicated.error.message }
  }

  // 专列还没 apply —— 退到只读 jsonb。这一次再失败就是真失败。
  const fallback = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (fallback.error) {
    return { ok: false, message: fallback.error.message }
  }
  return {
    ok: true,
    audienceId: audienceFromLeadsConfig((fallback.data as ClientAudienceRow | null)?.leads_config),
  }
}
