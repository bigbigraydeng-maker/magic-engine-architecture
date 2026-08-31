/**
 * 轮询一个 tailor_made_jobs 任务直到出结果。
 *
 * 从 TailorMadeEditor.tsx 抽出来单独放，是为了能被测试直接钉住——这段逻辑
 * 是整条链路上最后一个会把 "Unexpected token '<'" 甩到顾问脸上的地方，
 * 而这句报错甲方已经被烧过三次，不能再靠"看代码觉得没问题"。
 *
 * 背景：ME 后台正式域名走 Cloudflare 代理，一个请求等超过约 100 秒会被掐断，
 * 27 天以上的团生成要 100-180 秒，所以改成了「建任务 → 后台跑 → 前端轮询」。
 * 但一次生成要轮询几十次，其中任何一次撞上网关错误页 / Render 滚动重启 /
 * 掉一个包，裸 `res.json()` 就抛 SyntaxError，文本被原样显示给顾问——
 * 而此时后台任务其实还在正常跑、跑完还会自动存回草稿。
 */

/** 轮询间隔前密后疏：小改动几百毫秒就完，大团慢慢拉长到 3 秒一次。 */
export const POLL_DELAYS_MS = [300, 600, 1000, 1500, 2000, 3000]
/** 兜底总时长，跟 Anthropic 客户端默认超时对齐。 */
export const POLL_MAX_MS = 10 * 60 * 1000
/** 允许连续多少次「问不到」才真的放弃——见文件头注释。 */
export const POLL_MAX_CONSECUTIVE_FAILURES = 5

export interface PollJobOutcome {
  result?: Record<string, unknown>
  error?: string
  /** 页面已卸载，调用方应跳过所有 setState */
  cancelled?: true
}

export async function pollTailorMadeJob(
  clientId: string,
  jobId: string,
  isCancelled: () => boolean,
  /** 测试注入：跳过真实等待 */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = () => Date.now(),
): Promise<PollJobOutcome> {
  const startedAt = now()
  let attempt = 0
  let consecutiveFailures = 0

  for (;;) {
    if (isCancelled()) return { cancelled: true }

    // 一次轮询的「软失败」：网络抖动、网关错误页、非 JSON 响应。
    // 这些都不代表任务失败，只代表这一次没问到——记一笔，等下一轮再问。
    let terminal: PollJobOutcome | null = null
    try {
      const res = await fetch(`/api/clients/${clientId}/tailor-made/jobs/${jobId}`, {
        credentials: 'include',
      })
      if (isCancelled()) return { cancelled: true }

      // 4xx 是确定性的（任务不存在、没权限），重试多少次都一样，直接收尾。
      // 5xx / 网关错误页留给下面的重试计数。
      if (res.status >= 400 && res.status < 500) {
        const msg = await res.json().then(
          (d) => (d as { error?: string })?.error,
          () => null,
        )
        terminal = { error: msg || `查询任务失败（${res.status}）` }
      } else if (!res.ok) {
        throw new Error(`transient ${res.status}`)
      } else {
        // 关键：解析放在 try 里。网关返回 HTML 时这里抛的就是
        // "Unexpected token '<'"，绝不能让它冒到界面上去。
        const data = await res.json()
        if (data.status === 'completed') terminal = { result: data.result }
        else if (data.status === 'failed') terminal = { error: data.error || '生成失败' }
      }
      consecutiveFailures = 0
    } catch {
      if (isCancelled()) return { cancelled: true }
      consecutiveFailures += 1
      if (consecutiveFailures >= POLL_MAX_CONSECUTIVE_FAILURES) {
        // 说人话，并且告诉顾问「内容多半还在」——后台任务大概率已经跑完并
        // 存回草稿了，刷新就能看到，别让他重新生成、白花一次钱。
        return { error: '网络不稳定，暂时查不到生成进度。内容很可能已经生成好了 —— 请刷新页面看一下，通常就在草稿里' }
      }
    }

    if (terminal) return terminal

    if (now() - startedAt > POLL_MAX_MS) {
      return { error: '等待太久了，任务可能卡住了，请重试或联系技术支持' }
    }
    await sleep(POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)])
    attempt += 1
  }
}
