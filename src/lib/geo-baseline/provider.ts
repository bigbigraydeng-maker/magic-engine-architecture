/**
 * Magic Engine 2.0 · GEO Baseline —— OpenAI provider 适配器（Issue #883 / #917 · WP04A）
 *
 * 实现 WP04 的 `GeoProvider`（`src/lib/geo-measurement-runtime/types.ts:111-115`）。
 *
 * 🔴 **为什么不包一层 `src/lib/ai-tracker/runners/openai.ts`**，两条独立理由：
 *
 *    ① **四态塌成一态。** `RunnerOutput` 把限流 / 超时 / 明确错误全部收进一个
 *       `error_message: string`（`runners/types.ts:34`）。WP04 靠这四态决定要不要自动
 *       重放、要不要停跑：`rate_limited` 未收费可安全重放，`timeout` 计费未知**不许**
 *       自动重放（`runtime.ts:142-160`）。塌成一态 = 把这两件事当成同一件事。
 *
 *    ② **身份被静默丢掉。** `RunnerInput`（`runners/types.ts:13-18`）只有 `question`
 *       和 `market`，**没有 model 字段、也没有 locale 字段**；每个 runner 把模型钉死在
 *       自己的常量里（`runners/openai.ts:17`）。而 WP04 的 `observation.ts:22-36` 会把
 *       计划里的 `modelVersion` / `locale` **如实记成事实**。包一层 runner ⇒ 请求里根本
 *       没带这两项，观测行却写着它们 —— 一批身份是假的、且落库即不可变、永远修不掉的证据。
 *       WP04 有 engineFamily 装配闸（`runtime.ts:241-246`），**没有 model / locale 闸**，
 *       所以这道防线只能立在这里。
 *
 * 🔴 **幂等一律声明 `unsupported`。** WP00 U8 要求逐个 provider 核实幂等键支持情况，
 *    而本轮禁止调用付费 API ⇒ 核实不了。**没核实就不许声称 supported**
 *    —— 声称错了的代价是超时后自动重放、重复收费。
 */

import type {
  GeoProvider,
  GeoProviderCallResult,
  GeoProviderRequest,
} from '@/lib/geo-measurement-runtime'
import type {
  GeoOutboundRequest,
  GeoRawResponseEnvelope,
  GeoTransport,
  GeoTransportError,
} from './types'

/** 这个适配器只认 openai 引擎族。装配错了 WP04 会在第一次调用前拦下（引擎装配闸）。 */
export const GEO_BASELINE_ENGINE_FAMILY = 'openai'

/**
 * market → `web_search_options.user_location.approximate`。
 *
 * 🔴 **刻意不复用 `ai-tracker/runners/types.ts:41-57` 的 `marketToLocation`**：那个函数把
 *    `'au-nz'` 悄悄折成 NZ（`:50-52`），把 `'global'` 折成 `null/null`。对一次要冻结
 *    cohort 身份的基线来说，「你说 au-nz、我其实发的 NZ」就是假身份。
 * 🔴 **表里没有的 market 一律 fail closed**，不猜、不退化成无地域请求。
 */
const SUPPORTED_MARKETS: Readonly<Record<string, { country: string; timezone: string }>> = Object.freeze({
  au: { country: 'AU', timezone: 'Australia/Sydney' },
  nz: { country: 'NZ', timezone: 'Pacific/Auckland' },
})

/** 默认单次调用超时。超时 = 计费未知，WP04 据此走「不自动重放」那一支。 */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000

export interface GeoBaselineProviderOptions {
  readonly transport: GeoTransport
  /** 单次调用超时（毫秒）。 */
  readonly timeoutMs?: number
  /** 注入以便测试确定性；默认 `AbortSignal.timeout`。 */
  readonly createTimeoutSignal?: (ms: number) => { signal: AbortSignal; dispose: () => void }
}

/**
 * 出站请求的构造 —— **计划值必须真的送出去**，送不出去就 fail closed。
 * 这是 B10（没有 model / locale 装配闸）唯一的防线。
 */
export function buildOutboundRequest(
  request: GeoProviderRequest,
): { ok: true; outbound: GeoOutboundRequest } | { ok: false; errorCode: string; message: string } {
  const location = SUPPORTED_MARKETS[request.market]
  if (!location) {
    return {
      ok: false,
      errorCode: 'provider_cannot_honor_market',
      message:
        `provider cannot honor market "${request.market}" as a structured user_location ` +
        `(supported: ${Object.keys(SUPPORTED_MARKETS).join(', ')}); refusing to send a request ` +
        `whose recorded identity would not match what was actually asked`,
    }
  }
  if (request.locale.trim().length === 0) {
    return { ok: false, errorCode: 'provider_cannot_honor_locale', message: 'locale must be non-empty' }
  }
  return {
    ok: true,
    outbound: {
      model: request.modelVersion,
      question: request.questionText,
      // OpenAI 的 chat completions **没有 locale 传输参数**。唯一能落地的方式是写进指令。
      // 这句是可审计的：测试断言它确实出现在出站请求里。
      localeDirective: `Answer in ${request.locale}.`,
      userLocation: location,
    },
  }
}

/** token 用量 → USD。价格由调用方随计划给，不在这里写死（写死的价格会过期而无人察觉）。 */
export function computeCostUsd(
  promptTokens: number | null,
  completionTokens: number | null,
  pricing: { inputPerMillionUsd: number; outputPerMillionUsd: number },
): number | null {
  if (promptTokens === null || completionTokens === null) return null
  return (
    (promptTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (completionTokens / 1_000_000) * pricing.outputPerMillionUsd
  )
}

function defaultTimeoutSignal(ms: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

function asTransportError(err: unknown): GeoTransportError {
  if (err instanceof Error) return err as GeoTransportError
  return new Error(String(err)) as GeoTransportError
}

export interface GeoBaselineProviderConfig extends GeoBaselineProviderOptions {
  readonly pricing: { readonly inputPerMillionUsd: number; readonly outputPerMillionUsd: number }
}

/**
 * WP04 `GeoProvider` 的 OpenAI 实现。
 *
 * 🔴 **模型身份核对**：provider 回显的 `resolvedModel` 与计划里的 `modelVersion` 不一致
 *    ⇒ 观测判失败（`provider_model_mismatch`），**不写成成功**。
 *    这不是苛刻 —— WP04 的 `GeoProviderCallResult.ok` 里**没有地方**报告「实际跑的是哪个
 *    模型」，所以浮动别名（`gpt-4o`）一旦被解析成某个日期快照，观测行就会写着别名、
 *    数据却来自快照。**浮动别名不能当冻结的观测身份**，这道闸把这件事变成一个当场可见的
 *    失败，而不是一批悄悄失真的证据。修法是把 manifest 里的模型改成回显里的那个全名。
 */
export class GeoBaselineOpenAiProvider implements GeoProvider {
  readonly engineFamily = GEO_BASELINE_ENGINE_FAMILY
  /** 🔴 未核实即 unsupported —— 见文件头。 */
  readonly idempotency = 'unsupported' as const

  private readonly config: GeoBaselineProviderConfig

  constructor(config: GeoBaselineProviderConfig) {
    this.config = config
  }

  async call(request: GeoProviderRequest): Promise<GeoProviderCallResult> {
    if (request.engineFamily !== this.engineFamily) {
      return {
        kind: 'error',
        errorCode: 'provider_engine_mismatch',
        message: `request engineFamily "${request.engineFamily}" != provider "${this.engineFamily}"`,
        costUsd: 0,
      }
    }
    const built = buildOutboundRequest(request)
    if (!built.ok) {
      return { kind: 'error', errorCode: built.errorCode, message: built.message, costUsd: 0 }
    }

    const ms = this.config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
    const make = this.config.createTimeoutSignal ?? defaultTimeoutSignal
    const { signal, dispose } = make(ms)
    try {
      const result = await this.config.transport(built.outbound, signal)
      return this.resolveOk(result, request)
    } catch (err) {
      return this.classifyError(asTransportError(err), ms)
    } finally {
      dispose()
    }
  }

  /** 成功路径：先核对模型身份，再算成本，最后把整个载荷封进信封。 */
  private resolveOk(
    result: Awaited<ReturnType<GeoTransport>>,
    request: GeoProviderRequest,
  ): GeoProviderCallResult {
    if (result.resolvedModel !== request.modelVersion) {
      return {
        kind: 'error',
        errorCode: 'provider_model_mismatch',
        message:
          `plan pinned modelVersion "${request.modelVersion}" but the provider resolved it to ` +
          `"${result.resolvedModel}"; a floating alias cannot serve as frozen observation identity. ` +
          `Pin the manifest to "${result.resolvedModel}" and re-run.`,
        costUsd: 0,
      }
    }
    const cost = computeCostUsd(result.promptTokens, result.completionTokens, this.config.pricing)
    if (cost === null) {
      // 拿不到用量 = 说不出这一步实际花了多少。成本上界不明的付费步骤一律 fail closed
      // （GEO 契约 §7.1 第 3 条）。不许拿 0 顶替 —— 那是把「不知道」写成「免费」。
      return {
        kind: 'error',
        errorCode: 'provider_cost_unknown',
        message: 'provider returned no token usage; actual cost cannot be established',
        costUsd: 0,
      }
    }
    const envelope: GeoRawResponseEnvelope = {
      envelope: 'geo-baseline/openai/v1',
      resolvedModel: result.resolvedModel,
      text: result.text,
      citationUrls: result.citationUrls,
      usage: { promptTokens: result.promptTokens, completionTokens: result.completionTokens },
    }
    return { kind: 'ok', rawResponse: JSON.stringify(envelope), costUsd: cost }
  }

  /** 失败路径：**四态必须分得开**，见文件头 ①。 */
  private classifyError(err: GeoTransportError, timeoutMs: number): GeoProviderCallResult {
    if (err.isAbort === true || err.name === 'AbortError' || err.name === 'TimeoutError') {
      // 计费歧义：请求可能已经打到 provider 并产生了费用，也可能没有。
      // 说不出就是说不出 —— WP04 据此按上界计最坏情况，且**不自动重放**。
      return {
        kind: 'timeout',
        message: `provider call aborted after ${timeoutMs}ms: ${err.message}`,
        costUsd: { known: false, reason: 'source_ambiguous' },
      }
    }
    if (err.status === 429) {
      // 限流：未产出 completion ⇒ 未收费，重放安全。
      return { kind: 'rate_limited', message: err.message }
    }
    const cost = computeCostUsd(
      err.usage?.promptTokens ?? null,
      err.usage?.completionTokens ?? null,
      this.config.pricing,
    )
    return {
      kind: 'error',
      errorCode: err.status !== undefined ? `provider_http_${err.status}` : 'provider_error',
      // 错误响应通常不带 usage；不带就是没产出 completion，未收费，记 0 是事实不是猜测。
      // 真带了 usage 就如实记 —— 之后 WP04 的 trustProviderCost 还会再验一道。
      message: err.message,
      costUsd: cost ?? 0,
    }
  }
}
