/**
 * 死信 / 等审批 / 被拒绝 → 下发成人工任务。
 *
 * 铁律的下半句：确实做不了，也不许烂尾。**必须下发成人工任务，且进同一个管道**
 * （今日待办），不能只写进 cron summary / console.log / 只有开发看得到的表。
 *
 * 三件套缺一条就是没下发好：
 *   what —— 问题**和影响**，说人话
 *   how  —— 具体点哪里，让 FDE 不用问人
 *   href —— 直达链接，连粘贴都不用
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun } from './types'
import { listDeadLetterRuns } from './store'

export interface KernelHandoffTodo {
  client_id: string
  run_id: string
  what: string
  how: string
  href: string
}

/** 多久以内的需要人处理的执行才捞。太老的说明已经不重要了，天天刷屏反而没人看。 */
export const HANDOFF_WINDOW_DAYS = 14

const DASHBOARD = 'https://app.magicengine.com.au/dashboard/clients'

export async function fetchKernelHandoffTodos(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<KernelHandoffTodo[]> {
  const since = new Date(now.getTime() - HANDOFF_WINDOW_DAYS * 86_400_000).toISOString()
  const runs = await listDeadLetterRuns(sb, since)
  return runs.map((run) => toTodo(run))
}

function toTodo(run: ActionRun): KernelHandoffTodo {
  const href = `${DASHBOARD}/${run.client_id}/execution`

  if (run.status === 'pending_approval') {
    return {
      client_id: run.client_id,
      run_id: run.id,
      what: `有一件「${run.action_key}」排好了，按这个客户的规则要你点头才做 —— 没点之前它一直不会开始`,
      how: '打开执行看板找到这条，看一眼要做什么，同意就点「同意执行」；不该做就点「不做」并写一句原因',
      href,
    }
  }

  if (run.status === 'denied') {
    return {
      client_id: run.client_id,
      run_id: run.id,
      what: `有一件「${run.action_key}」被系统挡下来了：${run.last_error ?? '未说明原因'}`,
      how:
        '大多数是两种情况：① 这个客户还没给这类动作设自动化规则 → 去客户设置里设一条；' +
        '② 这个动作系统还没实现 → 回我一句，我来排。两种都不用你自己动手做那件事',
      href,
    }
  }

  return {
    client_id: run.client_id,
    run_id: run.id,
    what: `有一件「${run.action_key}」重试到上限还是没做成，已经停手：${run.last_error ?? '未说明原因'}`,
    how: '这条不用你做那件事本身 —— 回我一句「查一下这条」，我去看是哪一步卡住的。在修好之前它不会自己重试，也不会重复扣费',
    href,
  }
}
