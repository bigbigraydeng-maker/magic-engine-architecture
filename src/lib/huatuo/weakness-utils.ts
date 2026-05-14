/**
 * 华佗 weakness 归一化工具 — 纯函数，无外部依赖（client & server 都能用）。
 *
 * Reference: ROADMAP.md P8.10.S3
 *
 * 解决的问题：Claude 经常把维度名写在 weakness.text 的开头（旧习惯），
 * 但结构化的 dimension 字段填错（常常全填成同一个值）。
 * 这里以「文字前缀」为最可信来源纠正分组。
 */

import type { SelfGradeWeakness, SelfGradeDimension, WeaknessSeverity } from './types'

/** 七维有效键 */
export const VALID_DIMENSIONS: SelfGradeDimension[] = [
  'realism', 'completeness', 'fde_actionability', 'roi_alignment',
  'prioritization', 'resource_match', 'innovation',
]

/**
 * 从薄弱点文本开头检测维度名前缀。
 * 命中则返回该维度 + 剥掉前缀（及分隔符）后的干净文本。
 * 未命中返回 { dimension: null, cleanedText: 原文 }。
 */
export function extractDimensionPrefix(
  text: string,
): { dimension: SelfGradeDimension | null; cleanedText: string } {
  const lower = text.toLowerCase()
  for (const dim of VALID_DIMENSIONS) {
    if (lower.startsWith(dim)) {
      // 剥掉维度名 + 紧跟的空白 / 冒号（半角或全角）
      const rest = text.slice(dim.length).replace(/^[\s:：]+/, '')
      return { dimension: dim, cleanedText: rest || text }
    }
  }
  return { dimension: null, cleanedText: text }
}

/**
 * 把 Claude 返回的 / DB 里旧格式的 weaknesses 归一成结构化 SelfGradeWeakness[]。
 *
 * 兼容输入：
 *   1. 新结构化格式 [{ dimension, severity, text }]
 *   2. 旧字符串格式 ["realism 边际风险：..."]
 *   3. 异常 → []
 *
 * 维度判定优先级：**文字前缀 > dimension 字段 > 默认 completeness**
 * （因为实测 Claude 的文字前缀比结构化字段更可靠）
 */
export function coerceWeaknesses(raw: unknown): SelfGradeWeakness[] {
  if (!Array.isArray(raw)) return []

  const result: SelfGradeWeakness[] = []
  for (const item of raw) {
    let text = ''
    let dimFromField: SelfGradeDimension | null = null
    let severity: WeaknessSeverity = 'medium'

    if (typeof item === 'string') {
      text = item.trim()
    } else if (item && typeof item === 'object' && 'text' in item) {
      const obj = item as Record<string, unknown>
      text = typeof obj.text === 'string' ? obj.text.trim() : ''
      if (
        typeof obj.dimension === 'string' &&
        VALID_DIMENSIONS.includes(obj.dimension as SelfGradeDimension)
      ) {
        dimFromField = obj.dimension as SelfGradeDimension
      }
      if (obj.severity === 'high' || obj.severity === 'medium' || obj.severity === 'low') {
        severity = obj.severity
      }
    }

    if (!text) continue

    // 文字前缀优先 — Claude 经常把维度名写在 text 开头但 dimension 字段填错
    const { dimension: dimFromText, cleanedText } = extractDimensionPrefix(text)
    const dimension = dimFromText ?? dimFromField ?? 'completeness'

    result.push({ dimension, severity, text: cleanedText })
  }
  return result
}
