import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import {
  serializeStringLiteral,
  serializeValue,
  serializeTourObject,
  insertOrReplaceTourObject,
  NonLiteralTourObjectError,
  TourArrayNotFoundError,
  TourSlugConflictError,
} from './tour-object-writer'

const FILE_PATH = 'src/lib/data/tours.ts'

/**
 * 真实 CTS tours.ts 结构的最小可信复刻：两个顶层数组（destinations / tours），
 * `Tier.slug` 的值恰好是 'discovery'（跟团品最常见的命名词撞车），
 * 以及一个用 spread 表达式而非纯字面量的真实团对象（对齐 tale-of-two-cities）。
 */
function baseFile(toursBody: string): string {
  return `import { SOME_CAMPAIGN } from '@/lib/campaigns/some-campaign';

export interface Tour {
  id: string;
  slug: string;
}

export const destinations = [
  {
    id: 'dest-1',
    slug: 'china',
    tiers: [
      { id: 'tier-1', slug: 'discovery', name: 'Discovery' },
    ],
  },
];

export const tours: Tour[] = [
${toursBody}
];
`
}

describe('serializeStringLiteral —— 转义', () => {
  it("撇号 (Xi'an)", () => {
    expect(serializeStringLiteral("Xi'an")).toBe("'Xi\\'an'")
  })
  it('反斜杠先转义，不会被后续规则二次处理坏', () => {
    expect(serializeStringLiteral('a\\b')).toBe("'a\\\\b'")
  })
  it('双引号不需要转义（外层是单引号）', () => {
    expect(serializeStringLiteral('say "hi"')).toBe(`'say "hi"'`)
  })
  it('字面换行符转义成 \\\\n —— docx 抽取文本最常见的坑', () => {
    expect(serializeStringLiteral('line1\nline2')).toBe("'line1\\nline2'")
  })
  it('回车符 / 制表符', () => {
    expect(serializeStringLiteral('a\rb\tc')).toBe("'a\\rb\\tc'")
  })
  it('中文原样保留', () => {
    expect(serializeStringLiteral('北京')).toBe("'北京'")
  })
  it('U+2028 / U+2029 转义 —— 不转义会产出非法 JS 字符串字面量', () => {
    expect(serializeStringLiteral('a b c')).toBe("'a\\u2028b\\u2029c'")
  })
})

describe('serializeValue / serializeTourObject', () => {
  it('嵌套数组/对象递归序列化', () => {
    const text = serializeTourObject({ slug: 'x', days: [{ day: 1, meals: ['Breakfast'] }] })
    expect(text).toContain("slug: 'x'")
    expect(text).toContain('day: 1')
    expect(text).toContain("'Breakfast'")
  })
  it('null / 空数组 / 空对象', () => {
    expect(serializeValue(null, 0)).toBe('null')
    expect(serializeValue([], 0)).toBe('[]')
    expect(serializeValue({}, 0)).toBe('{}')
  })
  it('非有限数字直接拒绝，不产出坏的 TS', () => {
    expect(() => serializeValue(Number.POSITIVE_INFINITY, 0)).toThrow()
  })
})

describe('insertOrReplaceTourObject —— 插入', () => {
  it('空数组插入', () => {
    const file = baseFile('')
    const result = insertOrReplaceTourObject({
      fileContent: file,
      filePath: FILE_PATH,
      arrayName: 'tours',
      slug: 'golden-china',
      newObjectFields: { id: 'golden-china', slug: 'golden-china', title: 'Golden China' },
    })
    expect(result.mode).toBe('inserted')
    expect(result.content).toContain("slug: 'golden-china'")
    expect(result.content).toContain("title: 'Golden China'")
  })

  it('已有数组末尾插入（原本带尾随逗号）', () => {
    const file = baseFile(`  { id: 'essentials', slug: 'essentials' },`)
    const result = insertOrReplaceTourObject({
      fileContent: file,
      filePath: FILE_PATH,
      arrayName: 'tours',
      slug: 'golden-china',
      newObjectFields: { id: 'golden-china', slug: 'golden-china' },
    })
    expect(result.mode).toBe('inserted')
    expect(result.content).toContain("slug: 'essentials'")
    expect(result.content).toContain("slug: 'golden-china'")
    // 两个对象之间必须有逗号分隔，不能粘连
    expect(result.content).not.toMatch(/\}\s*\{/)
  })

  it('插入对象内部属性的缩进必须比外层花括号多一级，不能跟 { 平级（真实 PR #139 实测发现的坑）', () => {
    const file = baseFile(`  { id: 'essentials', slug: 'essentials' },`)
    const result = insertOrReplaceTourObject({
      fileContent: file,
      filePath: FILE_PATH,
      arrayName: 'tours',
      slug: 'golden-china',
      newObjectFields: { id: 'golden-china', slug: 'golden-china' },
    })
    const lines = result.content.split('\n')
    const openBraceIdx = lines.findIndex((l, i) => l.trim() === '{' && lines[i + 1]?.includes("id: 'golden-china'"))
    expect(openBraceIdx).toBeGreaterThan(-1)
    const braceIndent = lines[openBraceIdx].match(/^\s*/)![0].length
    const propIndent = lines[openBraceIdx + 1].match(/^\s*/)![0].length
    expect(propIndent).toBeGreaterThan(braceIndent)
  })

  it('已有数组末尾插入（原本没有尾随逗号）—— 必须自动补逗号，不能产出语法错误', () => {
    const file = baseFile(`  { id: 'essentials', slug: 'essentials' }`)
    const result = insertOrReplaceTourObject({
      fileContent: file,
      filePath: FILE_PATH,
      arrayName: 'tours',
      slug: 'golden-china',
      newObjectFields: { id: 'golden-china', slug: 'golden-china' },
    })
    expect(result.mode).toBe('inserted')
    // 两个对象之间必须补上逗号，不能产出 "}{" 或 "} {"（缺逗号语法错误）
    expect(result.content).not.toMatch(/\}\s*\{/)
    const out = ts.transpileModule(result.content, { reportDiagnostics: true })
    const errors = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
    expect(errors).toHaveLength(0)
  })

  it('不会跟 destinations 数组或 Tier.slug 撞（子牙问题1a）—— 只往 tours 数组插', () => {
    const file = baseFile(`  { id: 'essentials', slug: 'essentials' },`)
    const result = insertOrReplaceTourObject({
      fileContent: file,
      filePath: FILE_PATH,
      arrayName: 'tours',
      slug: 'discovery-express', // slug 本身包含 'discovery'，跟 Tier.slug 撞词但不完全相等
      newObjectFields: { id: 'discovery-express', slug: 'discovery-express' },
    })
    // 新对象必须出现在 tours 数组里，而不是被插进 destinations
    const toursSectionStart = result.content.indexOf('export const tours')
    expect(result.content.indexOf("slug: 'discovery-express'")).toBeGreaterThan(toursSectionStart)
  })
})

describe('insertOrReplaceTourObject —— 替换', () => {
  it('按 slug 替换纯字面量对象', () => {
    const file = baseFile(`  { id: 'essentials', slug: 'essentials', price: 'NZD $3,880' },`)
    const result = insertOrReplaceTourObject({
      fileContent: file,
      filePath: FILE_PATH,
      arrayName: 'tours',
      slug: 'essentials',
      newObjectFields: { id: 'essentials', slug: 'essentials', price: 'NZD $4,080' },
    })
    expect(result.mode).toBe('replaced')
    expect(result.content).toContain("price: 'NZD $4,080'")
    expect(result.content).not.toContain('NZD $3,880')
  })

  it('命中非字面量表达式（spread + 成员访问）时拒绝自动覆盖 —— 子牙问题1b / 魏征B1.3', () => {
    const file = baseFile(
      `  {\n    id: 'tale-of-two-cities',\n    slug: 'tale-of-two-cities',\n    departureDates: [...SOME_CAMPAIGN.heroDepartureOrder, '18 March 2027'],\n  },`,
    )
    expect(() =>
      insertOrReplaceTourObject({
        fileContent: file,
        filePath: FILE_PATH,
        arrayName: 'tours',
        slug: 'tale-of-two-cities',
        newObjectFields: { id: 'tale-of-two-cities', slug: 'tale-of-two-cities' },
      }),
    ).toThrow(NonLiteralTourObjectError)
  })

  it('目标数组声明找不到时明确报错，不是静默失败', () => {
    const file = `export const somethingElse = [];`
    expect(() =>
      insertOrReplaceTourObject({
        fileContent: file,
        filePath: FILE_PATH,
        arrayName: 'tours',
        slug: 'golden-china',
        newObjectFields: { slug: 'golden-china' },
      }),
    ).toThrow(TourArrayNotFoundError)
  })

  it('文件里已有重复 slug 时拒绝猜测该改哪个', () => {
    const file = baseFile(`  { id: 'a', slug: 'dup' },\n  { id: 'b', slug: 'dup' },`)
    expect(() =>
      insertOrReplaceTourObject({
        fileContent: file,
        filePath: FILE_PATH,
        arrayName: 'tours',
        slug: 'dup',
        newObjectFields: { slug: 'dup' },
      }),
    ).toThrow(TourSlugConflictError)
  })
})

describe('insertOrReplaceTourObject —— 语法校验兜底', () => {
  it('正常插入/替换后的结果必须是能通过 TS 语法解析的合法内容', () => {
    const file = baseFile(`  { id: 'essentials', slug: 'essentials' },`)
    const result = insertOrReplaceTourObject({
      fileContent: file,
      filePath: FILE_PATH,
      arrayName: 'tours',
      slug: 'golden-china',
      newObjectFields: {
        id: 'golden-china',
        slug: 'golden-china',
        title: "Golden China — Xi'an & Beijing",
        itinerary: [{ day: 1, title: 'Day 1', meals: ['Breakfast', 'Dinner'] }],
      },
    })
    // 语法校验已经在 insertOrReplaceTourObject 内部做过（不通过会直接抛错），
    // 走到这里就是已经通过校验的证明；再解析一次做端到端确认。
    const out = ts.transpileModule(result.content, { reportDiagnostics: true })
    const errors = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
    expect(errors).toHaveLength(0)
  })
})
