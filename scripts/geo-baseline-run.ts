/**
 * GEO 基线 —— 一次性人工触发（Issue #883 WP08 / #917 WP04A）
 *
 * 🔴 **默认 dry-run。** 不加 `--live` 就绝不调用 provider、绝不写任何一行。
 * 🔴 **代码里没有任何客户常量。** 所有 cohort 取值从环境变量进来，由 PM 冻结后提供
 *    （未决项 R5 / R10 / M3 / M6）。脚本自己不猜、不填默认。
 * 🔴 这不是 cron，不进 `render.yaml`；不是 API 路由，不暴露入口。
 *
 * 用法（dry-run，只读库、不花钱）：
 *   GEO_CLIENT_ID=... GEO_QUERY_SET_VERSION=... GEO_ENGINE_FAMILY=openai \
 *   GEO_MODEL_VERSION=... GEO_LOCALE=... GEO_MARKET=nz GEO_SAMPLE_COUNT=... \
 *   GEO_BUDGET_USD=... GEO_PER_CALL_CEILING_USD=... \
 *   GEO_PARSER_VERSION=... GEO_METRIC_RULES_VERSION=... \
 *   GEO_PRICE_INPUT_PER_M=... GEO_PRICE_OUTPUT_PER_M=... \
 *   GEO_TRIGGERED_BY=... \
 *   npx tsx --env-file=.env.local scripts/geo-baseline-run.ts
 *
 * 真跑（**需要单独授权：真实 provider 调用 + 预算 + 生产写入 + baseline execution**）：
 *   ... 同上 ... npx tsx --env-file=.env.local scripts/geo-baseline-run.ts --live
 *
 * 退出码：0 = 完整基线；1 = 跑挂了；2 = 部分覆盖（**不是一次完整基线**）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { runGeoMeasurementBatch } from '@/lib/geo-measurement-runtime'
import {
  GeoBaselineOpenAiProvider,
  GeoSupabaseStore,
  buildFrozenPlan,
  createGeoBaselineParser,
  loadFrozenQueryScope,
  openAiTransport,
  summariseBudgetHeadroom,
  TABLE_BATCHES,
  TABLE_EVIDENCE,
  TABLE_OBSERVATIONS,
  TABLE_QUERIES,
  TABLE_QUERY_SETS,
} from '@/lib/geo-baseline'
import {
  buildOwnedDomainPolicy,
  GeoConfigError,
  optionalNumber as parseOptionalNumber,
  requireNumber,
  requireString,
} from '@/lib/geo-baseline/config'
import type { GeoBaselineManifest, GeoBuiltPlan, GeoOwnedDomainPolicy } from '@/lib/geo-baseline'

const LIVE = process.argv.includes('--live')

function die(message: string): never {
  console.error(message)
  process.exit(1)
}

/** 薄壳：把纯函数的错误翻成「打印 + 退出」。判据本身在 `@/lib/geo-baseline/config`，那里能被直测。 */
function required(name: string): string {
  try {
    return requireString(name, process.env[name])
  } catch (e) {
    die(e instanceof GeoConfigError ? e.message : String(e))
  }
}

function requiredNumber(name: string, opts: { positive?: boolean } = {}): number {
  try {
    return requireNumber(name, process.env[name], opts)
  } catch (e) {
    die(e instanceof GeoConfigError ? e.message : String(e))
  }
}

function optionalNumber(name: string, fallback: number): number {
  try {
    return parseOptionalNumber(name, process.env[name], fallback)
  } catch (e) {
    die(e instanceof GeoConfigError ? e.message : String(e))
  }
}

function readManifest(): GeoBaselineManifest {
  return {
    clientId: required('GEO_CLIENT_ID'),
    engineFamily: required('GEO_ENGINE_FAMILY'),
    modelVersion: required('GEO_MODEL_VERSION'),
    locale: required('GEO_LOCALE'),
    market: required('GEO_MARKET'),
    sampleCount: requiredNumber('GEO_SAMPLE_COUNT', { positive: true }),
    parserVersion: required('GEO_PARSER_VERSION'),
    metricRulesVersion: required('GEO_METRIC_RULES_VERSION'),
    budgetUsd: requiredNumber('GEO_BUDGET_USD', { positive: true }),
    perObservationCostCeilingUsd: requiredNumber('GEO_PER_CALL_CEILING_USD', { positive: true }),
    maxAttemptsPerObservation: optionalNumber('GEO_MAX_ATTEMPTS', 1),
    triggeredBy: required('GEO_TRIGGERED_BY'),
  }
}

/** 薄壳 —— 判据（含「verified 不许从清单非空推出来」）在 `@/lib/geo-baseline/config`。 */
function readOwnedDomainPolicy(): GeoOwnedDomainPolicy {
  try {
    return buildOwnedDomainPolicy({
      domainsCsv: process.env.GEO_OWNED_DOMAINS,
      verifiedBy: process.env.GEO_OWNED_DOMAINS_VERIFIED_BY,
    })
  } catch (e) {
    die(e instanceof GeoConfigError ? e.message : String(e))
  }
}

/**
 * 五张表存在性 preflight（WP00 §2 规则 2：文件名不是 apply 证据）。
 *
 * 🔴 判据是**有没有报错**，不是**有没有读到行**。表存在但为空同样返回空数组 ——
 *    只断言「空」的话，两种情况分不开，探针等于没有。
 */
async function preflightTables(): Promise<void> {
  for (const table of [TABLE_QUERY_SETS, TABLE_QUERIES, TABLE_BATCHES, TABLE_OBSERVATIONS, TABLE_EVIDENCE]) {
    const { error } = await supabaseAdmin.from(table).select('id').limit(1)
    if (error) {
      console.error(`❌ 表 ${table} 读不到：${error.message}`)
      die('   WP03 的 migration 可能没 apply，或 PostgREST 的 schema 缓存没刷新。停。')
    }
    console.log(`   ✅ ${table}`)
  }
}

function printPlan(manifest: GeoBaselineManifest, built: GeoBuiltPlan, owned: GeoOwnedDomainPolicy): void {
  const headroom = summariseBudgetHeadroom(built)
  console.log(
    `   cohort：engine=${manifest.engineFamily} model=${manifest.modelVersion} ` +
      `locale=${manifest.locale} market=${manifest.market} sample=${manifest.sampleCount}`,
  )
  console.log(`   解释身份：parser=${manifest.parserVersion} metricRules=${manifest.metricRulesVersion}`)
  console.log(`   计划观测数：${built.plannedObservationCount}`)
  console.log(`   最坏花费：$${built.worstCaseCostUsd.toFixed(4)} / 授权额度 $${headroom.budgetUsd.toFixed(4)}`)
  console.log(`   ${headroom.note}`)
  console.log(
    `   自有域名：${owned.verified ? `已核实（${owned.verifiedDomains.join(', ')}）` : '⚠️ 未核实 ⇒ 每条引用的 ownedDomain 一律记「未知」，不是 false'}`,
  )
  console.log('   页面级引用归属：本轮不可算（R4 未裁定 / 页面台账为空）—— 绝不报 0')
}

function printResult(result: Awaited<ReturnType<typeof runGeoMeasurementBatch>>): number {
  console.log('\n' + '═'.repeat(72))
  console.log(`终态：${result.status}   批次：${result.batchId}`)
  console.log(
    `覆盖：计划 ${result.plannedCoverage.attempted} / 尝试 ${result.actualCoverage.attempted} / ` +
      `成功 ${result.actualCoverage.succeeded} / 失败 ${result.actualCoverage.failed}`,
  )
  console.log(`花费：${result.costUsd.known ? `$${result.costUsd.value.toFixed(4)}` : `未知（${result.costUsd.reason}）`}`)
  console.log(`停止原因：${result.stopReason.code} —— ${result.stopReason.detail}`)
  if (result.stopReason.observedErrorCodes.length > 0) {
    console.log(`出现过的错误码：${result.stopReason.observedErrorCodes.join(', ')}`)
  }
  if (result.status === 'completed') return 0
  console.log(
    '🔴 这不是一次完整基线。按 GEO 契约 §7.2，部分覆盖的批次不许在任何界面上被呈现成一次完整基线。',
  )
  // 🔴 退出码也是一个界面。返回 0 会让任何包装它的东西把「部分覆盖」读成「成功」。
  return 2
}

async function runLive(manifest: GeoBaselineManifest, built: GeoBuiltPlan, owned: GeoOwnedDomainPolicy): Promise<number> {
  const provider = new GeoBaselineOpenAiProvider({
    transport: openAiTransport,
    pricing: {
      inputPerMillionUsd: requiredNumber('GEO_PRICE_INPUT_PER_M', { positive: true }),
      outputPerMillionUsd: requiredNumber('GEO_PRICE_OUTPUT_PER_M', { positive: true }),
    },
    perObservationCostCeilingUsd: manifest.perObservationCostCeilingUsd,
    timeoutMs: optionalNumber('GEO_TIMEOUT_MS', 60_000),
  })
  const parse = createGeoBaselineParser({
    ownedDomains: owned,
    ownedPages: {
      computable: false,
      reason: '客户页面台账为空，且本轮是否做页面级归属尚未裁定（Roman 文档 R4 / WP00 U2）',
    },
  })
  const store = new GeoSupabaseStore({ client: supabaseAdmin, now: () => new Date().toISOString() })

  const result = await runGeoMeasurementBatch(built.plan, {
    provider,
    parse,
    store,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  })
  return printResult(result)
}

async function main(): Promise<number> {
  const manifest = readManifest()
  const owned = readOwnedDomainPolicy()

  console.log('═'.repeat(72))
  console.log(LIVE ? '🔴 LIVE —— 会真的调用 provider 并写生产库' : '🟢 DRY RUN —— 只读库，不调 provider，不写任何一行')
  console.log('═'.repeat(72))

  console.log('\n[1/4] 五张表存在性 preflight')
  await preflightTables()

  console.log('\n[2/4] 读取冻结的查询范围')
  const scope = await loadFrozenQueryScope(supabaseAdmin, {
    clientId: manifest.clientId,
    querySetVersion: required('GEO_QUERY_SET_VERSION'),
  })
  console.log(`   查询集 ${scope.querySetVersion}（${scope.querySetId}）· ${scope.queries.length} 个问题`)
  console.log(
    `   锁定状态：${scope.lockedAt.known ? `已于 ${scope.lockedAt.value} 锁定` : '未锁定（首个批次落地时由数据库自动上锁）'}`,
  )

  console.log('\n[3/4] 组装并校验冻结计划')
  const built = buildFrozenPlan(manifest, scope)
  printPlan(manifest, built, owned)

  if (!LIVE) {
    console.log('\n[4/4] DRY RUN 到此为止。没有调用任何 provider，没有写任何一行。')
    console.log('      真跑需要六条独立授权全部就位（代码实施 / 真实客户数据 / 真实 provider / 预算 / 生产写入 / baseline execution），')
    console.log('      然后加 --live 重跑。')
    return 0
  }

  console.log('\n[4/4] LIVE —— 开始跑批次')
  return runLive(manifest, built, owned)
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('\n❌ 跑挂了：', err instanceof Error ? err.message : String(err))
    if ((err as { committed?: boolean })?.committed === true) {
      console.error('\n⚠️ 批次**已经原子提交成功**，库里有完整的一批 —— 挂掉的是提交之后的只读对账。')
      console.error('   不要直接重跑（会多出一批重复观测）。先按上面的批次 id 人工核对库里的行。')
    } else {
      console.error('\n✅ 整批已回滚，库里一行都没留 —— 可以安全重跑（会自动用新的批次 id）。')
    }
    process.exit(1)
  })
