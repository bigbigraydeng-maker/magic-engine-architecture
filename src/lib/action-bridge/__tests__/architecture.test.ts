/**
 * bridge 的边界 —— 从 bridge 这一侧盯。
 *
 * `kernel/__tests__/architecture.test.ts` 从 Kernel 那一侧盯同一条线
 * （Kernel 不许 import 域模块与 bridge）。两侧各自独立：
 * 删掉任意一侧，另一侧仍然拦得住自己那半边。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, posix } from 'path'
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
 * 把说明符规范成**跟禁止清单同一套写法**（无点段的 `@/...`）。
 *
 * 🔴 只处理 `./` `../` 是不够的。仓库的 tsconfig 是
 *    `baseUrl: "."` + `paths: { "@/*": ["./src/*"] }`，所以下面这些
 *    **合法的 TypeScript 导入**都会解析到仓库内真实模块，却一条都不命中：
 *      import 'src/lib/capabilities'                  // baseUrl 项目路径
 *      require('src/lib/supabase')
 *      import '@/lib/kernel/../growth/types'          // alias 里带点段
 *      await import('@/lib/action-bridge/../execution')
 *    所以四类说明符都要折算到同一口径，点段一律消除。
 *
 * 🔴 `@/` 是本仓 alias，`@supabase/supabase-js` 这类 scoped npm 包**不是** ——
 *    判据必须是 `@/` 而不是 `@`，否则会把 npm 包名改写掉。
 */
function toAliasPath(repoRelative: string): string {
  return repoRelative.startsWith('src/') ? `@/${repoRelative.slice('src/'.length)}` : repoRelative
}

function canonicalSpecifier(sourcePath: string, spec: string): string {
  const slashed = spec.split('\\').join('/')

  // ① 相对说明符：按**当前被扫描的那个源文件**的目录解析
  if (slashed.startsWith('.')) {
    const dir = posix.dirname(sourcePath.split('\\').join('/'))
    return toAliasPath(posix.normalize(posix.join(dir, slashed)))
  }

  // ② 本仓 alias（只有 `@/`），点段在这里被消除
  if (slashed.startsWith('@/')) {
    return toAliasPath(posix.normalize(`src/${slashed.slice('@/'.length)}`))
  }

  // ③ baseUrl 项目路径（`src/...`）
  if (slashed === 'src' || slashed.startsWith('src/')) {
    return toAliasPath(posix.normalize(slashed))
  }

  // ④ npm 包名（含 scoped）原样保留
  return spec
}

/** 一个源文件里所有 import 指向的模块，已规范成 `@/...` 口径。 */
const importedModules = (sourcePath: string, code: string): string[] =>
  moduleSpecifiersIn(code).map((spec) => canonicalSpecifier(sourcePath, spec))

/**
 * 命中判据 = **前缀匹配**，跟原来的正则语义一致：
 * 禁止 `@/lib/growth` 时，`@/lib/growth` 与 `@/lib/growth/types` 都要命中；
 * `@/lib/cms/` 这种带斜杠的前缀规则照常生效。
 *
 * 🔴 改成字符串比较之后**不再需要转义** —— 模块名里的 `/`、`@`、`.`
 *    都只是普通字符，没有任何机会被当成正则元字符。
 */
const specMatchesModule = (spec: string, mod: string): boolean => spec.startsWith(mod)

function forbiddenImportsIn(sourcePath: string, code: string): string[] {
  const specs = importedModules(sourcePath, code)
  return ACTION_BRIDGE_FORBIDDEN_IMPORTS.filter((mod) =>
    specs.some((spec) => specMatchesModule(spec, mod)),
  )
}

const kernelImportsIn = (sourcePath: string, code: string): string[] =>
  importedModules(sourcePath, code).filter((spec) => spec.startsWith('@/lib/kernel'))

describe('action-bridge 是一层纯映射', () => {
  it('目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(PROD_FILES.length).toBeGreaterThan(0)
  })

  it('🔴 不 import 域模块 / 库 / provider / 执行 / legacy 生成端', () => {
    const violations: string[] = []
    for (const file of PROD_FILES) {
      for (const mod of forbiddenImportsIn(file, codeOf(file))) {
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
      importedModules(f, codeOf(f)).some((spec) => spec.startsWith('@/lib/growth')),
    )
    expect(
      offenders,
      'bridge 自己声明 CandidateIdentity。import 了 Growth 就等于把它焊死在第一个域模块上，\n' +
        '第二个域模块进来时要么改 bridge，要么再造一座桥。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('只从 Kernel 取类型与只读注册表（动态导入 / require / 相对路径也算数）', () => {
    const kernelImports = PROD_FILES.flatMap((f) => kernelImportsIn(f, codeOf(f)))
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

  /** 合成用例的虚拟源文件 —— 相对说明符要按它的位置解析。 */
  const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'

  it.each(FORBIDDEN_FORMS)('%s → 必须被发现', (_label, code) => {
    expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
  })

  it('🔴 只写在注释里的示例不算违规（判据不许把自己的文档当罪证）', () => {
    const commented = [
      `// import { x } from '@/lib/capabilities'`,
      `/* const m = require('@/lib/supabase') */`,
      ` * import '@/lib/execution'`,
      `const real = 1`,
    ].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, stripComments(commented))).toEqual([])
  })

  it('不在禁止清单里的模块不误报', () => {
    const clean = [
      `import { ACTION_REGISTRY } from '@/lib/kernel/registry'`,
      `import type { ActionKey } from '@/lib/kernel/types'`,
      `import { MAPPING_TABLE } from './mapping-table'`,
      `import type { X } from './types'`,
    ].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, clean)).toEqual([])
  })

  it('🔴 Kernel 允许清单也盖得住动态导入 / require / 副作用导入', () => {
    // 这三种都能把 gateway 拉进来，而允许清单只有 types 与 registry
    expect(kernelImportsIn(BRIDGE_FILE, `import '@/lib/kernel/gateway'`)).toEqual([
      '@/lib/kernel/gateway',
    ])
    expect(kernelImportsIn(BRIDGE_FILE, `await import('@/lib/kernel/gateway')`)).toEqual([
      '@/lib/kernel/gateway',
    ])
    expect(kernelImportsIn(BRIDGE_FILE, `require('@/lib/kernel/store')`)).toEqual([
      '@/lib/kernel/store',
    ])
    // 允许的那两个照常被认出来（判据没把正常写法一起拦掉）
    expect(kernelImportsIn(BRIDGE_FILE, `import { x } from '@/lib/kernel/types'`)).toEqual([
      '@/lib/kernel/types',
    ])
  })
})

/**
 * 🔴 **相对路径同样要按源文件位置解析。**
 *
 * 上一轮把四种 import 写法都盖住了，但只拿**原始说明符**去比 `@/lib/...` ——
 * 于是 `import '../capabilities'` 指向同一个模块却一条都不命中。
 * 禁止清单用的是 alias 口径，说明符就必须先规范到同一口径再比。
 */
describe('🔴 相对路径导入按源文件位置解析（合成源码）', () => {
  const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'
  const NESTED_FILE = 'src/lib/action-bridge/nested/deep.ts'

  it('规范化本身：相对说明符折算成 alias', () => {
    expect(canonicalSpecifier(BRIDGE_FILE, '../capabilities')).toBe('@/lib/capabilities')
    expect(canonicalSpecifier(BRIDGE_FILE, '../kernel/types')).toBe('@/lib/kernel/types')
    expect(canonicalSpecifier(BRIDGE_FILE, './mapping-table')).toBe(
      '@/lib/action-bridge/mapping-table',
    )
    expect(canonicalSpecifier(NESTED_FILE, '../../supabase')).toBe('@/lib/supabase')
    // alias 与 npm 包名原样保留
    expect(canonicalSpecifier(BRIDGE_FILE, '@/lib/capabilities')).toBe('@/lib/capabilities')
    expect(canonicalSpecifier(BRIDGE_FILE, '@supabase/supabase-js')).toBe('@supabase/supabase-js')
    expect(canonicalSpecifier(BRIDGE_FILE, 'vitest')).toBe('vitest')
  })

  const RELATIVE_FORMS: Array<[label: string, code: string]> = [
    ['../capabilities（副作用导入）', `import '../capabilities'`],
    ['../capabilities（具名导入）', `import { createCapabilities } from '../capabilities'`],
    ['../execution（动态导入）', `const m = await import('../execution')`],
    ['../supabase（require）', `const sb = require('../supabase')`],
    ['../cms/wordpress-client（带斜杠前缀规则）', `import { w } from '../cms/wordpress-client'`],
    ['../growth（域模块）', `import type { T } from '../growth/types'`],
  ]

  it.each(RELATIVE_FORMS)('bridge 里的 %s → 必须被拒', (_label, code) => {
    expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
  })

  it('🔴 `../kernel/gateway` 会被 Kernel 允许清单拒掉', () => {
    expect(kernelImportsIn(BRIDGE_FILE, `import '../kernel/gateway'`)).toEqual([
      '@/lib/kernel/gateway',
    ])
    expect(kernelImportsIn(BRIDGE_FILE, `await import('../kernel/store')`)).toEqual([
      '@/lib/kernel/store',
    ])
  })

  it('✅ `../kernel/types` 与 `../kernel/registry` 允许通过', () => {
    const code = [
      `import type { ActionKey } from '../kernel/types'`,
      `import { ACTION_REGISTRY } from '../kernel/registry'`,
    ].join('\n')
    const found = kernelImportsIn(BRIDGE_FILE, code).sort()
    expect(found).toEqual(['@/lib/kernel/registry', '@/lib/kernel/types'])
    // 它们也不该被禁止清单误伤
    expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual([])
  })

  it('✅ 合法的本地相对导入不误报', () => {
    const code = [
      `import { MAPPING_TABLE } from './mapping-table'`,
      `import type { CandidateIdentity } from './types'`,
      `import { helper } from './nested/helper'`,
    ].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual([])
    expect(kernelImportsIn(BRIDGE_FILE, code)).toEqual([])
  })
})

/**
 * 🔴 仓库的 tsconfig 是 `baseUrl: "."` + `paths: { "@/*": ["./src/*"] }`，
 *    所以「不以 `.` 开头」并不等于「不是本仓模块」：
 *      · `src/lib/x` 靠 baseUrl 解析得到；
 *      · `@/lib/a/../b` 里的点段会被 TypeScript 自己消掉。
 *    这两类都是**合法写法**，只要扫描不折算就能静默绕过冻结边界。
 */
describe('🔴 baseUrl 项目路径与 alias 点段也要折算（合成源码）', () => {
  const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'

  it('🔴 `src/lib/capabilities` / `src/lib/supabase` 会被抓到', () => {
    expect(forbiddenImportsIn(BRIDGE_FILE, `import 'src/lib/capabilities'`)).toContain(
      '@/lib/capabilities',
    )
    expect(forbiddenImportsIn(BRIDGE_FILE, `require('src/lib/supabase')`)).toContain(
      '@/lib/supabase',
    )
    expect(
      forbiddenImportsIn(BRIDGE_FILE, `await import('src/lib/execution/auto-run')`),
    ).toContain('@/lib/execution')
  })

  it('🔴 alias 里的点段会被消除后再判', () => {
    expect(
      forbiddenImportsIn(BRIDGE_FILE, `import '@/lib/action-bridge/../execution'`),
    ).toContain('@/lib/execution')
    expect(
      forbiddenImportsIn(BRIDGE_FILE, `import type { X } from '@/lib/kernel/../growth/types'`),
    ).toContain('@/lib/growth')
  })

  it('🔴 绕开 Kernel 允许清单的两种写法都被认出来', () => {
    // 点段绕过
    expect(
      kernelImportsIn(BRIDGE_FILE, `import '@/lib/action-bridge/../kernel/gateway'`),
    ).toEqual(['@/lib/kernel/gateway'])
    // baseUrl 绕过
    expect(kernelImportsIn(BRIDGE_FILE, `require('src/lib/kernel/store')`)).toEqual([
      '@/lib/kernel/store',
    ])
  })

  it('✅ 折算之后仍然允许的两条 Kernel 导入', () => {
    expect(
      kernelImportsIn(BRIDGE_FILE, `import type { T } from '@/lib/action-bridge/../kernel/types'`),
    ).toEqual(['@/lib/kernel/types'])
    expect(kernelImportsIn(BRIDGE_FILE, `import { R } from 'src/lib/kernel/registry'`)).toEqual([
      '@/lib/kernel/registry',
    ])
  })

  it('🔴 scoped npm 包不许被当成本仓 alias 改写', () => {
    // `@supabase/supabase-js` 本来就在禁止清单里 —— 它必须**按原样**命中，
    // 而不是被 `@/` 那条分支改写成别的东西
    expect(
      forbiddenImportsIn(BRIDGE_FILE, `import { createClient } from '@supabase/supabase-js'`),
    ).toEqual(['@supabase/supabase-js'])
    // 不在清单里的普通 / scoped 包一律不误报
    const clean = [
      `import { describe } from 'vitest'`,
      `import { z } from '@scope/pkg'`,
      `import { readFileSync } from 'fs'`,
    ].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, clean)).toEqual([])
    expect(kernelImportsIn(BRIDGE_FILE, clean)).toEqual([])
  })
})
