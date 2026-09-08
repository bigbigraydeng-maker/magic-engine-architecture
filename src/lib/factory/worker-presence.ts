/**
 * 出片工人还在不在。
 *
 * 出片这条线的装配环节跑在一台 Mac 上（Python + ffmpeg + piper + 品牌素材），
 * 队列协议本身是服务端的、跟机器无关（认领走 RPC、素材走签名链接、有心跳、
 * 交付时服务端复扫红线），但**没人跑工人的时候，工单就静静躺在队列里**。
 *
 * 🔴 这不是「工人坏了」——工人没开机是常态（合盖、出门、重启）。
 *    问题是**从外面看不出来**：队列里躺着活，看板上什么都没有，
 *    而「这周怎么没出片」要等人想起来问才发现。
 *
 * 判据故意做得保守：**只有队列里真的有活在等**的时候才报。
 * 没活的时候工人没开机完全正常，报了就是噪音 —— 误报成常态，告警就废了。
 */

/** 工单排队多久还没人认领算「没人干活」。给足合盖午休的余量。 */
export const QUEUE_STALE_HOURS = 6

export interface QueueSnapshot {
  /** 队列里等着的工单数（status='queued'） */
  queued: number
  /** 最老那单等了多久（小时）。队列空时传 null */
  oldestQueuedHours: number | null
  /** 任何工人最近一次心跳距今多久（小时）。从没有过心跳传 null */
  lastHeartbeatHours: number | null
  /**
   * 排队工单里**带着失败原因**的有几个。
   *
   * 🔴 为什么必须单独数（2026-09-08 生产实测）：余额不足时 worker 把工单
   * **退回 queued** 而不是标 failed（见 `pushVideoCreditsItem` 文件头）。
   * 于是一条失败过的工单跟「等人干的新活」在队列里长得一模一样。
   *
   * 实测后果：Oztop 一条 8-03 的工单因 `Insufficient credit balance` 失败后
   * 退回队列，一躺 36 天（`attempt_count=1`，失败后就没再被碰过）。恰好赶上
   * 工人离线，就被这里误诊成「工人没开机」，让 PM 去开机跑 CLI ——
   * **他就算开机跑了也没用，病因根本不是工人不在**。
   *
   * 只看 `status='queued'` 的行是安全的：`reject_reason` 这个字段被两种语义
   * 共用（人工审核意见 / 机器执行失败原因），但人工拒绝的工单落在
   * `review_rejected` 状态，混不进来。
   */
  queuedStuckOnFailure: number
  /** 其中一条的失败原因原文（截断即可）—— 给人看的证据，判定层不解析它。 */
  stuckSampleReason: string | null
}

export type WorkerPresence =
  | { idle: true }
  | {
      idle: false
      /**
       * 病因分类 —— 两者的处置完全不同，混成一条会让人做错的事：
       *   `worker_offline`     没人干活 → 去把工人跑起来
       *   `stuck_on_failure`   这些活都失败过、还卡在队列里 → 看报错，多半要充值
       */
      kind: 'worker_offline' | 'stuck_on_failure'
      /** 给人看的一句话：等了多久、多久没人干活 / 卡在什么错上 */
      humanReason: string
      /** `stuck_on_failure` 时带上失败原因原文，方便上层原样印给人看 */
      sampleReason?: string
    }

/**
 * 队列里有活但没人干 → 报。
 *
 * 两个数缺一不可：光看「有没有心跳」会在没活的时候天天误报；
 * 光看「队列长度」分不清是没人干还是正在干。
 */
export function judgeWorkerPresence(snap: QueueSnapshot): WorkerPresence {
  // 队列空 = 工人没开机也无所谓，不报
  if (snap.queued === 0) return { idle: true }

  // 有活，但最老的那单还没等够久 —— 可能工人正在跑别的单
  if (snap.oldestQueuedHours === null || snap.oldestQueuedHours < QUEUE_STALE_HOURS) {
    return { idle: true }
  }

  const waited = snap.oldestQueuedHours.toFixed(0)
  const hb = snap.lastHeartbeatHours
  const workerOffline = hb === null || hb >= QUEUE_STALE_HOURS

  /**
   * 🔴 工人离线时，**永远先报「去把工人跑起来」**，不管这些活失败过没有。
   *
   * 为什么顺序是这个（Codex P1 复审 PR #1485，两条独立证据）：
   *
   *   带 `reject_reason` 的 queued 工单**不等于「没救了」**——`fail` 路由把
   *   可重试失败原样退回 queued 并留下原因，而 `max_attempts` 默认是 2，
   *   所以队列里带原因的工单通常**只失败过一次、还有一次机会**；真正没救的
   *   会进 `dead_letter` 终态，压根不在 queued 里。
   *
   *   于是「有原因就判卡住、并告诉 PM 别开机」会造成一个死结：网络抖动这种
   *   暂时错误失败一次后，只要工人恰好离线，重试就**永远不会发生**——因为
   *   待办把唯一能触发重试的动作（开机）劝阻掉了。
   *
   * 开机是离线状态下**无条件正确**的第一步，所以它优先。失败原因不丢——
   * 作为附加信息一起带上，开机后还是过不去时那就是下一步要查的东西。
   */
  if (workerOffline) {
    const since =
      hb === null ? '从来没有工人连上来过' : `已经 ${hb.toFixed(0)} 小时没有工人动过`
    return {
      idle: false,
      kind: 'worker_offline',
      humanReason: `${snap.queued} 个出片工单在排队，最老的等了 ${waited} 小时，${since}`,
      // 这些活失败过的话，把原因带上：开机后如果还是过不去，就是它。
      ...(snap.queuedStuckOnFailure > 0 && snap.stuckSampleReason
        ? { sampleReason: snap.stuckSampleReason }
        : {}),
    }
  }

  /**
   * 工人在线，但排队的活**全部**失败过 —— 这才是真正的「有人干、就是过不去」。
   *
   * 这一支堵的是旧逻辑的漏报：以前只要心跳新鲜就整条判 idle，于是「工人在跑、
   * 但这批活每次都失败」永远没人知道。
   */
  if (snap.queuedStuckOnFailure >= snap.queued) {
    const many = snap.queued > 1
    return {
      idle: false,
      kind: 'stuck_on_failure',
      humanReason:
        `工人在线，但排队的 ${snap.queued} 个出片工单${many ? '都' : ''}失败过、还没过去，` +
        `最老的已经等了 ${waited} 小时 —— 失败的原因不解决，它们不会自己好`,
      ...(snap.stuckSampleReason ? { sampleReason: snap.stuckSampleReason } : {}),
    }
  }

  // 工人在线、还有没失败过的新活在等 —— 那是产能问题，不是「没人干活」
  return { idle: true }
}
