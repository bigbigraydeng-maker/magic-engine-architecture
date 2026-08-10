/**
 * validate —— 两层校验，都在这里汇合（Issue #878 / WP06）。
 *
 * 🔴 不查 Supabase。红线短语由调用方作为 `RedlineCheckInput` 显式传入；
 *    provider 侧校验结果由调用方作为 `ProviderCheckInput` 显式传入（或用纯
 *    函数算好再传）——本文件零 provider 客户端 import。
 * 🔴 红线短语缺失 / 查询失败必须 fail closed，绝不能被当成「没有红线」——
 *    与 `src/lib/factory/strategist.ts` 的 `gate1` 同一语义（「查不到红线 ≠
 *    没有红线」），同样大小写不敏感子串匹配。
 * 🔴 provider 校验「没算过」不许被表示成「通过」——`evaluated:false` 直接判
 *    不通过，不是默认放行。
 */

import type {
  PageDiffResult,
  PageOptimizationRequest,
  PageValidationResult,
  ProviderCheckInput,
  RedlineCheckInput,
} from './types'

export function validatePageChange(
  request: PageOptimizationRequest,
  diff: PageDiffResult,
  redline: RedlineCheckInput,
  providerCheck: ProviderCheckInput,
): PageValidationResult {
  if (!diff.ok) {
    return { ok: false, reason: `diff 不可用：${diff.reason}`, violations: [] }
  }

  const violations: string[] = []

  for (const change of diff.changes) {
    if (!change.changed) continue
    if (request.constraints.doNotTouch.includes(change.field)) {
      violations.push(`字段 "${change.field}" 在 doNotTouch 名单内，不许改动`)
    }
  }

  if (!redline.available) {
    return {
      ok: false,
      reason: `客户红线短语不可用：${redline.reason}——按 fail-closed 原则一律拒绝，不当成"没有红线"`,
      violations,
    }
  }

  const changedSurface = diff.changes
    .filter((c) => c.changed)
    .map((c) => c.after)
    .join(' | ')
    .toLowerCase()
  for (const phrase of redline.phrases) {
    const needle = phrase.trim().toLowerCase()
    if (needle && changedSurface.includes(needle)) {
      violations.push(`命中客户红线短语："${phrase}"`)
    }
  }

  if (!providerCheck.evaluated) {
    return {
      ok: false,
      reason: `provider 侧校验未执行：${providerCheck.reason}——没算过不能算通过`,
      violations,
    }
  }
  if (!providerCheck.passed) {
    violations.push(...providerCheck.violations)
  }

  return violations.length === 0 ? { ok: true } : { ok: false, reason: '校验未通过', violations }
}
