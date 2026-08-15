/**
 * Magic Engine Commerce · Product Intelligence POC —— 一次性人工触发。
 *
 * 链路：TikTok Shop US 爆品（需求已验证）→ 以图搜款找中国工厂（供货）
 *      → 澳新 Google 搜索量 + 趋势（需求外溢）→ 四道闸 → 可解释候选。
 *
 * 🔴 **默认 dry-run。** 不加 `--live` 就只打印计划和预估花费，一个 API 都不调。
 * 🔴 这不是 cron，不进 render.yaml；不是 API 路由，不暴露入口；不写任何一行数据。
 *
 * 用法（dry-run，不花钱）：
 *   npx tsx --env-file=.env.local scripts/commerce-poc.ts --keyword="portable blender"
 *
 * 真跑（**会花钱**，约 US$0.2–0.4/次）：
 *   npx tsx --env-file=.env.local scripts/commerce-poc.ts --keyword="portable blender" --live
 *
 * 回放已抓好的样本（**不调 Apify，只调澳新那两个数据源**，用于没有 APIFY_API_KEY
 * 的机器上验证归一化与判定逻辑）：
 *   npx tsx --env-file=.env.local scripts/commerce-poc.ts --from-file=<path>.json --live
 *
 * 可选：--max=20（TikTok 取几条）· --enrich=5（其中几条做供货+澳新验证）· --json
 */

import { readFileSync } from 'node:fs'
import { searchTikTokShop } from '../src/lib/apify/tiktok-shop'
import type { RawTikTokShopProduct } from '../src/lib/apify/tiktok-shop'
import type { RawSourcingMatch } from '../src/lib/apify/sourcing-by-image'
import { findSourcingByImage } from '../src/lib/apify/sourcing-by-image'
import {
  normalizeSourcing,
  normalizeTikTokProduct,
  withSourcing,
} from '../src/lib/commerce/product-intel/normalize'
import { measureAuNzDemand } from '../src/lib/commerce/product-intel/validate-aunz'
import { rankCandidates } from '../src/lib/commerce/product-intel/score'
import type {
  ProductCandidate,
  ScoredCandidate,
} from '../src/lib/commerce/product-intel/types'

/** 单价来自 2026-08-15 实测的 actor 定价表（BRONZE 档）。 */
const COST_PER_TIKTOK_ROW_USD = 0.0045
const COST_PER_IMAGE_SEARCH_USD = 0.006

interface Options {
  keyword: string
  max: number
  enrich: number
  live: boolean
  json: boolean
  fromFile: string | null
}

/** 已抓好的样本文件结构 —— 字段与 actor 原始输出一致，归一化路径完全相同。 */
interface ReplayFixture {
  seedKeyword: string
  tiktok: { runId: string | null; products: RawTikTokShopProduct[] }
  sourcing: Record<string, { runId: string | null; matches: RawSourcingMatch[] }>
}

function parseArgs(argv: readonly string[]): Options {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const num = (name: string, fallback: number): number => {
    const parsed = Number.parseInt(get(name) ?? '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return {
    keyword: get('keyword') ?? '',
    max: num('max', 20),
    enrich: num('enrich', 5),
    live: argv.includes('--live'),
    json: argv.includes('--json'),
    fromFile: get('from-file') ?? null,
  }
}

/**
 * 回放模式：raw 从文件来，走**同一条**归一化路径，澳新那一段照常真调。
 * 供货证据只对文件里有的商品挂上 —— 缺的那些毛利闸会判 UNKNOWN，这是对的。
 */
async function runFromFile(path: string, enrich: number): Promise<{
  seedKeyword: string
  candidates: readonly ProductCandidate[]
}> {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as ReplayFixture
  const collectedAt = new Date().toISOString()
  const all = fixture.tiktok.products.map(
    (p) => normalizeTikTokProduct(p, fixture.tiktok.runId, collectedAt),
  )
  console.log(`   从文件读到 ${all.length} 条（种子词「${fixture.seedKeyword}」）`)

  const shortlist = [...all]
    .sort((a, b) => (b.cumulativeSold.value ?? 0) - (a.cumulativeSold.value ?? 0))
    .slice(0, enrich)
  const demand = await measureAuNzDemand(fixture.seedKeyword)

  const candidates = shortlist.map((candidate) => {
    const raw = fixture.sourcing[candidate.source.sourceProductId]
    if (!raw) return { ...candidate, demand }
    const evidence = normalizeSourcing(raw.matches, raw.runId, collectedAt)
    return { ...withSourcing(candidate, evidence), demand }
  })
  return { seedKeyword: fixture.seedKeyword, candidates }
}

function estimateCostUsd(opts: Options): number {
  return opts.max * COST_PER_TIKTOK_ROW_USD + opts.enrich * COST_PER_IMAGE_SEARCH_USD
}

/** 对 shortlist 补供货证据 + 澳新需求。澳新是品类级，整批共用一次查询。 */
async function enrichCandidates(
  shortlist: readonly ProductCandidate[],
  seedKeyword: string,
): Promise<readonly ProductCandidate[]> {
  const demand = await measureAuNzDemand(seedKeyword)
  const enriched = await Promise.all(
    shortlist.map(async (candidate) => {
      if (!candidate.imageUrl) return { ...candidate, demand }
      const sourcing = await findSourcingByImage(candidate.imageUrl)
      if (sourcing.error) {
        console.warn(`  ⚠️ 以图搜款失败（${candidate.source.sourceProductId}）：${sourcing.error}`)
        return { ...candidate, demand }
      }
      const evidence = normalizeSourcing(
        sourcing.matches, sourcing.runId, new Date().toISOString(),
      )
      return { ...withSourcing(candidate, evidence), demand }
    }),
  )
  return enriched
}

const VERDICT_LABEL: Record<string, string> = {
  TEST_NOW: '✅ 值得测',
  WATCH: '👀 观察',
  REJECT: '❌ 排除',
  UNKNOWN: '❓ 判不了',
}

function printCandidate(scored: ScoredCandidate, index: number): void {
  const c = scored.candidate
  const price = c.retailPriceUsd.value
  const sold = c.cumulativeSold.value
  console.log(`\n${index + 1}. ${VERDICT_LABEL[scored.verdict]}  ${c.title.slice(0, 70)}`)
  console.log(`   美国售价 ${price === null ? '—' : `US$${price.toFixed(2)}`}`
    + `   累计已售 ${sold === null ? '—' : sold.toLocaleString()}`)
  console.log(`   ${c.source.sourceUrl}`)
  for (const gate of scored.gates) {
    const mark = gate.outcome === 'PASS' ? '✓' : gate.outcome === 'FAIL' ? '✗' : '?'
    console.log(`   ${mark} ${gate.reason}`)
  }
  if (c.sourcing?.topSuppliers.length) {
    console.log(`   供应商：${c.sourcing.topSuppliers.slice(0, 3).join(' · ')}`)
  }
}

/** 回放模式的主流程。抽出来是为了让 main 保持一屏内可读。 */
async function mainFromFile(opts: Options): Promise<void> {
  console.log(`回放样本    ${opts.fromFile}`)
  console.log(`不调 Apify（只真调澳新搜索量与趋势）`)
  if (!opts.live) {
    console.log('\n[dry-run] 没加 --live，到此为止。')
    return
  }
  console.log('\n① 读样本…')
  const { seedKeyword, candidates } = await runFromFile(opts.fromFile!, opts.enrich)
  const ranked = rankCandidates(candidates)
  if (opts.json) {
    console.log(JSON.stringify(ranked, null, 2))
    return
  }
  console.log(`\n② 结果（按证据强度排，不是按预测销量）`)
  console.log(`   ⚠️ 澳新需求是「${seedKeyword}」这个品类词的量，不是单品的量。`)
  ranked.forEach(printCandidate)
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.fromFile) return mainFromFile(opts)

  if (!opts.keyword) {
    console.error('缺 --keyword="…"。例：--keyword="portable blender"')
    process.exit(1)
  }

  console.log(`关键词      ${opts.keyword}`)
  console.log(`TikTok 取   ${opts.max} 条 → 其中前 ${opts.enrich} 条做供货+澳新验证`)
  console.log(`预估花费    约 US$${estimateCostUsd(opts).toFixed(3)}`)

  if (!opts.live) {
    console.log('\n[dry-run] 没加 --live，到此为止，一个 API 都没调。')
    return
  }

  console.log('\n① 搜 TikTok Shop US…')
  const search = await searchTikTokShop({
    keywords: [opts.keyword], region: 'US', maxResultsPerKeyword: opts.max,
  })
  if (search.error) {
    console.error(`搜索失败：${search.error}`)
    process.exit(1)
  }
  const collectedAt = new Date().toISOString()
  const all = search.products.map((p) => normalizeTikTokProduct(p, search.runId, collectedAt))
  console.log(`   拿到 ${all.length} 条`)

  const shortlist = [...all]
    .sort((a, b) => (b.cumulativeSold.value ?? 0) - (a.cumulativeSold.value ?? 0))
    .slice(0, opts.enrich)
  console.log(`\n② 对销量前 ${shortlist.length} 条做以图搜款 + 澳新需求验证…`)
  const enriched = await enrichCandidates(shortlist, opts.keyword)

  const ranked = rankCandidates(enriched)
  if (opts.json) {
    console.log(JSON.stringify(ranked, null, 2))
    return
  }
  console.log(`\n③ 结果（按证据强度排，不是按预测销量）`)
  console.log(`   ⚠️ 澳新需求是「${opts.keyword}」这个品类词的量，不是单品的量。`)
  ranked.forEach(printCandidate)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
