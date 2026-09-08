import { supabaseAdmin } from '@/lib/supabase'

export interface CronRunHandle {
  finish(opts: {
    processed?: number
    completed?: number
    failed?: number
    summary?: Record<string, unknown>
    error?: string
  }): Promise<void>
}

/**
 * 只开一行运行记录、把 id 交出去 —— 给**工作流函数**用。
 *
 * 🔴 为什么要有这个入口：Inngest 的函数体在每个步骤边界之后会从头重放一遍
 *    （步骤的结果走缓存，步骤**外**的代码每遍都真跑）。`startCronRun` 返回的是一个
 *    带闭包的 handle，没法放进步骤里跨重放传递；直接放在步骤外就会每重放一遍插一行，
 *    结果是每周留下一堆永远停在「在跑」的假记录 —— 而这套监控的全部价值就是那些记录
 *    是真的。所以工作流里改成：一个步骤开记录拿 id，另一个步骤按 id 收尾。
 */
export async function startCronRunId(jobName: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single()
  return data?.id ?? null
}

/** 用已知的 id + 开始时刻重建收尾用的 handle（配合 startCronRunId 跨步骤使用）。 */
export function cronRunHandle(runId: string | null, startedAt: number): CronRunHandle {
  return finisher(runId, startedAt)
}

export async function startCronRun(jobName: string): Promise<CronRunHandle> {
  const startedAt = Date.now()
  const runId = await startCronRunId(jobName)
  return finisher(runId, startedAt)
}

function finisher(runId: string | null, startedAt: number): CronRunHandle {
  return {
    async finish({ processed = 0, completed = 0, failed = 0, summary, error }) {
      if (!runId) return
      const durationMs = Date.now() - startedAt
      await supabaseAdmin
        .from('cron_run_logs')
        .update({
          status: error ? 'failed' : 'completed',
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          processed,
          completed_count: completed,
          failed_count: failed,
          summary: summary ?? null,
          error_message: error ?? null,
        })
        .eq('id', runId)
    },
  }
}
