/**
 * Kernel 的失败词汇表。
 *
 * 为什么要有专门的错误类型：Gateway 的每一道闸失败之后的**处置方式不同** ——
 * 有的该重试，有的重试一万次也还是那个结果，有的必须当场停手并写安全告警。
 * 用裸 Error + 字符串匹配来分这三种，是把判定交给了错误文案的措辞。
 */

export type KernelErrorCode =
  /** 动作不在注册表里 —— 永远不重试 */
  | 'UNKNOWN_ACTION'
  /** 注册表版本跟 decision 记的对不上 */
  | 'ACTION_VERSION_MISMATCH'
  /** 没有授权决策 / 决策不是 allow */
  | 'NOT_AUTHORIZED'
  /** 决策已经被兑换过 —— 重放 */
  | 'DECISION_ALREADY_CONSUMED'
  /** 决策过期 */
  | 'DECISION_EXPIRED'
  /** 授权时的政策版本跟现在的对不上 —— 政策改了，必须重新授权 */
  | 'STALE_POLICY_VERSION'
  /**
   * 政策的**身份或模式**变了：被删掉重建（版本号可能一样但行不是同一行）、
   * 或模式换了（机器签的放行只在仍是自动时有效，人签的只在仍要人审时有效）。
   */
  | 'POLICY_CHANGED'
  /** 🔴 跨客户：decision 属于 A 客户，却拿来对 B 客户执行 */
  | 'CROSS_CLIENT'
  /** 超预算 */
  | 'COST_CAP_EXCEEDED'
  /** 输入不符合 input_schema */
  | 'INVALID_INPUT'
  /** 产物不符合 output_schema */
  | 'INVALID_OUTPUT'
  /** 验证没过 —— 事情**没做成**，不是「日志里有条 warn」 */
  | 'VERIFICATION_FAILED'
  /** run / step 状态不允许这次执行 */
  | 'INVALID_STATE'
  /** capability 没注册处理器 */
  | 'CAPABILITY_NOT_IMPLEMENTED'
  /** 对外副作用被闸死 —— v1 永远不许出现 */
  | 'OUTWARD_SIDE_EFFECT_BLOCKED'
  /**
   * capability 报回来的花费不是一个真实金额（NaN / ±Infinity / 负数）。
   * 🔴 负数最危险 —— 它能把「已花金额」减回来，等于绕开预算上限。
   *    一律 fail closed，且这个数字**不进账本**。
   */
  | 'INVALID_COST'

export class KernelError extends Error {
  readonly code: KernelErrorCode
  /**
   * 这个失败重试有没有意义。
   *
   * 🔴 默认 false。「不确定要不要重试」时重试，等于把一个已知失败
   *    放大成 N 个失败；而漏了重试只是慢一轮。
   */
  readonly retryable: boolean
  /** 给人看的一句话。会原样进今日待办，所以必须是人话。 */
  readonly humanReason: string
  readonly detail: Record<string, unknown>

  constructor(
    code: KernelErrorCode,
    humanReason: string,
    opts: { retryable?: boolean; detail?: Record<string, unknown> } = {},
  ) {
    super(`[${code}] ${humanReason}`)
    this.name = 'KernelError'
    this.code = code
    this.retryable = opts.retryable ?? false
    this.humanReason = humanReason
    this.detail = opts.detail ?? {}
  }
}

/** capability 内部用的：这次失败换个时间再试有意义（网络抖动、上游 429）。 */
export class RetryableCapabilityError extends Error {
  readonly retryable = true as const
  constructor(message: string) {
    super(message)
    this.name = 'RetryableCapabilityError'
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof KernelError) return err.retryable
  if (err instanceof RetryableCapabilityError) return true
  return false
}

export function humanReasonOf(err: unknown): string {
  if (err instanceof KernelError) return err.humanReason
  if (err instanceof Error) return err.message
  return String(err)
}
