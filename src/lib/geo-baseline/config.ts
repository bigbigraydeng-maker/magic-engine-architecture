/**
 * Magic Engine 2.0 · GEO Baseline —— 运行配置的读取与校验（Issue #883 / #917 · WP04A）
 *
 * 🔴 **这些函数从脚本里搬出来，是因为变异验证证明它们在脚本里测不到。**
 *    「`verified` 不许从清单非空推出来」和「`Number('60s')` 是 NaN」这两道闸
 *    原本只有注释守着 —— 拆掉它们，测试套件 0 条红。判据必须能被单独直测，
 *    否则它就只是一句话。
 *
 * 🔴 纯函数：不读 `process.env`、不调 `process.exit`。环境读取与退出留给脚本，
 *    这里只负责「给定输入 → 合法配置或明确错误」。
 */

import type { GeoOwnedDomainPolicy } from './types'

export class GeoConfigError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoConfigError'
    this.code = code
  }
}

/** 必填字符串。空串 / 全空白 = 没填。 */
export function requireString(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim().length === 0) {
    throw new GeoConfigError(
      'missing_required',
      `缺环境变量 ${name} —— 这一项属于 PM 冻结的 manifest，脚本不替它填默认值。`,
    )
  }
  return raw.trim()
}

/**
 * 必填数值。
 *
 * 🔴 `Number('60s')` 是 `NaN`，而 `??` **拦不住 NaN** —— 必须显式判有限。
 *    漏了这一条：`setTimeout(fn, NaN)` 会被当成 1ms，每次调用瞬间中止；
 *    价格填成 0 则每次调用都算 $0，预算闸从此形同虚设。
 */
export function requireNumber(
  name: string,
  raw: string | undefined,
  opts: { positive?: boolean } = {},
): number {
  const text = requireString(name, raw)
  const n = Number(text)
  if (!Number.isFinite(n)) {
    throw new GeoConfigError('not_finite', `环境变量 ${name}="${text}" 不是一个有限数字。`)
  }
  if (opts.positive === true && n <= 0) {
    throw new GeoConfigError(
      'not_positive',
      `环境变量 ${name}="${text}" 必须大于 0。填 0 会让每一次调用都算成 $0，预算闸从此形同虚设。`,
    )
  }
  return n
}

/** 可选数值：没填就用兜底；填了就必须是**有限正数**，NaN 一律拒。 */
export function optionalNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n <= 0) {
    throw new GeoConfigError('not_positive', `环境变量 ${name}="${raw}" 必须是一个大于 0 的有限数字。`)
  }
  return n
}

/**
 * 自有域名政策。
 *
 * 🔴 **`verified` 必须来自一个独立的显式背书，绝不能从「清单非空」推出来。**
 *    这是复审确认的一条真实违规（原实现是 `verified: domains.length > 0`）。
 *
 *    「有人填了几个域名」和「PM 核实过这就是全部自有域名与别名」是两件事。
 *    漏填一个别名，那个别名下的每一条引用都会被记成 `{known:true, value:false}` ——
 *    也就是「我们核实过，这不是他的」—— 而事实是根本没人核实过。
 *    这条结论会落进 `geo_evidence.citations` 的 jsonb，**不可变、永远改不掉**。
 *    R10 / GEO 契约 M8 至今未决（PM 提供域名事实 + Build Control Room 定维护方式）。
 */
export function buildOwnedDomainPolicy(args: {
  domainsCsv: string | undefined
  verifiedBy: string | undefined
}): GeoOwnedDomainPolicy {
  const domains = (args.domainsCsv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const attestation = (args.verifiedBy ?? '').trim()

  if (attestation.length === 0) {
    // 没有背书 ⇒ 未核实。清单照样带着（给人看），但每条引用一律记「未知」。
    return { verifiedDomains: domains, verified: false }
  }
  if (domains.length === 0) {
    throw new GeoConfigError(
      'attested_empty_list',
      'GEO_OWNED_DOMAINS_VERIFIED_BY 已填，但 GEO_OWNED_DOMAINS 是空的 —— 核实一份空清单没有意义。',
    )
  }
  return { verifiedDomains: domains, verified: true }
}
