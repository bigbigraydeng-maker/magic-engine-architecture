/**
 * WP04 运行时的架构守卫（Issue #874 / WP04）。
 *
 * 🔴 授权硬禁止的边界不能只靠 code review：一旦有人在这一层 import 了真实 provider、
 *    supabase、Kernel / 执行内核，或者自己手写了一份可比性判定，「不接生产 / 不自造
 *    comparability」这两条就破了 —— 而这种改动在 diff 里长得很无辜。判据写在这里。
 *
 * 仿 `src/lib/geo-measurement/__tests__/architecture.test.ts` 的写法。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const RUNTIME_DIR = join(ROOT, 'src/lib/geo-measurement-runtime')

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

/** 生产文件 = runtime 目录下除测试以外的 .ts。fake-* 是生产内的测试替身，一并受约束。 */
const PRODUCTION_FILES = walk(RUNTIME_DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

describe('GEO Measurement Runtime 不接生产、不自造可比性', () => {
  it('目录里确实有生产文件（防止判据因路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
  })

  it('不 import 执行内核 / Kernel / 数据库 / 真实 provider 通道', () => {
    const forbidden = [
      '@/lib/kernel',
      '@/lib/zhuge',
      '@/lib/execution',
      '@/lib/capabilities',
      '@/lib/flywheel',
      '@/lib/supabase',
      '@supabase/supabase-js',
      '@/lib/growth',
      '@/lib/ai-tracker',
      '@/lib/industry-ai-visibility',
      '@/lib/ai/',
      '@/lib/publer',
      '@/lib/gbp',
      '@/lib/gsc',
      '@/lib/cms',
      'openai',
      '@anthropic-ai/sdk',
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
    expect(violations, `WP04 运行时只对着注入的假件跑，绝不接真实 provider / 生产库 / 执行内核。\n${violations.join('\n')}`).toEqual([])
  })

  it('geo 依赖只有 WP02 契约与 WP03 行形状，没有偷偷平行另一套契约', () => {
    // 🔴 允许清单只有两个：
    //    · `@/lib/geo-measurement`             —— WP02 契约（纯类型 + 纯函数）
    //    · `@/lib/geo-measurement-store/types` —— WP03 行形状（纯类型，**没有** supabase 客户端）
    //    WP03 的行类型是刻意复用的：不复用就等于在 WP04 里手写第二套列名，
    //    哪天库里改了列，编译器一声不吭。允许它进来的前提是它确实只有类型。
    const ALLOWED = [/^@\/lib\/geo-measurement$/, /^@\/lib\/geo-measurement\//, /^@\/lib\/geo-measurement-store\/types$/]
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      const geoImports = Array.from(src.matchAll(/from\s+['"](@\/lib\/geo-[^'"]*)['"]/g)).map((m) => m[1])
      for (const spec of geoImports) {
        if (!ALLOWED.some((re) => re.test(spec))) offenders.push(`${file} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('WP03 store 只借行形状，不借（也没有）数据库客户端', () => {
    const storeTypes = readFileSync(join(ROOT, 'src/lib/geo-measurement-store/types.ts'), 'utf8')
    // 这条守的是「借类型」这个前提本身：哪天 WP03 的 types.ts 长出一个 supabase 客户端，
    // WP04 这一层就等于间接接上了生产库 —— 那必须当场红，而不是等 code review 发现。
    expect(/from\s+['"]@supabase\/supabase-js['"]/.test(storeTypes)).toBe(false)
    expect(/from\s+['"]@\/lib\/supabase['"]/.test(storeTypes)).toBe(false)
  })

  it('WP04 自己不写可比性判定 —— 没有手写的 comparable 结论字面量', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      if (/comparable\s*:\s*true/.test(src) || /comparable\s*:\s*false/.test(src)) {
        offenders.push(file)
      }
    }
    expect(
      offenders,
      '可比结论只能从 WP02 的 evaluateGeoComparability 出来；WP04 里出现手写的 { comparable: ... } 就是自造了一份判定。',
    ).toEqual([])
  })

  it('没有引入生产入口（route.ts / cron / render 调度）到本目录', () => {
    const files = walk(RUNTIME_DIR).map((f) => relative(ROOT, f))
    const entrypoints = files.filter((f) => /route\.ts$|cron/i.test(f))
    expect(entrypoints, `WP04 不暴露生产 cron/API 入口：\n${entrypoints.join('\n')}`).toEqual([])
  })
})
