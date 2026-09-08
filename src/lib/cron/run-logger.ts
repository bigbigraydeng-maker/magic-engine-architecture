import { supabaseAdmin } from '@/lib/supabase'

/**
 * 定时任务运行记录（cron_run_logs）的写入口。
 *
 * 🔴 这里的写失败**绝不能静默**。
 *    2026-09-07 实测（生产库 glbdnayojixmexgofbsd）：goals-expiry-check 由 GitHub Actions
 *    每天调度，8/18–8/30 这 13 次全部 HTTP 200、body 都是 {"success":true}，
 *    但 cron_run_logs 里只有 8/27 那一天留下了记录，另外 12 天一行都没有 ——
 *    首版只取了 `data`、没取 `error`，insert 一失败 runId 就是 null，
 *    `finish()` 直接 `return`，任务照常跑完却不留任何痕迹。
 *
 *    后果不是「少一条日志」，而是**健康检查反过来说谎**：health.ts 完全建立在
 *    cron_run_logs 上，没有行 = 「从来没跑过 / 逾期没跑」。
 *    误报一旦成为常态，真出事那天也会被当噪音划掉。
 *
 * 所以本模块有两条硬规则：
 *   1. 每一次写库都必须取 error 并 `console.error` 出来（进 Render 日志，人能看见）；
 *   2. 开跑那行没插进去时，`finish()` 必须补插一条**带终态**的记录 ——
 *      发现不许只死在日志里，必须回到健康检查看得见的同一根管道。
 *      （这也是 `cronRunHandle` 必须知道 jobName 的原因：没有它就补不了那一行。）
 *
 * 写日志本身失败**不抛异常**：它是观测手段，不是安全闸，不该把正在跑的业务任务弄挂。
 */

export interface CronRunHandle {
  finish(opts: {
    processed?: number
    completed?: number
    failed?: number
    summary?: Record<string, unknown>
    error?: string
  }): Promise<void>
}

/** Supabase 的错误对象只保证有 message，其余字段按需带上，全部塞进一行日志里。 */
function describe(error: { message: string; code?: string; details?: string | null; hint?: string | null }): string {
  const parts = [error.message]
  if (error.code) parts.push(`code=${error.code}`)
  if (error.details) parts.push(`details=${error.details}`)
  if (error.hint) parts.push(`hint=${error.hint}`)
  return parts.join(' | ')
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
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single()

  if (error) {
    console.error(
      `[cron-run-logger] ${jobName}: 开跑记录写不进 cron_run_logs —— 健康检查会把这次运行当成「没跑过」。${describe(error)}`,
    )
  }

  return data?.id ?? null
}

/** 用已知的 id + 开始时刻重建收尾用的 handle（配合 startCronRunId 跨步骤使用）。 */
export function cronRunHandle(jobName: string, runId: string | null, startedAt: number): CronRunHandle {
  return finisher(jobName, runId, startedAt)
}

export async function startCronRun(jobName: string): Promise<CronRunHandle> {
  const startedAt = Date.now()
  const runId = await startCronRunId(jobName)
  return finisher(jobName, runId, startedAt)
}

function finisher(jobName: string, runId: string | null, startedAt: number): CronRunHandle {
  // 只有补插那条才需要自己带 started_at（正常路径沿用建表 DDL 的 NOW() 默认值，不改动既有行为）。
  const startedAtIso = new Date(startedAt).toISOString()

  return {
    async finish({ processed = 0, completed = 0, failed = 0, summary, error: jobError }) {
      const durationMs = Date.now() - startedAt
      const outcome = {
        status: jobError ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed,
        completed_count: completed,
        failed_count: failed,
        summary: summary ?? null,
        error_message: jobError ?? null,
      }

      // 开跑那行没插进去 —— 补插一条终态记录，至少让健康检查知道它跑过。
      if (!runId) {
        const { error: backfillError } = await supabaseAdmin
          .from('cron_run_logs')
          .insert({ job_name: jobName, started_at: startedAtIso, ...outcome })
        if (backfillError) {
          console.error(
            `[cron-run-logger] ${jobName}: 补插终态记录也失败，这次运行在 cron_run_logs 里彻底没有痕迹。${describe(backfillError)}`,
          )
        } else {
          console.error(
            `[cron-run-logger] ${jobName}: 开跑记录当时没写成，已补插一条终态记录顶上（started_at=${startedAtIso}）。`,
          )
        }
        return
      }

      const { error: updateError } = await supabaseAdmin
        .from('cron_run_logs')
        .update(outcome)
        .eq('id', runId)

      if (updateError) {
        console.error(
          `[cron-run-logger] ${jobName}: 收尾更新写不进 cron_run_logs —— 这行会永远停在 running。${describe(updateError)}`,
        )
      }
    },
  }
}
