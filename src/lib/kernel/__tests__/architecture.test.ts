/**
 * 架构测试 —— L1 边界的执行者。
 *
 * 🔴 为什么不只靠 ESLint：`// eslint-disable-next-line` 一行就能关掉它。
 *    架构测试关不掉 —— 它跑在 `npm test` 里，白名单写在版本控制的代码里，
 *    加一条就是一次要过 review 的 diff。
 *
 * 全部是纯文件系统扫描：不需要 AST 解析器，不需要新依赖。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import {
  PROVIDER_WRITE_MODULES,
  PROVIDER_WRITE_ALLOWED_DIRS,
  PROVIDER_WRITE_GRANDFATHERED,
  EXECUTION_ITEMS_WRITERS_GRANDFATHERED,
  AUTHORIZED_CONTEXT_MINTERS,
  KERNEL_NO_SUPABASE_ADMIN_DIRS,
  MIGRATION_VERSION_COLLISIONS_GRANDFATHERED,
} from '../boundaries'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const ALL_FILES = walk(SRC).map((f) => relative(ROOT, f).split('\\').join('/'))

const isTest = (p: string) => /\.test\.tsx?$/.test(p) || p.includes('/__tests__/')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * 扫描前先把注释去掉。
 *
 * 🔴 首版没做这一步，于是**讲解这条规则的注释本身**被当成了违规
 *    （`boundaries.ts` 和 `types.ts` 里都写着「唯一的绕过是 `as unknown as …`」）。
 *    一条把自己的文档当罪证的规则，第一件事就是教人删注释。
 */
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

/**
 * 全仓 2500+ 个文件，而这个文件里有三条规则都要扫一遍。
 * 不缓存的话每条规则各读一次全仓，在并行跑测试时会直接撞 5 秒超时
 * （实测：单跑 1.4s，十个测试文件并行时 >5s）。
 */
const codeCache = new Map<string, string>()
const readCode = (p: string): string => {
  const hit = codeCache.get(p)
  if (hit !== undefined) return hit
  const code = stripComments(read(p))
  codeCache.set(p, code)
  return code
}

interface EslintConfig {
  rules: Record<string, [string, { patterns: Array<{ group: string[] }> }]>
  overrides: Array<{ files: string[]; rules: Record<string, string> }>
}
const eslintConfig = (): EslintConfig => JSON.parse(read('.eslintrc.json')) as EslintConfig

describe('L1 边界：对外写能力只能由 capability 层调用', () => {
  it('没有 capability 层之外的新 importer（历史清单只准变短）', () => {
    const allowed = new Set<string>(PROVIDER_WRITE_GRANDFATHERED)
    const violations: string[] = []

    for (const file of ALL_FILES) {
      if (isTest(file)) continue
      if (PROVIDER_WRITE_ALLOWED_DIRS.some((d) => file.startsWith(d))) continue
      // 模块自己和它同目录的内部实现不算 importer
      if (PROVIDER_WRITE_MODULES.some((m) => file === `${m.replace('@/', 'src/')}.ts`)) continue

      const src = readCode(file)
      const hit = PROVIDER_WRITE_MODULES.find((m) =>
        new RegExp(`from\\s+['"]${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(src),
      )
      if (hit && !allowed.has(file)) violations.push(`${file} → ${hit}`)
    }

    expect(
      violations,
      `这些文件绕过了执行内核直接 import 对外写能力。\n` +
        `正确做法是提交一个 action_run，让 Kernel 去执行；\n` +
        `确实要豁免就把路径加进 boundaries.ts 的 PROVIDER_WRITE_GRANDFATHERED（那是一次要过 review 的 diff）。\n` +
        violations.join('\n'),
    ).toEqual([])
  })

  it('历史清单里的路径都还在（清单不许留幽灵条目）', () => {
    const missing = PROVIDER_WRITE_GRANDFATHERED.filter((p) => !ALL_FILES.includes(p))
    expect(
      missing,
      '这些豁免路径对应的文件已经不存在了，把它们从 boundaries.ts 里删掉 —— ' +
        '留着会让清单看起来比实际更长，也会掩盖真实的收口进度。',
    ).toEqual([])
  })

  it('ESLint 的受限模块清单跟 boundaries.ts 一字不差', () => {
    const rule = eslintConfig().rules['no-restricted-imports']
    expect(rule, '.eslintrc.json 里应该有 no-restricted-imports 规则').toBeTruthy()
    const groups = rule[1].patterns.flatMap((p) => p.group).sort()
    const expected = PROVIDER_WRITE_MODULES.map((m) => `**${m.replace('@', '')}`).sort()
    expect(
      groups,
      '两处各写一份清单必然分家 —— .eslintrc.json 必须跟 boundaries.ts 保持一致',
    ).toEqual(expected)
  })

  it('🔴 ESLint 的豁免路径真的匹配得上那些文件（`[id]` 必须转义）', () => {
    // 首版直接把 `src/app/api/clients/[id]/...` 写进 files，结果 16 个本该
    // 降级为 warning 的历史文件全部报 error —— 因为 minimatch 把 `[id]`
    // 当成了字符类（匹配单个 i 或 d）。一条「看起来配好了」的豁免规则，
    // 实际一条都没生效。
    const warnOverride = eslintConfig().overrides.find(
      (o) => o.rules['no-restricted-imports'] === 'warn',
    )
    expect(warnOverride, '应该有一段把历史 importer 降级为 warning 的 overrides').toBeTruthy()

    const unescaped = warnOverride!.files.map((p) => p.replace(/\\/g, ''))
    expect(
      unescaped.sort(),
      'ESLint 的豁免路径必须跟 boundaries.ts 的历史清单完全一致',
    ).toEqual([...PROVIDER_WRITE_GRANDFATHERED].sort())

    // 逐条检查转义：Next.js 的动态路由目录名带方括号，
    // 而 ESLint 的 files 走 minimatch —— 不转义就会被当成字符类。
    const unescapedBrackets = warnOverride!.files.filter((g) => /(^|[^\\])[[\]]/.test(g))
    expect(
      unescapedBrackets,
      '这些豁免路径里的方括号没转义，minimatch 会把它当字符类 —— 规则实际不会生效。写成 \\\\[ \\\\]',
    ).toEqual([])
  })
})

describe('L1 边界：Kernel 不许自己抓 service-role 客户端', () => {
  it('kernel / capabilities 目录里没有一处 import supabaseAdmin', () => {
    const violations = ALL_FILES.filter((f) => KERNEL_NO_SUPABASE_ADMIN_DIRS.some((d) => f.startsWith(d)))
      .filter((f) => !isTest(f))
      .filter((f) => /from\s+['"]@\/lib\/supabase['"]/.test(readCode(f)))

    expect(
      violations,
      'Kernel 的数据访问一律走注入进来的客户端（见 kernel/deps.ts）。\n' +
        '自己 import supabaseAdmin 等于把「谁在什么授权下写了什么」退化成「进程里哪都能写」。\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})

describe('L2 边界：授权上下文不许在别处被造出来', () => {
  it('只有 kernel/authorize.ts 会把普通对象抬成 AuthorizedExecutionContext', () => {
    const minters = new Set<string>(AUTHORIZED_CONTEXT_MINTERS)
    const pattern = /as\s+(unknown\s+as\s+)?AuthorizedExecutionContext/

    const violations = ALL_FILES.filter((f) => !isTest(f))
      .filter((f) => !minters.has(f))
      .filter((f) => pattern.test(readCode(f)))

    expect(
      violations,
      '伪造授权上下文是一行显式写下的绕过代码。\n' +
        '（就算伪造了也过不了 Gateway 的重读比对，但它不该出现在生产代码里。）\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('Gateway 确实会从库里重读授权，而不是只信传进来的对象', () => {
    const gateway = read('src/lib/kernel/gateway.ts')
    // 这三件事缺任何一件，「伪造 ctx 也没用」这句话就不成立
    expect(gateway).toContain('getDecision(')
    expect(gateway).toContain('assertDecisionMatches')
    expect(gateway).toContain('beginAuthorizedRun(')
  })
})

describe('L1 边界：execution_items 是看板，不是执行引擎', () => {
  it('没有新的直接写入方（15 个历史生产者只准变少）', () => {
    const allowed = new Set<string>(EXECUTION_ITEMS_WRITERS_GRANDFATHERED)
    const violations: string[] = []

    for (const file of ALL_FILES) {
      if (isTest(file)) continue
      const src = readCode(file)
      let writes = false
      const re = /from\('execution_items'\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        if (/\.(insert|update|delete)\(/.test(src.slice(m.index, m.index + 300))) {
          writes = true
          break
        }
      }
      if (writes && !allowed.has(file)) violations.push(file)
    }

    expect(
      violations,
      '新代码不该直接往执行看板里写 —— 提交一个 action_run，让 Kernel 去跑。\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})

describe('migration 版本不许撞车（P1-4）', () => {
  it('supabase/migrations 里没有两个文件用同一个版本号', () => {
    // 🔴 实测踩过：本 PR 原来用 20260808000001，而并行的另一个窗口（PR #862）
    //    已经占了 000001 / 000002。两边都合进 main 之后，Supabase 的
    //    migration history 会出现重复 version —— 而这件事在**各自的分支上
    //    都看不出来**，只有合并之后才炸。
    //    所以判据必须是「扫全目录」，不是「我记得我用的是哪个号」。
    const dir = join(ROOT, 'supabase/migrations')
    const versions = new Map<string, string[]>()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue
      const version = f.slice(0, 14)
      expect(
        /^\d{14}$/.test(version),
        `migration 文件名前 14 位必须是时间戳版本号：${f}`,
      ).toBe(true)
      versions.set(version, [...(versions.get(version) ?? []), f])
    }

    const known = new Set<string>(MIGRATION_VERSION_COLLISIONS_GRANDFATHERED)
    const collisions = Array.from(versions.entries())
      .filter(([v, files]) => files.length > 1 && !known.has(v))
      .map(([v, files]) => `${v} → ${files.join(' / ')}`)

    expect(
      collisions,
      '这些 migration 用了同一个版本号。并行开发时各自分支都看不出来，' +
        '合并后 Supabase 的 migration 账本会出现重复 version。\n' +
        '把后来的那个改成一个更晚且唯一的版本号（不要往豁免清单里加）。\n' +
        collisions.join('\n'),
    ).toEqual([])
  })

  it('历史重复清单里的版本号现在确实还在重复（清单不许留幽灵条目）', () => {
    const dir = join(ROOT, 'supabase/migrations')
    const count = new Map<string, number>()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue
      const v = f.slice(0, 14)
      count.set(v, (count.get(v) ?? 0) + 1)
    }
    const resolved = MIGRATION_VERSION_COLLISIONS_GRANDFATHERED.filter(
      (v) => (count.get(v) ?? 0) <= 1,
    )
    expect(
      resolved,
      '这些历史撞车已经被解决了，把它们从 boundaries.ts 的清单里删掉 —— ' +
        '留着会让欠账看起来比实际更多。',
    ).toEqual([])
  })
})

describe('lineage 视图的权限（C1）', () => {
  const MIGRATION = 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql'

  it('🔴 视图必须声明 security_invoker —— 否则按 owner 权限读底表，anon 可能借道越过 RLS', () => {
    const sql = read(MIGRATION)
    const viewStmt = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.kernel_action_lineage'))
    const header = viewStmt.slice(0, viewStmt.indexOf(' AS'))
    expect(
      /WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i.test(header),
      'kernel_action_lineage 的 CREATE VIEW 头部必须带 WITH (security_invoker = true)。\n' +
        '没有它，视图以 owner 权限读 goals / authorization_decisions / step output —— \n' +
        'anon/authenticated 经 Data API 查视图就能把跨客户数据一锅端走。',
    ).toBe(true)
  })

  it('🔴 anon / authenticated 必须被显式 REVOKE，service_role 显式 GRANT —— 不赌底表 RLS 恰好都配对', () => {
    const sql = read(MIGRATION)
    expect(
      /REVOKE\s+ALL\s+ON\s+public\.kernel_action_lineage\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i.test(sql),
      '迁移里必须有 REVOKE ALL ON public.kernel_action_lineage FROM PUBLIC, anon, authenticated',
    ).toBe(true)
    expect(
      /GRANT\s+SELECT\s+ON\s+public\.kernel_action_lineage\s+TO\s+service_role/i.test(sql),
      '迁移里必须有 GRANT SELECT ON public.kernel_action_lineage TO service_role',
    ).toBe(true)
  })

  it('两个 RPC 的 EXECUTE 也都收了口（同一类漏洞，一起盯）', () => {
    const sql = read(MIGRATION)
    for (const fn of [
      'kernel_claim_run_step',
      'kernel_begin_authorized_run',
      'kernel_resolve_pending_approval',
      'kernel_claim_run_recovery',
    ]) {
      expect(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}[^;]*FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ).test(sql),
        `${fn} 的 EXECUTE 必须显式 REVOKE（anon key 在浏览器 bundle 里）`,
      ).toBe(true)
    }
  })

  it('RPC 的政策时间窗跟应用层同一个口径（C5：不许退回 IS NULL-only）', () => {
    const sql = read(MIGRATION)
    // 政策查询必须是「from<=now 且 (to IS NULL 或 to>now)」——
    // 用 effective_to IS NULL 当过滤条件会把带结束时间但没到期的政策当成不存在
    const windows = sql.match(
      /effective_from\s*<=\s*now\(\)\s+AND\s+\(p\.effective_to\s+IS\s+NULL\s+OR\s+p\.effective_to\s*>\s*now\(\)\)/gi,
    )
    expect(
      (windows ?? []).length >= 2,
      '两个会查政策的 RPC（begin / resolve_pending_approval）的时间窗必须都在，且跟 store.isPolicyActive 完全一致',
    ).toBe(true)
  })
})

describe('两处清单不许分家（S1 / S2）', () => {
  const MIGRATION_SQL = 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql'

  it('🔴 可恢复拒绝码：SQL 里的白名单跟 runner.ts 的 RECOVERABLE_DENY_CODES 一字不差', async () => {
    // 真正的强制在 RPC 里（应用层那份只是为了把话说人话）。
    // 两处各写一份清单必然分家 —— 分家的那天，应用层说「不能恢复」而数据库放行，
    // 或者反过来。这条测试是唯一能让它们保持同步的东西。
    const { RECOVERABLE_DENY_CODES } = await import('../runner')
    const sql = read(MIGRATION_SQL)
    const m = sql.match(/v_recoverable\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/)
    expect(m, 'kernel_claim_run_recovery 里应该有 v_recoverable 白名单').toBeTruthy()
    const fromSql = Array.from(m![1].matchAll(/'([^']+)'/g)).map((x) => x[1]).sort()
    expect(fromSql).toEqual(Array.from(RECOVERABLE_DENY_CODES).sort())
  })

  it('🔴 恢复 RPC 里有状态 CAS 和指针 CAS 两道，且步骤重置在同一个函数里', () => {
    const sql = read(MIGRATION_SQL)
    const fn = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.kernel_claim_run_recovery'),
      sql.indexOf('REVOKE EXECUTE ON FUNCTION public.kernel_claim_run_recovery'),
    )
    expect(fn).toContain('FOR UPDATE')
    // 状态 CAS
    expect(fn).toMatch(/v_run\.status\s*<>\s*p_recovery_kind/)
    // 指针 CAS
    expect(fn).toMatch(/v_run\.authorization_decision_id\s+IS\s+DISTINCT\s+FROM\s+p_expected_decision_id/i)
    // 🔴 步骤重置必须在同一个函数（= 同一个事务）里，不能先 reset 再 update run
    expect(fn).toMatch(/UPDATE\s+public\.action_run_steps/i)
    expect(fn).toMatch(/status\s*<>\s*'succeeded'/)
    // 🔴 而且绝不能碰 cost_actual_usd —— 历史已花的钱不许因为重跑变小
    //
    // 切法：从这条语句自己开头切到**它自己的分号**。
    // 早先是切到「下一条 UPDATE public.action_runs」为止 —— 那依赖两条语句的
    // 书写先后：谁被挪到前面，这里就切出一个空串，而 `expect('').not.toContain(…)`
    // 恒真，这道断言等于静默失效（fail-open）。下面那句 SET 哨兵就是防这个的。
    const startIdx = fn.indexOf('UPDATE public.action_run_steps')
    expect(startIdx, '恢复 RPC 里应该有一条重置步骤的 UPDATE').toBeGreaterThan(-1)
    const endIdx = fn.indexOf(';', startIdx)
    expect(endIdx, '那条 UPDATE 应该以分号收尾').toBeGreaterThan(startIdx)
    const resetStmt = fn.slice(startIdx, endIdx)
    expect(resetStmt, '切出来的必须真是那条语句，不能是空串').toContain('SET status')
    expect(resetStmt).not.toContain('cost_actual_usd')
  })

  it('🔴 execution_item 的复合外键和前置唯一索引都在（S2 的库层那道）', () => {
    const sql = read(MIGRATION_SQL)
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_items_client_id_id')
    expect(
      /FOREIGN KEY \(client_id, execution_item_id\)[\s\S]{0,80}?REFERENCES public\.execution_items \(client_id, id\)/.test(
        sql,
      ),
      'action_runs 必须有 (client_id, execution_item_id) → execution_items(client_id, id) 的复合外键',
    ).toBe(true)
  })

  it('🔴 两条复合外键的删除语义各自钉死，且各只有一条外键', () => {
    const sql = read(MIGRATION_SQL)
    const runs = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.action_runs'),
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.action_run_steps'),
    )
    expect(runs, 'action_runs 建表语句应该切得出来').toContain('goal_matches_purpose')

    // 卡片：删得掉，台账留下 → SET NULL，且**必须带列清单**
    // （不带列清单会去置空 NOT NULL 的 client_id，整条 DELETE 当场炸）
    expect(runs).toMatch(
      /FOREIGN KEY \(client_id, execution_item_id\)[\s\S]{0,120}?ON DELETE SET NULL \(execution_item_id\)/,
    )
    // 目标：有台账就删不掉 → 刻意不写 ON DELETE（= NO ACTION）
    const goalFk = runs.slice(
      runs.indexOf('CONSTRAINT fk_action_runs_goal_same_client'),
      runs.indexOf('CONSTRAINT fk_action_runs_execution_item_same_client'),
    )
    expect(goalFk, 'goal 的复合外键应该切得出来').toContain('REFERENCES public.goals')
    expect(goalFk).not.toContain('ON DELETE')

    // 🔴 每列**只能有一条**外键。两条并存时，删除走哪条要看约束 OID
    // （= 建表里的书写顺序），等于把「删得掉删不掉」押在书写次序上。
    expect(runs.match(/REFERENCES public\.goals/g) ?? []).toHaveLength(1)
    expect(runs.match(/REFERENCES public\.execution_items/g) ?? []).toHaveLength(1)
  })
})

describe('注册表的封闭性', () => {
  it('capability 的实现集合跟注册表的动作集合完全对齐', async () => {
    const { ACTION_KEYS } = await import('../registry')
    const { createCapabilities } = await import('@/lib/capabilities')
    const impls = Object.keys(createCapabilities({} as never))
    expect(
      impls.sort(),
      '注册表里有、实现里没有 = 提交了会死信；实现里有、注册表里没有 = 一条永远调不到的路。',
    ).toEqual([...ACTION_KEYS].sort())
  })

  it('每个动作定义都把幂等 / 重试 / 副作用 / 风险说清楚了', async () => {
    const { ACTION_REGISTRY, ACTION_KEYS } = await import('../registry')
    for (const key of ACTION_KEYS) {
      const def = ACTION_REGISTRY.get(key)!
      expect(def.idempotency.keyFields.length, `${key} 必须声明幂等键字段`).toBeGreaterThan(0)
      expect(def.retryPolicy.maxAttempts, `${key} 必须声明重试上限`).toBeGreaterThan(0)
      expect(def.steps.length, `${key} 必须至少有一个步骤`).toBeGreaterThan(0)
      // v1 的交付边界：注册表里不许出现任何对外副作用的动作
      expect(def.sideEffect, `${key}：v1 不接受对外副作用的动作`).not.toBe('outward')
      // 幂等键字段必须真的在输入契约里，否则提交时算不出来
      for (const f of def.idempotency.keyFields) {
        expect(
          Object.keys(def.inputSchema.properties),
          `${key} 的幂等键字段「${f}」必须出现在 input_schema 里`,
        ).toContain(f)
      }
    }
  })
})
