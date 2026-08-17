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

describe('geo-module 只推理：禁止危险 import', () => {
  for (const file of productionFiles) {
    it(`${file.replace(process.cwd() + '/', '')} 不 import 任何越界目标`, () => {
      const src = readFileSync(file, 'utf8')
      // 只看 import/require 行，避免注释里提到 supabase 触发误报。
      const importLines = src
        .split('\n')
        .filter((l) => /^\s*(import|export)\b.*from\s+['"]/.test(l) || /require\(['"]/.test(l))
        .join('\n')
      for (const { needle, why } of FORBIDDEN) {
        expect(importLines, `${file} 违反：${why}`).not.toContain(needle)
      }
    })
  }
})

describe('门面导出面稳定', () => {
  it('index 导出 runGeoModule 且不导出任何修改器 / 执行器', async () => {
    const mod = await import('../index')
    expect(typeof mod.runGeoModule).toBe('function')
    const names = Object.keys(mod)
    expect(names.some((n) => /persist|write|apply|execute|authorize|mutate/i.test(n))).toBe(false)
  })
})
