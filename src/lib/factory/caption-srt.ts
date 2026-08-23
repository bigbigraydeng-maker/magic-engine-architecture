// #1162 可编辑字幕：既有 CaptionCue 时间轴 ↔ 一份 Ray 可手改的 SRT。
// 目的：让 Ray 在本地对 walk-talk 草稿做**强制人工校正**——
//   既有 cues → 导出 SRT → Ray 改文字（含把 `Claude` 改成 `Strategy Engine`）→ 导回 cues → 确定性重出。
// 复用 #1155 已 merged 的 CaptionCue 契约与高亮标记（`**...**`），不发明新格式、不造通用字幕编辑器。
//   · 高亮保真：runs 里的高亮段导出时写回 `**...**`，导入时用既有 parseRuns 还原，round-trip 不丢高亮。
//   · 纯逻辑、零 provider、零联网：seed（一次听写）之后所有 edit/import/re-render 都不碰 provider。
//   · fail-closed：时间戳格式非法 / 缺 `-->` / end<=start / 无可用块 一律抛，绝不静默产出坏轴。

import { parseRuns, stripMarks, type CaptionCue } from './walk-talk-proof'

/** 秒 → SRT 时间戳 `HH:MM:SS,mmm`（毫秒三位，四舍五入到毫秒）。 */
export function formatSrtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) throw new Error(`SRT 时间非法：${sec}`)
  const totalMs = Math.round(sec * 1000)
  const ms = totalMs % 1000
  const totalSec = (totalMs - ms) / 1000
  const s = totalSec % 60
  const totalMin = (totalSec - s) / 60
  const m = totalMin % 60
  const h = (totalMin - m) / 60
  const p2 = (n: number) => String(n).padStart(2, '0')
  const p3 = (n: number) => String(n).padStart(3, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${p3(ms)}`
}

/** SRT 时间戳 `HH:MM:SS,mmm` → 秒。格式不符（含逗号误用点、位数不对、分/秒越界）即抛（fail-closed）。 */
export function parseSrtTime(str: string): number {
  const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(str.trim())
  if (!m) throw new Error(`SRT 时间戳格式非法（应为 HH:MM:SS,mmm）：${str}`)
  const h = Number(m[1])
  const min = Number(m[2])
  const s = Number(m[3])
  const ms = Number(m[4])
  if (min > 59 || s > 59) throw new Error(`SRT 时间戳分/秒越界：${str}`)
  return h * 3600 + min * 60 + s + ms / 1000
}

/** 单条 cue 的可编辑文本行：把 runs 还原成带 `**高亮**` 标记的一行（Ray 就改这一行）。 */
export function cueToEditableText(cue: CaptionCue): string {
  return cue.runs.map((r) => (r.hi ? `**${r.t}**` : r.t)).join('')
}

/** CaptionCue[] → SRT 文本。块号 1-based（SRT 惯例），文本行保留 `**高亮**` 标记供 Ray 编辑。 */
export function cuesToSrt(cues: CaptionCue[]): string {
  if (cues.length === 0) throw new Error('导出 SRT 失败：字幕轴为空')
  const blocks = cues.map((c, i) => {
    if (!(c.end > c.start)) throw new Error(`导出 SRT 失败：字幕 #${c.index} 时长非正 ${c.start}→${c.end}`)
    return `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${cueToEditableText(c)}`
  })
  return blocks.join('\n\n') + '\n'
}

/**
 * SRT 文本 → CaptionCue[]。每块：可选块号行 + `start --> end` 时间行 + 一或多文本行。
 * · index 重编为 0-based（对齐 CaptionCue.index 约定）；
 * · 文本用既有 parseRuns 还原高亮 runs、stripMarks 得纯文本；多文本行以空格合并成单行大字；
 * · fail-closed：无可用块 / 时间行缺 `-->` / 时间戳非法 / end<=start / 文本为空 一律抛。
 * 跨块单调/越界不在此层判——交给渲染前的 validateCaptionCues（避免与其重复且口径不一）。
 */
export function srtToCues(srt: string): CaptionCue[] {
  const blocks = srt
    .replace(/\r\n/g, '\n')
    .replace(/^﻿/, '')
    .trim()
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
  if (blocks.length === 0) throw new Error('导入 SRT 失败：没有可用字幕块')

  const cues: CaptionCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd())
    // 首行若是纯数字块号则丢弃（SRT 惯例）；否则整块从时间行起。
    let cursor = 0
    if (/^\d+$/.test(lines[0].trim())) cursor = 1
    const timeLine = lines[cursor]
    if (!timeLine || !timeLine.includes('-->')) {
      throw new Error(`导入 SRT 失败：缺时间行（应含 -->）：${block.replace(/\n/g, '⏎')}`)
    }
    const [rawStart, rawEnd] = timeLine.split('-->')
    if (rawStart === undefined || rawEnd === undefined) {
      throw new Error(`导入 SRT 失败：时间行格式非法：${timeLine}`)
    }
    const start = parseSrtTime(rawStart)
    const end = parseSrtTime(rawEnd)
    if (!(end > start)) throw new Error(`导入 SRT 失败：end 必须大于 start（${timeLine}）`)

    const textLine = lines
      .slice(cursor + 1)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!textLine) throw new Error(`导入 SRT 失败：字幕文本为空（时间 ${timeLine}）`)

    cues.push({
      index: cues.length,
      start,
      end,
      text: stripMarks(textLine),
      runs: parseRuns(textLine),
    })
  }
  return cues
}
