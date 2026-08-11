/**
 * GEO Baseline 接线层的架构守卫（Issue #883 / #917 · WP04A）。
 *
 * 🔴 授权边界不能只靠 code review：一旦有人在这一层抓住了 `supabaseAdmin`、
 *    把 legacy orchestrator 的 upsert 语义借进来、或者塞了一个 cron/route 入口，
 *    「注入而不是抓取」「一次性接线不是平台」这两条就破了 —— 而这种改动在 diff 里长得很无辜。
 *
 * 仿 `src/lib/geo-measurement-runtime/__tests__/architecture.test.ts` 的写法。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src/lib/geo-baseline')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')
}

const PRODUCTION_FILES = walk(DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

describe('GEO Baseline 接线层的边界', () => {
  it('目录里确实有生产文件（防止判据因路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
  })

  it('绝不自己抓 service-role 客户端 —— 数据库客户端一律注入', () => {
    // 抓着 supabaseAdmin = 进程里任何地方都能写，且租户/授权闸没法在内存里测。
    // 唯一允许 import 它的地方是 scripts/ 下那个人工触发脚本（它就是「调用方」）。
    const offenders = PRODUCTION_FILES.filter((f) => /from\s+['"]@\/lib\/supabase['"]/.test(sourceOf(f)))
    expect(offenders, `这些文件自己抓了 supabaseAdmin：\n${offenders.join('\n')}`).toEqual([])
  })

  it('不 import 执行内核 / legacy 采集器 / 飞轮 / 执行队列', () => {
    const forbidden = [
      '@/lib/kernel',
      '@/lib/execution',
      '@/lib/capabilities',
      '@/lib/flywheel',
      '@/lib/growth',
      '@/lib/zhuge',
      // 🔴 legacy runner 的问题不是「旧」，是四态塌成一态 + 身份被静默丢掉（见 provider.ts 文件头）。
      '@/lib/ai-tracker',
      '@/lib/industry-ai-visibility',
    ]
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const spec of forbidden) {
        if (new RegExp(`from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(src)) {
          violations.push(`${file} → ${spec}`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('只有传输层碰真实 SDK —— 其余文件不许 import openai', () => {
    const offenders = PRODUCTION_FILES.filter(
      (f) => !f.endsWith('transport-openai.ts') && /from\s+['"](openai|@anthropic-ai\/sdk)['"]/.test(sourceOf(f)),
    )
    expect(
      offenders,
      `真实 SDK 只能出现在 transport-openai.ts —— 否则 provider 的四态分类就没法对着假件测：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('不暴露生产入口（没有 route.ts / cron 文件）', () => {
    const files = walk(DIR).map((f) => relative(ROOT, f))
    const entrypoints = files.filter((f) => /route\.ts$|cron/i.test(f))
    expect(entrypoints, `这一层不提供 cron/API 入口：\n${entrypoints.join('\n')}`).toEqual([])
  })

  it('不自己写可比性判定 —— 没有手写的 comparable 结论字面量', () => {
    const offenders = PRODUCTION_FILES.filter((f) => {
      const src = sourceOf(f)
      return /comparable\s*:\s*true/.test(src) || /comparable\s*:\s*false/.test(src)
    })
    expect(offenders, '可比结论只能从 WP02 的 evaluateGeoComparability 出来').toEqual([])
  })

  it('不重写 WP04 的判据 —— 预算 / 计划校验一律复用，不在本层另写一份', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      // 本层不许出现自己的预算比较或计划上限常量；那些都在 WP04 的 budget.ts / plan.ts 里。
      if (/MAX_PLANNED_OBSERVATIONS|remainingUsd\s*</.test(src)) offenders.push(file)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 绝不对 geo_* 表直接 INSERT —— 唯一写入路径是原子 RPC', () => {
    // 三条独立 INSERT = 三个事务；中途失败会留下不可删除的半截证据
    // （这三张表禁 UPDATE/DELETE）。契约要求全有或全无，只有事务做得到。
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const m of Array.from(src.matchAll(/\.from\(\s*TABLE_(BATCHES|OBSERVATIONS|EVIDENCE)\s*\)([\s\S]{0,120})/g))) {
        if (/\.insert\(/.test(m[2])) offenders.push(`${file} → .from(TABLE_${m[1]}).insert(`)
      }
      if (/\.from\(\s*['"]geo_(batches|observations|evidence)['"]\s*\)[\s\S]{0,120}\.insert\(/.test(src)) {
        offenders.push(`${file} → 直接 .from('geo_*').insert(`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('store 确实调了那个原子 RPC', () => {
    const store = sourceOf('src/lib/geo-baseline/store.ts')
    expect(store).toContain("RPC_PERSIST_BATCH = 'geo_persist_batch_v1'")
    expect(store).toMatch(/\.rpc\(RPC_PERSIST_BATCH/)
  })

  it('没有 any', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('WP02 / WP03 / WP04 一个字都没被改（本 PR 只新增）', () => {
    // 判据：这一层只从那三个模块 import，从不反向依赖，也没有把它们的文件路径写进来做改写。
    const allowedGeoImports = [
      /^@\/lib\/geo-measurement$/,
      /^@\/lib\/geo-measurement-runtime$/,
      /^@\/lib\/geo-measurement-store\/types$/,
    ]
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const specs = Array.from(sourceOf(file).matchAll(/from\s+['"](@\/lib\/geo-[^'"]*)['"]/g)).map((m) => m[1])
      for (const spec of specs) {
        if (!allowedGeoImports.some((re) => re.test(spec))) offenders.push(`${file} → ${spec}`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('人工触发脚本的边界', () => {
  const SCRIPT = 'scripts/geo-baseline-run.ts'
  const src = stripComments(readFileSync(join(ROOT, SCRIPT), 'utf8'))

  it('默认 dry-run —— 不加 --live 就不跑', () => {
    expect(src).toContain("process.argv.includes('--live')")
  })

  it('脚本里没有任何客户常量（Roman 的取值属未决项，不进代码）', () => {
    expect(/romanhu|roman-hu|Ray White|Mission Bay/i.test(src)).toBe(false)
    // UUID 字面量同理 —— client_id 只能从环境变量进来。
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(src)).toBe(false)
  })

  it('没有默认 cohort 值 —— 缺环境变量就退出，不替 PM 填', () => {
    for (const key of [
      'GEO_CLIENT_ID',
      'GEO_QUERY_SET_VERSION',
      'GEO_ENGINE_FAMILY',
      'GEO_MODEL_VERSION',
      'GEO_LOCALE',
      'GEO_MARKET',
      'GEO_SAMPLE_COUNT',
      'GEO_BUDGET_USD',
      'GEO_PER_CALL_CEILING_USD',
      'GEO_PARSER_VERSION',
      'GEO_METRIC_RULES_VERSION',
    ]) {
      // `required(...)` 或 `requiredNumber(...)` 都算 —— 两者缺值都 process.exit(1)。
      // 判据是「这个 key 没有 ?? 默认值」，不是「用了哪个 helper」。
      const wired = new RegExp(`required(?:Number)?\\('${key}'`).test(src)
      expect(wired, `${key} 必须走 required()/requiredNumber()，不许有 ?? 默认值`).toBe(true)
      expect(
        new RegExp(`${key}[^\\n]*\\?\\?`).test(src),
        `${key} 不许有 ?? 默认值 —— 这一项属于 PM 冻结的 manifest`,
      ).toBe(false)
    }
  })

  it('🔴 自有域名「已核实」必须来自独立的显式信号，不许从清单非空推出来', () => {
    // 复审确认的一条真实违规：`verified: ownedDomains.length > 0` 把 R10（未决项）
    // 悄悄决了 —— 漏填一个别名，那个别名下的每条引用都会被记成「核实过，不是他的」。
    expect(src).not.toMatch(/verified:\s*\w*[Dd]omains\.length\s*>/)
    expect(src, 'verified 必须由一个独立的 attestation 环境变量驱动').toContain(
      'GEO_OWNED_DOMAINS_VERIFIED_BY',
    )
  })

  it('可选数值环境变量也必须验有限 —— Number("60s") 是 NaN，?? 拦不住', () => {
    for (const key of ['GEO_TIMEOUT_MS', 'GEO_MAX_ATTEMPTS']) {
      expect(src, `${key} 必须走 optionalNumber()（内部判 Number.isFinite）`).toMatch(
        new RegExp(`optionalNumber\\('${key}'`),
      )
      expect(
        new RegExp(`process\\.env\\.${key}\\s*\\?\\?`).test(src),
        `${key} 不许直接 process.env.X ?? 默认值 —— NaN 会漏过去`,
      ).toBe(false)
    }
  })

  it('部分覆盖不许以退出码 0 收场（退出码也是一个界面）', () => {
    expect(src).toContain('return 2')
  })

  it('没进 render.yaml（一次性脚本不是 cron）', () => {
    const renderYaml = readFileSync(join(ROOT, 'render.yaml'), 'utf8')
    expect(renderYaml).not.toContain('geo-baseline-run')
  })
})
