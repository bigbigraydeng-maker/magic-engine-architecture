/**
 * #1159 · CTS Golden China 12-day · Facebook 获客 Reel · 本地出片
 *
 * 用途：把 `docs/clients/cts/2026-11-golden-china-reel-01/` 下的
 *       - script.txt（一行一格字幕；空行分隔；`**...**` 高亮）
 *       - stills/{01..04}-*.jpg（真实照片，Pexels License）
 *       - （可选）bgm 路径参数
 *   → 一支 1080×1920 H.264 + AAC MP4，≤15s。
 *
 * 零 provider · 零 DB · 零上传 · 零联网（除非 --bgm 参数指向网络挂载）。
 *
 * 前置一次性：
 *   python3 -m venv /tmp/walktalk-venv && /tmp/walktalk-venv/bin/pip install pillow
 *
 * 用法：
 *   WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
 *     npx tsx scripts/render-cts-golden-china-reel.ts \
 *       docs/clients/cts/2026-11-golden-china-reel-01/script.txt \
 *       docs/clients/cts/2026-11-golden-china-reel-01/stills \
 *       /tmp/cts-golden-china-reel-01.mp4 \
 *       [--bgm /path/to/track.mp3] [--per-shot 3.75]
 *
 * 默认每格 3.75s（4 格 = 15s）。--per-shot 可微调。
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { renderStillsSlideshowReel, REEL_HARD_CAP_SEC, type ShotSpec } from '../src/lib/factory/stills-slideshow-reel'

function parseArgs(argv: string[]): {
  scriptPath: string
  stillsDir: string
  outPath: string
  bgmPath?: string
  perShotSec: number
} {
  const positional: string[] = []
  let bgmPath: string | undefined
  let perShotSec = 3.75
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--bgm') {
      bgmPath = argv[++i]
    } else if (a === '--per-shot') {
      perShotSec = Number(argv[++i])
      if (!Number.isFinite(perShotSec) || perShotSec <= 0) throw new Error(`--per-shot 非法：${argv[i]}`)
    } else {
      positional.push(a)
    }
  }
  const [scriptPath, stillsDir, outPath] = positional
  if (!scriptPath || !stillsDir || !outPath) {
    throw new Error('用法：render-cts-golden-china-reel.ts <scriptTxt> <stillsDir> <outMp4> [--bgm <path>] [--per-shot <sec>]')
  }
  return { scriptPath, stillsDir, outPath, bgmPath, perShotSec }
}

/** 读 script.txt：把连续非空段（段间空行分隔）压平为一条一行；顺序 = 一格一行。 */
export function readShotLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

async function listStills(dir: string): Promise<string[]> {
  const files = (await readdir(dir))
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort() // 按文件名字典序（01-, 02-, 03-, 04-...）
    .map((f) => resolve(dir, f))
  if (files.length === 0) throw new Error(`stills 目录里没有可用图片：${dir}`)
  return files
}

async function main(): Promise<void> {
  const { scriptPath, stillsDir, outPath, bgmPath, perShotSec } = parseArgs(process.argv.slice(2))
  const pythonBin = process.env.WALKTALK_PYTHON
  if (!pythonBin) throw new Error('缺 WALKTALK_PYTHON（隔离 venv 的 python，内含 Pillow）')

  const raw = await readFile(scriptPath, 'utf8')
  const captions = readShotLines(raw)
  const stills = await listStills(stillsDir)

  // 字幕行数与图片数量必须相等；不等 fail-closed，别悄悄用错的图配对错的字。
  if (captions.length !== stills.length) {
    throw new Error(
      `字幕格数 (${captions.length}) ≠ 图片数 (${stills.length})。` +
      `请让 script.txt 每一非空行对应一张 stills 里的图（当前 stills：${stills.map((s) => s.split('/').pop()).join(', ')})`,
    )
  }

  const shots: ShotSpec[] = stills.map((imagePath, i) => ({
    imagePath,
    durationSec: perShotSec,
    caption: captions[i],
  }))
  const total = shots.reduce((a, s) => a + s.durationSec, 0)
  if (total > REEL_HARD_CAP_SEC) {
    throw new Error(
      `总时长 ${total.toFixed(2)}s 超过硬顶 ${REEL_HARD_CAP_SEC}s；调小 --per-shot（当前 ${perShotSec}s）或减 shots。`,
    )
  }

  const res = await renderStillsSlideshowReel({
    shots, outPath, pythonBin, bgmPath,
  })

  // eslint-disable-next-line no-console
  console.log(
    `✅ 出片：${res.outPath}\n` +
    `   总时长 ${res.totalDurationSec.toFixed(2)}s · ${res.shotCount} 格 · ${res.cueCount} 条字幕 · BGM=${res.bgmMode}\n` +
    `   下一步：本地播放器打开审看，或 SendUserFile 发给 Ray。`,
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌', err instanceof Error ? err.message : err)
  process.exit(1)
})
