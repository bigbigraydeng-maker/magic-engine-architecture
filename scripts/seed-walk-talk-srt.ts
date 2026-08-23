/**
 * #1162 一次性 seed：把一支既有 walk-talk 原片听写成**首份可编辑 SRT**（真实时间戳）。
 * 仅此一步允许 provider —— 恰好一次 OpenAI whisper-1 调用（Ray 授权，上限 US$0.02）。
 * 失败即退出，**不自动重试**（预算铁律）。产出 SRT 后，所有 edit/import/re-render 走 render-walk-talk-from-srt.ts，零 provider。
 *
 * 不出片、不上传、不写库；只落一个本地 .srt 文件供 Ray 手改（含把 `Claude` 改成 `Strategy Engine`）。
 *
 * Usage：
 *   OPENAI_API_KEY=sk-... npx tsx scripts/seed-walk-talk-srt.ts <rawMp4> <scriptTxt> <outSrt>
 *   可选 WALKTALK_MAXCHARS（默认 14）、WALKTALK_CLEAN=0 关闭语气水词清洗（默认清洗）。
 */

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertInputReadable,
  ffprobeDuration,
  extractAudioForAsr,
  transcribeAudio,
  segmentsToCaptionCues,
  validateCaptionCues,
  extractHighlightTerms,
} from '../src/lib/factory/walk-talk-proof'
import { cuesToSrt } from '../src/lib/factory/caption-srt'

async function main(): Promise<void> {
  const [rawPath, scriptPath, outSrt] = process.argv.slice(2)
  const apiKey = process.env.OPENAI_API_KEY
  if (!rawPath || !scriptPath || !outSrt) {
    throw new Error('用法：seed-walk-talk-srt.ts <rawMp4> <scriptTxt> <outSrt>')
  }
  if (!apiKey) throw new Error('缺 OPENAI_API_KEY（一次性 whisper-1 seed 需要）')

  await assertInputReadable(rawPath, '原片')
  await assertInputReadable(scriptPath, '口播稿')

  const rawScript = await readFile(scriptPath, 'utf8')
  const durationSec = await ffprobeDuration(rawPath)
  const maxChars = Number(process.env.WALKTALK_MAXCHARS ?? 14)
  const clean = process.env.WALKTALK_CLEAN !== '0'

  const dir = await mkdtemp(join(tmpdir(), 'walktalk-seed-'))
  let providerCalls = 0
  try {
    const audio = join(dir, 'audio.mp3')
    await extractAudioForAsr(rawPath, audio)
    // —— 唯一 provider 调用（恰好一次；失败不重试）——
    providerCalls++
    const segments = await transcribeAudio(audio, apiKey)
    const cues = segmentsToCaptionCues(segments, durationSec, maxChars, extractHighlightTerms(rawScript), clean)
    validateCaptionCues(cues, durationSec)
    const srt = cuesToSrt(cues)
    await writeFile(outSrt, srt, 'utf8')

    const hasClaude = /claude/i.test(srt)
    // eslint-disable-next-line no-console
    console.log(
      `✅ seed SRT 写出：${outSrt}\n` +
        `   时长 ${durationSec.toFixed(1)}s · 字幕 ${cues.length} 条 · provider 调用 ${providerCalls} 次（whisper-1）\n` +
        `   下一步：请 Ray 手改文字${hasClaude ? '（⚠️ 检测到 `Claude`，须改为 `Strategy Engine`）' : ''}，再跑 render-walk-talk-from-srt.ts 重出（零 provider）`,
    )
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
