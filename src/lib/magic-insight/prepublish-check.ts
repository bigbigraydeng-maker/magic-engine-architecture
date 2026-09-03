/**
 * Magic Insight 研究报告发布前的机械核查闸。
 *
 * 存在的原因（2026-09-03 事故）：两份对外研究报告（Vol.01 中国入境游、
 * Vol.02 中国→澳洲物流）在起草时未跑任何实时数据查询，却给自造数字配上了
 * 权威来源标注（ABS / NIA / Google Ads Keyword Planner / Trip.com 财报），
 * 直接违反 CLAUDE.md 铁律 8。改稿后仍在修正版里留下一个 10 倍单位错误
 * （A$82.6 billion 写成「A$82.6 亿」，应为 826 亿）。
 *
 * 教训不是"下次记得检查"——靠自觉的清单就是 CLAUDE.md 铁律 3 说的断头管道。
 * 这里把每一类踩过的错变成可机械拦截的规则。
 *
 * 与既有模块的分工（Reuse First）：
 * - `market-intel/grounding.ts` 已实现"摘要里的实体与数字能否在原文找到"，
 *   本模块直接复用其 `extractNumbers`，不重复实现数字抽取；
 * - 但 grounding.ts 的注释明确把"中英数量级换算"（$150 million ↔ 1.5亿）
 *   列为自己不覆盖的已知边界——那恰好是本次事故的错因，故由本模块补上。
 *
 * 定位：这是**最低限度的机械闸**，不是完美事实核查。它拦不住"数字是编的但
 * 内部自洽"这种情况——那需要 receipt（实时拉取凭证）而不是文本分析，所以
 * `searchMetricWithoutReceipt` 走的是凭证路线而非文本路线。
 */

import { extractNumbers } from '../market-intel/grounding'

export type CheckSeverity = 'block' | 'warn'

export interface PrepublishFinding {
  /** 规则 ID，稳定不变，便于 CI 里按规则豁免。 */
  rule: string
  severity: CheckSeverity
  message: string
  /** 命中位置的原文片段，便于人工定位。 */
  excerpt: string
}

export interface PrepublishInput {
  /** 报告全文（HTML 或纯文本均可）。 */
  source: string
  /**
   * 声称做过的一手调研的产物路径（名单 / 评分表 / 原始记录）。
   * 报告里出现"抽样 N 家""实地走访"等表述时必须非空。
   */
  fieldworkArtifacts?: string[]
  /**
   * 搜索量 / CPC / SERP 占位等指标的实时拉取凭证路径。
   * CLAUDE.md 铁律 8：这类数字必须来自 DataForSEO 或 GSC，不能估不能编。
   */
  dataPullReceipts?: string[]
}

/** 数量级换算表，统一折算到基本单位。 */
const SCALE_UNITS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^亿$/, 1e8],
  [/^万$/, 1e4],
  [/^(?:b|bn|billion)$/i, 1e9],
  [/^(?:m|mn|million)$/i, 1e6],
  [/^(?:k|thousand)$/i, 1e3],
]

/** 自证清白式表述——主动邀请客户去核对，而核对一定失败时风险最高。 */
const SELF_CERTIFYING_PATTERNS: ReadonlyArray<RegExp> = [
  /所有数字均可(?:反向)?溯源/,
  /全部(?:数据)?均?可独立验证/,
  /每一个数字都(?:可|能)(?:被)?追溯/,
  /未采购任何付费数据订阅/,
  /数据(?:全部|均)来自公开可查/,
]

/** 声称做过一手调研的表述。 */
const FIELDWORK_PATTERNS: ReadonlyArray<RegExp> = [
  /抽样(?:约)?\s*\d+\s*(?:家|个|位|份)/,
  /样本量(?:约)?\s*\d+/,
  /实地(?:走访|调研|考察)/,
  /本院(?:调研|访谈|抽查)/,
  /审计时间[：:]/,
  /(?:我们|本院)(?:访谈|调查)了\s*\d+/,
]

/** 必须有实时拉取凭证的指标词。 */
const SEARCH_METRIC_PATTERNS: ReadonlyArray<RegExp> = [
  /月(?:均)?搜索量/,
  /搜索量\s*[\d,]+/,
  /\bCPC\b/,
  /每月搜索/,
  /SERP\s*(?:占位|排名|首页)/,
  /关键词(?:难度|KD)/,
]

/** 数据分层标注词——任一出现即视为该数字已标口径。 */
const TIER_MARKERS: ReadonlyArray<string> = [
  '已核实',
  '待核实',
  '未核实',
  'Official',
  'Industry',
  'Estimate',
  'Search',
  '判断',
  '推算',
  '行业口径',
  '货代口径',
  '官方',
  '待核',
]

/** 头条数字所在的容器 class——这些位置的数字必须带口径标注。 */
const HEADLINE_VALUE_CLASSES: ReadonlyArray<string> = ['kpi-value', 'cover-num', 's-metric', 'stat-value']

const TIER_LOOKAHEAD_CHARS = 700
const SCALE_PAIR_WINDOW_CHARS = 60
/** 允许的相对误差——真实文档里 826 亿 vs 82.6b 会有四舍五入。 */
const SCALE_TOLERANCE = 0.02

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}

function toBaseUnits(rawNumber: string, unit: string): number | null {
  const value = Number(rawNumber.replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  for (const [pattern, multiplier] of SCALE_UNITS) {
    if (pattern.test(unit)) return value * multiplier
  }
  return null
}

/** 把基本单位数值折算回中文数量级，用于在报错信息里直接给出正确写法。 */
function formatCjkScale(baseValue: number, cjkUnit: string): string {
  const divisor = cjkUnit === '亿' ? 1e8 : 1e4
  const scaled = baseValue / divisor
  // 整数就不带小数点，避免 "1200.0 亿" 这种读起来别扭的写法。
  return Number.isInteger(scaled) ? scaled.toLocaleString('en-US') : scaled.toFixed(1)
}

interface ScalePair {
  cjk: { raw: string; unit: string }
  latin: { raw: string; unit: string }
  excerpt: string
}

/**
 * 找出「中文数量级 + 拉丁数量级」成对出现的片段。
 * 命中形态如：`A$826 亿（A$82.6 b）` 或 `A$82.6 billion（826 亿）`。
 */
function findScalePairs(text: string): ScalePair[] {
  const pairs: ScalePair[] = []
  const cjkFirst =
    /([\d][\d,]*(?:\.\d+)?)\s*(亿|万)[\s\S]{0,60}?([\d][\d,]*(?:\.\d+)?)\s*(b\b|bn\b|billion|m\b|mn\b|million|k\b|thousand)/gi
  const latinFirst =
    /([\d][\d,]*(?:\.\d+)?)\s*(b\b|bn\b|billion|m\b|mn\b|million|k\b|thousand)[\s\S]{0,60}?([\d][\d,]*(?:\.\d+)?)\s*(亿|万)/gi

  // 用 exec 循环而不是 for...of matchAll()——迭代器展开需要 target es2015+，
  // 本仓库 tsconfig 没设，会报 TS2802。
  // 这条坑 market-intel/grounding.ts 的注释里已经写过（它为此改用 Array.from），
  // 复用那个模块却没照做，2026-09-03 当场又踩了一次。
  let match = cjkFirst.exec(text)
  while (match !== null) {
    pairs.push({
      cjk: { raw: match[1], unit: match[2] },
      latin: { raw: match[3], unit: match[4] },
      excerpt: match[0].slice(0, SCALE_PAIR_WINDOW_CHARS * 2),
    })
    match = cjkFirst.exec(text)
  }

  match = latinFirst.exec(text)
  while (match !== null) {
    pairs.push({
      cjk: { raw: match[3], unit: match[4] },
      latin: { raw: match[1], unit: match[2] },
      excerpt: match[0].slice(0, SCALE_PAIR_WINDOW_CHARS * 2),
    })
    match = latinFirst.exec(text)
  }
  return pairs
}

/** 规则 1：中英数量级换算必须自洽（本次事故的直接错因）。 */
export function checkScaleConversion(text: string): PrepublishFinding[] {
  const findings: PrepublishFinding[] = []
  for (const pair of findScalePairs(text)) {
    const cjkValue = toBaseUnits(pair.cjk.raw, pair.cjk.unit)
    const latinValue = toBaseUnits(pair.latin.raw, pair.latin.unit)
    if (cjkValue === null || latinValue === null || latinValue === 0) continue

    const relativeError = Math.abs(cjkValue - latinValue) / Math.abs(latinValue)
    if (relativeError <= SCALE_TOLERANCE) continue

    // 用「大/小 N 倍」而不是裸比值——0.10 倍这种说法人读起来要在脑子里再换算一次，
    // 而这条信息出现的时刻正是有人被拦住、最需要一眼看懂的时刻。
    const cjkIsSmaller = cjkValue < latinValue
    const fold = cjkIsSmaller ? latinValue / cjkValue : cjkValue / latinValue
    const direction = cjkIsSmaller ? '小' : '大'
    const corrected = cjkIsSmaller
      ? `应为 ${formatCjkScale(latinValue, pair.cjk.unit)}${pair.cjk.unit}`
      : `应为 ${formatCjkScale(latinValue, pair.cjk.unit)}${pair.cjk.unit}`

    findings.push({
      rule: 'scale-conversion-mismatch',
      severity: 'block',
      message:
        `数量级换算不一致：写的是 ${pair.cjk.raw}${pair.cjk.unit}，` +
        `但 ${pair.latin.raw}${pair.latin.unit} 折算下来是 ${formatCjkScale(latinValue, pair.cjk.unit)}${pair.cjk.unit}——` +
        `${direction}了 ${fold.toFixed(1)} 倍，${corrected}。（1 billion = 10 亿；1 million = 100 万）`,
      excerpt: pair.excerpt,
    })
  }
  return findings
}

/** 规则 2：货币金额用「亿/万」却没给出原始数量级——歧义风险。 */
export function checkUnpairedCjkScale(text: string): PrepublishFinding[] {
  const findings: PrepublishFinding[] = []
  const currencyCjk = /((?:A\$|US\$|NZ\$|\$|￥|人民币|澳元|美元)\s*[\d][\d,]*(?:\.\d+)?\s*(?:亿|万))/g
  const paired = new Set(findScalePairs(text).map((p) => `${p.cjk.raw}${p.cjk.unit}`))

  // exec 循环，理由同 findScalePairs：本仓库 tsconfig target 不支持迭代器展开。
  let m = currencyCjk.exec(text)
  while (m !== null) {
    const numeric = m[1].match(/([\d][\d,]*(?:\.\d+)?)\s*(亿|万)/)
    if (numeric && !paired.has(`${numeric[1]}${numeric[2]}`)) {
      findings.push({
        rule: 'scale-unit-unpaired',
        severity: 'warn',
        message:
          `货币金额「${m[1].trim()}」使用了中文数量级但未附原始口径。` +
          `建议写成「826 亿（A$82.6 b）」形式，让换算可被机械校验。`,
        excerpt: m[1].trim(),
      })
    }
    m = currencyCjk.exec(text)
  }
  return findings
}

/** 规则 3：禁止自证清白式表述——它邀请客户核对，而核对会失败。 */
export function checkSelfCertifyingClaims(text: string): PrepublishFinding[] {
  const findings: PrepublishFinding[] = []
  for (const pattern of SELF_CERTIFYING_PATTERNS) {
    const m = text.match(pattern)
    if (!m) continue
    findings.push({
      rule: 'self-certifying-claim',
      severity: 'block',
      message:
        `出现自证清白式表述「${m[0]}」。这类句子主动邀请读者核对全文每个数字，` +
        `一旦有任何一条不成立，损伤的是出品方信誉。改为逐条标注数据分层，不要做全局承诺。`,
      excerpt: m[0],
    })
  }
  return findings
}

/** 收集所有命中的短语，去重后保序——用于"补一份凭证即可解决"的整体式规则。 */
function collectMatches(text: string, patterns: ReadonlyArray<RegExp>): string[] {
  const hits: string[] = []
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m && !hits.includes(m[0])) hits.push(m[0])
  }
  return hits
}

/**
 * 规则 4：声称做过一手调研，必须有产物；否则不能写。
 *
 * 只报一条：补一份产物就能同时解决所有命中，逐条刷屏只会让人想把闸关掉。
 */
export function checkFieldworkArtifacts(
  text: string,
  artifacts: ReadonlyArray<string>
): PrepublishFinding[] {
  if (artifacts.length > 0) return []
  const hits = collectMatches(text, FIELDWORK_PATTERNS)
  if (hits.length === 0) return []

  return [
    {
      rule: 'fieldwork-without-artifact',
      severity: 'block',
      message:
        `声称做过一手调研（命中 ${hits.length} 处：${hits.join('、')}），但未登记任何产物。` +
        `调研若真做过，必须能拿出名单 / 评分表 / 原始记录；拿不出就不能写进报告。` +
        `用 --artifact <路径> 登记后重跑。`,
      excerpt: hits.join(' / '),
    },
  ]
}

/**
 * 规则 5：搜索量 / CPC / SERP 必须有实时拉取凭证（CLAUDE.md 铁律 8）。
 *
 * 同样只报一条——remediation 是单一动作：跑一次真实拉取并登记 receipt。
 */
export function checkSearchMetricReceipts(
  text: string,
  receipts: ReadonlyArray<string>
): PrepublishFinding[] {
  if (receipts.length > 0) return []
  const hits = collectMatches(text, SEARCH_METRIC_PATTERNS)
  if (hits.length === 0) return []

  return [
    {
      rule: 'search-metric-without-receipt',
      severity: 'block',
      message:
        `出现搜索类指标（命中 ${hits.length} 处：${hits.join('、')}）但无实时拉取凭证。` +
        `CLAUDE.md 铁律 8：搜索量 / KD / 点击数必须来自 DataForSEO 或 GSC，不能估不能编。` +
        `请先跑 src/lib/dataforseo/search-volume.ts，再用 --receipt <路径> 登记后重跑。`,
      excerpt: hits.join(' / '),
    },
  ]
}

/** 规则 6：来源清单里列了但正文没有数字用到它——装饰性引用。 */
export function checkOrphanSources(
  text: string,
  sourceNames: ReadonlyArray<string>
): PrepublishFinding[] {
  const findings: PrepublishFinding[] = []
  for (const name of sourceNames) {
    const trimmed = name.trim()
    if (trimmed.length < 3) continue
    // 出现次数 <= 1 说明只在来源清单里露过面，正文没有任何数字挂靠它。
    const occurrences = text.split(trimmed).length - 1
    if (occurrences > 1) continue
    findings.push({
      rule: 'orphan-source',
      severity: 'warn',
      message:
        `来源「${trimmed}」出现在来源清单里，但正文没有任何数字标注引用它。` +
        `装饰性引用是本次事故的典型特征——用不到就删掉。`,
      excerpt: trimmed,
    })
  }
  return findings
}

/** 规则 7：头条数字必须带数据分层标注。 */
export function checkHeadlineFiguresTiered(html: string): PrepublishFinding[] {
  const findings: PrepublishFinding[] = []
  for (const className of HEADLINE_VALUE_CLASSES) {
    const marker = `class="${className}"`
    let index = html.indexOf(marker)
    while (index !== -1) {
      const window = html.slice(index, index + TIER_LOOKAHEAD_CHARS)
      const hasTier = TIER_MARKERS.some((t) => window.includes(t))
      if (!hasTier) {
        findings.push({
          rule: 'untiered-headline-figure',
          severity: 'block',
          message:
            `头条数字（.${className}）附近 ${TIER_LOOKAHEAD_CHARS} 字符内没有数据分层标注。` +
            `每个显著数字都必须标明是「已核实 / 行业口径 / 推算 / 判断 / 待核」中的哪一类。`,
          excerpt: stripHtml(window).slice(0, 120),
        })
      }
      index = html.indexOf(marker, index + marker.length)
    }
  }
  return findings
}

export interface PrepublishReport {
  findings: PrepublishFinding[]
  blocking: PrepublishFinding[]
  warnings: PrepublishFinding[]
  passed: boolean
  /** 复用 grounding.ts 抽出的数字总数，用于粗略衡量文档的数字密度。 */
  numberCount: number
}

/**
 * 跑全部规则。
 *
 * `sourceNames` 需由调用方从来源清单里抽出——不同模板的来源块结构不同，
 * 交给调用方比在这里猜 DOM 结构更可靠。
 */
export function runPrepublishCheck(
  input: PrepublishInput,
  sourceNames: ReadonlyArray<string> = []
): PrepublishReport {
  const html = input.source
  const text = stripHtml(html)

  const findings: PrepublishFinding[] = [
    ...checkScaleConversion(text),
    ...checkUnpairedCjkScale(text),
    ...checkSelfCertifyingClaims(text),
    ...checkFieldworkArtifacts(text, input.fieldworkArtifacts ?? []),
    ...checkSearchMetricReceipts(text, input.dataPullReceipts ?? []),
    ...checkOrphanSources(text, sourceNames),
    ...checkHeadlineFiguresTiered(html),
  ]

  const blocking = findings.filter((f) => f.severity === 'block')
  const warnings = findings.filter((f) => f.severity === 'warn')

  return {
    findings,
    blocking,
    warnings,
    passed: blocking.length === 0,
    numberCount: extractNumbers(text).length,
  }
}
