// #1155 边走边拍「一支样片」证明 —— 一条连续原片 + 一份口播稿 → 一支竖屏 H.264 MP4。
// 目的：证明既有渲染配方（PIL 透明字幕 PNG + ffmpeg overlay/enable(between)，见
// render-assemble.ts / lecture-render.ts）能直接服务「一条连续边走边拍录像」，
// 而不是只服务 AI 分段 job。故此文件**复用配方、不复用 job 语义**：
//   · 不碰 Supabase / 数据库 / 上传 / provider；纯本地。
//   · 字幕时间由稿子按字数**确定性均摊**得出（无 ASR / 无 Whisper / 无付费）——近似对轴，
//     精确逐字对轴留作后续手工道。
//   · 关键词高亮：稿子里用 **双星号** 标记高亮词（客户数据），本模块只认标记、保持通用。
// 只暴露「命令构造 / 时间校验 / 缺输入 fail-closed」等纯逻辑供单测，真跑不进单测。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exec = promisify(execFile)

// 画幅与安全区（复用 lecture-render / render-assemble 的竖屏约定）。
export const W = 1080
export const H = 1920
// 字幕放**顶部**：低机位自拍脸偏低，字幕压到嘴；顶部天空区最干净。字块**顶边**贴 CAPTION_TOP。
export const CAPTION_TOP = 300
export const FONT_SIZE = 72
export const STROKE = 7
export const SIDE_MARGIN = 70 // 字幕左右留白，折行按可用宽度 W-2*margin

export interface CaptionRun {
  t: string
  hi: boolean // 是否高亮（黄色）
}

export interface CaptionCue {
  index: number
  start: number
  end: number
  text: string // 去标记后的纯文本（计时权重/展示用）
  runs: CaptionRun[] // 带高亮标记的分段
}

/** 从口播稿抽字幕行：每一非空行一条；剥掉 markdown 结构行（#、---、|、``` 、引用符 >）。保留 ** 高亮标记。 */
export function parseScriptLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*>\s?/, '').trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^#/.test(l) && !/^-{3,}$/.test(l) && !l.startsWith('|') && !l.startsWith('```'))
}

/** 去掉高亮标记，得纯展示文本。 */
export function stripMarks(line: string): string {
  return line.replace(/\*\*/g, '')
}

/** 把一行拆成分段：**...** 内为高亮段，其余为普通段。 */
export function parseRuns(line: string): CaptionRun[] {
  const runs: CaptionRun[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) runs.push({ t: line.slice(last, m.index), hi: false })
    runs.push({ t: m[1], hi: true })
    last = re.lastIndex
  }
  if (last < line.length) runs.push({ t: line.slice(last), hi: false })
  return runs.length > 0 ? runs : [{ t: line, hi: false }]
}

/**
 * 按字数把每条字幕**无缝**均摊到 [0, totalDurationSec]：确定性、无 provider。
 * 权重 = 去标记后字符数（至少 1）；start/end 由累计权重比例换算，保证 start0=0、end_last=total、单调。
 */
export function buildCaptionCues(lines: string[], totalDurationSec: number): CaptionCue[] {
  if (lines.length === 0) throw new Error('字幕为空：口播稿没有可用文本行')
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    throw new Error(`视频时长非法：${totalDurationSec}`)
  }
  const plain = lines.map(stripMarks)
  const weights = plain.map((t) => Math.max(t.length, 1))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const cues: CaptionCue[] = []
  let cum = 0
  for (let i = 0; i < lines.length; i++) {
    const start = (cum / totalWeight) * totalDurationSec
    cum += weights[i]
    const end = (cum / totalWeight) * totalDurationSec
    cues.push({ index: i, start, end, text: plain[i], runs: parseRuns(lines[i]) })
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
// 加：① 按可用宽度自动折行（ASCII 单词不拆、高亮词整体不拆）；② 高亮段画黄色；
// ③ 字块顶边贴 CAPTION_TOP（顶部天空区，避开脸）。仅需 Pillow。
export const CAPTION_PY = `
import sys, json, re
from PIL import Image, ImageDraw, ImageFont
font_path, out_dir, cues_json, font_size, stroke, cap_top, side_margin = (
    sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7]))
W, H = 1080, 1920
usable = W - 2 * side_margin
WHITE = (255, 255, 255, 255); HI = (255, 214, 0, 255); OUTLINE = (0, 0, 0, 235)
font = ImageFont.truetype(font_path, font_size)
scratch = ImageDraw.Draw(Image.new("RGBA", (W, H)))
def wadv(s):  # 排版宽度（不含描边），用于居中与步进，保持一致避免右漂
    b = scratch.textbbox((0, 0), s, font=font, stroke_width=0)
    return b[2] - b[0]
def atoms(runs):  # 高亮段整体一个 atom；普通段拆成 ASCII 词 / 单字符供折行
    out = []
    for text, hi in runs:
        if hi:
            out.append((text, True))
        else:
            for t in re.findall(r"[A-Za-z0-9]+|[^A-Za-z0-9]", text):
                out.append((t, False))
    return out
def wrap(a):
    lines, cur = [], []
    for t, hi in a:
        cand = "".join(x for x, _ in cur) + t
        if cur and wadv(cand) > usable and t != " ":
            lines.append(cur); cur = [] if t == " " else [(t, hi)]
        else:
            if not cur and t == " ":
                continue
            cur.append((t, hi))
    if cur:
        lines.append(cur)
    return lines or [[("", False)]]
cues = json.loads(cues_json)
asc, desc = font.getmetrics()
lh = asc + desc + stroke * 2 + 14
for i, runs in enumerate(cues):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for j, line in enumerate(wrap(atoms(runs))):
        lw = wadv("".join(x for x, _ in line))
        x = (W - lw) // 2; y = cap_top + j * lh
        for t, hi in line:
            d.text((x, y), t, font=font, fill=(HI if hi else WHITE), stroke_width=stroke, stroke_fill=OUTLINE)
            x += wadv(t)
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

// ---------- ASR 模式：听写真实口播 + 真实时间戳（复用 lecture-render 的 Whisper 配方） ----------
// 稿子≠实际口播（自由发挥）时，确定性均摊对不上。此模式把字幕直接取自听写结果，按真实时间上。
// 复用点：lecture-render.ts extractAudio + whisperTranscribe 的同款配方（OpenAI whisper-1, verbose_json）。

export interface WhisperSegment {
  start: number
  end: number
  text: string
}

/** 抽单声道 16k 低码音轨（Whisper 限 25MB，视频直传会爆）——同 lecture-render extractAudio。 */
async function extractAudioForAsr(videoFile: string, outMp3: string): Promise<void> {
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', outMp3])
}

/** OpenAI Whisper 听写，返回带时间戳分段——同 lecture-render whisperTranscribe 配方。 */
async function transcribeAudio(audioFile: string, apiKey: string): Promise<WhisperSegment[]> {
  const form = new FormData()
  const buf = await readFile(audioFile)
  form.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', 'whisper-1')
  form.append('language', 'zh')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(300000),
  })
  if (!res.ok) throw new Error(`Whisper 听写失败 ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { segments?: { start: number; end: number; text: string }[] }
  const segments = (json.segments ?? [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? '').trim() }))
    .filter((s) => s.text)
  if (segments.length === 0) throw new Error('听写结果为空（录像里没有可识别的语音？）')
  return segments
}

/** 从稿子里的 **双星号** 收集高亮词表（客户数据；转录字幕据此上色，模块本身不含任何词）。 */
export function extractHighlightTerms(raw: string): string[] {
  const terms = new Set<string>()
  const re = /\*\*([^*]+)\*\*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const t = m[1].trim()
    if (t) terms.add(t)
  }
  return Array.from(terms)
}

// 语气水词清单（保守）。仅当**独立出现**时删——见 cleanFiller 的边界判定。
export const FILLER_PARTICLES = ['啊', '呃', '嗯', '唉', '哦', '噢', '诶', '呀']

// 边界字符：标点 / 空白 / ASCII / 字符串两端。语气词只有紧挨边界时才算「独立」。
const FILLER_BOUNDARY = /[\s，。！？；、：""''（）《》【】…—·~,.!?;:"'()]/

/**
 * 清洗口播噪声：**只删独立语气词**，绝不删合法词语内部的匹配字符。
 * 「独立」= 该语气词左右至少一侧是边界（标点/空白/ASCII/句首句尾）；
 * 例：句末「…开完会啊」→ 删啊；但「不要唉声叹气」中的「唉」两侧都是汉字 → 保留。
 */
export function cleanFiller(text: string): string {
  const chars = Array.from(text)
  const isBoundary = (c: string | undefined): boolean =>
    c === undefined || FILLER_BOUNDARY.test(c) || /[A-Za-z0-9]/.test(c)
  const kept: string[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (FILLER_PARTICLES.includes(c) && (isBoundary(chars[i - 1]) || isBoundary(chars[i + 1]))) {
      continue // 独立语气词，删
    }
    kept.push(c)
  }
  return kept.join('').replace(/\s{2,}/g, ' ').replace(/，{2,}/g, '，').replace(/^[，、\s]+/, '').trim()
}

// 标点类 token：不得作为一段的开头（否则会形成「只有标点」的字幕帧）。
const PUNCT_TOKEN = /^[。！？；，、：）】」』》…—·”’%,.!?;:)\]]+$/

/**
 * 把一条转录文本按标点/长度切成短句大字；尽量不超过 maxChars。
 * 关键：① 英文/数字单词整体不切（按 token 打包），避免 Submit / GA4 被拦腰断开；
 *       ② 句末/尾随标点**始终附到当前段**（哪怕因此略超一字），绝不单独成帧。
 */
export function splitByLength(text: string, maxChars: number): string[] {
  const out: string[] = []
  for (const sent of text.split(/(?<=[。！？；，、])/)) {
    const s = sent.trim()
    if (!s) continue
    const tokens = s.match(/[A-Za-z0-9]+|[^A-Za-z0-9]/g) || [s]
    let cur = ''
    for (const t of tokens) {
      const isPunct = PUNCT_TOKEN.test(t)
      if (cur && cur.length + t.length > maxChars && !isPunct && t !== ' ') {
        out.push(cur)
        cur = t
      } else if (cur === '' && t === ' ') {
        continue
      } else {
        cur += t
      }
    }
    if (cur.trim()) out.push(cur)
  }
  // 兜底：任何「纯标点」碎片并回上一段（句末标点不得单独成帧）。
  const merged: string[] = []
  for (const p of out) {
    if (merged.length > 0 && PUNCT_TOKEN.test(p.trim())) {
      merged[merged.length - 1] += p.trim()
    } else {
      merged.push(p)
    }
  }
  return merged.length > 0 ? merged : [text]
}

/** 用词表把一行标成高亮/普通分段（最长优先匹配）。词表为空则整行普通。 */
export function applyHighlights(text: string, keywords: string[]): CaptionRun[] {
  const sorted = keywords.filter(Boolean).sort((a, b) => b.length - a.length)
  const runs: CaptionRun[] = []
  let i = 0
  while (i < text.length) {
    const hit = sorted.find((k) => text.startsWith(k, i))
    if (hit) {
      runs.push({ t: hit, hi: true })
      i += hit.length
    } else {
      const last = runs[runs.length - 1]
      if (last && !last.hi) last.t += text[i]
      else runs.push({ t: text[i], hi: false })
      i++
    }
  }
  return runs.length > 0 ? runs : [{ t: text, hi: false }]
}

/**
 * 把听写分段切成字幕轴（**真实时间戳**）：长段按标点/长度切成短句，段内按字数分时间；
 * 跨段单调钳位、末端不超总时长。高亮由词表决定。
 */
export function segmentsToCaptionCues(
  segments: WhisperSegment[],
  totalDurationSec: number,
  maxChars: number,
  keywords: string[],
  clean = false,
): CaptionCue[] {
  if (segments.length === 0) throw new Error('听写分段为空')
  const cues: CaptionCue[] = []
  let idx = 0
  let prevEnd = 0
  for (const seg of segments) {
    const segText = clean ? cleanFiller(seg.text) : seg.text
    if (!segText.trim()) continue
    const pieces = splitByLength(segText, maxChars)
    const span = Math.max(seg.end - seg.start, 0.001)
    const totalLen = pieces.reduce((a, p) => a + Math.max(p.length, 1), 0)
    let cum = 0
    for (const p of pieces) {
      let start = seg.start + (cum / totalLen) * span
      cum += Math.max(p.length, 1)
      let end = seg.start + (cum / totalLen) * span
      start = Math.max(start, prevEnd)
      end = Math.min(Math.max(end, start + 0.05), totalDurationSec)
      prevEnd = end
      cues.push({ index: idx++, start, end, text: p, runs: applyHighlights(p, keywords) })
    }
  }
  return cues
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
  mode: 'script' | 'asr'
}

/**
 * 真跑一支样片：校验输入 → 求字幕轴 → PIL 画字幕 → ffmpeg 拼 → 落本地 MP4。无 DB / 无上传。
 * mode='script'：字幕取自稿子，按字数确定性均摊（无 provider）。
 * mode='asr'：字幕取自**听写真实口播**、按真实时间戳上（复用 lecture Whisper 配方，需 apiKey）。
 */
export async function renderWalkTalkProof(opts: {
  rawPath: string
  scriptPath: string
  outPath: string
  pythonBin: string // 隔离 venv 的 python（内含 Pillow）；不动系统 python
  fontPath?: string
  readScript: (p: string) => Promise<string>
  mode?: 'script' | 'asr'
  apiKey?: string
  maxCharsPerCue?: number
  cleanFiller?: boolean // asr 模式：去语气水词/口头禅（默认关）
}): Promise<RenderProofResult> {
  const mode = opts.mode ?? 'script'
  const font = opts.fontPath || process.env.FACTORY_CJK_FONT || '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
  await assertInputReadable(opts.rawPath, '原片')
  await assertInputReadable(opts.scriptPath, '口播稿')
  await assertInputReadable(opts.pythonBin, 'venv python')

  const raw = await opts.readScript(opts.scriptPath)
  const durationSec = await ffprobeDuration(opts.rawPath)

  const dir = await mkdtemp(join(tmpdir(), 'walktalk-'))
  try {
    let cues: CaptionCue[]
    if (mode === 'asr') {
      if (!opts.apiKey) throw new Error('ASR 模式需 apiKey（OPENAI_API_KEY）')
      const audio = join(dir, 'audio.mp3')
      await extractAudioForAsr(opts.rawPath, audio)
      const segments = await transcribeAudio(audio, opts.apiKey)
      cues = segmentsToCaptionCues(segments, durationSec, opts.maxCharsPerCue ?? 14, extractHighlightTerms(raw), opts.cleanFiller ?? false)
    } else {
      cues = buildCaptionCues(parseScriptLines(raw), durationSec)
    }
    validateCaptionCues(cues, durationSec)

    const pyFile = join(dir, 'caps.py')
    await writeFile(pyFile, CAPTION_PY)
    const cuesArg = JSON.stringify(cues.map((c) => c.runs.map((r) => [r.t, r.hi])))
    await exec(opts.pythonBin, [
      pyFile, font, dir, cuesArg,
      String(FONT_SIZE), String(STROKE), String(CAPTION_TOP), String(SIDE_MARGIN),
    ])
    const capPngPaths = cues.map((_, i) => join(dir, `cap${i}.png`))
    const args = buildProofFfmpegArgs({ rawPath: opts.rawPath, capPngPaths, cues, outPath: opts.outPath })
    await exec('ffmpeg', args, { maxBuffer: 1 << 26 })
    return { outPath: opts.outPath, durationSec, cueCount: cues.length, mode }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
