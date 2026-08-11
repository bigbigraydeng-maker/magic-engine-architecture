/**
 * bridge 的边界 —— 从 bridge 这一侧盯。
 *
 * `kernel/__tests__/architecture.test.ts` 从 Kernel 那一侧盯同一条线
 * （Kernel 不许 import 域模块与 bridge）。两侧各自独立：
 * 删掉任意一侧，另一侧仍然拦得住自己那半边。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { ACTION_BRIDGE_FORBIDDEN_IMPORTS } from '@/lib/kernel/boundaries'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src/lib/action-bridge')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
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

const PROD_FILES = walk(DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/'))

const codeOf = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'))

/**
 * 从一段源码里把**所有**模块说明符抠出来。
 *
 * 🔴 只认 `from '...'` 是不够的 —— 下面这三种照样把模块拉进来，却一条都不会被发现：
 *      import '@/lib/capabilities'         // 静态副作用导入
 *      await import('@/lib/execution')     // 动态导入
 *      require('@/lib/supabase')           // CommonJS
 *    一条只挡得住「规规矩矩的写法」的边界等于没有边界 —— 想绕的人正好用另外三种。
 */
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  // import ... from 'x' / export ... from 'x'（含 import type / export type）
  /\bfrom\s*['"]([^'"]+)['"]/g,
  // import 'x' —— 副作用导入。`import(` 和 `import x from` 都进不来（后面不是引号）
  /\bimport\s*['"]([^'"]+)['"]/g,
  // import('x') / await import('x') —— 动态导入
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  // require('x')
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
]

function moduleSpecifiersIn(code: string): string[] {
  const out: string[] = []
  for (const pattern of SPECIFIER_PATTERNS) {
    // 每次新建，避免共享 lastIndex 让第二次扫描从半路开始
    const re = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(code)) !== null) out.push(match[1])
  }
  return out
}

/**
 * 命中判据 = **前缀匹配**，跟原来的正则语义一致：
 * 禁止 `@/lib/growth` 时，`@/lib/growth` 与 `@/lib/growth/types` 都要命中；
 * `@/lib/cms/` 这种带斜杠的前缀规则照常生效。
 *
 * 🔴 改成字符串比较之后**不再需要转义** —— 模块名里的 `/`、`@`、`.`
 *    都只是普通字符，没有任何机会被当成正则元字符。
 */
const specMatchesModule = (spec: string, mod: string): boolean => spec.startsWith(mod)

function forbiddenImportsIn(code: string): string[] {
  const specs = moduleSpecifiersIn(code)
  return ACTION_BRIDGE_FORBIDDEN_IMPORTS.filter((mod) =>
    specs.some((spec) => specMatchesModule(spec, mod)),
  )
}

const kernelImportsIn = (code: string): string[] =>
  moduleSpecifiersIn(code).filter((spec) => spec.startsWith('@/lib/kernel'))

describe('action-bridge 是一层纯映射', () => {
  it('目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(PROD_FILES.length).toBeGreaterThan(0)
  })

  it('🔴 不 import 域模块 / 库 / provider / 执行 / legacy 生成端', () => {
    const violations: string[] = []
    for (const file of PROD_FILES) {
      for (const mod of forbiddenImportsIn(codeOf(file))) {
        violations.push(`${file} → ${mod}`)
      }
    }
    expect(
      violations,
      'bridge 只做「候选身份 → ActionKey」这一件事。\n' +
        '它能 import 到库或 provider 的那一刻，就成了第二条执行路径。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('🔴 尤其不 import Growth —— 候选身份靠结构匹配，不靠名义类型', () => {
    const offenders = PROD_FILES.filter((f) =>
      moduleSpecifiersIn(codeOf(f)).some((spec) => spec.startsWith('@/lib/growth')),
    )
    expect(
      offenders,
      'bridge 自己声明 CandidateIdentity。import 了 Growth 就等于把它焊死在第一个域模块上，\n' +
        '第二个域模块进来时要么改 bridge，要么再造一座桥。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('只从 Kernel 取类型与只读注册表（动态导入 / require 也算数）', () => {
    const kernelImports = PROD_FILES.flatMap((f) => kernelImportsIn(codeOf(f)))
    const unique = kernelImports.filter((v, i) => kernelImports.indexOf(v) === i).sort()
    // registry（拿定义 / 版本号）与 types（ActionKey 等）—— 不碰 gateway / authorize / store
    expect(unique).toEqual(['@/lib/kernel/registry', '@/lib/kernel/types'])
  })

  it('没有 any', () => {
    const offenders = PROD_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(codeOf(f)))
    expect(offenders, 'CLAUDE.md 铁律 7：TypeScript strict，无 any\n' + offenders.join('\n')).toEqual([])
  })
})

/**
 * 🔴 **盯着这道闸本身。**
 *
 * 上面那几条扫的是真实文件，而真实文件现在是干净的 —— 也就是说
 * 它们**永远绿**，绿得跟「判据整个失效了」一模一样。
 * 所以这一组用合成源码逐项证明：每一种把模块拉进来的写法都真的会被发现。
 * 这正是本轮 P2 的成因 —— 原来的判据只认 `from '...'`，另外三种全是敞开的。
 */
describe('🔴 导入扫描盖得住所有写法（合成源码）', () => {
  const FORBIDDEN_FORMS: Array<[label: string, code: string]> = [
    ['具名导入', `import { createCapabilities } from '@/lib/capabilities'`],
    ['默认导入', `import caps from '@/lib/capabilities'`],
    ['type 导入', `import type { X } from '@/lib/capabilities'`],
    ['命名空间导入', `import * as caps from '@/lib/capabilities'`],
    ['再导出', `export { createCapabilities } from '@/lib/capabilities'`],
    ['再导出全部', `export * from '@/lib/capabilities'`],
    ['静态副作用导入', `import '@/lib/capabilities'`],
    ['动态导入', `const m = await import('@/lib/execution')`],
    ['动态导入（无 await）', `void import('@/lib/execution')`],
    ['CommonJS require', `const sb = require('@/lib/supabase')`],
    ['子路径也算', `import { x } from '@/lib/capabilities/seo/build-publish-package'`],
    ['前缀规则（带斜杠的 @/lib/cms/）', `import { w } from '@/lib/cms/wordpress-client'`],
    ['引号风格不影响', `import { x } from "@/lib/supabase"`],
    ['空格风格不影响', `const m = await import (  '@/lib/execution'  )`],
  ]

  it.each(FORBIDDEN_FORMS)('%s → 必须被发现', (_label, code) => {
    expect(forbiddenImportsIn(code).length).toBeGreaterThan(0)
  })

  it('🔴 只写在注释里的示例不算违规（判据不许把自己的文档当罪证）', () => {
    const commented = [
      `// import { x } from '@/lib/capabilities'`,
      `/* const m = require('@/lib/supabase') */`,
      ` * import '@/lib/execution'`,
      `const real = 1`,
    ].join('\n')
    expect(forbiddenImportsIn(stripComments(commented))).toEqual([])
  })

  it('不在禁止清单里的模块不误报', () => {
    const clean = [
      `import { ACTION_REGISTRY } from '@/lib/kernel/registry'`,
      `import type { ActionKey } from '@/lib/kernel/types'`,
      `import { MAPPING_TABLE } from './mapping-table'`,
    ].join('\n')
    expect(forbiddenImportsIn(clean)).toEqual([])
  })

  it('🔴 Kernel 允许清单也盖得住动态导入 / require / 副作用导入', () => {
    // 这三种都能把 gateway 拉进来，而允许清单只有 types 与 registry
    expect(kernelImportsIn(`import '@/lib/kernel/gateway'`)).toEqual(['@/lib/kernel/gateway'])
    expect(kernelImportsIn(`await import('@/lib/kernel/gateway')`)).toEqual(['@/lib/kernel/gateway'])
    expect(kernelImportsIn(`require('@/lib/kernel/store')`)).toEqual(['@/lib/kernel/store'])
    // 允许的那两个照常被认出来（判据没把正常写法一起拦掉）
    expect(kernelImportsIn(`import { x } from '@/lib/kernel/types'`)).toEqual(['@/lib/kernel/types'])
  })
})
