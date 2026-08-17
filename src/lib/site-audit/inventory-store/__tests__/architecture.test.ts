/**
 * 台账落库适配器的架构守卫（Issue #930 store adapter）。
 *
 * 契约层（canonical-inventory/）保持「无写入路径」；写能力单独放本模块，规矩也单独盯：
 *   · store 类不自己抓 supabaseAdmin（客户端注入，空库闸才能内存里测）；
 *   · 租户只从入参来 —— 没有任何客户字面量 / UUID 字面量硬编码；
 *   · 不开生产入口（没有 route / cron）；本 PR 不加 migration。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src/lib/site-audit/inventory-store')

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

const CLIENT_SPECIFIC = /romanhu|roman-hu|ray\s*white|mission\s*bay/i

describe('台账落库适配器的边界', () => {
  it('目录里确实有生产文件（防止判据空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
    expect(PRODUCTION_FILES).toContain('src/lib/site-audit/inventory-store/store.ts')
  })

  it('store 类不 import @/lib/supabase —— 客户端注入', () => {
    // store 类文件靠注入；仅 createInventoryStore 工厂在函数体内自建客户端（用 @supabase/supabase-js）。
    const offenders = PRODUCTION_FILES.filter((f) => /from\s+['"]@\/lib\/supabase['"]/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('service-role 客户端不在模块顶层构造（只在函数体内）', () => {
    // 顶层出现 createClient(...) 调用 = 模块加载即建客户端，违反 CLAUDE.md #7。
    for (const file of PRODUCTION_FILES) {
      const lines = sourceOf(file).split('\n')
      let depth = 0
      for (const line of lines) {
        const atTopLevel = depth === 0
        if (atTopLevel && /(^|[^.\w])createClient\s*\(/.test(line)) {
          throw new Error(`${file} 在模块顶层构造了 supabase 客户端`)
        }
        depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0)
      }
    }
    expect(true).toBe(true)
  })

  it('不暴露生产入口（没有 route.ts / cron 文件）', () => {
    const files = walk(DIR).map((f) => relative(ROOT, f))
    const entrypoints = files.filter((f) => /route\.ts$|cron/i.test(f))
    expect(entrypoints, entrypoints.join('\n')).toEqual([])
  })

  it('没有客户专属字样（不是「某个客户的能力」）', () => {
    const offenders = PRODUCTION_FILES.filter((f) => CLIENT_SPECIFIC.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('没有 UUID 字面量（租户只能从调用方进来）', () => {
    const offenders = PRODUCTION_FILES.filter((f) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sourceOf(f)),
    )
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('没有 any', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('本 PR 没有新增 migration', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    const offenders = migrations.filter((f) => /inventory.?store|canonical.?inventory/i.test(f))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('每个函数都 < 50 行', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
      let start = -1
      for (let i = 0; i < lines.length; i++) {
        if (start < 0 && /^(export )?(async )?function /.test(lines[i])) start = i
        else if (start >= 0 && lines[i] === '}') {
          const length = i - start + 1
          if (length >= 50) offenders.push(`${file}:${start + 1} → ${length} 行`)
          start = -1
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
