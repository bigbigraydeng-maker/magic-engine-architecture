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

/**
 * 发现候选 URL —— 直接用现有 `discoverSitemapUrls`
 * （robots / sitemap / sitemap_index / 首页 BFS / Jina 兜底，五级回退全在里面）。
 *
 * 🔴 它返回的是**原始串**，而且它内部的同源过滤是宽松的（剥 www + 前缀比较）。
 *    所以结果必须再过 `buildInventoryPlan()` 的精确主机闸，不能直接拿来用。
 */
export async function discoverCandidateUrls(domain: string): Promise<readonly string[]> {
  return discoverSitemapUrls(domain)
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
