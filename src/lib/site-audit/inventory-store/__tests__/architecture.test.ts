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
    // S3：用 offenders 数组做断言，不用恒绿的 expect(true).toBe(true)。
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const lines = sourceOf(file).split('\n')
      let depth = 0
      for (const line of lines) {
        if (depth === 0 && /(^|[^.\w])createClient\s*\(/.test(line)) {
          offenders.push(`${file} 在模块顶层构造了 supabase 客户端`)
        }
        depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
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

  it('每个函数 / 类方法都 < 50 行', () => {
    // S2：顶层 `function` 与**类方法**都要盯。本模块的长逻辑全在类方法里，
    //     只匹配顶层 function 会漏掉它们（假信心）。用花括号深度扫，多行签名也能算准。
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      offenders.push(...longBodies(file))
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

/** 关键字开头的行不是函数/方法声明（排除 if/for/catch 等看着像 `name(` 的）。 */
const NON_DECL = /^(if|for|while|switch|catch|return|await|const|let|var|new|else)\b/

/** 顶层 `function` 或类方法的声明行。 */
function isDeclarationLine(line: string): boolean {
  const trimmed = line.trim()
  if (/^(export )?(async )?function /.test(line)) return true
  // 类方法：缩进 + 可选修饰符 + 名字( … 且不是控制关键字 / 调用。
  return (
    /^\s+(public |private |protected |static |async |get |set )*[A-Za-z_$][\w$]*\s*\(/.test(line) &&
    !NON_DECL.test(trimmed)
  )
}

/** 用花括号深度算出每个函数/方法体的行数，返回 ≥50 行的那些。 */
function longBodies(file: string): string[] {
  const lines = readFileSync(join(process.cwd(), file), 'utf8').split('\n')
  const offenders: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!isDeclarationLine(lines[i])) continue
    let depth = 0
    let opened = false
    for (let j = i; j < lines.length; j++) {
      depth += (lines[j].match(/{/g)?.length ?? 0) - (lines[j].match(/}/g)?.length ?? 0)
      if (lines[j].includes('{')) opened = true
      if (opened && depth <= 0) {
        const length = j - i + 1
        if (length >= 50) offenders.push(`${file}:${i + 1} → ${length} 行`)
        break
      }
    }
  }
  return offenders
}
