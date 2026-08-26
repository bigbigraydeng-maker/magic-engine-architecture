// #1159 · CTS Golden China · 静图拼接 Reel 出片
//
// 目的：**没有实拍原片**的客户（CTS 真拍 = 0，见 docs/media-inventory.md）也能出可审的 15s 竖屏 Reel。
// 组成 = 真实照片（Pexels/Unsplash 授权）+ 烧字幕 + BGM。付费 I2V provider **不用**（合同禁；本模块零联网）。
//
// 复用配方（不重造）：
//   · walk-talk-proof.ts 的 CAPTION_PY（PIL 透明字幕 PNG）+ W/H/CAPTION_TOP/FONT_SIZE/STROKE/SIDE_MARGIN
//   · assertInputReadable / assertOutputPathDistinct / ffprobeDuration 的 fail-closed 契约
//   · CaptionCue 类型 & 高亮标记（`**...**`）
//
// 新增：静图 ken-burns 慢推（zoompan filter）→ concat → overlay 字幕 → mux BGM。
// 硬约束：**总时长 ≤ 15 秒**（Ray 2026-08-27 直报：FB 实测 <15s 拿 leads）。
//
// 纯逻辑函数（构造 ffmpeg args / 校验时长 / 缺输入 fail-closed）暴露给单测；真跑不进单测。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  W, H, CAPTION_TOP, FONT_SIZE, STROKE, SIDE_MARGIN, CAPTION_PY,
  assertInputReadable, assertOutputPathDistinct, parseRuns, stripMarks,
  type CaptionCue, type CaptionRun,
} from './walk-talk-proof'

const exec = promisify(execFile)

/** 硬约束：单支 Reel 总时长上限。Ray 2026-08-27 拍板，FB 实测线索率来源。 */
export const REEL_HARD_CAP_SEC = 15
/** 每一格 ken-burns 慢推的最短时长（避免闪帧不成型）。 */
export const SHOT_MIN_SEC = 1.5
/** 输出帧率：与 walk-talk-proof 一致；zoompan d 参数按此换算。 */
export const FPS = 30

export interface ShotSpec {
  /** 静图绝对路径（真实照片，非 AI 生成）。 */
  imagePath: string
  /** 本格在成片里的持续时长（秒）。所有格总和必须 ≤ REEL_HARD_CAP_SEC。 */
  durationSec: number
  /** 本格烧的一行字幕；`**...**` 之间为高亮词。空串 = 本格无字。 */
  caption: string
}

export interface StillsSlideshowReelInput {
  shots: ShotSpec[]
  outPath: string
  /** 隔离 venv 里的 python3（内含 Pillow）；沿用 walk-talk-proof 惯例。 */
  pythonBin: string
  /** 可选真 BGM 路径（MP3/WAV/AAC）；不给就用内联合成的极轻 ambient bed 打底。 */
  bgmPath?: string
  /** BGM 音量线性系数：真 BGM 建议 0.35~0.6；合成 bed 默认 0.05（几乎静音）。 */
  bgmVolume?: number
}

export interface StillsSlideshowReelResult {
  outPath: string
  totalDurationSec: number
  shotCount: number
  cueCount: number
  bgmMode: 'file' | 'synth'
}

// ─── 校验 ───────────────────────────────────────────────────────────────────

/** 单元测试友好的校验器：只查形状/时长，不碰磁盘。 */
export function validateShots(shots: ShotSpec[]): void {
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new Error('stills-slideshow-reel：shots 不能为空')
  }
  if (shots.length > 8) {
    throw new Error(`stills-slideshow-reel：shots 太多（${shots.length}），单支 Reel 建议 3–6 格`)
  }
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (!s.imagePath || typeof s.imagePath !== 'string') {
      throw new Error(`shot #${i}: imagePath 缺失`)
    }
    if (!Number.isFinite(s.durationSec) || s.durationSec < SHOT_MIN_SEC) {
      throw new Error(`shot #${i}: durationSec 非法或过短（${s.durationSec}s < ${SHOT_MIN_SEC}s）`)
    }
    if (typeof s.caption !== 'string') {
      throw new Error(`shot #${i}: caption 必须为字符串（可空）`)
    }
  }
  const total = shots.reduce((a, s) => a + s.durationSec, 0)
  if (total > REEL_HARD_CAP_SEC + 1e-6) {
    throw new Error(
      `stills-slideshow-reel：总时长 ${total.toFixed(2)}s 超过硬顶 ${REEL_HARD_CAP_SEC}s（Ray FB 实测线索率 <15s）`,
    )
  }
}

/** 由 shots 派生 CaptionCue 轴：一格一条字幕，起止 = 该格的绝对时间窗。空 caption 不产生 cue。 */
export function shotsToCues(shots: ShotSpec[]): CaptionCue[] {
  const cues: CaptionCue[] = []
  let t = 0
  shots.forEach((s, i) => {
    const start = t
    const end = t + s.durationSec
    t = end
    if (s.caption.trim() === '') return
    const runs: CaptionRun[] = parseRuns(s.caption)
    cues.push({ index: cues.length, start, end, text: stripMarks(s.caption), runs })
  })
  // 索引在 push 时已按 cues.length 编号 → 单调 0..n-1；起止已由 durationSec 单调累加保证严格递增。
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].end <= cues[i].start) {
      throw new Error(`cue #${i} end<=start（${cues[i].end}<=${cues[i].start}）`)
    }
  }
  return cues
}

// ─── ffmpeg 参数构造（纯函数，供单测）─────────────────────────────────────────

/**
 * 每一格的 ken-burns 慢推：视 zoompan 的 d 参数 = 该格帧数（durationSec * FPS）。
 * 缩放至 1.10，起点 z=1.0；x/y 稳定居中；输出 1080×1920。
 * 为解决 zoompan 依赖单帧输入的老坑：先 scale 输入到 2× 目标画布 + crop 居中裁竖屏，再 zoompan。
 */
export function buildKenburnsChain(inputIndex: number, durationSec: number, outLabel: string): string {
  const frames = Math.max(1, Math.round(durationSec * FPS))
  return [
    `[${inputIndex}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`,
    `crop=${W * 2}:${H * 2}`,
    `zoompan=z='min(1.0+0.10*on/${frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    `trim=duration=${durationSec.toFixed(3)}`,
    `setpts=PTS-STARTPTS,setsar=1[${outLabel}]`,
  ].join(',')
}

/**
 * 构造 ffmpeg 命令行（不真跑）：N 张静图（每张 -loop 1 -t d）→ ken-burns → concat →
 *   逐条字幕 overlay+enable → mux 音轨（真 BGM or 合成 bed）→ 1080×1920 H.264 + AAC。
 */
export function buildStillsSlideshowFfmpegArgs(params: {
  shots: ShotSpec[]
  capPngPaths: string[]  // 与 shotsToCues 对齐（长度 = 非空 caption 的格数）
  cues: CaptionCue[]
  outPath: string
  bgmPath?: string
  bgmVolume?: number
}): string[] {
  const { shots, capPngPaths, cues, outPath, bgmPath } = params
  if (capPngPaths.length !== cues.length) {
    throw new Error(`字幕图与轴数量不符：${capPngPaths.length} vs ${cues.length}`)
  }
  const totalDur = shots.reduce((a, s) => a + s.durationSec, 0)

  // 图片输入：每张 -loop 1 -t d，视频流独立
  const inputs: string[] = []
  shots.forEach((s) => {
    inputs.push('-loop', '1', '-t', s.durationSec.toFixed(3), '-i', s.imagePath)
  })
  // 字幕 PNG 输入（无循环，透明层，overlay 用 enable 控时窗）
  capPngPaths.forEach((p) => {
    inputs.push('-i', p)
  })
  // 音轨输入
  if (bgmPath) {
    inputs.push('-i', bgmPath)
  } else {
    // 内联合成 ambient bed：两个正弦 A3(220) + E4(330) 叠加（纯五度，柔和），44.1k stereo，长度=总时长。
    // 极低音量（~5% 之后再被 volume 拉低）——放这只是给成片一个音轨占位，让 FB 不当无声视频对待。
    inputs.push(
      '-f', 'lavfi',
      '-t', totalDur.toFixed(3),
      '-i', `aevalsrc=0.10*sin(2*PI*220*t)+0.06*sin(2*PI*330*t):s=44100:c=stereo`,
    )
  }

  // ── filter_complex ──
  const filters: string[] = []

  // 每一格 ken-burns
  const kenLabels: string[] = []
  shots.forEach((s, i) => {
    const label = `k${i}`
    filters.push(buildKenburnsChain(i, s.durationSec, label))
    kenLabels.push(label)
  })

  // concat
  const concatLabel = 'base'
  filters.push(`${kenLabels.map((l) => `[${l}]`).join('')}concat=n=${shots.length}:v=1:a=0[${concatLabel}]`)

  // 逐条字幕 overlay（字幕 PNG 是第 (shots.length + k) 号输入）
  let cur = concatLabel
  cues.forEach((c, i) => {
    const capInputIdx = shots.length + i
    const next = `v${i}`
    filters.push(
      `[${cur}][${capInputIdx}:v]overlay=0:0:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[${next}]`,
    )
    cur = next
  })

  // 音轨处理：BGM 淡入淡出 + 音量
  const audioInputIdx = shots.length + capPngPaths.length
  const vol = params.bgmVolume ?? (bgmPath ? 0.5 : 0.05)
  const fadeDur = Math.min(2, totalDur / 5)
  filters.push(
    `[${audioInputIdx}:a]volume=${vol},afade=t=in:st=0:d=${fadeDur.toFixed(3)},afade=t=out:st=${(totalDur - fadeDur).toFixed(3)}:d=${fadeDur.toFixed(3)}[aout]`,
  )

  return [
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${cur}]`, '-map', '[aout]',
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest',
    '-movflags', '+faststart',
    outPath,
  ]
}

// ─── 真跑（不进单测）───────────────────────────────────────────────────────

/**
 * 端到端出片：校验 → 派生 cues → 渲染字幕 PNG（Pillow）→ 跑 ffmpeg → 返回元数据。
 * 无 DB / 无上传 / 无联网（除非 bgmPath 是网络挂载）。
 */
export async function renderStillsSlideshowReel(
  input: StillsSlideshowReelInput,
): Promise<StillsSlideshowReelResult> {
  validateShots(input.shots)
  await assertInputReadable(input.pythonBin, 'venv python')
  for (const s of input.shots) {
    await assertInputReadable(s.imagePath, 'still')
  }
  if (input.bgmPath) {
    await assertInputReadable(input.bgmPath, 'BGM')
  }
  // 输出别名闸：ffmpeg -y 会覆盖输出，别让 outPath 指向任何 still 或 BGM。
  const otherInputs = input.shots.map((s) => s.imagePath)
  if (input.bgmPath) otherInputs.push(input.bgmPath)
  await assertOutputPathDistinct(input.outPath, otherInputs)

  const cues = shotsToCues(input.shots)

  // 渲染字幕 PNG（transparent），沿用 walk-talk-proof 的 CAPTION_PY 配方
  const tmp = await mkdtemp(join(tmpdir(), 'cts-reel-caps-'))
  let capPngPaths: string[] = []
  try {
    if (cues.length > 0) {
      // 沿用 walk-talk-proof 的默认字体：Arial Unicode.ttf（覆盖 CJK；Pillow 可打开 TTF）。
      // 老版 Pillow 打不开 macOS 的 .ttc 容器，别用 PingFang.ttc。
      const fontPath = process.env.WALKTALK_FONT
        ?? process.env.FACTORY_CJK_FONT
        ?? '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
      const pyPath = join(tmp, 'cap.py')
      await writeFile(pyPath, CAPTION_PY, 'utf8')
      const cuesJson = JSON.stringify(cues.map((c) => c.runs.map((r) => [r.t, r.hi])))
      await exec(input.pythonBin, [
        pyPath, fontPath, tmp, cuesJson,
        String(FONT_SIZE), String(STROKE), String(CAPTION_TOP), String(SIDE_MARGIN),
      ])
      capPngPaths = cues.map((_, i) => join(tmp, `cap${i}.png`))
    }

    const args = buildStillsSlideshowFfmpegArgs({
      shots: input.shots,
      capPngPaths,
      cues,
      outPath: input.outPath,
      bgmPath: input.bgmPath,
      bgmVolume: input.bgmVolume,
    })
    await exec('ffmpeg', args)

    const totalDurationSec = input.shots.reduce((a, s) => a + s.durationSec, 0)
    return {
      outPath: input.outPath,
      totalDurationSec,
      shotCount: input.shots.length,
      cueCount: cues.length,
      bgmMode: input.bgmPath ? 'file' : 'synth',
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
