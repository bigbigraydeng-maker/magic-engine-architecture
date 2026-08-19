/**
 * Canonical hashing + deep freeze —— A · Authorized Input Pinning 的地基。
 *
 * 🔴 三个 helper 的存在理由：
 *
 *   · `canonicalStringify`：把任何 JSON-safe 值序列化成**排过序、无空白**的字符串。
 *     `JSON.stringify({a:1,b:2})` 与 `JSON.stringify({b:2,a:1})` 不相等 ——
 *     那样任何键顺序抖动都会造出「hash 不等 = 输入被改」的假警报，Gateway
 *     就变成「fail-closed 每一次调用」。用它把「值相等」和「字节相等」对齐。
 *
 *   · `canonicalHashOfInput`：唯一的入口，全 64 hex 小写 SHA-256。
 *     决策级别的授权凭证不许截位 —— 40 位截断就是把碰撞空间从 2^256
 *     降到 2^160，为了几十字节省了个数量级的攻击难度。
 *
 *   · `deepFreezeVerifiedInput`：Gateway 通过 hash-check 之后，把这份 input
 *     的**深拷贝**逐层 `Object.freeze` 传给 capability。**浅冻结救不了**：
 *     `Object.freeze({...input})` 只冻结顶层，`ctx.runInput.intents[0].proposedValue = 'X'`
 *     照样写得进去；一旦 capability 顺手改了自己收到的这份 input，Kernel 手里
 *     那份 hash-check 通过的凭证就跟真正 handler 消费的东西对不上，
 *     而这种 mutation 通常无声无息（没人报错、也没验证会挑出来）。
 *
 * 🔴 这个文件**不 import 任何 kernel 内部模块**：它是被大家 import 的地基。
 */

import { createHash } from 'crypto'

/**
 * 排序键的稳定 JSON 序列化。
 *
 * · 对象：按 `Object.keys().sort()` 输出；`undefined` 值的键跳过（跟 JSON.stringify 一致）。
 * · 数组：按原顺序（数组顺序是**有语义的**，不能排序 —— `intents[0]` 与 `intents[1]` 通常
 *   代表不同的意图，排序会让「换了两条意图的顺序」变成 hash 相等，Gateway 就看不见了）。
 * · 原始值：透传给 `JSON.stringify`。
 * · `undefined`：返回 `undefined`（跟 `JSON.stringify` 一致；作为对象值时被跳过）。
 *
 * 不接受循环引用（会一路递归到爆栈；action input 本来就是从 JSON 反序列化的
 * plain object，不会有循环）。
 */
export function canonicalStringify(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    const parts = value.map((item) => canonicalStringify(item) ?? 'null')
    return `[${parts.join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const pairs: string[] = []
  for (const key of keys) {
    const serialized = canonicalStringify(obj[key])
    if (serialized === undefined) continue
    pairs.push(`${JSON.stringify(key)}:${serialized}`)
  }
  return `{${pairs.join(',')}}`
}

/**
 * 完整 64 hex 的 lowercase SHA-256。**不截位。**
 *
 * 🔴 授权凭证不允许"省几十字节"—— 40 位截断把碰撞空间从 2^256 降到 2^160。
 */
export function canonicalHashOfInput(input: unknown): string {
  const canonical = canonicalStringify(input) ?? 'null'
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * 深拷贝 + 逐层冻结。传给 capability 手里的那份 `ctx.runInput` 必须**任何一层都改不动**。
 *
 * 🔴 浅冻结不够：`Object.freeze({...input})` 只锁顶层，`intents[0].proposedValue = 'X'`
 *    照样写进去，然后 handler 拿着一份跟 Gateway hash-check 通过的凭证**不同**的 input
 *    去执行 —— 那正是我们要防的 TOCTOU。
 *
 * 用 `structuredClone` 拷贝，保证跟原 input 完全无引用共享；然后 DFS 逐层 `Object.freeze`。
 */
export function deepFreezeVerifiedInput<T>(input: T): Readonly<T> {
  const cloned = structuredClone(input)
  deepFreeze(cloned)
  return cloned as Readonly<T>
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  if (Object.isFrozen(value)) return
  Object.freeze(value)
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item)
    return
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
}
