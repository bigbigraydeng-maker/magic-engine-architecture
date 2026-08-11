/**
 * bridge 的边界 —— 从 bridge 这一侧盯。
 *
 * `kernel/__tests__/architecture.test.ts` 从 Kernel 那一侧盯同一条线
 * （Kernel 不许 import 域模块与 bridge）。两侧各自独立：
 * 删掉任意一侧，另一侧仍然拦得住自己那半边。
 */

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join, relative, posix } from 'path'
import { tmpdir } from 'os'
import { ACTION_BRIDGE_FORBIDDEN_IMPORTS } from '@/lib/kernel/boundaries'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src/lib/action-bridge')

/**
 * 🔴 **`.tsx?` 只认 `.ts` / `.tsx`。**（Codex thread r3761927225）仓库 tsconfig
 *    开了 `allowJs`，bridge 新增一个 `.js`/`.jsx` 辅助文件、里面直接 import 被禁止
 *    的层，这个 walker 在文件系统这一层就把它跳过了 —— 根本轮不到下面的
 *    scanModuleReferences 去判，两套架构测试永远绿。这不是判据的口子，
 *    是扫描范围本身的口子。
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.[jt]sx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * 🔴 **用真正的 TypeScript 解析器，不再手搓正则。**
 *
 * 这一版之前是一路正则打补丁堆上来的，每补一次就露一个新口子（`from` → 副作用导入
 * → 动态导入 → require → 反引号 → 插值 → 相对路径 → baseUrl → 点段）。
 * 正则**看不懂 JS 的词法**，所以两类问题它结构上就解决不了：
 *
 *   ① 转义：`` import(`\x73rc/lib/${d}`) `` 源码文本是 `\x73rc/...`，运行时却是 `src/...`。
 *      比对**源码原文**永远比不中；要比就得比**求值后（cooked）**的字符串。
 *   ② 注释与字面量分不开：`const start = '/*'` … `const end = '*\/'` 之间是**真实源码**，
 *      正则版 `stripComments` 会把它整段当块注释删掉，夹在中间的违规 import 随之蒸发。
 *
 * 仓库本来就有 TypeScript（devDependency，编译器 API 自带），所以**不引入任何新依赖**。
 * 解析器天然认得注释 / 字符串 / 模板 / 正则字面量，上面两类问题一次性消失。
 *
 * 🔴 **按文件扩展名选正确的 ScriptKind，不能对 `.js`/`.jsx` 硬编码用 TS 解析。**
 *    （Codex thread r3761927225）JSX 语法在 `ScriptKind.TS`/`.JS` 下不被支持 ——
 *    `<Widget />` 会被当成类型断言/泛型语法去解析，解析器行为跟着走样。
 *    扩展名之外一律落回 `.TS`（合成用例的虚拟路径大多没有真实扩展名）。
 */
function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

const parseSource = (code: string, scriptKind: ts.ScriptKind = ts.ScriptKind.TS): ts.SourceFile =>
  // setParentNodes = false：这里只按位置取注释、按节点类型取说明符，用不上父指针，
  // 关掉它能省一遍全树回填（全仓近 2000 个文件时这笔开销是实打实的）。
  ts.createSourceFile('scan.ts', code, ts.ScriptTarget.Latest, false, scriptKind)

/**
 * 把注释挖空（保留换行与列宽，行号列号都不动）。
 *
 * 🔴 注释范围一律来自**解析器**，不是正则。正则版的 `/\/\*[\s\S]*?\*\//g` 会把
 *    字符串或正则字面量里的 `/*` 当成注释开头 —— 于是这样一段合法源码：
 *      const start = '/*'
 *      import '@/lib/capabilities'      // ← 真实的违规导入
 *      const end = '*\/'
 *    扫描后只剩 `const start = ''`，边界测试一片绿。
 *
 * 只有仍然基于正则的检查（比如「没有 any」）才需要它；
 * import 扫描走 AST，解析器本来就不会把注释当代码。
 *
 * 🔴 **只收 leading 不够 —— 同一行、紧跟在前一个 token 后面的注释是 trailing，
 *    不是下一个 token 的 leading。**（Codex thread r3759104932）
 *      const x = foo /* as unknown as AuthorizedExecutionContext *\/ + bar
 *    TS 的 trivia 归属规则：本行内、换行符之前出现的注释算**前一个 token 的
 *    trailing trivia**，只有跨过一次换行之后的注释才会被记成下一个 token 的
 *    leading trivia。原来只在每个节点的 `pos`（= leading）取一次，会漏掉这类
 *    挂在表达式中间、同一行内的注释 —— 挖不掉，就原样留在后面还在用正则的
 *    「没有 any」之类检查里，可能把纯注释文本当成生产代码。
 *    补法：每个节点的 `pos`（leading）与 `end`（trailing）都收一遍。
 */
function stripComments(src: string, scriptKind: ts.ScriptKind = ts.ScriptKind.TS): string {
  const sourceFile = parseSource(src, scriptKind)
  const ranges = new Map<string, ts.CommentRange>()

  // `node.pos` 就是含前导 trivia 的起点（= getFullStart()），不需要父指针
  const collectLeadingAt = (pos: number): void => {
    for (const r of ts.getLeadingCommentRanges(src, pos) ?? []) {
      ranges.set(`${r.pos}:${r.end}`, r)
    }
  }
  // `node.end` 是节点的结束位置 —— 同一行内紧跟在它后面的注释算它的 trailing trivia
  const collectTrailingAt = (pos: number): void => {
    for (const r of ts.getTrailingCommentRanges(src, pos) ?? []) {
      ranges.set(`${r.pos}:${r.end}`, r)
    }
  }
  const visit = (node: ts.Node): void => {
    collectLeadingAt(node.pos)
    collectTrailingAt(node.end)
    node.forEachChild(visit)
  }
  visit(sourceFile)
  // 文件末尾那条注释是 EOF token 的前导 trivia，不挂在任何其它节点上
  collectLeadingAt(sourceFile.endOfFileToken.pos)

  const chars = src.split('')
  // 用 forEach 而不是 `for…of ranges.values()`：仓库 tsconfig 没设 target，
  // 直接迭代 Map 的迭代器会撞 TS2802（要 downlevelIteration）。
  ranges.forEach((r) => {
    for (let i = r.pos; i < r.end && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' '
    }
  })
  return chars.join('')
}

const PROD_FILES = walk(DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/'))

const codeOf = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'), scriptKindFor(p))

/**
 * 从一段源码里把**所有**模块引用抠出来 —— 走 AST，六种入口一个不漏：
 *
 *      import { x } from '…'  /  import type … /  import '…'（副作用）    ImportDeclaration
 *      export { x } from '…'  /  export * from '…'                        ExportDeclaration
 *      import x = require('…')                                            ImportEqualsDeclaration
 *      import('…') / await import('…')                                    CallExpression(ImportKeyword)
 *      require('…') / require.resolve('…')                                CallExpression(require)
 *      type T = import('…').X                                             ImportTypeNode
 *
 * 🔴 **说明符取的是 `.text`，也就是解析器求值后的 cooked 值，不是源码原文。**
 *    `import('\x40/lib/capabilities')` 的 `.text` 直接就是 `@/lib/capabilities`；
 *    `` require(`\x73rc/lib/supabase`) `` 的 `.text` 直接就是 `src/lib/supabase`。
 *    转义写法自此不再是一条绕过路径 —— 不是因为多加了一条正则，而是因为
 *    比对的东西从「源码长什么样」换成了「运行时到底是哪个字符串」。
 *
 * 🔴 **`type T = import('…').X` 是单独一种语法节点（`ImportTypeNode`），
 *    不是 `CallExpression`。**（Codex thread r3759104922）只覆盖调用表达式那五种，
 *    这种纯类型层的引用会被漏掉 —— 但它在编译期照样把 bridge 焊死在被禁止的
 *    那一层上，`import type { X } from '…'` 挡得住的东西，`type T = import('…').X`
 *    原样绕过去。
 *
 * 🔴 **不是字面量的一律 fail closed**（`unresolvable`）：模板带插值、字符串拼接、
 *    说明符是个变量……静态都证明不了它去哪。证明不了就不许放行。
 */
type ModuleReferenceScan = {
  /** 能静态定死的说明符，已是 cooked 值 */
  readonly specifiers: readonly string[]
  /** 静态证明不了去向的引用，一律算命中，附带可读的原因 */
  readonly unresolvable: readonly string[]
}

function scanModuleReferences(
  code: string,
  scriptKind: ts.ScriptKind = ts.ScriptKind.TS,
): ModuleReferenceScan {
  const specifiers: string[] = []
  const unresolvable: string[] = []

  const record = (expr: ts.Expression | undefined, kind: string): void => {
    if (!expr) return

    // 字符串字面量 与 无插值模板字面量：`.text` 是 cooked 值，转义已被解析器还原
    if (ts.isStringLiteralLike(expr)) {
      specifiers.push(expr.text)
      return
    }

    // 带插值的模板：只有 head 是静态的，且同样取 cooked 值
    if (ts.isTemplateExpression(expr)) {
      const cookedHead = expr.head.text
      if (!provablyExternalPackagePrefix(cookedHead)) {
        unresolvable.push(
          cookedHead === ''
            ? `${kind} 模板 \`\${…}\`（表达式打头，静态前缀为空，无法证明去向是外部包，fail closed）`
            : `${kind} 模板 \`${cookedHead}\${…}\`（静态前缀证明不了它指向仓库外的包，fail closed）`,
        )
      }
      return
    }

    // 变量、拼接、三元…… 静态都定不下来
    unresolvable.push(
      `${kind} 说明符不是字面量（${ts.SyntaxKind[expr.kind]}），静态证明不了去向，fail closed`,
    )
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      record(node.moduleSpecifier, 'import')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      record(node.moduleSpecifier, 'export…from')
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression, 'import=require')
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        record(node.arguments[0], 'import()')
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        record(node.arguments[0], 'require()')
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'require' &&
        node.expression.name.text === 'resolve'
      ) {
        record(node.arguments[0], 'require.resolve()')
      }
    } else if (ts.isImportTypeNode(node)) {
      // `type T = import('…').X` —— 类型层的模块引用，argument 只可能是
      // 字符串字面量类型（TS 语法本身不允许在这里写变量/拼接），
      // 但仍按同一套「不是字面量就 fail closed」处理，不假设它一定合法。
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteralLike(arg.literal)) {
        record(arg.literal, 'import 类型()')
      } else {
        unresolvable.push(
          `import 类型() 说明符不是字符串字面量（${ts.SyntaxKind[arg.kind]}），静态证明不了去向，fail closed`,
        )
      }
    }
    node.forEachChild(visit)
  }

  visit(parseSource(code, scriptKind))
  return { specifiers, unresolvable }
}

/**
 * 插值模板字面量的动态 import()/require() —— 静态扫描算不出插值展开后的真实路径。
 *
 * 🔴 直接放过等于开了个口子：`import(\`${prefix}/execution\`)` 只要 `prefix`
 *    运行时算出来是 `'@/lib'`，效果跟写死 `import('@/lib/execution')` 一模一样，
 *    但静态扫描永远看不出来。
 *
 * 🔴 **判据的方向是「证明它安全」，不是「看它像不像工程路径」。**
 *    早先写成「静态前缀落在 `@/` `src/` `./` `../` 上才算命中」—— 那是反的，
 *    「没法证明是外部包」≠「可以放行」。于是**两类**写法从正门走了出去：
 *
 *      const prefix = '@/lib'; await import(`${prefix}/execution`)   // ① 静态前缀是空串
 *      await import(`s${rest}`)                                       // ② 前缀还能长成 `src/`
 *
 *    ① 表达式打头：反引号后面立刻就是 `${`，抠出来的静态前缀是空字符串。
 *      空前缀什么都没证明 —— `prefix` 运行时可能算出 `'@/lib'`，也可能算出一个
 *      npm 包名，静态扫描没有任何字面文本能用来判断；却因为 `''.startsWith('@/')`
 *      为假被判成干净，**恰恰是最没法证明安全的情形反而被放行**。
 *    ② 半截前缀：`'s'` 再补三个字符就是 `'src/'`，`'@'` 补一个就是 `'@/'`。
 *
 *    所以现在反过来：**证明不了指向仓库外的包，就算命中。**
 *    证明成立只有一种情形：静态前缀非空，**且**它既没落在四类工程路径写法上，
 *    也不可能再长成其中任何一条。
 *
 * 🔴 不猜插值算出来是什么，也不许把这段前缀塞进 `canonicalSpecifier()` 去规范化
 *    —— 那是个截断的半截路径，规范化出来的东西看着像一个合法模块，实则是编出来的。
 *
 * npm 包的插值（`` `some-package-${variant}` `` / `` `@supabase/${sub}` ``）静态前缀
 * 已经把首段定死在仓库外，证明成立，原样放行 —— 不能把外部包名误判成工程路径。
 */
const PROJECT_PATH_PREFIXES = ['@/', 'src/', './', '../'] as const

/**
 * 这段静态前缀能不能**证明**插值展开后指向的是仓库外的 npm 包。
 * 证明不了一律返回 false（→ fail closed）。
 */
function provablyExternalPackagePrefix(prefix: string): boolean {
  // 空前缀什么都证明不了：`${anything}` 可以是任意路径。
  // 🔴 这一句**被下面「长得成」那句盖住**（`'@/'.startsWith('')` 为真，空前缀在那里
  //    照样会被拒）—— 实测拆掉它 59 条测试全绿。留着是因为它写的是本轮 Codex
  //    点名的那一种情形，读代码的人一眼就能看见；但**别给它单写变异探针**说它
  //    独立生效，也别因为「空的情况这儿管了」就去简化下面那句 —— 真正拦住空前缀的是它。
  if (prefix === '') return false
  // 已经落在工程路径写法上
  if (PROJECT_PATH_PREFIXES.some((p) => prefix.startsWith(p))) return false
  // 还没写完，但再补几个字符就能长成工程路径写法（也含空前缀这一种）
  if (PROJECT_PATH_PREFIXES.some((p) => p.startsWith(prefix))) return false
  return true
}

/** 静态证明不了去向的模块引用（插值模板 / 变量 / 拼接），一律算命中。 */
const interpolatedProjectPathHits = (sourcePath: string, code: string): readonly string[] =>
  scanModuleReferences(code, scriptKindFor(sourcePath)).unresolvable

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
  scanModuleReferences(code, scriptKindFor(sourcePath)).specifiers.map((spec) =>
    canonicalSpecifier(sourcePath, spec),
  )

/**
 * 命中判据 = **前缀匹配**，跟原来的正则语义一致：
 * 禁止 `@/lib/growth` 时，`@/lib/growth` 与 `@/lib/growth/types` 都要命中；
 * `@/lib/cms/` 这种带斜杠的前缀规则照常生效。
 *
 * 🔴 改成字符串比较之后**不再需要转义** —— 模块名里的 `/`、`@`、`.`
 *    都只是普通字符，没有任何机会被当成正则元字符。
 */
const specMatchesModule = (spec: string, mod: string): boolean => spec.startsWith(mod)

/**
 * 🔴 插值动态导入的 fail-closed 命中不看具体清单 —— 静态扫描算不出真实目标，
 *    没法证明它没指向被禁止的那些层，所以对**每一道**在跑的边界检查都算命中
 *    （既包括「禁止清单」这道，也包括下面「Kernel 只准 types/registry」那道）。
 */
function forbiddenImportsIn(sourcePath: string, code: string): string[] {
  const specs = importedModules(sourcePath, code)
  const direct = ACTION_BRIDGE_FORBIDDEN_IMPORTS.filter((mod) =>
    specs.some((spec) => specMatchesModule(spec, mod)),
  )
  return [...direct, ...interpolatedProjectPathHits(sourcePath, code)]
}

const kernelImportsIn = (sourcePath: string, code: string): string[] => {
  const direct = importedModules(sourcePath, code).filter((spec) => spec.startsWith('@/lib/kernel'))
  return [...direct, ...interpolatedProjectPathHits(sourcePath, code)]
}

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
    ['动态导入（模板字面量，无插值）', 'const m = await import(`@/lib/execution`)'],
    ['CommonJS require（模板字面量，无插值）', 'const sb = require(`@/lib/supabase`)'],
  ]

  /** 合成用例的虚拟源文件 —— 相对说明符要按它的位置解析。 */
  const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'

  it.each(FORBIDDEN_FORMS)('%s → 必须被发现', (_label, code) => {
    expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
  })

  it('🔴 只写在注释里的示例不算违规（判据不许把自己的文档当罪证）', () => {
    // 🔴 JSDoc 续行（` * …`）必须**真的包在块注释里**。早先这里少写了 `/**` 与 `*/`，
    //    那段源码其实是「悬空的代码」，只因为旧的正则版按行首 `*` 猜注释才没报 ——
    //    解析器不猜，所以 fixture 得写成真实文件里的样子。
    const commented = [
      `// import { x } from '@/lib/capabilities'`,
      `/* const m = require('@/lib/supabase') */`,
      `/**`,
      ` * import '@/lib/execution'`,
      ` */`,
      `const real = 1`,
    ].join('\n')
    // 原文直接扫（AST 天然不把注释当代码）与先挖空注释再扫，两条路都必须干净
    expect(forbiddenImportsIn(BRIDGE_FILE, commented)).toEqual([])
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

/**
 * 🔴 **插值模板字面量的动态导入同样要 fail closed。**
 *
 * `import(\`${prefix}/execution\`)`：只要 `prefix` 运行时算出来是 `'@/lib'`，
 * 效果跟写死 `import('@/lib/execution')` 一模一样，但静态扫描算不出插值展开后
 * 去了哪。所以判据是**证明它安全才放行**：静态前缀（`${` 之前那一截）必须非空，
 * 且既没落在四类工程路径写法上（`@/`、`src/`、`./`、`../`）、也不可能再长成其中
 * 任何一条 —— 证明不了一律命中，不猜、也不算出真实目标。
 * npm 包的插值（`some-package-${variant}` / `@supabase/${sub}`）首段已定死在仓库外，放行。
 */
describe('🔴 插值模板字面量的动态导入 fail closed（合成源码）', () => {
  const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'

  const PROJECT_PREFIX_FORMS: Array<[label: string, code: string]> = [
    ['@/ alias 前缀', 'const m = await import(`@/lib/${domain}`)'],
    ['src/ baseUrl 前缀', 'const m = await import(`src/lib/${domain}`)'],
    ['./ 相对前缀', 'const m = require(`./${domain}`)'],
    ['../ 相对前缀', 'const m = require(`../${domain}`)'],
  ]

  it.each(PROJECT_PREFIX_FORMS)('%s 的插值动态导入 → 禁止清单判据 fail closed 必须命中', (_label, code) => {
    expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
  })

  it.each(PROJECT_PREFIX_FORMS)('%s 的插值动态导入 → Kernel 允许清单判据同样 fail closed', (_label, code) => {
    expect(kernelImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
  })

  /**
   * 🔴 **表达式打头，静态前缀为空** —— `${` 紧跟在反引号后面，抠出来的前缀是
   *    空字符串，不落在四类工程路径写法的任何一类，之前的判据会误判成「外部
   *    包插值」直接放行。空前缀什么都没证明，必须 fail closed，而不是因为
   *    「不匹配四类前缀」就当成安全。
   */
  const EXPRESSION_FIRST_FORMS: Array<[label: string, code: string]> = [
    ['import，无任何静态前缀', 'const m = await import(`${domain}/execution`)'],
    ['require，无任何静态前缀', 'const m = require(`${domain}/execution`)'],
    ['整段模板只有一个插值', 'const m = await import(`${modulePath}`)'],
  ]

  it.each(EXPRESSION_FIRST_FORMS)(
    '%s → 禁止清单判据 fail closed 必须命中（不能因为前缀是空字符串就放行）',
    (_label, code) => {
      expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
    },
  )

  it.each(EXPRESSION_FIRST_FORMS)('%s → Kernel 允许清单判据同样 fail closed', (_label, code) => {
    expect(kernelImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
  })

  it('🔴 命中诊断带着可辨认的原因（fail closed，不是一个具体模块名）', () => {
    const hits = forbiddenImportsIn(BRIDGE_FILE, 'await import(`@/lib/${domain}`)')
    expect(hits.length).toBe(1)
    expect(hits[0]).toContain('fail closed')

    const expressionFirstHits = forbiddenImportsIn(BRIDGE_FILE, 'await import(`${domain}/execution`)')
    expect(expressionFirstHits.length).toBe(1)
    expect(expressionFirstHits[0]).toContain('fail closed')
  })

  it('✅ 外部 npm 包名的插值不是工程路径，不误报（静态前缀非空且明确不落在四类写法上，才算证明了外部）', () => {
    const code = 'const m = await import(`some-package-${variant}`)'
    expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual([])
    expect(kernelImportsIn(BRIDGE_FILE, code)).toEqual([])
  })

  it('✅ 允许的 Kernel types/registry 导入（静态、无插值）即使用反引号也照常放行', () => {
    const code = ['import(`@/lib/kernel/types`)', 'require(`@/lib/kernel/registry`)'].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual([])
    expect(kernelImportsIn(BRIDGE_FILE, code).sort()).toEqual([
      '@/lib/kernel/registry',
      '@/lib/kernel/types',
    ])
  })

  it('🔴 只写在注释里的插值示例不算违规（判据不许把自己的文档当罪证）', () => {
    // JSDoc 续行同样要真的包在块注释里 —— 解析器不按行首 `*` 猜注释
    const commented = [
      '// const m = await import(`@/lib/${domain}`)',
      '/* const g = require(`../${domain}`) */',
      '/**',
      ' * await import(`src/lib/${x}`)',
      ' */',
      '// const h = await import(`${domain}/execution`)',
      'const real = 1',
    ].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, commented)).toEqual([])
    expect(kernelImportsIn(BRIDGE_FILE, commented)).toEqual([])
    expect(forbiddenImportsIn(BRIDGE_FILE, stripComments(commented))).toEqual([])
    expect(kernelImportsIn(BRIDGE_FILE, stripComments(commented))).toEqual([])
  })

  /**
   * 🔴 **判据反了的那两类，各自单独盯一条。**
   *
   * 上面那组 `PROJECT_PREFIX_FORMS` 全都是「静态前缀已经写成了工程路径」，
   * 所以旧判据（`prefix.startsWith('@/')` 之类）照样能让它们全绿 ——
   * 也就是说那一组**证明不了**这次的修复。真正从正门走出去的是下面两类：
   * 前缀为空、以及前缀短到还能长成工程路径标记。
   */
  describe('🔴 证明不了指向外部包就算命中（这才是本轮的判据）', () => {
    it('🔴 静态前缀为空 —— Codex 点名的那一种，整段路径都在插值里', () => {
      // const prefix = '@/lib'; await import(`${prefix}/execution`)
      // 运行时等价于 import('@/lib/execution')，静态前缀却是空串。
      const code = "const prefix = '@/lib'\nconst m = await import(`${prefix}/execution`)"
      expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
      expect(kernelImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
    })

    const GROWABLE_PREFIXES: Array<[label: string, code: string]> = [
      ['`s` 还能长成 `src/`', 'const m = await import(`s${rest}`)'],
      ['`sr` 还能长成 `src/`', 'const m = await import(`sr${rest}`)'],
      ['`src` 还能长成 `src/`', 'const m = await import(`src${rest}`)'],
      ['`@` 还能长成 `@/`', 'const m = await import(`@${rest}`)'],
      ['`.` 还能长成 `./`', 'const m = require(`.${rest}`)'],
      ['`..` 还能长成 `../`', 'const m = require(`..${rest}`)'],
    ]

    it.each(GROWABLE_PREFIXES)('🔴 %s → 证明不了，必须 fail closed', (_label, code) => {
      expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
      expect(kernelImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
    })

    it('✅ 首段已经定死在仓库外的 npm 插值仍然放行（判据没有一刀切成全拒）', () => {
      for (const code of [
        'const m = await import(`some-package-${variant}`)',
        'const m = await import(`@supabase/${sub}`)',
        'const m = require(`lodash.${fn}`)',
      ]) {
        expect(forbiddenImportsIn(BRIDGE_FILE, code), code).toEqual([])
        expect(kernelImportsIn(BRIDGE_FILE, code), code).toEqual([])
      }
    })
  })
})

/**
 * 🔴 **换成解析器之后才关得掉的两类绕过。**
 *
 * 这两条正则版**结构上**做不到，不是补一条 pattern 的事：
 *   ① 转义：比对源码原文，`\x73rc` 永远不等于 `src`；要比就得比 cooked 值。
 *   ② 注释：正则分不清「注释」与「字符串里长得像注释的那几个字符」。
 */
describe('🔴 解析器口径：转义与注释（合成源码）', () => {
  const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'

  /** ① Codex thread r3758650486 */
  describe('转义说明符按 cooked 值判，不按源码原文', () => {
    const ESCAPED_FORMS: Array<[label: string, code: string, why: string]> = [
      [
        '模板 head 里的 \\x73rc（Codex 原案）',
        'const m = await import(`\\x73rc/lib/${domain}`)',
        '源码是 \\x73rc/lib/，cooked 是 src/lib/ → 落在 baseUrl 工程路径上，fail closed',
      ],
      [
        '普通字符串里的 \\x40（= @）',
        "import '\\x40/lib/capabilities'",
        'cooked 是 @/lib/capabilities',
      ],
      [
        '无插值模板里的 \\x73rc',
        'const sb = require(`\\x73rc/lib/supabase`)',
        'cooked 是 src/lib/supabase',
      ],
      [
        'unicode 转义 \\u0073rc',
        "await import('\\u0073rc/lib/execution')",
        'cooked 是 src/lib/execution',
      ],
    ]

    it.each(ESCAPED_FORMS)('🔴 %s → 必须被发现', (_label, code) => {
      expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
    })

    it('🔴 cooked 值确实被还原成了真实模块名（不是靠 fail-closed 兜住的）', () => {
      // 无插值 → 走 specifiers 这条路，命中的必须是**具体模块名**而不是「证明不了」
      expect(forbiddenImportsIn(BRIDGE_FILE, "import '\\x40/lib/capabilities'")).toEqual([
        '@/lib/capabilities',
      ])
      expect(forbiddenImportsIn(BRIDGE_FILE, 'require(`\\x73rc/lib/supabase`)')).toEqual([
        '@/lib/supabase',
      ])
    })

    it('✅ 转义出来的外部包名不误报', () => {
      // '\x76itest' → 'vitest'，是 npm 包，不该被当成工程路径
      expect(forbiddenImportsIn(BRIDGE_FILE, "import '\\x76itest'")).toEqual([])
      expect(kernelImportsIn(BRIDGE_FILE, "import '\\x76itest'")).toEqual([])
    })
  })

  /** ② Codex thread r3758650489 */
  describe('注释挖空不许吞掉字符串之间的真实源码', () => {
    it('🔴 字符串里的 `/*` 与 `*/` 之间夹着的违规 import 必须还在', () => {
      // 这是一段**完全合法**的源码：两个字符串常量，中间一条真实的违规 import。
      // 正则版把 '/*' 到 '*/' 整段当块注释删掉 → 只剩 `const start = ''`，测试全绿。
      const code = [
        `const start = '/*'`,
        `import '@/lib/capabilities'`,
        `const end = '*/'`,
      ].join('\n')
      expect(stripComments(code)).toContain('@/lib/capabilities')
      expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual(['@/lib/capabilities'])
      expect(forbiddenImportsIn(BRIDGE_FILE, stripComments(code))).toEqual(['@/lib/capabilities'])
    })

    it('🔴 正则字面量里的 `/*` 同样不许把后面的源码吞掉', () => {
      const code = [`const re = /\\/\\*/`, `import '@/lib/execution'`, `const done = 1`].join('\n')
      expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual(['@/lib/execution'])
    })

    it('🔴 模板字面量里的 `/*` 也一样', () => {
      const code = ['const t = `/*`', `require('@/lib/supabase')`, 'const u = `*/`'].join('\n')
      expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual(['@/lib/supabase'])
    })

    it('✅ 真的写在块注释里的示例仍然不算违规（没有把判据放松成「注释也算」）', () => {
      const code = [`/* import '@/lib/capabilities' */`, `const real = 1`].join('\n')
      expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual([])
      expect(stripComments(code)).not.toContain('@/lib/capabilities')
    })

    it('✅ 挖空注释不改变行号（诊断信息里的位置仍然对得上）', () => {
      const code = ['/* a */', '// b', 'const real = 1'].join('\n')
      expect(stripComments(code).split('\n').length).toBe(3)
    })
  })

  /** ④ Codex thread r3759104932：trailing 注释（同一行、紧跟在前一个 token 后面）也要挖空 */
  describe('注释挖空同样要收 trailing，不能只收 leading', () => {
    it('🔴 表达式中间、同一行内的块注释（trailing trivia）必须被挖空', () => {
      // `/* … */` 紧跟在 foo 后面、同一行、没有换行分隔 —— 这是 foo 的
      // trailing trivia，不是 `+ bar` 的 leading trivia。只收 leading 会漏掉它。
      const code = `const x = foo /* as unknown as AuthorizedExecutionContext */ + bar`
      expect(stripComments(code)).not.toContain('as unknown as AuthorizedExecutionContext')
    })

    it('🔴 语句末尾、同一行的 `//` 注释同样要被挖空（不只是独占一行的注释）', () => {
      // 🔴 断言必须直接对 stripComments() 的输出下手 —— forbiddenImportsIn 走 AST
      // 直接扫原始 code，注释本来就不会被解析成 import 声明，跟 stripComments
      // 挖没挖干净无关；真正受这个修复影响的是后面那些还在用正则的检查（如「没有 any」）。
      const code = [`const x = 1 // as unknown as any`, `const y = 2`].join('\n')
      expect(stripComments(code)).not.toContain('as unknown as any')
    })

    it('✅ 挖 trailing 注释不许连带误伤字符串 / 正则里长得像注释的内容', () => {
      const code = [
        `const start = '/*'`,
        `const mid = 1 /* real trailing comment */ + 2`,
        `const end = '*/'`,
      ].join('\n')
      const stripped = stripComments(code)
      expect(stripped).toContain(`const start = '/*'`)
      expect(stripped).toContain(`const end = '*/'`)
      expect(stripped).not.toContain('real trailing comment')
    })
  })

  /**
   * ③ 顺带关掉的两条 —— 上一轮我在 PR 评论 §6 里如实列为「残余风险、未修」。
   *    换解析器之后它们是同一条代码路径的自然结果，不是额外加的判据。
   */
  describe('说明符不是字面量一律 fail closed（上一轮列为残余风险的两条）', () => {
    const NON_LITERAL: Array<[label: string, code: string]> = [
      ['字符串拼接', `const m = import('@/lib/' + 'growth')`],
      ['说明符是变量', `const p = '@/lib/capabilities'\nconst m = import(p)`],
      ['三元表达式', `const m = import(flag ? '@/lib/execution' : 'vitest')`],
      ['require.resolve', `const p = require.resolve('@/lib/supabase')`],
    ]

    it.each(NON_LITERAL)('🔴 %s → 必须被发现', (_label, code) => {
      expect(forbiddenImportsIn(BRIDGE_FILE, code).length).toBeGreaterThan(0)
    })
  })
})

/**
 * 🔴 **type-only 的模块引用走的是另一种语法节点（`ImportTypeNode`），
 *    不是上面六种里的 `CallExpression`/`Declaration`。**（Codex thread r3759104922）
 *
 * `type T = import('@/lib/capabilities').X` 在编译期建立的依赖跟
 * `import type { X } from '@/lib/capabilities'` 完全一样，但语法节点是
 * `ImportTypeNode`，原来的 `visit()` 只认 `ImportDeclaration` / `ExportDeclaration` /
 * `ImportEqualsDeclaration` / `CallExpression` 四类，这一种直接漏过去。
 */
describe('🔴 type-only 的 import() 类型引用同样要被治理（ImportTypeNode）', () => {
  const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'

  it('🔴 禁止清单：type T = import(...).X 必须被发现', () => {
    expect(forbiddenImportsIn(BRIDGE_FILE, `type T = import('@/lib/capabilities').X`)).toEqual([
      '@/lib/capabilities',
    ])
  })

  it('🔴 Kernel 允许清单同样看得到 import 类型（gateway 不在 types/registry 里）', () => {
    expect(kernelImportsIn(BRIDGE_FILE, `type T = import('@/lib/kernel/gateway').X`)).toEqual([
      '@/lib/kernel/gateway',
    ])
  })

  it('✅ 允许的 Kernel types/registry 用 import 类型写法也照常放行', () => {
    const code = [
      `type A = import('@/lib/kernel/types').ActionKey`,
      `type B = import('@/lib/kernel/registry').ActionDefinition`,
    ].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, code)).toEqual([])
    expect(kernelImportsIn(BRIDGE_FILE, code).sort()).toEqual([
      '@/lib/kernel/registry',
      '@/lib/kernel/types',
    ])
  })

  it('🔴 相对路径 / baseUrl 在 import 类型里同样要折算再判', () => {
    expect(forbiddenImportsIn(BRIDGE_FILE, `type T = import('../capabilities').X`)).toEqual([
      '@/lib/capabilities',
    ])
    expect(forbiddenImportsIn(BRIDGE_FILE, `type T = import('src/lib/execution').X`)).toEqual([
      '@/lib/execution',
    ])
  })

  it('🔴 转义写法在 import 类型里同样按 cooked 值判', () => {
    expect(forbiddenImportsIn(BRIDGE_FILE, `type T = import('\\x40/lib/capabilities').X`)).toEqual(
      ['@/lib/capabilities'],
    )
  })

  it('🔴 只写在注释里的 import 类型示例不算违规', () => {
    const commented = [
      `// type T = import('@/lib/capabilities').X`,
      `/* type U = import('@/lib/execution').Y */`,
      `const real = 1`,
    ].join('\n')
    expect(forbiddenImportsIn(BRIDGE_FILE, commented)).toEqual([])
  })
})

/**
 * 🔴 **全仓 walker 只认 `.ts` / `.tsx`，`.js` / `.jsx` helper 完全不会被扫。**
 *    （Codex thread r3761927225）仓库 tsconfig 开了 `allowJs`：bridge 新增一个
 *    `.js` 辅助文件、里面直接 import 被禁止的层，两套架构测试永远绿 —— walker
 *    在文件系统这一层就把它跳过了，根本轮不到 scanModuleReferences 去判。
 *    这不是扫描判据的口子，是扫描范围本身的口子。
 */
describe('🔴 walker 认得 .js / .jsx，不再只认 .ts / .tsx', () => {
  it('🔴 walk() 必须收 .ts / .tsx / .js / .jsx，且不误收非代码文件（真实磁盘探针）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'k-wp02-bridge-walker-'))
    try {
      writeFileSync(join(tmp, 'a.ts'), '')
      writeFileSync(join(tmp, 'b.tsx'), '')
      writeFileSync(join(tmp, 'c.js'), '')
      writeFileSync(join(tmp, 'd.jsx'), '')
      writeFileSync(join(tmp, 'e.json'), '')
      writeFileSync(join(tmp, 'f.md'), '')
      const found = walk(tmp).map((f) => f.split(/[\\/]/).pop())
      expect(found.sort()).toEqual(['a.ts', 'b.tsx', 'c.js', 'd.jsx'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  const BRIDGE_JS_FORMS: Array<[label: string, sourcePath: string, code: string]> = [
    ['.js 具名导入', 'src/lib/action-bridge/helper.js', `import { createCapabilities } from '@/lib/capabilities'`],
    ['.js CommonJS require', 'src/lib/action-bridge/helper.js', `const sb = require('@/lib/supabase')`],
    ['.jsx 具名导入', 'src/lib/action-bridge/widget.jsx', `import { execute } from '@/lib/execution'`],
    ['.jsx 动态导入', 'src/lib/action-bridge/widget.jsx', `const m = await import('@/lib/capabilities')`],
  ]

  it.each(BRIDGE_JS_FORMS)('🔴 %s → 必须被发现（禁止清单）', (_label, sourcePath, code) => {
    expect(forbiddenImportsIn(sourcePath, code).length).toBeGreaterThan(0)
  })

  it('🔴 .jsx 里插值动态导入同样 fail closed（不因为扩展名不是 .ts 就放松）', () => {
    const code = 'const m = await import(`@/lib/${domain}`)'
    expect(forbiddenImportsIn('src/lib/action-bridge/widget.jsx', code).length).toBeGreaterThan(0)
  })

  it('✅ .js / .jsx 里允许的 Kernel types/registry 导入不误报', () => {
    const code = [
      `import type { ActionKey } from '@/lib/kernel/types'`,
      `import { ACTION_REGISTRY } from '@/lib/kernel/registry'`,
    ].join('\n')
    expect(forbiddenImportsIn('src/lib/action-bridge/helper.js', code)).toEqual([])
    expect(kernelImportsIn('src/lib/action-bridge/helper.js', code).sort()).toEqual([
      '@/lib/kernel/registry',
      '@/lib/kernel/types',
    ])
  })

  it('✅ .jsx 里真正的 JSX 内容不误报（属性值长得像路径也不算 import）', () => {
    const code = [
      `import { createCapabilities } from '@/lib/capabilities'`,
      `const el = <Widget src="@/lib/capabilities" />`,
    ].join('\n')
    // 违规只来自那一行真实 import；JSX 属性值不是 import/require 的说明符
    expect(forbiddenImportsIn('src/lib/action-bridge/widget.jsx', code)).toEqual(['@/lib/capabilities'])
  })

  it('✅ 干净的 .js / .jsx 文件不误报', () => {
    const clean = [
      `import { MAPPING_TABLE } from './mapping-table'`,
      `export function helper() { return MAPPING_TABLE }`,
    ].join('\n')
    expect(forbiddenImportsIn('src/lib/action-bridge/helper.js', clean)).toEqual([])
    expect(forbiddenImportsIn('src/lib/action-bridge/widget.jsx', clean)).toEqual([])
  })
})
