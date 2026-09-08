import { randomUUID } from 'node:crypto'

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
 * 🔴 id 由**调用方**先生成，收尾走 upsert —— 不能等数据库发 id。
 *    Codex 复审 #1434 指出的坑：insert 在库里提交成功、但响应在回到进程前丢了，
 *    调用方拿到的是「错误 + 没有 id」。若此时另插一条终态记录，库里就同时存在
 *    孤儿 running 行和终态行；孤儿的 started_at（数据库 NOW()）还比终态行的晚，
 *    health.ts 按 started_at DESC 取最近一条，永远选中那条孤儿，
 *    一小时后把**跑完的任务**报成卡死 —— 正好是这个 PR 要消灭的那种假警报。
 *    先生成 id 就没有这个分叉：写成没写成，收尾都是对同一行 upsert。
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
export async function startCronRunId(jobName: string, startedAt: number = Date.now()): Promise<string> {
  const runId = randomUUID()

  const { error } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({ id: runId, job_name: jobName, status: 'running', started_at: new Date(startedAt).toISOString() })

  if (error) {
    console.error(
      `[cron-run-logger] ${jobName}: 开跑记录写不进 cron_run_logs —— 健康检查会把这次运行当成「没跑过」。${describe(error)}`,
    )
  }

  // 写没写成都把 id 交出去：收尾时对同一行 upsert，两种情况殊途同归。
  return runId
}

/** 用已知的 id + 开始时刻重建收尾用的 handle（配合 startCronRunId 跨步骤使用）。 */
export function cronRunHandle(jobName: string, runId: string | null, startedAt: number): CronRunHandle {
  return finisher(jobName, runId, startedAt)
}

export async function startCronRun(jobName: string): Promise<CronRunHandle> {
  const startedAt = Date.now()
  const runId = await startCronRunId(jobName, startedAt)
  return finisher(jobName, runId, startedAt)
}

function finisher(jobName: string, runId: string | null, startedAt: number): CronRunHandle {
  // started_at 一律用调用方这一侧的时钟：开跑那次 insert 和这里的 upsert 写的是同一个值，
  // 重写也不会漂移；也让 started_at / finished_at / duration_ms 三个字段出自同一个钟。
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

      // 无论开跑那行写成没写成，都对同一个 id upsert：
      //   写成了 → 更新成终态；没写成（或提交了但响应丢了）→ 这一步把它补齐。
      // 绝不会出现「孤儿 running 行 + 另一条终态行」那种自相矛盾的记录。
      const row = { id: runId, job_name: jobName, started_at: startedAtIso, ...outcome }
      const { error: writeError } = runId
        ? await supabaseAdmin.from('cron_run_logs').upsert(row)
        : await supabaseAdmin.from('cron_run_logs').insert({ job_name: jobName, started_at: startedAtIso, ...outcome })

      if (writeError) {
        console.error(
          `[cron-run-logger] ${jobName}: 收尾记录写不进 cron_run_logs —— 这次运行在库里要么没有痕迹、要么永远停在 running。${describe(writeError)}`,
        )
      }
    },
  }
}
