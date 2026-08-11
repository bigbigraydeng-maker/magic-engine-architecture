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

  it('唯一依赖的 geo 契约是 WP02（@/lib/geo-measurement），没有偷偷平行另一套契约', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      const geoImports = src.match(/from\s+['"](@\/lib\/geo-measurement[^'"]*)['"]/g) ?? []
      for (const imp of geoImports) {
        // 允许 @/lib/geo-measurement 与其子路径；不允许任何别的 geo-* 契约来源。
        if (!/@\/lib\/geo-measurement(['"]|\/)/.test(imp)) offenders.push(`${file} → ${imp}`)
      }
    }
    expect(offenders).toEqual([])
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
