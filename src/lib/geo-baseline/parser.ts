/**
 * Magic Engine 2.0 · GEO Baseline —— parser（Issue #883 / #917 · WP04A）
 *
 * 实现 WP04 的 `GeoParser`（`src/lib/geo-measurement-runtime/types.ts:127`）：
 * 把 provider 存下来的原始响应信封读成 `{ confidence, citations }`。
 *
 * 🔴 **确定性，不调 LLM。** 这一层做的是「把结构化载荷读出来」，不是「判断答案好不好」。
 *    七个指标（`qualified_mention` 等）的计算**不在本轮范围**：全仓至今没有任何指标计算
 *    实现，且判据 M1 仍是登记在案的未决项。WP08 基线的产物是**观测 + 证据**，
 *    指标是 WP05 / WP10 的事。
 *
 * 🔴 **`confidence` 的语义（v1，刻意保守）**：它衡量的是**读取保真度**，不是答案质量。
 *    一个确定性解析器读一个结构化信封，读通了就是读通了 —— 这时报 1.0 是诚实的，
 *    人为压低是演戏。读不通的部分（URL 解析不出主机名）按比例扣。
 *    ⚠️ 一旦 M1 落地、parser 开始判「有没有被提及」，confidence 的含义就变了，
 *    **那时必须换 `parserVersion`** —— 否则新旧两侧会被 WP02 当成同一把尺子来比
 *    （GEO 契约 §6.1 第 2 条）。这条约束写在这里，是因为它只在这个文件里成立。
 */

import type { GeoCitation, GeoMaybeUnknown } from '@/lib/geo-measurement'
import type { GeoParser, GeoParseResult, GeoProviderRequest } from '@/lib/geo-measurement-runtime'
import type { GeoBaselineParserConfig, GeoRawResponseEnvelope } from './types'

const ENVELOPE_VERSION = 'geo-baseline/openai/v1'

/** 主机名归一化：小写 + 去掉一个前导 `www.`。不做别的 —— 别的都是猜。 */
export function normaliseHost(host: string): string {
  const lower = host.trim().toLowerCase()
  return lower.startsWith('www.') ? lower.slice(4) : lower
}

/**
 * 域名归属判定。
 *
 * 🔴 未核实 ⇒ `{known:false}`，**不是 `false`**。`false` 会被下游读成
 *    「核实过，不是他的」（GEO 契约 §3.4：补 0 / 补 false 会被读成一个不同的事实）。
 * 🔴 子域按「同域或以 `.<域名>` 结尾」算自有，不做模糊匹配。
 */
export function classifyOwnedDomain(
  host: string,
  policy: GeoBaselineParserConfig['ownedDomains'],
): GeoMaybeUnknown<boolean> {
  if (!policy.verified) {
    return { known: false, reason: 'not_recorded_by_source' }
  }
  const target = normaliseHost(host)
  const owned = policy.verifiedDomains.some((raw) => {
    const d = normaliseHost(raw)
    return d.length > 0 && (target === d || target.endsWith(`.${d}`))
  })
  return { known: true, value: owned }
}

interface ParsedEnvelope {
  readonly ok: true
  readonly envelope: GeoRawResponseEnvelope
}
interface ParsedEnvelopeFailure {
  readonly ok: false
  readonly errorCode: string
  readonly message: string
}

/** 读信封。**读不通就是失败观测**，绝不退化成「空引用的成功观测」。 */
export function parseEnvelope(rawResponse: string): ParsedEnvelope | ParsedEnvelopeFailure {
  let decoded: unknown
  try {
    decoded = JSON.parse(rawResponse)
  } catch {
    return { ok: false, errorCode: 'envelope_not_json', message: 'raw response is not valid JSON' }
  }
  if (typeof decoded !== 'object' || decoded === null) {
    return { ok: false, errorCode: 'envelope_not_object', message: 'raw response is not an object' }
  }
  const e = decoded as Partial<GeoRawResponseEnvelope>
  if (e.envelope !== ENVELOPE_VERSION) {
    return {
      ok: false,
      errorCode: 'envelope_version_unsupported',
      message: `expected envelope "${ENVELOPE_VERSION}", got ${JSON.stringify(e.envelope)}`,
    }
  }
  if (typeof e.text !== 'string' || !Array.isArray(e.citationUrls)) {
    return { ok: false, errorCode: 'envelope_malformed', message: 'envelope is missing text or citationUrls' }
  }
  return { ok: true, envelope: decoded as GeoRawResponseEnvelope }
}

/** 一条 URL → 一条 `GeoCitation`；主机名解析不出来就整条丢弃并计入保真度扣分。 */
function toCitation(url: string, config: GeoBaselineParserConfig): GeoCitation | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  if (host.trim().length === 0) return null
  return {
    url,
    domain: normaliseHost(host),
    ownedDomain: classifyOwnedDomain(host, config.ownedDomains),
    // 🔴 页面台账缺失时永远是「不可算」，绝不是 0 / false / 省略字段。
    ownedPage: { status: 'not_computable', reason: config.ownedPages.reason },
  }
}

/**
 * 建一个 parser。
 *
 * @param config 自有域名清单（R10 未决前 `verified:false`）与页面归属政策（R4 未决 ⇒ 不可算）。
 */
export function createGeoBaselineParser(config: GeoBaselineParserConfig): GeoParser {
  return (rawResponse: string, _request: GeoProviderRequest): GeoParseResult => {
    const parsed = parseEnvelope(rawResponse)
    if (!parsed.ok) {
      return { ok: false, errorCode: parsed.errorCode, message: parsed.message }
    }
    const urls = parsed.envelope.citationUrls
    const citations: GeoCitation[] = []
    for (const url of urls) {
      const citation = typeof url === 'string' ? toCitation(url, config) : null
      if (citation !== null) citations.push(citation)
    }
    // 读取保真度：能读成结构的引用占比。一条引用都没有是**一个有内容的结论**
    //（「这条回答一个来源都没引」），不是读取失败 —— 此时保真度满分。
    const confidence = urls.length === 0 ? 1 : citations.length / urls.length
    return { ok: true, confidence, citations }
  }
}
