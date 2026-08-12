/**
 * Magic Engine 2.0 · 台账激活闸（Issue #930 · WP05 前置）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 顺序是这道闸的全部意义
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   校验（全部通过才继续）→ 抓取 + 富集（全部成功才继续）→ 一次性写入 → 精确对账
 *
 * 任何一步没过，**后面一步根本不会发生**：校验没过就一次抓取都不发出去；
 * 富集没全成就一行都不写。现有 `executeJob()` 的做法正相反 —— 边发现边 upsert，
 * 人还没看过就已经落库，失败的页面留下半截行。
 *
 * 🔴 这一层不 import supabase：写入口子从外面注入，所以「只有被接受的 canonical URL
 *    能到达持久化」这条能在内存里测死。
 * 🔴 闸门不过一律返回 `status: 'rejected'` 的审计对象而不是抛错 ——
 *    审计本身就是交付物；抛错会把「为什么没跑」这件事丢掉。
 *    调用方必须看 `status`，`'activated'` 之外都不算完成。
 */

import type {
  ActivationAudit,
  ActivationBlocker,
  ActivationDeps,
  ActivationExpectation,
  AcceptedPageRecord,
  InventoryCandidate,
  ReviewedInventoryPlan,
} from './types'
import { INVENTORY_PLAN_CONTRACT_VERSION, NORMALIZATION_RULE_VERSION } from './types'
import type { CrawlResult } from '../crawler'
import { verifyPlanHash } from './plan'
import { deriveCanonicalUrl, normaliseApprovedHosts } from './url-rules'

export interface ActivateInput {
  readonly plan: ReviewedInventoryPlan
  /** 从当前生产上下文读出来的租户 / 域名 / 批准主机。 */
  readonly expected: ActivationExpectation
  /**
   * 激活模式。目前只有首次激活一种，且**要求台账为空** ——
   * 增量模式涉及「旧行怎么处置」，那是另一份授权，不在这里默认成立。
   */
  readonly mode: 'first_activation'
  readonly deps: ActivationDeps
}

/**
 * 执行一次台账激活。
 *
 * 返回的审计对象逐条列出被接受 / 被拒 / 暂缓 / 失败 / 实际写入的 URL —— 不做汇总即真相，
 * 也不许把部分成功报成完成。
 */
export async function activateReviewedPlan(input: ActivateInput): Promise<ActivationAudit> {
  const { plan, deps } = input
  const accepted = plan.candidates.filter((c) => c.decision === 'accepted')

  const blockers = await collectBlockers(input, accepted)
  if (blockers.length > 0) {
    return buildAudit({ plan, accepted, status: 'rejected', blockers, failures: [], written: [], touched: false })
  }

  // ——— 闸门全过，才开始真的抓 ———
  const acceptedUrls = accepted.map((c) => c.canonicalUrl as string)
  const { records, failures } = await crawlAndEnrich(acceptedUrls, deps)

  if (failures.length > 0) {
    return buildAudit({
      plan,
      accepted,
      status: 'failed',
      blockers: [
        {
          code: 'accepted_page_failed',
          message:
            `${failures.length} 个被接受的页面抓取或分类失败，本次不写入任何一行 —— ` +
            '被批准的是「这一整份清单」，写一半就不是那份清单了。修好之后重跑。',
        },
      ],
      failures,
      written: [],
      touched: false,
    })
  }

  return persistAndReconcile(input, accepted, records)
}

// ---------------------------------------------------------------------------
// 闸门
// ---------------------------------------------------------------------------

async function collectBlockers(
  input: ActivateInput,
  accepted: readonly InventoryCandidate[],
): Promise<ActivationBlocker[]> {
  const { plan, expected, deps } = input
  const blockers: ActivationBlocker[] = [
    ...checkPlanIdentity(plan, expected),
    ...checkAcceptedSet(plan, accepted),
  ]
  if (blockers.length > 0) return blockers

  // 空库闸放在最后：它要打网络/数据库，前面的纯校验能拦下的就别浪费这一次查询。
  let existing: number
  try {
    existing = await deps.store.countExistingPages(plan.clientId)
  } catch (err) {
    // 🔴 读失败绝不当成 0 —— 「查不到」和「查炸了」必须是两种结局。
    return [
      {
        code: 'inventory_count_unavailable',
        message: `读不到该租户当前台账行数，无法确认是首次激活：${err instanceof Error ? err.message : String(err)}`,
      },
    ]
  }
  if (existing !== 0) {
    return [
      {
        code: 'inventory_not_empty',
        message:
          `首次激活要求台账为空，实际有 ${existing} 行。这些行的来源与去留需要单独决定，` +
          '不能被这次激活默默覆盖。',
      },
    ]
  }
  return []
}

function checkPlanIdentity(plan: ReviewedInventoryPlan, expected: ActivationExpectation): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  if (plan.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {
    blockers.push({
      code: 'contract_version_mismatch',
      message: `计划契约版本是 ${plan.contractVersion}，当前代码是 ${INVENTORY_PLAN_CONTRACT_VERSION}`,
    })
  }
  if (plan.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {
    blockers.push({
      code: 'rule_version_mismatch',
      message:
        `计划按 ${plan.normalizationRuleVersion} 归一，当前代码是 ${NORMALIZATION_RULE_VERSION} —— ` +
        '规则变了就必须重新生成并重新复核，旧批准不能套新语义',
    })
  }
  if (plan.clientId !== expected.clientId) {
    blockers.push({
      code: 'client_mismatch',
      message: `计划属于租户 ${plan.clientId}，本次激活的是 ${expected.clientId}`,
    })
  }
  if (!sameDomain(plan.boundary.requestedDomain, expected.requestedDomain)) {
    blockers.push({
      code: 'domain_mismatch',
      message: `计划针对域名 ${plan.boundary.requestedDomain}，本次上下文是 ${expected.requestedDomain}`,
    })
  }
  if (!sameHostSet(plan.boundary.approvedHosts, expected.approvedHosts)) {
    blockers.push({
      code: 'approved_hosts_mismatch',
      message:
        `计划批准的主机是 [${[...plan.boundary.approvedHosts].join(', ')}]，` +
        `本次上下文批准的是 [${[...expected.approvedHosts].join(', ')}]`,
    })
  }
  if (plan.review === null || plan.review.reviewedBy.trim().length === 0) {
    blockers.push({ code: 'plan_not_reviewed', message: '这份计划没有复核签名，不能激活' })
  }
  if (!verifyPlanHash(plan)) {
    blockers.push({
      code: 'plan_hash_mismatch',
      message: '计划内容与它自带的哈希对不上 —— 批准之后被改过，不许激活',
    })
  }
  return blockers
}

function checkAcceptedSet(
  plan: ReviewedInventoryPlan,
  accepted: readonly InventoryCandidate[],
): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  const pending = plan.candidates.filter((c) => c.decision === 'pending')
  if (pending.length > 0) {
    blockers.push({
      code: 'unreviewed_candidates',
      message: `还有 ${pending.length} 条候选没人判（pending）。没判过的不许当成「不要」。`,
    })
  }
  if (accepted.length === 0) {
    blockers.push({ code: 'empty_accepted_set', message: '被接受的页面是 0 条，没有可激活的台账' })
  }

  let approvedHosts: readonly string[]
  try {
    approvedHosts = normaliseApprovedHosts(plan.boundary.approvedHosts)
  } catch (err) {
    return [
      ...blockers,
      { code: 'invalid_host_allowlist', message: err instanceof Error ? err.message : String(err) },
    ]
  }

  const seen = new Set<string>()
  for (const candidate of accepted) {
    const url = candidate.canonicalUrl
    if (url === null) {
      blockers.push({
        code: 'accepted_without_canonical',
        message: `被接受的候选 ${candidate.originalUrl} 没有 canonical URL`,
      })
      continue
    }
    // 🔴 拿**原始 URL 重新推导**，而不是只验「这个串本身规不规范」。
    //    差别在于：把 canonical 从 /a 改成同一主机下的 /hacked，那个串自己完全规范，
    //    但它不是这条候选推导出来的东西 —— 照批就会写入一个没人复核过的页面。
    //    plan.ts 的 assertPlanIntact 已经验过一遍；这里是纵深防御，
    //    因为没有任何东西能证明一份手写的复核计划真的来自 buildInventoryPlan。
    const derived = deriveCanonicalUrl(candidate.originalUrl, { approvedHosts })
    if (derived === null || derived !== url) {
      blockers.push({
        code: 'accepted_url_not_derived',
        message:
          `被接受的 ${candidate.originalUrl} 记着的 canonical 是 ${url}，` +
          `按当前规则重新推导得到 ${derived ?? 'null'}（主机未批准或该串被改过）`,
      })
      continue
    }
    if (seen.has(url)) {
      blockers.push({ code: 'duplicate_accepted_target', message: `被接受集合里出现重复的 canonical URL：${url}` })
      continue
    }
    seen.add(url)
  }
  return blockers
}

// ---------------------------------------------------------------------------
// 抓取 + 富集（复用现有 site-audit，不另起一套）
// ---------------------------------------------------------------------------

interface CrawlOutcome {
  readonly records: readonly AcceptedPageRecord[]
  readonly failures: readonly { url: string; error: string }[]
}

async function crawlAndEnrich(urls: readonly string[], deps: ActivationDeps): Promise<CrawlOutcome> {
  const records: AcceptedPageRecord[] = []
  const failures: { url: string; error: string }[] = []

  // 抓取结果里 antibot 挑战页也带 `error`（`crawler.ts:439`），所以下面那道 error 判定
  // 同时挡住「WAF 拦截页被当成真页面写进台账」—— 那是 2026-06-20 Oztop 事故的形状。
  let crawled: readonly CrawlResult[]
  try {
    crawled = await deps.crawl(urls)
  } catch (err) {
    return { records: [], failures: urls.map((url) => ({ url, error: crawlErrorText(err) })) }
  }

  const byUrl = new Map(crawled.map((r) => [r.url, r]))
  for (const url of urls) {
    const result = byUrl.get(url)
    if (result === undefined) {
      // 抓取器没返回这一条 —— 不许当成「跳过」，它就是失败。
      failures.push({ url, error: 'crawler returned no result for this accepted URL' })
      continue
    }
    if (result.error !== undefined && result.error.length > 0) {
      failures.push({ url, error: result.error })
      continue
    }
    const enriched = await deps.enrich({ url, title: result.title, markdown: result.markdown })
    if (!enriched.classified) {
      // 台账要给 WP05 当页面身份用，分类失败的页面不许以 `other` 蒙混进去。
      failures.push({ url, error: `classification failed: ${enriched.classificationError ?? 'unknown'}` })
      continue
    }
    records.push({
      canonicalUrl: url,
      path: new URL(url).pathname,
      title: result.title,
      markdown: result.markdown,
      wordCount: enriched.wordCount,
      pageType: enriched.pageType,
      topics: enriched.topics,
      primaryKeyword: enriched.primaryKeyword,
      classificationConfidence: enriched.classificationConfidence,
      hasGeoBlock: enriched.hasGeoBlock,
      geoDetectionMethod: enriched.geoDetectionMethod,
      geoConfidence: enriched.geoConfidence,
      crawledAt: result.crawledAt.toISOString(),
    })
  }
  return { records, failures }
}

function crawlErrorText(err: unknown): string {
  return `crawl batch failed: ${err instanceof Error ? err.message : String(err)}`
}

// ---------------------------------------------------------------------------
// 写入 + 对账
// ---------------------------------------------------------------------------

async function persistAndReconcile(
  input: ActivateInput,
  accepted: readonly InventoryCandidate[],
  records: readonly AcceptedPageRecord[],
): Promise<ActivationAudit> {
  const { plan, deps } = input

  // 🔴 抓取要跑几分钟，空库那一眼是几分钟之前看的。这中间可能有另一次激活、
  //    或者旧的 site-audit 任务往同一张表里写过东西。写之前再看一眼，变了就停手。
  //    ⚠️ 这只是把窗口收窄，**不是**原子性：真正的保证必须由 store 在
  //    同一个事务 / 条件写里跟插入一起做（见 `CanonicalInventoryStore` 契约）。
  let recheck: number
  try {
    recheck = await deps.store.countExistingPages(plan.clientId)
  } catch (err) {
    return buildAudit({
      plan,
      accepted,
      status: 'rejected',
      blockers: [
        {
          code: 'inventory_count_unavailable',
          message: `写入前复查台账行数失败，不能确认它仍然是空的：${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      failures: [],
      written: [],
      touched: false,
    })
  }
  if (recheck !== 0) {
    return buildAudit({
      plan,
      accepted,
      status: 'rejected',
      blockers: [
        {
          code: 'inventory_changed_during_crawl',
          message:
            `抓取期间台账从 0 行变成了 ${recheck} 行 —— 有别的东西在往同一个租户写。` +
            '这次不写，先弄清那些行是谁写的。',
        },
      ],
      failures: [],
      written: [],
      touched: false,
    })
  }

  let written: readonly string[]
  try {
    written = await deps.store.writeAcceptedPages({
      clientId: plan.clientId,
      pages: records,
      // 🔴 这个标记不是给日志看的：实现方**必须**在同一个事务 / 条件写里
      //    重新确认台账为空，否则两份不同的计划可以各自对账通过、
      //    最后台账是两份的并集 —— 那已经不是任何一份被批准的清单。
      requireEmptyInventory: true,
    })
  } catch (err) {
    return buildAudit({
      plan,
      accepted,
      status: 'failed',
      blockers: [
        {
          code: 'write_failed',
          message:
            `写入台账失败：${err instanceof Error ? err.message : String(err)}。` +
            '⚠️ 失败发生在写入过程中，库里可能已有部分行，先人工核对再重跑。',
        },
      ],
      failures: [],
      written: [],
      touched: true,
    })
  }

  // 🔴 拿写入方返回的清单跟被接受集合做**精确**比对，不是数个数。
  //    少一条 / 多一条 / 换了一条，都不许报「完成」。
  const expectedSet = new Set(records.map((r) => r.canonicalUrl))
  const writtenSet = new Set(written)
  const missing = Array.from(expectedSet).filter((u) => !writtenSet.has(u))
  const unexpected = Array.from(writtenSet).filter((u) => !expectedSet.has(u))
  if (missing.length > 0 || unexpected.length > 0) {
    return buildAudit({
      plan,
      accepted,
      status: 'failed',
      blockers: [
        {
          code: 'write_set_mismatch',
          message:
            `写入结果与被接受集合不一致：缺 ${missing.length} 条 [${missing.join(', ')}]，` +
            `多 ${unexpected.length} 条 [${unexpected.join(', ')}]。⚠️ 台账已被改动，必须人工核对。`,
        },
      ],
      failures: [],
      written,
      touched: true,
    })
  }

  return buildAudit({ plan, accepted, status: 'activated', blockers: [], failures: [], written, touched: true })
}

// ---------------------------------------------------------------------------
// 审计对象
// ---------------------------------------------------------------------------

function buildAudit(parts: {
  plan: ReviewedInventoryPlan
  accepted: readonly InventoryCandidate[]
  status: ActivationAudit['status']
  blockers: readonly ActivationBlocker[]
  failures: readonly { url: string; error: string }[]
  written: readonly string[]
  touched: boolean
}): ActivationAudit {
  const { plan } = parts
  const rejected = plan.candidates.filter((c) => c.decision === 'rejected')
  const deferred = plan.candidates.filter((c) => c.decision === 'defer')
  return {
    status: parts.status,
    clientId: plan.clientId,
    planHash: plan.planHash,
    normalizationRuleVersion: plan.normalizationRuleVersion,
    counts: {
      accepted: parts.accepted.length,
      rejected: rejected.length,
      deferred: deferred.length,
      crawlFailed: parts.failures.length,
      written: parts.written.length,
    },
    acceptedUrls: parts.accepted.map((c) => c.canonicalUrl ?? c.originalUrl),
    rejectedUrls: rejected.map((c) => ({ url: c.canonicalUrl ?? c.originalUrl, reasonCodes: c.reasonCodes })),
    deferredUrls: deferred.map((c) => ({ url: c.canonicalUrl ?? c.originalUrl, reasonCodes: c.reasonCodes })),
    failedUrls: parts.failures,
    writtenUrls: parts.written,
    blockers: parts.blockers,
    inventoryTouched: parts.touched,
    redirectEvidence: 'unavailable',
  }
}

function sameDomain(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function sameHostSet(a: readonly string[], b: readonly string[]): boolean {
  const norm = (hosts: readonly string[]): string =>
    Array.from(new Set(hosts.map((h) => h.trim().toLowerCase())))
      .sort()
      .join('|')
  return norm(a) === norm(b)
}
