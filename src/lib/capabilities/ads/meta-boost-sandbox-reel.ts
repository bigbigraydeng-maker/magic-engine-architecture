/**
 * Outward Capability · `ads.meta_boost_sandbox_reel`
 *
 * 把一条已发布的帖子在 Meta 上建成**暂停态**广告，回读验证，记归因。
 * **不含激活** —— 见 `kernel/registry.ts` 里这个动作的完整边界论证：
 * Kernel v1 结构性要求对外动作诚实地 `reversible: true`，而"已经花出去的钱
 * 撤不回来"，所以真正花钱的那一步（激活）不属于这个 Kernel 动作，是一个
 * 独立的、走 M6 专用 API 路由的人工操作。
 *
 * 四步：
 *   guard          —— 校验草案 + 原子预留额度（真钱硬顶的唯一判定点）
 *   publish_paused —— 建成 PAUSED（真调 Meta，可能真的建出外部对象）
 *   gate           —— 回读验证（真调 Meta 读回真实落地状态）
 *   link           —— 记归因（纯内部记账，不碰外部）
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapabilityImplementation, CapabilityStepResult, VerificationResult } from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { validateDraft } from '@/lib/ads-strategy/ad-draft'
import { createBoostAdPaused, findByTag } from '@/lib/meta/post-boost-publisher'
import { fetchAdSetReadback, fetchAdCreativesReadback } from '@/lib/meta/readback'
import { adaptMetaAdSet, type RawMetaAdSet } from '@/lib/ads-strategy/meta-readback-adapter'
import { checkLaunch } from '@/lib/ads-strategy/launch-readback'
import { createSupabaseSpendReservationStore } from '@/lib/ads/spend-reservations'
import { linkAdToCreative } from '@/lib/ads/creative-link'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'

/** v1 sandbox 的终身额度硬顶。改这个常量就是改这个动作能花多少钱的上限。 */
export const V1_SANDBOX_LIFETIME_CAP_NZD = 300

/** 预留额度表的 scope_key 前缀 —— 每个客户各自一条终身额度记录。 */
export function scopeKeyFor(clientId: string): string {
  return `me_sandbox_v1_${clientId}`
}

interface RunInput {
  objectStoryId: string
  draft: AdDraft
  draftSummaryHash: string
  reservationAmountNzd: number
}

/** 从 run 上把提交时的输入读回来 —— capability 不接受调用方现场递参数。 */
async function requireInput(sb: SupabaseClient, runId: string): Promise<RunInput> {
  const { data, error } = await sb.from('action_runs').select('input').eq('id', runId).limit(1)
  if (error) throw new RetryableCapabilityError(`读取执行输入失败：${error.message}`)
  const row = (data ?? [])[0] as unknown as { input: Record<string, unknown> } | undefined
  if (!row) throw new KernelError('INVALID_STATE', `找不到执行实例 ${runId}`)

  const objectStoryId = row.input?.object_story_id
  const draft = row.input?.draft
  const draftSummaryHash = row.input?.draft_summary_hash
  const reservationAmountNzd = row.input?.reservation_amount_nzd

  if (
    typeof objectStoryId !== 'string' ||
    typeof draftSummaryHash !== 'string' ||
    typeof reservationAmountNzd !== 'number' ||
    !draft ||
    typeof draft !== 'object'
  ) {
    throw new KernelError('INVALID_INPUT', '这次执行的输入不完整（object_story_id / draft / draft_summary_hash / reservation_amount_nzd 缺一不可）')
  }

  return { objectStoryId, draft: draft as unknown as AdDraft, draftSummaryHash, reservationAmountNzd }
}

interface ClientMetaConfig {
  adAccountId: string
  pageId: string
}

async function loadClientMetaConfig(sb: SupabaseClient, clientId: string): Promise<ClientMetaConfig> {
  const { data, error } = await sb
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new RetryableCapabilityError(`读取客户 Meta 配置失败：${error.message}`)
  const row = data as { meta_ad_account_id?: string | null; facebook_page_id?: string | null } | null
  if (!row?.meta_ad_account_id) {
    throw new KernelError('INVALID_STATE', `客户 ${clientId} 没有配置 Meta 广告账户 id`)
  }
  if (!row.facebook_page_id) {
    throw new KernelError('INVALID_STATE', `客户 ${clientId} 没有配置 Facebook 主页 id`)
  }
  return { adAccountId: row.meta_ad_account_id, pageId: row.facebook_page_id }
}

export function createMetaBoostSandboxReelCapability(sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: 'ads.meta_boost_sandbox_reel',
    version: 1,
    steps: {
      /**
       * ① 预留额度：先做 ME 自己就能判的校验（不浪费一次真实创建），
       * 再原子预留 —— 这是真钱硬顶的唯一判定点，见 spend-reservations.ts。
       */
      async guard({ ctx }): Promise<CapabilityStepResult> {
        const input = await requireInput(sb, ctx.runId)

        const problems = validateDraft(input.draft)
        if (problems.length > 0) {
          throw new KernelError(
            'INVALID_INPUT',
            `草案本身有问题，没必要浪费一次真实创建：${problems.map((p) => `${p.field}：${p.message}`).join('；')}`,
          )
        }

        const store = createSupabaseSpendReservationStore(sb)
        const scopeKey = scopeKeyFor(ctx.clientId)
        const result = await store.reserve(ctx.clientId, scopeKey, V1_SANDBOX_LIFETIME_CAP_NZD, input.reservationAmountNzd)
        if (!result.ok) {
          const used = result.row.reservedAmountNzd + result.row.committedAmountNzd + result.row.failedNeedsReconcileAmountNzd
          throw new KernelError(
            'COST_CAP_EXCEEDED',
            `这次要占用 NZ$${input.reservationAmountNzd}，但 sandbox 终身额度 NZ$${V1_SANDBOX_LIFETIME_CAP_NZD} 已经用了 NZ$${used} —— 拒绝`,
            { detail: { scopeKey, row: result.row } },
          )
        }

        return {
          costActualUsd: 0,
          output: { reservation_scope_key: scopeKey, reserved_amount_nzd: input.reservationAmountNzd },
        }
      },

      /**
       * ② 建成暂停态：真调 Meta。先按 deterministicTag 反查（断点续跑/重试
       * 前先认自己的行，同 Codex #8/#9 recovery protocol），全 0 才新建。
       * 建失败会把预留额度退回去（确定没花钱）。
       */
      async publish_paused({ ctx, priorOutputs }): Promise<CapabilityStepResult> {
        const input = await requireInput(sb, ctx.runId)
        if (!priorOutputs.guard) {
          throw new KernelError('INVALID_STATE', '预留额度这一步的产物不见了，没法建广告')
        }

        const [client, accessToken] = await Promise.all([
          loadClientMetaConfig(sb, ctx.clientId),
          getMetaTokenForClient(ctx.clientId),
        ])
        if (!accessToken) {
          throw new KernelError('INVALID_STATE', `客户 ${ctx.clientId} 没有可用的 Meta 访问令牌`)
        }

        const tag = `ME-SANDBOX-${ctx.runId}`
        const existing = await findByTag(client.adAccountId, accessToken, tag)
        const counts = [existing.campaigns.length, existing.adSets.length, existing.creatives.length, existing.ads.length]

        if (counts.every((n) => n === 1)) {
          // 已经建过了（这是一次断点续跑）——直接用，不重建。
          return {
            costActualUsd: 0,
            output: {
              campaign_id: existing.campaigns[0],
              ad_set_id: existing.adSets[0],
              creative_id: existing.creatives[0],
              ad_id: existing.ads[0],
              deterministic_tag: tag,
            },
          }
        }
        if (counts.some((n) => n > 0)) {
          // 混合/不完整的残留——不猜，转人工核实 Meta 后台。
          throw new KernelError(
            'INVALID_STATE',
            `按 tag 反查到不完整的建广告残留（campaigns=${counts[0]} adSets=${counts[1]} creatives=${counts[2]} ads=${counts[3]}），需要人工核实 Meta 后台`,
            { detail: { tag, existing } },
          )
        }

        const result = await createBoostAdPaused(input.draft, client.adAccountId, accessToken, ctx.runId)
        if (!result.ok) {
          const store = createSupabaseSpendReservationStore(sb)
          await store.release(ctx.clientId, scopeKeyFor(ctx.clientId), input.reservationAmountNzd)
          throw new KernelError(
            'INVALID_STATE',
            `建广告失败（${result.step}）：${result.error}`,
            { detail: { orphans: result.orphans, step: result.step } },
          )
        }

        return {
          costActualUsd: 0,
          output: {
            campaign_id: result.campaignId,
            ad_set_id: result.adSetId,
            creative_id: result.creativeId,
            ad_id: result.adId,
            deterministic_tag: result.deterministicTag,
          },
        }
      },

      /**
       * ③ 回读验证：真调 Meta 读回真实落地状态，撞 launch-readback.ts 已知的坑
       * （年龄/版位/优势受众，R2 已建好对照逻辑）+ 直接核对预算/状态两项
       * （裁决点名要查、checkLaunch 管不到的部分）。
       *
       * 🔴 验证没过（或查不出来）**不删已建的暂停广告**——它是安全的：暂停态
       * 不花钱，留给人工看比自动删掉更负责。预留额度也不释放：这笔钱还有
       * 可能被人工修好后继续用，释放了容易造成"同时有个待处理的问题和一个
       * 已经放出去的额度"这种更难追的状态。
       */
      async gate({ ctx, priorOutputs }): Promise<CapabilityStepResult> {
        const input = await requireInput(sb, ctx.runId)
        const built = priorOutputs.publish_paused
        if (!built) throw new KernelError('INVALID_STATE', '建广告这一步的产物不见了，没法验证')

        const accessToken = await getMetaTokenForClient(ctx.clientId)
        if (!accessToken) throw new KernelError('INVALID_STATE', `客户 ${ctx.clientId} 没有可用的 Meta 访问令牌`)

        const adSetId = String(built.ad_set_id)
        const [rawAdSet, creatives] = await Promise.all([
          fetchAdSetReadback(adSetId, accessToken),
          fetchAdCreativesReadback(adSetId, accessToken),
        ])

        const checks: VerificationResult['checks'] = []
        const check = (name: string, passed: boolean, detail?: string) =>
          checks.push({ name, passed, ...(detail ? { detail } : {}) })

        check('回读到广告组', Boolean(rawAdSet))
        check('回读到创意', Boolean(creatives))

        if (!rawAdSet || !creatives) {
          const verification: VerificationResult = {
            method: 'meta_ad_boost_readback',
            passed: false,
            checks,
            failure_reason: '广告建出来了（暂停着），但回读不到真实设置 —— 查不出来不等于没问题，在查清楚之前不该开',
          }
          throw new KernelError('VERIFICATION_FAILED', verification.failure_reason!, { detail: { verification } })
        }

        // 直接核对：状态必须是 PAUSED（裁决点名的"状态"检查——checkLaunch 不管这个）
        const rawStatus = (rawAdSet as unknown as RawMetaAdSet).effective_status
        check('状态是 PAUSED', rawStatus === 'PAUSED', typeof rawStatus === 'string' ? `实际是 ${rawStatus}` : '读不到状态')

        // 直接核对：预算跟批准的一致（裁决点名的"预算"检查）
        const rawBudgetCents = (rawAdSet as unknown as RawMetaAdSet).daily_budget
        const approvedCents = Math.round(input.draft.dailyBudget * 100)
        const budgetMatches = typeof rawBudgetCents === 'string'
          ? Number(rawBudgetCents) === approvedCents
          : rawBudgetCents === approvedCents
        check('预算跟批准的一致', budgetMatches,
          `批准 ${approvedCents} 分，回读到 ${String(rawBudgetCents)} 分`)

        const report = checkLaunch(
          adaptMetaAdSet(rawAdSet, creatives, {
            expectedGeo: null,
            expectedAgeMin: input.draft.ageMin,
            expectedAgeMax: input.draft.ageMax,
            expectedPublisherPlatforms: input.draft.publisherPlatforms,
            expectedAdvantageAudienceOff: true,
          }),
        )
        for (const f of report.findings) {
          check(f.message, f.severity !== 'blocker', f.code)
        }

        const failed = checks.filter((c) => !c.passed)
        const passed = failed.length === 0 && report.safeToActivate
        const verification: VerificationResult = {
          method: 'meta_ad_boost_readback',
          passed,
          checks,
          ...(passed ? {} : { failure_reason: failed.map((c) => c.name).join('；') || '闸门有 blocker 级发现' }),
        }

        if (!passed) {
          throw new KernelError(
            'VERIFICATION_FAILED',
            `回读验证没过：${verification.failure_reason}。广告已建出但仍是暂停态，需要人工处理（不自动删除）。`,
            { detail: { verification, campaign_id: built.campaign_id, ad_set_id: built.ad_set_id } },
          )
        }

        return { costActualUsd: 0, verification, output: { ...built } }
      },

      /**
       * ④ 记归因：纯内部记账，不碰任何外部服务。`linkAdToCreative` 自身
       * "永不抛异常"——归因认不出来是正常结局，不该让整个 run 因此失败。
       */
      async link({ ctx, priorOutputs }): Promise<CapabilityStepResult> {
        const input = await requireInput(sb, ctx.runId)
        const built = priorOutputs.gate ?? priorOutputs.publish_paused
        if (!built) throw new KernelError('INVALID_STATE', '建广告这一步的产物不见了，没法记归因')

        const client = await loadClientMetaConfig(sb, ctx.clientId)

        const link = await linkAdToCreative({
          clientId: ctx.clientId,
          adId: String(built.ad_id),
          postId: input.objectStoryId,
          pageId: client.pageId,
          createdBy: 'me_ad_launch',
          play: 'boost_organic_post',
          playSource: 'declared_at_creation',
          playContext: { experiment: 'me_sandbox_v1' },
        })

        return {
          costActualUsd: 0,
          output: {
            ...built,
            creative_ref: link.creativeRef,
            link_method: link.linkMethod,
          },
        }
      },
    },
  }
}
