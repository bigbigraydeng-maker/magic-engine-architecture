// #1155 边走边拍「一支样片」证明 —— 一条连续原片 + 一份口播稿 → 一支竖屏 H.264 MP4。
// 目的：证明既有渲染配方（PIL 透明字幕 PNG + ffmpeg overlay/enable(between)，见
// render-assemble.ts / lecture-render.ts）能直接服务「一条连续边走边拍录像」，
// 而不是只服务 AI 分段 job。故此文件**复用配方、不复用 job 语义**：
//   · 不碰 Supabase / 数据库 / 上传 / provider；纯本地。
//   · 字幕时间由稿子按字数**确定性均摊**得出（无 ASR / 无 Whisper / 无付费）——近似对轴，
//     精确逐字对轴留作后续手工道。
// 只暴露「命令构造 / 时间校验 / 缺输入 fail-closed」三块纯逻辑供单测，真跑不进单测。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exec = promisify(execFile)

// 画幅与安全区（复用 lecture-render / render-assemble 的竖屏与字幕位约定）。
export const W = 1080
export const H = 1920
// 字幕落下三分之一：字块**底边**贴 SUB_BOTTOM，向上生长，整体压在安全区内（关键内容 y≤1248）。
export const SUB_BOTTOM = 1240
export const FONT_SIZE = 72
export const STROKE = 7
export const SIDE_MARGIN = 70 // 字幕左右留白，折行按可用宽度 W-2*margin

export interface CaptionCue {
  index: number
  start: number
  end: number
  text: string
}

/** 从口播稿抽字幕条：每一非空行一条；剥掉 markdown 结构行（#、---、|、``` 、引用符 >）。 */
export function parseScriptLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*>\s?/, '').trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^#/.test(l) && !/^-{3,}$/.test(l) && !l.startsWith('|') && !l.startsWith('```'))
}

/**
 * 按字数把每条字幕**无缝**均摊到 [0, totalDurationSec]：确定性、无 provider。
 * 权重 = 该条字符数（至少 1）；start/end 由累计权重比例换算，保证 start0=0、end_last=total、单调。
 */
export function buildCaptionCues(lines: string[], totalDurationSec: number): CaptionCue[] {
  if (lines.length === 0) throw new Error('字幕为空：口播稿没有可用文本行')
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    throw new Error(`视频时长非法：${totalDurationSec}`)
  }
  const weights = lines.map((t) => Math.max(t.length, 1))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const cues: CaptionCue[] = []
  let cum = 0
  for (let i = 0; i < lines.length; i++) {
    const start = (cum / totalWeight) * totalDurationSec
    cum += weights[i]
    const end = (cum / totalWeight) * totalDurationSec
    cues.push({ index: i, start, end, text: lines[i] })
  }
  return cues
}

/** 校验字幕轴：非空、单调不减、落在 [0,总时长]、每条 end>start。任何违规即抛（fail-closed）。 */
export function validateCaptionCues(cues: CaptionCue[], totalDurationSec: number): void {
  if (cues.length === 0) throw new Error('字幕轴为空')
  const eps = 1e-3
  let prevEnd = 0
  for (const c of cues) {
    if (!(c.end > c.start)) throw new Error(`字幕 #${c.index} 时长非正：${c.start}→${c.end}`)
    if (c.start < -eps || c.end > totalDurationSec + eps) {
      throw new Error(`字幕 #${c.index} 越界 [0,${totalDurationSec}]：${c.start}→${c.end}`)
    }
    if (c.start < prevEnd - eps) throw new Error(`字幕 #${c.index} 与上一条重叠：start ${c.start} < 上条 end ${prevEnd}`)
    prevEnd = c.end
  }
}

/** 缺输入即抛（fail-closed）——原片 / 口播稿路径不可读时不许静默出片。 */
export async function assertInputReadable(path: string, label: string): Promise<void> {
  try {
    await access(path, fsConstants.R_OK)
  } catch {
    throw new Error(`${label}不存在或不可读：${path}`)
  }
}

// PIL 画一批全屏透明字幕 PNG：复用 render-assemble 的「大白字 + 黑描边 + 居中」配方，
// 加：按可用宽度自动折行（ASCII 单词不拆）、多行字块底边贴 SUB_BOTTOM。仅需 Pillow。
export const CAPTION_PY = `
import sys, json, re
from PIL import Image, ImageDraw, ImageFont
font_path, out_dir, cues_json, font_size, stroke, sub_bottom, side_margin = (
    sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7]))
W, H = 1080, 1920
usable = W - 2 * side_margin
font = ImageFont.truetype(font_path, font_size)
scratch = ImageDraw.Draw(Image.new("RGBA", (W, H)))
def tok(s):  # ASCII 字母数字连成词不拆，其余每字符一 token
    return re.findall(r"[A-Za-z0-9]+|[^A-Za-z0-9]", s)
def width(s):
    b = scratch.textbbox((0, 0), s, font=font, stroke_width=stroke)
    return b[2] - b[0]
def wrap(text):
    lines, cur = [], ""
    for t in tok(text):
        cand = cur + t
        if cur and width(cand) > usable:
            lines.append(cur); cur = t.lstrip() if t == " " else t
        else:
            cur = cand
    if cur.strip():
        lines.append(cur)
    return lines or [text]
cues = json.loads(cues_json)
for i, txt in enumerate(cues):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    if txt:
        wrapped = wrap(txt)
        asc, desc = font.getmetrics()
        lh = asc + desc + stroke * 2 + 12
        top = sub_bottom - lh * len(wrapped)
        for j, ln in enumerate(wrapped):
            b = d.textbbox((0, 0), ln, font=font, stroke_width=stroke)
            x = (W - (b[2] - b[0])) // 2 - b[0]
            d.text((x, top + j * lh), ln, font=font, fill=(255, 255, 255, 255),
                   stroke_width=stroke, stroke_fill=(0, 0, 0, 235))
    img.save(f"{out_dir}/cap{i}.png")
`

/** 构造 ffmpeg 参数（纯函数，可单测；不真跑）：连续原片裁竖屏 → 逐条字幕 overlay+enable → 保留原声。 */
export function buildProofFfmpegArgs(params: {
  rawPath: string
  capPngPaths: string[]
  cues: CaptionCue[]
  outPath: string
}): string[] {
  const { rawPath, capPngPaths, cues, outPath } = params
  if (capPngPaths.length !== cues.length) {
    throw new Error(`字幕图与轴数量不符：${capPngPaths.length} vs ${cues.length}`)
  }
  const inputs = ['-i', rawPath]
  for (const p of capPngPaths) inputs.push('-i', p)
  const filters: string[] = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[base]`,
  ]
  let cur = 'base'
  cues.forEach((c, i) => {
    const next = `v${i}`
    filters.push(
      `[${cur}][${i + 1}:v]overlay=0:0:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[${next}]`,
    )
    cur = next
  })
  return [
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${cur}]`, '-map', '0:a',
    '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart',
    outPath,
  ]
}

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const d = parseFloat(stdout.trim())
  if (!Number.isFinite(d) || d <= 0) throw new Error(`无法读取时长：${file}`)
  return d
}

export interface RenderProofResult {
  outPath: string
  durationSec: number
  cueCount: number
}

/** 真跑一支样片：校验输入 → 均摊字幕轴 → PIL 画字幕 → ffmpeg 拼 → 落本地 MP4。无 DB / 无上传。 */
export async function renderWalkTalkProof(opts: {
  rawPath: string
  scriptPath: string
  outPath: string
  pythonBin: string // 隔离 venv 的 python（内含 Pillow）；不动系统 python
  fontPath?: string
  readScript: (p: string) => Promise<string>
}): Promise<RenderProofResult> {
  const font = opts.fontPath || process.env.FACTORY_CJK_FONT || '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
  await assertInputReadable(opts.rawPath, '原片')
  await assertInputReadable(opts.scriptPath, '口播稿')
  await assertInputReadable(opts.pythonBin, 'venv python')

  const raw = await opts.readScript(opts.scriptPath)
  const lines = parseScriptLines(raw)
  const durationSec = await ffprobeDuration(opts.rawPath)
  const cues = buildCaptionCues(lines, durationSec)
  validateCaptionCues(cues, durationSec)

  const dir = await mkdtemp(join(tmpdir(), 'walktalk-'))
  try {
    const pyFile = join(dir, 'caps.py')
    await writeFile(pyFile, CAPTION_PY)
    await exec(opts.pythonBin, [
      pyFile, font, dir, JSON.stringify(cues.map((c) => c.text)),
      String(FONT_SIZE), String(STROKE), String(SUB_BOTTOM), String(SIDE_MARGIN),
    ])
    const capPngPaths = cues.map((_, i) => join(dir, `cap${i}.png`))
    const args = buildProofFfmpegArgs({ rawPath: opts.rawPath, capPngPaths, cues, outPath: opts.outPath })
    await exec('ffmpeg', args, { maxBuffer: 1 << 26 })
    return { outPath: opts.outPath, durationSec, cueCount: cues.length }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
