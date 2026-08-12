/**
 * 把现有 site-audit 能力接到台账契约上（Issue #930 · WP05 前置）。
 *
 * 🔴 这个文件是「复用」这件事的落点：发现 / 抓取 / 分类 / GEO 检测**全部**来自现有模块，
 *    这里只做参数转接，一行采集逻辑都不重写。
 *
 * 🔴 没有默认的 store —— 落库适配器要等激活被单独授权后再接。
 *    这一层给不出 store，就没有任何路径能从代码里写到生产台账。
 */

import { crawlPages, discoverSitemapUrls, type CrawlOptions, type CrawlResult } from '../crawler'
import { enrichCrawledPage } from '../page-enrichment'
import type { ActivationDeps, CanonicalInventoryStore } from './types'

export interface HostDiscoveryResult {
  readonly host: string
  /** **这个主机自己的**页面数（按解析后的 hostname 精确归属，不是发现器返回的总条数）。 */
  readonly count: number
  /** 发现这个主机时返回的、其实属于别的主机的条数 —— 记下来，不丢掉。 */
  readonly foreignCount: number
  readonly error: string | null
}

export interface DiscoveryOutcome {
  /** 所有主机合并去重后的原始 URL。 */
  readonly urls: readonly string[]
  /** 每个主机各自发现了多少 —— 0 条也要看得见，不许被合并结果盖住。 */
  readonly perHost: readonly HostDiscoveryResult[]
}

/**
 * 发现候选 URL —— 直接用现有 `discoverSitemapUrls`
 * （robots / sitemap / sitemap_index / 首页 BFS / Jina 兜底，五级回退全在里面）。
 *
 * 🔴 **逐个批准主机各发现一遍再合并**，不是只跑一个域名。
 *    批准清单里可以有裸域 + `www` + 子域，而它们完全可能是**互不链接的独立站点**
 *    （#930 的现场就是这样）。只跑第一个的 robots / sitemap / 首页，
 *    第二个站的页面根本不会出现在候选里 —— 复核和激活照样成功，
 *    产出一份**静默缺页**的台账。缺页比多页危险：多的会被人看见并拒掉，缺的没人会发现。
 *
 * 🔴 逐主机的条数原样返回。某个主机 0 条可能是站点空、也可能是被 WAF 挡了，
 *    两者都得让人看见再决定，不能悄悄当成「这个站没有页面」。
 *
 * 🔴 返回的是**原始串**，而且 crawler 内部的同源过滤是宽松的（剥 www + 前缀比较）。
 *    所以结果必须再过 `buildInventoryPlan()` 的精确主机闸，不能直接拿来用。
 */
export async function discoverCandidateUrls(approvedHosts: readonly string[]): Promise<DiscoveryOutcome> {
  const seen = new Set<string>()
  const perHost: HostDiscoveryResult[] = []

  for (const host of approvedHosts) {
    perHost.push(await discoverOneHost(host, seen))
  }

  return { urls: Array.from(seen), perHost }
}

/**
 * 跑一个主机的发现，并**如实**记账。
 *
 * 🔴 两件事都不能想当然：
 *    1. **「找到了东西」≠「找到了这个站的东西」。** crawler 的同源过滤是宽松的
 *       （剥 www + 前缀比较），跑 A 主机时完全可能只返回 B 主机的 URL ——
 *       按返回总条数记账，A 就被记成「有页面」，那道「0 条必须有人认」的闸永远不响，
 *       而 A 整个站静默缺席。所以只数**解析后 hostname 精确等于本主机**的那些。
 *    2. **「没抛错」≠「找全了」。** discoverSitemapUrls 每一级回退都会吞掉失败继续走，
 *       一棵子 sitemap 取不到、其余还有结果时，它正常返回 —— 部分结果长得跟完整结果一样。
 *       所以接上它的观察口，任何被吞掉的失败都记成 error，交给人去认。
 */
async function discoverOneHost(host: string, seen: Set<string>): Promise<HostDiscoveryResult> {
  const swallowed: string[] = []
  let found: readonly string[] = []
  try {
    found = await discoverSitemapUrls(host, {
      onIssue: (issue) => swallowed.push(`${issue.stage}${issue.url ? ` ${issue.url}` : ''}: ${issue.error}`),
    })
  } catch (err) {
    // 整个发现挂掉也必须留痕 —— 否则它会长得跟「这个站没有页面」一样。
    return { host, count: 0, foreignCount: 0, error: err instanceof Error ? err.message : String(err) }
  }

  let count = 0
  for (const url of found) {
    if (!seen.has(url)) seen.add(url)
    if (hostnameOf(url) === host) count++
  }
  const error =
    swallowed.length > 0
      ? `发现过程中有 ${swallowed.length} 处失败被吞掉（结果可能不完整）：${swallowed.slice(0, 3).join('；')}`
      : null
  return { host, count, foreignCount: found.length - count, error }
}

/** 解析不了就返回 null —— 绝不用字符串包含去猜归属。 */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 抓取适配器：现有 `crawlPages`（限流 + 容错 + 反爬指纹识别）。
 *
 * 🔴 上限必须按**这一次被接受的页面数**来给，不能吃 `crawlPages` 的默认 100
 *    （`crawler.ts:411`、`:415` 会 `urls.slice(0, limit)`）。被接受清单超过 100 条时，
 *    多出来的 URL 会连结果都没有，激活方只能看到「抓取器没返回这一条」——
 *    整次激活在跑完 100 次真实网络请求之后失败，而且原因看着像抓取挂了，
 *    实际上是配置把批准过的清单截断了。
 *
 * 显式传了一个更小的上限，就是配置本身有问题：**直接抛**，别让它退化成一堆看不懂的失败。
 */
export function createCrawlAdapter(
  opts?: CrawlOptions,
): (urls: readonly string[]) => Promise<readonly CrawlResult[]> {
  return (urls) => {
    if (opts?.limit !== undefined && opts.limit < urls.length) {
      throw new Error(
        `抓取上限 ${opts.limit} 小于被接受的页面数 ${urls.length} —— ` +
          '被批准的是这一整份清单，截断之后跑出来的不是那份清单',
      )
    }
    return crawlPages([...urls], { ...opts, limit: urls.length })
  }
}

/**
 * 组装激活依赖。store 必须由调用方给 —— 见文件头。
 */
export function createActivationDeps(input: {
  readonly store: CanonicalInventoryStore
  readonly now: () => string
  /**
   * 验签。**必须由调用方给**，这里不提供默认实现 ——
   * 一个「默认恒真」的验签器等于没有这道闸，而且没人会注意到它不见了。
   */
  readonly verifyReviewSignature: (planHash: string, signature: string) => boolean
  readonly crawlOptions?: CrawlOptions
}): ActivationDeps {
  return {
    store: input.store,
    verifyReviewSignature: input.verifyReviewSignature,
    crawl: createCrawlAdapter(input.crawlOptions),
    enrich: enrichCrawledPage,
    now: input.now,
  }
}
