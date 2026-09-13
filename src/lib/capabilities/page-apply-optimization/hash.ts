/**
 * page-apply-optimization · hashing + naming utilities（纯函数）
 *
 * 🔴 canonical JSON: 键按字典序、无空格、无 undefined。为的是给 `PageFieldDiff[]`
 *    算出一份**可跨进程稳定**的 hash —— 只要 shape 一致，任何 process 都算出同一个值。
 *
 * 🔴 分支命名走确定性 —— 同一个 idempotency-key 只会命名同一个分支，
 *    provider 端 push/open PR 都幂等（PM Change 4 的一半：Bridge 认领动作必须真能落）。
 */

import { createHash } from 'crypto'
import type { PageFieldDiff } from '@/lib/page-optimization'

/**
 * Canonical stringify —— 键按字典序、数组保持原顺序、字符串原样。
 * 只覆盖本模块用得到的形状（`PageFieldDiff[]`），不试图变成通用 JSON 序列化器。
 */
function canonicalStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k]))
        .join(',') +
      '}'
    )
  }
  return 'null'
}

/**
 * 对通过 `validatePageChange()` 的 `PageDiffResult.changes` 算 SHA-256（前 40 位）。
 *
 * 🔴 只对 `field/before/after/changed` 四个字段负责。任何多余字段一律忽略 ——
 *    hash 的 stability 判据是「同一份 diff 内容」，不是「同一个 diff 对象引用」。
 */
export function canonicalDiffHash(changes: readonly PageFieldDiff[]): string {
  const normalized = changes.map((c) => ({
    field: c.field,
    before: c.before,
    after: c.after,
    changed: c.changed,
  }))
  return createHash('sha256').update(canonicalStringify(normalized)).digest('hex').slice(0, 40)
}

/**
 * idempotency key = `(page_url, page_version_token, validated_diff_hash)` 的 SHA-256（前 24 位）。
 * spec §7：Provider 端幂等键 = `sha256(idempotency_key + step_key)`；本函数只算前一半。
 */
export function idempotencyKeyFromInput(
  pageUrl: string,
  pageVersionToken: string,
  validatedDiffHash: string,
): string {
  const canonical = canonicalStringify({
    page_url: pageUrl,
    page_version_token: pageVersionToken,
    validated_diff_hash: validatedDiffHash,
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24)
}

/**
 * 分支名 —— `me/page-apply/<idempotency-key>`。
 *
 * `me/` 前缀防跟 GitHub Actions / 用户自建分支重名；`page-apply/` 前缀标识产地
 * （未来若 `ads.apply_*` 也自动化了，走 `me/ads-apply/` 与本命名空间隔开）。
 */
export function branchNameForRun(idempotencyKey: string): string {
  return `me/page-apply/${idempotencyKey}`
}
