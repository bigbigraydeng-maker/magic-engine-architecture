// #1162 PATCH1（command_id ME-1162-PATCH1-BUDGET-NO-OVERWRITE）：seed 的两道 fail-closed 守卫。
// 一次性 whisper-1 seed 极易在「视频比预期长」时悄悄超出 Ray 授权的 US$0.02 上限，
// 或在重跑时覆盖掉 Ray 已手改的 SRT。这里把 seed 编排成**先校验后付费**的确定性流程：
//   守卫 1｜预算前置：先测时长 → 按单一文档化费率估算 whisper 成本 → 超上限即在
//           抽音频 / 调 provider / 落文件 / 任何重试**之前**抛（fail-closed），并报出时长+估算供 Ray 决策。
//   守卫 2｜绝不覆盖：目标 SRT 已存在即在抽音频/调 provider 前抛；最终写用 'wx' 独占创建，
//           竞态下也不会盖掉已存在文件。
// 依赖全部注入，provider/IO 可在单测里替身；本模块自身零联网、零付费。

import type { WhisperSegment, CaptionCue } from './walk-talk-proof'

/** whisper-1 计费费率（唯一、文档化）：US$0.006 / 分钟，按秒计。改费率=改这一个常量。 */
export const WHISPER_USD_PER_MIN = 0.006
/** Ray 已授权的 seed 总花费上限（US$）。禁止在代码里抬高；需更高上限=另行 Build Control 授权。 */
export const SEED_CAP_USD = 0.02

/** 保守估算 whisper 成本：秒数向上取整后按分钟费率算（宁可高估，绝不低估）。 */
export function estimateWhisperCostUsd(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`预算估算失败：原片时长非法 ${durationSec}`)
  }
  return (Math.ceil(durationSec) / 60) * WHISPER_USD_PER_MIN
}

/** 预算前置闸：估算成本 > 上限即抛（附时长+估算），否则返回估算值。绝不裁片/抬上限/拆多次调用。 */
export function assertWithinSeedBudget(durationSec: number, capUsd = SEED_CAP_USD): number {
  const est = estimateWhisperCostUsd(durationSec)
  if (est > capUsd) {
    throw new Error(
      `预算闸拦截：原片 ${durationSec.toFixed(1)}s，估算 whisper 成本 $${est.toFixed(4)} ` +
        `超过授权上限 $${capUsd.toFixed(2)}。请换更短的源片，或另行 Build Control 授权更高上限——` +
        `绝不裁片、不抬上限、不拆成多次付费调用。`,
    )
  }
  return est
}

/** seed 所需的外部能力（真跑注入 ffprobe/ffmpeg/whisper/fs；单测注入替身）。 */
export interface SeedDeps {
  probeDuration: (rawPath: string) => Promise<number>
  extractAudio: (rawPath: string, outMp3: string) => Promise<void>
  /** 恰好一次 provider 调用；失败即抛，编排层**不重试**。 */
  transcribe: (audioPath: string, apiKey: string) => Promise<WhisperSegment[]>
  /** 把分段转成字幕轴（复用既有 segmentsToCaptionCues + 校验）。 */
  buildCues: (segments: WhisperSegment[], durationSec: number) => CaptionCue[]
  serialize: (cues: CaptionCue[]) => string
  /** 目标路径是否已存在（守卫 2 前置检查）。 */
  destExists: (path: string) => Promise<boolean>
  /** 独占写（'wx' 语义）：目标已存在即抛，竞态下不覆盖。 */
  writeExclusive: (path: string, data: string) => Promise<void>
  /** 临时音频路径工厂（真跑用 mkdtemp；测试给固定值）。 */
  makeAudioPath: () => Promise<string>
  cleanup?: () => Promise<void>
}

export interface SeedResult {
  cues: CaptionCue[]
  srt: string
  estimatedCostUsd: number
  providerCalls: number
}

/**
 * seed 编排：守卫 1（预算前置）→ 守卫 2 前置（目标不存在）→ 抽音频 → 一次听写 → 建轴 → 独占写。
 * 任何守卫失败都在**付费/落文件之前**抛。provider 调用恰好一次，绝不重试、绝不第二次。
 */
export async function seedWalkTalkSrt(opts: {
  rawPath: string
  outSrtPath: string
  apiKey: string
  deps: SeedDeps
  capUsd?: number
}): Promise<SeedResult> {
  const { rawPath, outSrtPath, apiKey, deps } = opts

  // —— 守卫 2 前置：目标 SRT 已存在，绝不在其上覆盖（在任何 extract/provider 前拒）——
  if (await deps.destExists(outSrtPath)) {
    throw new Error(
      `覆盖闸拦截：目标 SRT 已存在，拒绝覆盖（可能是 Ray 已手改的版本）：${outSrtPath}。` +
        `请指定一个新的输出路径。`,
    )
  }

  // —— 守卫 1：预算前置（在任何 extract/provider/落文件前）——
  const durationSec = await deps.probeDuration(rawPath)
  const estimatedCostUsd = assertWithinSeedBudget(durationSec, opts.capUsd)

  const audioPath = await deps.makeAudioPath()
  let providerCalls = 0
  try {
    await deps.extractAudio(rawPath, audioPath)
    providerCalls++ // 恰好一次；失败下方不重试
    const segments = await deps.transcribe(audioPath, apiKey)
    const cues = deps.buildCues(segments, durationSec)
    const srt = deps.serialize(cues)
    // —— 守卫 2 落地：独占创建，竞态下不覆盖 ——
    await deps.writeExclusive(outSrtPath, srt)
    return { cues, srt, estimatedCostUsd, providerCalls }
  } finally {
    await deps.cleanup?.()
  }
}
