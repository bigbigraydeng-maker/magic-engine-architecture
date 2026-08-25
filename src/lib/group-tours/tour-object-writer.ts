import * as ts from 'typescript'

/**
 * 安全地把一个团对象插入/替换进目标网站数据文件（如 CTS 的 src/lib/data/tours.ts）
 * 里的一个数组常量。
 *
 * 设计阶段复审（子牙+魏征）命中的两个真实坑，决定了这里不能走"正则窗口定位"
 * （`cms/meta-patcher.ts` 那条路线只解决"改已知对象的一个字段"，解决不了
 * "先要在一堆结构里找到正确的对象边界"这个更难的问题）：
 *
 *  1. 目标文件不止一个数组，`Tier.slug` 的值（'discovery'/'signature'/'stopover'）
 *     恰好和团品最常见的命名词撞车 —— 靠"找到 `slug:` 出现的位置"定位会认错对象。
 *  2. 目标文件里已有的团对象，字段值不一定是纯数据，可能是
 *     `[...SOME_IMPORTED_CONST.foo, '18 March 2027']` 这种运行时表达式
 *     （真实案例：CTS tours.ts 的 tale-of-two-cities / shanghai-surroundings）。
 *     整体替换这种对象会把动态逻辑静默换成写死的旧值 —— 括号配对、类型检查
 *     全部正常，只有语义坏了，PR review 肉眼也容易漏看。
 *
 * 既然要正确处理"找到指定数组、找到指定对象、判断它是不是纯字面量"这三件事，
 * 用 TypeScript 编译器自己解析 AST 是唯一靠谱的做法 —— 也顺带解决了"生成的
 * 新内容语法对不对"这个问题（用 ts.transpileModule 的 diagnostics 真解析校验，
 * 不是数括号；魏征已指出括号计数抓不住漏逗号/引号提前闭合这类最常见错误）。
 */

// ─── 字面量序列化 ────────────────────────────────────────────────────────────

/** JS 字符串字面量里除了引号，反斜杠/换行/U+2028/U+2029 不转义都会产出语法错误或坏数据。 */
export function serializeStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `'${escaped}'`
}

const VALID_BARE_KEY = /^[A-Za-z_$][\w$]*$/

function serializeKey(key: string): string {
  return VALID_BARE_KEY.test(key) ? key : serializeStringLiteral(key)
}

/**
 * 通用值序列化：把任意 JS 值（字符串/数字/布尔/null/数组/对象）转成合法的
 * TS 对象字面量文本。不针对某个具体 interface 写死字段处理，靠这一个函数
 * 递归吃掉 itinerary/faqs 这类嵌套结构，逻辑集中一处，好测。
 */
export function serializeValue(value: unknown, indent: number): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return serializeStringLiteral(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`serializeValue: 非有限数字 ${value}`)
    return String(value)
  }
  if (typeof value === 'boolean') return String(value)

  const pad = ' '.repeat(indent + 2)
  const closePad = ' '.repeat(indent)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((v) => `${pad}${serializeValue(v, indent + 2)}`).join(',\n')
    return `[\n${items},\n${closePad}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const lines = entries
      .map(([k, v]) => `${pad}${serializeKey(k)}: ${serializeValue(v, indent + 2)}`)
      .join(',\n')
    return `{\n${lines},\n${closePad}}`
  }

  throw new Error(`serializeValue: 不支持的类型 ${typeof value}`)
}

/**
 * 把团对象字段序列化成一段完整的对象字面量文本（不含外层缩进/逗号，
 * 由 insertOrReplaceTourObject 决定怎么拼进数组）。
 *
 * @param fields 已经按目标 interface 字段名映射好的值，插入顺序即输出顺序
 *   （对象属性顺序只影响可读性，不影响正确性）
 */
export function serializeTourObject(fields: Record<string, unknown>): string {
  return serializeValue(fields, 0)
}

// ─── 纯字面量检测 ────────────────────────────────────────────────────────────

export class NonLiteralTourObjectError extends Error {}

/** 只允许纯数据节点：字符串/数字/布尔/null、数组字面量、对象字面量（属性只能是普通赋值）、负数。 */
function isPureLiteralExpression(node: ts.Expression): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return true
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const u = node as ts.PrefixUnaryExpression
      return u.operator === ts.SyntaxKind.MinusToken && isPureLiteralExpression(u.operand)
    }
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = node as ts.ArrayLiteralExpression
      // SpreadElement 不是 Expression 意义上能递归判断字面量的节点——
      // 只要出现就说明数组里混了运行时展开，直接判非字面量。
      return arr.elements.every((el) => !ts.isSpreadElement(el) && isPureLiteralExpression(el))
    }
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = node as ts.ObjectLiteralExpression
      return obj.properties.every((p) => ts.isPropertyAssignment(p) && isPureLiteralExpression(p.initializer))
    }
    default:
      // Identifier / PropertyAccessExpression / ElementAccessExpression /
      // CallExpression / TemplateExpression / SpreadElement 等，一律当非字面量。
      return false
  }
}

// ─── 定位目标数组 / 目标对象 ──────────────────────────────────────────────────

interface LocatedArray {
  sourceFile: ts.SourceFile
  arrayNode: ts.ArrayLiteralExpression
}

export class TourArrayNotFoundError extends Error {}
export class TourSlugConflictError extends Error {}

/**
 * 找到 `export const <arrayName>: T[] = [...]` 这条声明的数组字面量节点。
 * 走 AST 而不是文本搜索，天然不会跟文件里别的数组/别的 `slug:` 撞。
 */
function locateExportedArray(fileContent: string, arrayName: string, filePath: string): LocatedArray {
  const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, /* setParentNodes */ true)

  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (!isExported) continue

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== arrayName) continue
      if (decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
        return { sourceFile, arrayNode: decl.initializer }
      }
    }
  }

  throw new TourArrayNotFoundError(
    `目标文件里没找到 "export const ${arrayName}: ...[] = [...]" 这条声明，无法定位插入位置。`,
  )
}

/** 数组元素里找 `slug: '<targetSlug>'` 的那个对象字面量，找不到返回 null。 */
function findObjectBySlug(arrayNode: ts.ArrayLiteralExpression, slug: string): ts.ObjectLiteralExpression | null {
  const matches: ts.ObjectLiteralExpression[] = []
  for (const el of arrayNode.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue
    const slugProp = el.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'slug',
    )
    if (!slugProp || !ts.isStringLiteral(slugProp.initializer)) continue
    if (slugProp.initializer.text === slug) matches.push(el)
  }
  if (matches.length > 1) {
    // 目标文件本身已经有重复 slug——这是既有数据问题，不是本工具造成的，
    // 但不能替换一个"不知道该改哪个"的目标，宁可拒绝也不要猜。
    throw new TourSlugConflictError(`目标文件里已经有 ${matches.length} 个 slug 为 "${slug}" 的对象，无法确定改哪一个。`)
  }
  return matches[0] ?? null
}

// ─── 对外主函数 ──────────────────────────────────────────────────────────────

export type InsertOrReplaceMode = 'inserted' | 'replaced'

export interface InsertOrReplaceResult {
  content: string
  mode: InsertOrReplaceMode
}

/**
 * 把 `newObjectFields` 插入/替换进 `fileContent` 里 `export const <arrayName>`
 * 数组的对应位置：slug 已存在就整体替换（先做纯字面量检测，命中非字面量直接
 * 拒绝），不存在就插进数组末尾。
 *
 * @throws TourArrayNotFoundError 目标数组声明找不到
 * @throws TourSlugConflictError  目标文件里已有重复 slug（既有数据问题）
 * @throws NonLiteralTourObjectError 要替换的对象包含非字面量表达式，拒绝自动覆盖
 * @throws Error 生成的新文件语法不合法（ts.transpileModule 报出 diagnostics）
 */
export function insertOrReplaceTourObject(params: {
  fileContent: string
  filePath: string
  arrayName: string
  slug: string
  newObjectFields: Record<string, unknown>
}): InsertOrReplaceResult {
  const { fileContent, filePath, arrayName, slug, newObjectFields } = params

  const { arrayNode } = locateExportedArray(fileContent, arrayName, filePath)
  const existing = findObjectBySlug(arrayNode, slug)
  const newObjectText = serializeTourObject(newObjectFields)

  let updatedContent: string
  let mode: InsertOrReplaceMode

  if (existing) {
    if (!isPureLiteralExpression(existing)) {
      throw new NonLiteralTourObjectError(
        `slug "${slug}" 对应的团对象里含有非静态表达式（引用了变量/展开/函数调用等），` +
          `无法安全自动覆盖，请人工在 GitHub 上编辑这个对象。`,
      )
    }
    const start = existing.getStart()
    const end = existing.getEnd()
    // 缩进对齐替换目标原来的列位置，不用固定 2 —— 数组元素本身的缩进由
    // 调用方传入的 newObjectFields 决定内容，这里只保证外层花括号对齐。
    const indentedNewObject = reindentToMatch(fileContent, start, newObjectText)
    updatedContent = fileContent.slice(0, start) + indentedNewObject + fileContent.slice(end)
    mode = 'replaced'
  } else {
    updatedContent = insertBeforeArrayClose(fileContent, arrayNode, newObjectText)
    mode = 'inserted'
  }

  assertValidSyntax(updatedContent, filePath)
  return { content: updatedContent, mode }
}

/**
 * 把新对象文本的每一行都加上目标列位置的缩进，保持文件整体风格不突兀。
 *
 * 必须逐行加，不能只在第一行前面拼一个缩进字符串——`newObjectText` 本身是
 * `serializeValue` 从 0 开始缩进的多行文本，只垫第一行会让花括号对齐、
 * 内部属性却矮一截（真实发过一次 PR 才发现这个问题：`{` 在 2 格缩进，
 * 紧接着的 `id: ...` 却也停在 2 格，没有比父级多缩进一层）。
 */
function reindentAllLines(indent: string, text: string): string {
  return text
    .split('\n')
    .map((line) => indent + line)
    .join('\n')
}

/** 把新对象文本的每一行都加上跟原对象起始列一致的缩进（替换场景：第一行位置已经在原地，不用再垫）。 */
function reindentToMatch(fileContent: string, nodeStart: number, objectText: string): string {
  const indent = detectIndent(fileContent, nodeStart)
  const lines = objectText.split('\n')
  return lines.map((line, i) => (i === 0 ? line : indent + line)).join('\n')
}

/** 在数组最后一个元素之后插入新对象（数组为空则直接插到 `[` 之后）。 */
function insertBeforeArrayClose(fileContent: string, arrayNode: ts.ArrayLiteralExpression, newObjectText: string): string {
  const elements = arrayNode.elements
  const closeBracketPos = arrayNode.getEnd() - 1 // 数组字面量的最后一个字符就是 ']'

  if (elements.length === 0) {
    const openBracketPos = arrayNode.getStart() + 1 // '[' 之后
    const indented = reindentAllLines('  ', newObjectText)
    return (
      fileContent.slice(0, openBracketPos) +
      `\n${indented},\n` +
      fileContent.slice(openBracketPos, closeBracketPos) +
      fileContent.slice(closeBracketPos)
    )
  }

  const lastElement = elements[elements.length - 1]
  const lastEnd = lastElement.getEnd()
  // 最后一个元素后面到 ']' 之间可能已经有一个尾随逗号——有就在它之后插，
  // 没有就先补一个逗号，避免生成 "}{" 这种缺逗号的语法错误。
  const between = fileContent.slice(lastEnd, closeBracketPos)
  const hasTrailingComma = /^\s*,/.test(between)
  const insertPos = hasTrailingComma ? lastEnd + between.indexOf(',') + 1 : lastEnd
  const prefix = hasTrailingComma ? '' : ','
  const indent = detectIndent(fileContent, lastElement.getStart())
  const indented = reindentAllLines(indent, newObjectText)

  return (
    fileContent.slice(0, insertPos) +
    `${prefix}\n${indented}` +
    fileContent.slice(insertPos)
  )
}

function detectIndent(fileContent: string, pos: number): string {
  const lineStart = fileContent.lastIndexOf('\n', pos - 1) + 1
  return fileContent.slice(lineStart, pos)
}

/**
 * 真语法校验——不是数括号。魏征指出括号配对计数抓不住"漏逗号""引号提前
 * 闭合"这类最常见的错误；ts.transpileModule 走真解析，diagnostics 非空
 * 就说明生成的内容语法有问题，直接拒绝返回，不进入下一步 commit。
 */
function assertValidSyntax(content: string, filePath: string): void {
  const result = ts.transpileModule(content, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
  })
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const messages = errors
      .slice(0, 5)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ')
    throw new Error(`生成的文件语法校验未通过，已阻止发布：${messages}`)
  }
}
