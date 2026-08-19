/**
 * 真实并发竞争测试（Build Control 木桶原则第二轮裁决明确要求保留）。
 *
 * Codex 复审 BLOCKER #2 的原话：「两边同时读到还有余额，都通过」。
 * 这里不是断言一个理论上安全的实现"看起来对"，而是**两组对照**：
 *
 *   1. atomic 版（读-判-写在同一个不含 await 的同步临界区内完成，
 *      忠实模拟 migration 里那条单语句原子 UPDATE 的保证）
 *      —— 20 次并发 reserve($20)，cap=$300，必须恰好 15 次成功、
 *      reserved 总额恰好 $300，一分不多。
 *
 *   2. racy 版（读和写之间故意插一个 `await Promise.resolve()`，
 *      模拟"先 SELECT 再 UPDATE"这种两次往返的错误实现）
 *      —— 同样 20 次并发 reserve($20)，**必须能真的观察到超支**
 *      （reserved 总额 > $300，或成功次数 > 15）。
 *
 * 第 2 组的意义：如果它也"恰好安全"，说明这个测试根本测不出竞态，
 * 是摆设。JS 的 Promise.all 对"起手都在同步阶段调用、被同一个 await
 * 挂起"的 async 函数，会先把全部 20 个调用都推进到各自的 await 点
 * （此时全部读到同一份旧值），再统一恢复执行写入 —— 这是 JS 事件循环
 * 真实的调度行为，不是伪造出来的失败，丢失更新（lost update）就是
 * 在这里真实发生的。
 */
import { describe, it, expect } from 'vitest'
import type { SpendReservationStore, SpendReservationRow } from '../spend-reservations'

const CLIENT = 'c-cts'
const SCOPE = 'me_sandbox_v1_cts'
const CAP = 300
const AMOUNT = 20
const ATTEMPTS = 20 // 20 * $20 = $400 想要的总额，cap 只够 15 次

/** 原子版：读-判-写在同一个同步块内，无 await —— 忠实模拟单语句原子 UPDATE。 */
function createAtomicFakeStore(): SpendReservationStore {
  const rows = new Map<string, SpendReservationRow>()
  const key = (c: string, s: string) => `${c}::${s}`
  return {
    async reserve(clientId, scopeKey, capAmountNzd, amountNzd) {
      // 🔴 同步临界区：从这里到 return 之间没有 await，等价于原子操作。
      const k = key(clientId, scopeKey)
      let row = rows.get(k)
      if (!row) {
        row = {
          clientId, scopeKey, currency: 'NZD', capAmountNzd,
          reservedAmountNzd: 0, committedAmountNzd: 0, releasedAmountNzd: 0, failedNeedsReconcileAmountNzd: 0,
        }
        rows.set(k, row)
      }
      const used = row.reservedAmountNzd + row.committedAmountNzd + row.failedNeedsReconcileAmountNzd
      if (used + amountNzd > row.capAmountNzd) return { ok: false, reason: 'over_cost_cap', row: { ...row } }
      row.reservedAmountNzd += amountNzd
      return { ok: true, row: { ...row } }
    },
    async commit(clientId, scopeKey, amountNzd) {
      const row = rows.get(key(clientId, scopeKey))
      if (!row || row.reservedAmountNzd < amountNzd) return { ok: false, reason: 'insufficient_reserved' }
      row.reservedAmountNzd -= amountNzd
      row.committedAmountNzd += amountNzd
      return { ok: true, row: { ...row } }
    },
    async release(clientId, scopeKey, amountNzd) {
      const row = rows.get(key(clientId, scopeKey))
      if (!row || row.reservedAmountNzd < amountNzd) return { ok: false, reason: 'insufficient_reserved' }
      row.reservedAmountNzd -= amountNzd
      row.releasedAmountNzd += amountNzd
      return { ok: true, row: { ...row } }
    },
    async markNeedsReconcile(clientId, scopeKey, amountNzd) {
      const row = rows.get(key(clientId, scopeKey))
      if (!row || row.reservedAmountNzd < amountNzd) return { ok: false, reason: 'insufficient_reserved' }
      row.reservedAmountNzd -= amountNzd
      row.failedNeedsReconcileAmountNzd += amountNzd
      return { ok: true, row: { ...row } }
    },
  }
}

/**
 * 蓄意有race的版本：读了当前值之后先 `await`，再基于"读到的旧值"写入。
 * 只用来证明"没有原子性会真的超支"，**生产代码绝不能长这样**——
 * 真实实现（`createSupabaseSpendReservationStore`）走的是单条 RPC 调用，
 * 原子性由 Postgres 的单语句 UPDATE 保证，不是这种两段式。
 */
function createRacyFakeStore(): SpendReservationStore {
  const rows = new Map<string, SpendReservationRow>()
  const key = (c: string, s: string) => `${c}::${s}`
  return {
    async reserve(clientId, scopeKey, capAmountNzd, amountNzd) {
      const k = key(clientId, scopeKey)
      let row = rows.get(k)
      if (!row) {
        row = {
          clientId, scopeKey, currency: 'NZD', capAmountNzd,
          reservedAmountNzd: 0, committedAmountNzd: 0, releasedAmountNzd: 0, failedNeedsReconcileAmountNzd: 0,
        }
        rows.set(k, row)
      }
      // 🔴 读到当前值之后先让出执行权 —— 模拟"先 SELECT 再另开一条 UPDATE"
      const usedAtReadTime = row.reservedAmountNzd + row.committedAmountNzd + row.failedNeedsReconcileAmountNzd
      await Promise.resolve() // <-- 竞态窗口就是这一行
      if (usedAtReadTime + amountNzd > row.capAmountNzd) {
        return { ok: false, reason: 'over_cost_cap', row: { ...row } }
      }
      row.reservedAmountNzd += amountNzd // 基于"读的时候"的旧值判定，写的是最新的行——丢失更新
      return { ok: true, row: { ...row } }
    },
    async commit() { throw new Error('racy fake 只用于 reserve 竞态演示') },
    async release() { throw new Error('racy fake 只用于 reserve 竞态演示') },
    async markNeedsReconcile() { throw new Error('racy fake 只用于 reserve 竞态演示') },
  }
}

async function fireConcurrentReserves(store: SpendReservationStore) {
  const calls = Array.from({ length: ATTEMPTS }, () => store.reserve(CLIENT, SCOPE, CAP, AMOUNT))
  return Promise.all(calls)
}

describe('原子实现：20 个并发 reserve($20)，cap=$300', () => {
  it('恰好 15 次成功，5 次因超顶被拒 —— 一分不多不少', async () => {
    const store = createAtomicFakeStore()
    const results = await fireConcurrentReserves(store)
    const succeeded = results.filter((r) => r.ok)
    const rejected = results.filter((r) => !r.ok)
    expect(succeeded.length).toBe(15)
    expect(rejected.length).toBe(5)
  })

  it('最终 reserved 总额恰好等于 cap，不超支', async () => {
    const store = createAtomicFakeStore()
    await fireConcurrentReserves(store)
    const final = await store.reserve(CLIENT, SCOPE, CAP, 0.01)
    // 用一次极小额度的 reserve 探测当前状态（0.01 太小不会改变结论，只借它的返回行读状态）
    expect(final.row.reservedAmountNzd).toBeLessThanOrEqual(CAP)
    expect(final.row.reservedAmountNzd).toBe(300) // 15 * 20
  })

  it('拒绝的请求带着"超顶"原因，不是静默失败', async () => {
    const store = createAtomicFakeStore()
    const results = await fireConcurrentReserves(store)
    const rejected = results.filter((r) => !r.ok)
    for (const r of rejected) {
      if (!r.ok) expect(r.reason).toBe('over_cost_cap')
    }
  })
})

describe('对照组 · 非原子实现：同样 20 个并发 reserve($20)，证明竞态真实存在', () => {
  it('🔴 没有原子性 → 硬顶被真实绕过（这条测试若不失败，就说明"竞态测试"是摆设）', async () => {
    const store = createRacyFakeStore()
    const results = await fireConcurrentReserves(store)
    const succeeded = results.filter((r) => r.ok)

    // 竞态的真实后果不是"漏写钱"，是"漏判超顶"：20 个并发调用在写入之前
    // 全部读到同一份「用量=0」的旧快照，各自判定"还没超顶"，于是全部通过——
    // 之后各自的写入仍然照实累加（写操作本身没丢），最终 20 次全成功。
    expect(succeeded.length).toBe(20) // 应该只放 15 次，这里全放了

    const finalRow = succeeded[succeeded.length - 1]?.row
    // 硬顶是 $300，但账目真实累计到了 $400 —— 判定被绕过的直接证据。
    expect(finalRow?.reservedAmountNzd).toBe(400)
    expect(finalRow?.reservedAmountNzd).toBeGreaterThan(CAP)
  })
})
