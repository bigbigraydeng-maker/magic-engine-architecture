/**
 * #1162 确定性本地重出：把 Ray 手改后的 SRT + 既有原片 → 一支竖屏 H.264 MP4。
 * **零 provider**：只解析 SRT + 复用 renderCuesToVideo（PIL 字幕 + ffmpeg overlay），绝不听写、不联网、不写库。
 * 同一份 SRT + 同一支原片 → 同一支片（确定性），可反复重出直到 Ray 视觉验收。
 *
 * 先建隔离 venv 装 Pillow（不动系统 python）：
 *   python3 -m venv /tmp/walktalk-venv && /tmp/walktalk-venv/bin/pip install pillow
 *
 * Usage：
 *   WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
 *   npx tsx scripts/render-walk-talk-from-srt.ts <rawMp4> <editedSrt> <outMp4>
 */

import { readFile } from 'node:fs/promises'
import {
  assertInputReadable,
  ffprobeDuration,
  renderCuesToVideo,
  assertOutputPathDistinct,
} from '../src/lib/factory/walk-talk-proof'
import { srtToCues } from '../src/lib/factory/caption-srt'

async function main(): Promise<void> {
  const [rawPath, srtPath, outPath] = process.argv.slice(2)
  const pythonBin = process.env.WALKTALK_PYTHON
  if (!rawPath || !srtPath || !outPath) {
    throw new Error('用法：render-walk-talk-from-srt.ts <rawMp4> <editedSrt> <outMp4>')
  }
  if (!pythonBin) throw new Error('缺 WALKTALK_PYTHON（隔离 venv 的 python，内含 Pillow）')

  await assertInputReadable(rawPath, '原片')
  await assertInputReadable(srtPath, 'SRT 字幕')
  await assertInputReadable(pythonBin, 'venv python')
  // 输出别名闸：ffmpeg -y 会覆盖输出，绝不能让输出 MP4 指向原片或编辑后的 SRT（否则销毁源）。
  await assertOutputPathDistinct(outPath, [rawPath, srtPath])

  const srt = await readFile(srtPath, 'utf8')
  const cues = srtToCues(srt) // fail-closed：SRT 坏了不出片
  const durationSec = await ffprobeDuration(rawPath)

  await renderCuesToVideo({ rawPath, cues, durationSec, outPath, pythonBin })
  // eslint-disable-next-line no-console
  console.log(`✅ 重出[import·零 provider]：${outPath}\n   时长 ${durationSec.toFixed(1)}s · 字幕 ${cues.length} 条`)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
