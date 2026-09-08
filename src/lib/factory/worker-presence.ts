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
   * **退回 queued** 让下轮重领，`status` 不会变成 failed（见
   * `pushVideoCreditsItem` 文件头）。于是一条因余额失败的工单会永远躺在
   * queued 里，每轮被领走、每轮失败、又退回来。
   *
   * 实测后果：Oztop 一条 8-03 的工单因 `Insufficient credit balance` 卡了
   * 36 天，恰好赶上工人离线，就被这里误诊成「工人没开机」，让 PM 去开机跑
   * CLI —— **他就算开机跑了也没用，病因根本不是工人不在**。
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
       *   `stuck_on_failure`   有人干过、但这些活每轮都失败 → 看报错，多半要充值
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

  /**
   * 🔴 先判「这些活是不是每轮都在失败」，再判「有没有人干活」。
   *
   * 顺序不能反：队列里全是反复失败退回来的工单时，**不管工人在不在线**都该报，
   * 而且报的是失败原因，不是「去开机」。放在心跳判断之后会有两个漏洞：
   *   ① 工人在线时整条被判 idle → 反复失败的工单永远没人知道（漏报）；
   *   ② 工人恰好离线时被误诊成「没人干活」→ 人照着做也解决不了（误诊，
   *      2026-09-08 Oztop 那条 36 天僵尸工单就是这么被报错的）。
   *
   * 判据要求**全部**排队工单都带失败原因才算这一类：还有新活在等的时候，
   * 「工人没开机」仍然是那个更要紧、更该先说的问题。
   */
  if (snap.queuedStuckOnFailure >= snap.queued) {
    const many = snap.queued > 1
    return {
      idle: false,
      kind: 'stuck_on_failure',
      humanReason:
        `${snap.queued} 个出片工单${many ? '都' : ''}卡在队列里反复失败，` +
        `最老的已经等了 ${waited} 小时 —— 工人每轮领走、每轮失败、又退回队列，不会自己好`,
      ...(snap.stuckSampleReason ? { sampleReason: snap.stuckSampleReason } : {}),
    }
  }

  // 有活、等久了、也不是在反复失败，再看有没有人在干
  const hb = snap.lastHeartbeatHours
  if (hb !== null && hb < QUEUE_STALE_HOURS) {
    // 有工人在动，只是这单还没轮到 —— 那是产能问题，不是「没人干活」
    return { idle: true }
  }

  const since =
    hb === null ? '从来没有工人连上来过' : `已经 ${hb.toFixed(0)} 小时没有工人动过`
  return {
    idle: false,
    kind: 'worker_offline',
    humanReason: `${snap.queued} 个出片工单在排队，最老的等了 ${waited} 小时，${since}`,
  }
}
