/**
 * GEO Module v1 架构守卫（Issue #879 / WP05）。
 *
 * 🔴 本模块的价值有一半是「它不做什么」：只推理，不碰页面、不落库、不授权、不 provider 调用、
 *    不进执行队列、不回写基线、不映射 ActionKey。一旦有人在这里 import 了 supabase / 执行内核 /
 *    provider 客户端 / capabilities 写侧，纯推理边界就破了 —— 那种改动在 diff 里长得很无辜，
 *    所以用一道扫描把它钉死。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'src/lib/geo-module')

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
const isSource = (p: string) => SOURCE_EXTS.some((e) => p.endsWith(e))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (isSource(full)) out.push(full)
  }
  return out
}

/** 生产文件（不含 __tests__）—— 边界只约束生产代码，测试可以 import 校验器等。 */
const productionFiles = walk(DIR).filter((f) => !f.includes('__tests__'))

/**
 * 禁止出现的 import 目标（子串匹配 import 说明符）。
 * 每一条对应一条 WP05 硬边界。
 */
const FORBIDDEN: readonly { readonly needle: string; readonly why: string }[] = [
  { needle: '@/lib/supabase', why: '纯推理模块不落库、不读写生产（读生产由调用方注入）' },
  { needle: '@supabase/supabase-js', why: '不建 supabase 客户端' },
  { needle: '@/lib/kernel', why: '不碰执行内核 / 授权' },
  { needle: 'execution', why: '不进执行队列 / execution_items' },
  { needle: '/capabilities/', why: '不 import provider 写侧能力（snapshot/apply）' },
  { needle: 'openai', why: '不直调任何 provider' },
  { needle: 'anthropic', why: '不直调任何 provider' },
  { needle: '@/lib/geo-baseline', why: '不复测、不走真实采集/落库 store' },
]

/**
 * 抽出文件里所有 import/require 的**模块说明符**（引号内的目标）。
 *
 * 🔴 直接抓 `from '...'` / `import '...'` / `require('...')` 的引号内容，**不按行过滤** ——
 *    多行 import（`import {\n a,\n b\n} from '@/lib/x'`）的 `from '...'` 在单独一行，
 *    「import 与 from 同一行」的老写法会漏扫它（Codex #1032 P2：扫不到=没有边界）。
 *    只取说明符，注释里提到 supabase 之类不会误报（除非注释真写了 `from '...'`）。
 */
function importSpecifiers(src: string): string[] {
  const specs: string[] = []
  const re = /(?:\bfrom|\bimport|\brequire\s*\()\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) specs.push(m[1])
  return specs
}

describe('geo-module 只推理：禁止危险 import', () => {
  for (const file of productionFiles) {
    it(`${file.replace(process.cwd() + '/', '')} 不 import 任何越界目标`, () => {
      const specifiers = importSpecifiers(readFileSync(file, 'utf8'))
      for (const { needle, why } of FORBIDDEN) {
        const offender = specifiers.find((s) => s.includes(needle))
        expect(offender, `${file} 违反：${why}`).toBeUndefined()
      }
    })
  }

  it('多行 import 也被扫到（守卫自身回归）', () => {
    const multiline = "import {\n  a,\n  b,\n} from '@/lib/supabase'\n"
    expect(importSpecifiers(multiline)).toContain('@/lib/supabase')
  })
})

describe('门面导出面稳定', () => {
  it('index 导出 runGeoModule 且不导出任何修改器 / 执行器', async () => {
    const mod = await import('../index')
    expect(typeof mod.runGeoModule).toBe('function')
    const names = Object.keys(mod)
    expect(names.some((n) => /persist|write|apply|execute|authorize|mutate/i.test(n))).toBe(false)
  })
})
