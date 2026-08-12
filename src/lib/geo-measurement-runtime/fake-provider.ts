/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 测试替身（Issue #874 / WP04）
 *
 * 🔴 授权硬禁止：**不跑真实 GEO 测量、不调用任何付费 provider。** v1 的运行链路只对着
 *    这些确定性替身跑。它们**不发任何网络请求**，全部是内存里的脚本。
 *
 * 🔴 provider 的 `idempotency` 是替身自己声明的，用来测「timeout 歧义下要不要自动重放」。
 *    绝不把这个内部脚本当成真实 provider 的 exactly-once 保证。
 */

import type {
  GeoParser,
  GeoProvider,
  GeoProviderCallResult,
  GeoProviderIdempotency,
  GeoProviderRequest,
  GeoRuntimeDeps,
} from './types'

/** 脚本函数：给定请求 + 这条观测已尝试过几次（从 1 起），返回一次调用结果。 */
export type GeoFakeProviderScript = (request: GeoProviderRequest, attemptNumber: number) => GeoProviderCallResult

function dedupeKey(r: GeoProviderRequest): string {
  return [r.queryKey, r.engineFamily, r.modelVersion, r.locale, r.market, r.sampleIndex].join('|')
}

/** 脚本化的假 provider。按 (观测维度) 记尝试次数，好让脚本模拟「首次超时、重试成功」。 */
export class GeoFakeProvider implements GeoProvider {
  readonly engineFamily: string
  readonly idempotency: GeoProviderIdempotency
  private readonly script: GeoFakeProviderScript
  private readonly attempts = new Map<string, number>()
  /** 只读：调用总次数（供测试断言「没有多余的付费重放」）。 */
  callCount = 0

  constructor(args: { engineFamily: string; idempotency: GeoProviderIdempotency; script: GeoFakeProviderScript }) {
    this.engineFamily = args.engineFamily
    this.idempotency = args.idempotency
    this.script = args.script
  }

  async call(request: GeoProviderRequest): Promise<GeoProviderCallResult> {
    const key = dedupeKey(request)
    const attemptNumber = (this.attempts.get(key) ?? 0) + 1
    this.attempts.set(key, attemptNumber)
    this.callCount += 1
    return this.script(request, attemptNumber)
  }
}

/** 恒成功 provider（成本固定），最常用的基线替身。 */
export function alwaysOkProvider(engineFamily: string, costUsd = 0.01): GeoFakeProvider {
  return new GeoFakeProvider({
    engineFamily,
    idempotency: 'not_applicable',
    script: (r) => ({ kind: 'ok', rawResponse: `answer for ${r.queryKey}#${r.sampleIndex}`, costUsd }),
  })
}

/**
 * 默认假 parser：原始响应非空即「可解释」，给一个固定置信度 + 零引用来源。
 * 传入 `failOn` 可让某些原始响应触发解析失败（测 parser 失败路径）。
 */
export function makeFakeParser(opts?: { confidence?: number; failWhen?: (raw: string) => boolean }): GeoParser {
  const confidence = opts?.confidence ?? 0.95
  return (raw) => {
    if (opts?.failWhen?.(raw)) {
      return { ok: false, errorCode: 'unparseable_response', message: 'parser could not interpret the response' }
    }
    if (raw.trim().length === 0) {
      return { ok: false, errorCode: 'empty_response', message: 'empty raw response' }
    }
    return { ok: true, confidence, citations: [] }
  }
}

/** 确定性递增 id 工厂（测试用）。生产会换成 crypto.randomUUID，但那超出 v1 假件范围。 */
export function createSequentialIdFactory(): GeoRuntimeDeps['newId'] {
  const counters: Record<string, number> = { batch: 0, observation: 0, evidence: 0 }
  return (kind) => {
    counters[kind] += 1
    return `${kind}-${counters[kind]}`
  }
}

/** 固定时钟（测试用）。 */
export function fixedClock(iso = '2026-08-12T00:00:00.000Z'): GeoRuntimeDeps['now'] {
  return () => iso
}
