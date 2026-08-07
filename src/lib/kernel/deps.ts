/**
 * Kernel 的依赖包。
 *
 * 为什么用显式依赖注入而不是 `import { supabaseAdmin }`：
 *
 *   ① Kernel 是唯一的执行门面，它自己抓着 service-role 客户端，
 *      「谁在什么授权下写了什么」就退化成「进程里任何地方都能写」；
 *   ② 授权闸、幂等、重试、死信这些东西**必须能被测试真正跑一遍**，
 *      而不是把「闸有没有生效」寄托在生产库上；
 *   ③ registry / capabilities 也进 deps，是为了让测试能用合成动作
 *      去验证 retry / dead_letter / 成本超支这些路径，
 *      而不必往生产注册表里塞一个假动作。
 *
 * 🔴 注意这不是「随便传个 capability 就能执行」的口子：
 *    执行前 Gateway 仍然会把授权事实从 append-only 决策表里重读一遍再比对，
 *    而架构测试保证生产代码里没有第二个地方能造出 AuthorizedExecutionContext。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun, CapabilityImplementation } from './types'
import type { ActionRegistry } from './registry'
import { getRun } from './store'

export interface KernelDeps {
  readonly supabase: SupabaseClient
  readonly registry: ActionRegistry
  /** action_key → capability 实现。查不到 = CAPABILITY_NOT_IMPLEMENTED，不是「跳过」。 */
  readonly capabilities: Readonly<Record<string, CapabilityImplementation>>
  /** 这台机器的身份，进 claimed_by / consumed_by，用来查「是谁跑的」。 */
  readonly workerId: string
  now(): Date
  /** 重试之间的等待。测试里换成不等，生产里就是真等。 */
  sleep(ms: number): Promise<void>
  requireRun(runId: string): Promise<ActionRun>
}

export interface KernelDepsInit {
  supabase: SupabaseClient
  registry: ActionRegistry
  capabilities: Readonly<Record<string, CapabilityImplementation>>
  workerId?: string
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

export function createKernelDeps(init: KernelDepsInit): KernelDeps {
  const deps: KernelDeps = {
    supabase: init.supabase,
    registry: init.registry,
    capabilities: init.capabilities,
    workerId: init.workerId ?? `kernel@${process.env.RENDER_INSTANCE_ID ?? 'local'}`,
    now: init.now ?? (() => new Date()),
    sleep: init.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    async requireRun(runId: string) {
      const run = await getRun(init.supabase, runId)
      if (!run) throw new Error(`[kernel] 找不到执行实例 ${runId}`)
      return run
    },
  }
  return deps
}
