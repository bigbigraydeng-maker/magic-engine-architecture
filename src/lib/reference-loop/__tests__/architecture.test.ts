/**
 * Reference Loop adapter 架构守卫（Issue #1041 Slice 1）
 *
 * 🔴 本模块的价值有一半是「它不做什么」：只拼装 + 保血缘 + typed 失败——
 *    不 apply、不 publish、不落库、不调 provider、不进执行队列、不发明并行
 *    Page Optimization 实现、不发明并行 Growth 契约。一旦有人在这里 import 了
 *    supabase / kernel / cms 写侧 / provider 客户端 / execution 队列，纯拼装边界
 *    就破了 —— 那种改动在 diff 里长得很无辜，所以用一道扫描把它钉死。
 *
 * 🔴 判据用「import 说明符扫描」（geo-module 同款），不用 stripComments——
 *    只看引号里的模块名，注释里提到危险符号不会误报，也不需要跟
 *    `src/lib/__tests__/strip-comments-consistency.test.ts` 那七份副本对齐。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'src/lib/reference-loop')

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const
const isSource = (p: string) => SOURCE_EXTS.some((e) => p.endsWith(e))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (isSource(full)) out.push(full)
  }
  return out
}

/** 生产文件（不含 __tests__）—— 边界只约束生产代码。 */
const productionFiles = walk(DIR).filter((f) => !f.includes('__tests__'))

/**
 * 抽出文件里所有 import/require 的**模块说明符**（引号内的目标）。
 *
 * 只看 `from '...'` / `import '...'` / `require('...')` 的引号内容；
 * 注释里提到 supabase 之类不会误报（除非注释真写了 `from '...'`）。
 * 多行 import 也覆盖 —— `from '...'` 单独占一行时同样抓得到。
 */
function importSpecifiers(src: string): string[] {
  const specs: string[] = []
  const re = /(?:\bfrom|\bimport|\brequire\s*\()\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) specs.push(m[1])
  return specs
}

const FORBIDDEN: readonly { readonly needle: string; readonly why: string }[] = [
  { needle: '@/lib/supabase', why: '本层不落库；读侧数据由调用方注入' },
  { needle: '@supabase/supabase-js', why: '不建 supabase 客户端' },
  { needle: '@/lib/kernel', why: '不碰授权内核 —— 授权只能由 Kernel 依客户政策签发' },
  { needle: '@/lib/execution', why: '不进执行队列' },
  { needle: 'execution_items', why: '不进 execution_items 看板' },
  { needle: '/capabilities/', why: '不 import provider 写侧能力（snapshot/apply）—— 快照由调用方在外部读好后传入' },
  { needle: '@/lib/cms/', why: '不认识 CMS 具体形状 —— providers 类型透过 ResolvePageInput 传入即可' },
  { needle: '@/lib/publer/', why: '不调发布通道' },
  { needle: '@/lib/gbp/', why: '不调 GBP' },
  { needle: '@/lib/gsc/', why: '不合并 measurement surface；GSC 数据的解读归 measurement 层' },
  { needle: '@/lib/ga4/', why: '不合并 measurement surface；GA4 数据的解读归 measurement 层' },
  { needle: '@/lib/geo-baseline', why: '不复测、不走真实采集/落库 store' },
  { needle: '@/lib/geo-measurement', why: '不做 measurement 计算 —— Slice 3 才谈' },
  { needle: '@/lib/flywheel', why: 'Slice 3 才谈 verification trigger 与归因，不在这一层引入' },
  { needle: 'openai', why: '不直调任何 provider（本层不生成文案）' },
  { needle: 'anthropic', why: '不直调任何 provider（本层不生成文案）' },
]

describe('reference-loop 只拼装：禁止危险 import', () => {
  it('生产目录里确实有文件（防止判据因为路径写错而空跑）', () => {
    expect(productionFiles.length).toBeGreaterThan(0)
  })

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

describe('reference-loop 门面导出面', () => {
  it('index 只导出类型 + 一个 prepare 函数，不导出变更器 / 授权器 / 执行器', async () => {
    const mod = await import('../index')
    const names = Object.keys(mod)
    // types 都是 `type` 导出，运行时不出现——所以运行时只能看到 prepareReferenceLoopChange
    expect(names).toEqual(['prepareReferenceLoopChange'])

    for (const name of names) {
      const forbiddenPrefixes = ['apply', 'publish', 'commit', 'authorize', 'approve', 'create', 'update', 'mutate', 'merge', 'upsert', 'persist', 'save', 'write', 'delete', 'run', 'execute']
      const startsWithForbidden = forbiddenPrefixes.some((p) => name.startsWith(p))
      expect(startsWithForbidden, `导出的 "${name}" 前缀落在禁止列表里`).toBe(false)
    }
  })

  it('没有 any', () => {
    const violations = productionFiles.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(readFileSync(f, 'utf8')))
    expect(violations, 'CLAUDE.md 铁律 7：TypeScript strict，无 any').toEqual([])
  })
})
