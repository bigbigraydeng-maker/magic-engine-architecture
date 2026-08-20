/**
 * "AI 只做摘要不许编事实" 这条红线的技术保障（设计文档 §二第 4 条，2026-08-20
 * 设计审魏征指出的漏洞：v1 里这条约束只是一句 prompt 指令，没有任何后置校验）。
 *
 * 做法是"最低限度的自动核对"，不是完美的事实核查：抽取摘要里出现的英文专有名词
 * （公司名/产品名/型号通常在中译文里保持原文不译，比如 "OpenAI"、"GPT-5"）和
 * 数字，逐个核对是否能在抓取到的原文摘要里找到。核对不通过不等于"一定是编的"，
 * 只是触发人工翻查——数字检查尤其粗糙（比如英文"$150 million"如果被摘要成
 * "1.5亿美元"，数字形态变了，会被误判成不通过），这是已知、可接受的限制：
 * 宁可多几条被搁置等人看一眼，也不要让真编造的内容自动溜出去。
 */

// 续接片段不要求大写开头——"GPT-5"、"GPT-4o" 这类型号后缀是数字，
// 之前要求续接也大写会把 "-5" 切掉，只剩 "GPT"。
const LATIN_ENTITY_RE = /[A-Z][A-Za-z0-9]*(?:[\s-][A-Za-z0-9]+)*/g
const NUMBER_RE = /\d[\d,.]*\d|\d/g

// 太短/太通用，不值得单独核对（避免"A"这种字母、或版本号里孤立的"2"触发无意义的失败）。
const MIN_ENTITY_LENGTH = 2

export function extractLatinEntities(text: string): string[] {
  const matches = text.match(LATIN_ENTITY_RE) ?? []
  // Array.from 而不是 [...Set]——展开语法对 Set 的迭代需要 target es2015+，
  // 这个仓库的 tsconfig 没设，Array.from 是普通方法调用，不受影响。
  return Array.from(new Set(matches.filter((m) => m.length >= MIN_ENTITY_LENGTH)))
}

export function extractNumbers(text: string): string[] {
  const matches = text.match(NUMBER_RE) ?? []
  // 只保留 2 位数以上的数字——个位数太通用（"3 个功能"这种），核对意义不大。
  return Array.from(new Set(matches.filter((m) => m.replace(/[,.]/g, '').length >= 2)))
}

export interface GroundingResult {
  passed: boolean
  ungroundedEntities: string[]
  ungroundedNumbers: string[]
}

export function checkGrounding(summaryZh: string, rawExcerpt: string): GroundingResult {
  const haystack = rawExcerpt.toLowerCase()

  const entities = extractLatinEntities(summaryZh)
  const ungroundedEntities = entities.filter((e) => !haystack.includes(e.toLowerCase()))

  const numbers = extractNumbers(summaryZh)
  const ungroundedNumbers = numbers.filter((n) => !rawExcerpt.includes(n))

  return {
    passed: ungroundedEntities.length === 0 && ungroundedNumbers.length === 0,
    ungroundedEntities,
    ungroundedNumbers,
  }
}
