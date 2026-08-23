/**
 * #1155 边走边拍一支样片证明 —— 本地跑，产出一支竖屏 H.264 MP4，供 Ray 视觉审。
 * 不碰 Supabase / 数据库 / 上传 / provider；字幕时间按字数确定性均摊（无 ASR）。
 *
 * 先建隔离 venv 装 Pillow（不动系统 python）：
 *   python3 -m venv /tmp/walktalk-venv && /tmp/walktalk-venv/bin/pip install pillow
 *
 * Usage（script 模式，无 provider）：
 *   WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
 *   npx tsx scripts/render-walk-talk-proof.ts <rawMp4> <scriptTxt> <outMp4>
 *
 * Usage（asr 模式，听写真实口播 + 真实时间戳，需 OPENAI_API_KEY）：
 *   WALKTALK_MODE=asr OPENAI_API_KEY=sk-... WALKTALK_PYTHON=... \
 *   npx tsx scripts/render-walk-talk-proof.ts <rawMp4> <scriptTxt> <outMp4>
 */

import { readFile } from 'node:fs/promises'
import { renderWalkTalkProof } from '../src/lib/factory/walk-talk-proof'

async function main(): Promise<void> {
  const [rawPath, scriptPath, outPath] = process.argv.slice(2)
  const pythonBin = process.env.WALKTALK_PYTHON
  const mode = process.env.WALKTALK_MODE === 'asr' ? 'asr' : 'script'
  if (!rawPath || !scriptPath || !outPath) {
    throw new Error('用法：render-walk-talk-proof.ts <rawMp4> <scriptTxt> <outMp4>')
  }
  if (!pythonBin) throw new Error('缺 WALKTALK_PYTHON（隔离 venv 的 python，内含 Pillow）')

  const res = await renderWalkTalkProof({
    rawPath,
    scriptPath,
    outPath,
    pythonBin,
    mode,
    apiKey: process.env.OPENAI_API_KEY,
    readScript: (p) => readFile(p, 'utf8'),
  })
  // eslint-disable-next-line no-console
  console.log(`✅ 出片[${res.mode}]：${res.outPath}\n   时长 ${res.durationSec.toFixed(1)}s · 字幕 ${res.cueCount} 条`)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
