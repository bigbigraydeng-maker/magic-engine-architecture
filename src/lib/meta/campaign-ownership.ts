/**
 * 广告写路径的最低限度归属校验（AD-SEC-1）。
 *
 * ── 问题 ─────────────────────────────────────────────────────────────────
 * `meta-ads/execute` / `ad-health/stop-loss` 这类路径只校验 URL 里的客户身份
 * （`requirePaidClientAccess(clientId)`），`campaign_id` 却原样取自请求体、
 * 从不核对这条广告是不是真的属于这个客户。有权限的人提交一个别家客户的
 * campaign_id，就能停/改别家客户在投的广告。
 *
 * ── 这条守卫能挡住什么、挡不住什么 ───────────────────────────────────────
 * 挡住：campaign_id 根本不在这个客户注册的 Meta 广告账户里的情况——最粗暴的
 * 跨账户误操作/越权，也是本仓目前唯一有真凭实据可以核对的边界。
 *
 * 🔴 挡不住：CTS / Oztop 目前共用同一个 Meta 广告账户，account_id 本来就
 * 相同——同账户内的跨客户操作，这条校验查不出来。根治需要账户拆分，或者
 * 补一张「谁创建的这条广告」归属表，两条都是产品/运维决策，不是能靠这一次
 * 代码改动单方面解决的（详见 ROADMAP.md AD-SEC-1）。上线前必须让 PM 知道
 * 这个局限，不能把这条守卫当成「问题已解决」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getCampaignDetails, type CampaignDetails } from './client'

function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

export type OwnershipCheckResult =
  | { ok: true; campaign: CampaignDetails }
  | { ok: false; error: string }

/**
 * 读一次 campaign（带 account_id）+ 核对它是不是这个客户在 `clients` 表登记
 * 的广告账户。任何一步读不出来都 fail closed（拒绝执行，不是放行）。
 */
export async function assertCampaignOwnedByClient(
  campaignId: string,
  clientId: string,
  accessToken: string,
): Promise<OwnershipCheckResult> {
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError) {
    return { ok: false, error: `查不到这个客户的广告账户登记：${clientError.message}` }
  }
  const registeredAccountId = (client as { meta_ad_account_id?: string | null } | null)
    ?.meta_ad_account_id
  if (!registeredAccountId) {
    return { ok: false, error: '这个客户没有登记 Meta 广告账户，无法核对这条广告的归属，已拒绝执行。' }
  }

  const campaign = await getCampaignDetails(campaignId, accessToken)
  if (!campaign) {
    return { ok: false, error: '读不到这条广告的详情，无法核对归属，已拒绝执行。' }
  }
  if (!campaign.account_id) {
    return { ok: false, error: 'Meta 没有返回这条广告所属的账户信息，无法核对归属，已拒绝执行。' }
  }
  if (normalizeAccountId(campaign.account_id) !== normalizeAccountId(registeredAccountId)) {
    return {
      ok: false,
      error: '这条广告不属于这个客户登记的广告账户 —— 已拒绝执行，防止跨客户误操作。',
    }
  }
  return { ok: true, campaign }
}
