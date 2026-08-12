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

/** 抓取适配器：现有 `crawlPages`（限流 + 容错 + 反爬指纹识别）。 */
export function createCrawlAdapter(
  opts?: CrawlOptions,
): (urls: readonly string[]) => Promise<readonly CrawlResult[]> {
  return (urls) => crawlPages([...urls], opts)
}

/**
 * 组装激活依赖。store 必须由调用方给 —— 见文件头。
 */
export function createActivationDeps(input: {
  readonly store: CanonicalInventoryStore
  readonly now: () => string
  readonly crawlOptions?: CrawlOptions
}): ActivationDeps {
  return {
    store: input.store,
    crawl: createCrawlAdapter(input.crawlOptions),
    enrich: enrichCrawledPage,
    now: input.now,
  }
}
