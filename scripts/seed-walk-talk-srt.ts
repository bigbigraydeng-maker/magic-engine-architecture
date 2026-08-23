/**
 * #1162 一次性 seed：把一支既有 walk-talk 原片听写成**首份可编辑 SRT**（真实时间戳）。
 * 仅此一步允许 provider —— 恰好一次 OpenAI whisper-1 调用（Ray 授权，上限 US$0.02）。
 * 失败即退出，**不自动重试**（预算铁律）。产出 SRT 后，所有 edit/import/re-render 走 render-walk-talk-from-srt.ts，零 provider。
 *
 * 两道 fail-closed 守卫（PATCH1，实现在 walk-talk-seed.ts，付费/落文件前生效）：
 *   ① 预算前置：先测时长→估算 whisper 成本，超 US$0.02 上限即在抽音频/调 provider 前抛（报时长+估算）。
 *   ② 绝不覆盖：目标 SRT 已存在即拒；最终写用 'wx' 独占创建，竞态下不盖 Ray 已手改的版本。
 *
 * 不出片、不上传、不写库；只落一个本地 .srt 文件供 Ray 手改（含把 `Claude` 改成 `Strategy Engine`）。
 *
 * Usage：
 *   OPENAI_API_KEY=sk-... npx tsx scripts/seed-walk-talk-srt.ts <rawMp4> <scriptTxt> <outSrt>
 *   <outSrt> 必须是**尚不存在**的新路径。可选 WALKTALK_MAXCHARS（默认 14）、WALKTALK_CLEAN=0 关闭语气水词清洗（默认清洗）。
 */

import { readFile, mkdtemp, rm, access } from 'node:fs/promises'
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
import { seedWalkTalkSrt, reserveOutputFile, type SeedDeps } from '../src/lib/factory/walk-talk-seed'

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
  const maxChars = Number(process.env.WALKTALK_MAXCHARS ?? 14)
  const clean = process.env.WALKTALK_CLEAN !== '0'
  const keywords = extractHighlightTerms(rawScript)

  let tmpDir: string | undefined
  const deps: SeedDeps = {
    // 原子预留：open 'wx' 独占创建目标（EEXIST 前置拒），失败清理按 inode 归属，绝不误删被替换的人工 SRT。
    reserveOutput: reserveOutputFile,
    probeDuration: ffprobeDuration,
    extractAudio: extractAudioForAsr,
    transcribe: transcribeAudio,
    buildCues: (segments, durationSec) => {
      const cues = segmentsToCaptionCues(segments, durationSec, maxChars, keywords, clean)
      validateCaptionCues(cues, durationSec)
      return cues
    },
    serialize: cuesToSrt,
    makeAudioPath: async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'walktalk-seed-'))
      return join(tmpDir, 'audio.mp3')
    },
    cleanup: async () => {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    },
  }

  let res
  try {
    res = await seedWalkTalkSrt({ rawPath, outSrtPath: outSrt, apiKey, deps })
  } catch (e) {
    // 失败清理只关句柄、不删路径（避免误删被替换的人工 SRT）——可能残留一个空占位，需人工处理。
    if (await pathExists(outSrt)) {
      // eslint-disable-next-line no-console
      console.error(
        `⚠️ 输出路径可能残留一个未完成的占位文件，需人工检查/删除后再重跑：${outSrt}\n` +
          `   （本工具不自动删除，以免误删被其他进程替换写入的人工 SRT。）`,
      )
    }
    throw e
  }
  const hasClaude = /claude/i.test(res.srt)
  // eslint-disable-next-line no-console
  console.log(
    `✅ seed SRT 写出：${outSrt}\n` +
      `   字幕 ${res.cues.length} 条 · provider 调用 ${res.providerCalls} 次（whisper-1）· 估算成本 $${res.estimatedCostUsd.toFixed(4)}\n` +
      `   下一步：请 Ray 手改文字${hasClaude ? '（⚠️ 检测到 `Claude`，须改为 `Strategy Engine`）' : ''}，再跑 render-walk-talk-from-srt.ts 重出（零 provider）`,
  )
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
