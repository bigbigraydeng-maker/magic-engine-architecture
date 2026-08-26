/**
 * #1159 · CTS Golden China 12-day · Facebook 获客 Reel · 本地出片
 *
 * 两种模式：
 *
 * (a) STILLS 模式（v1；纯静图 + ken-burns）：
 *     WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
 *       npx tsx scripts/render-cts-golden-china-reel.ts \
 *         docs/clients/cts/2026-11-golden-china-reel-01/script.txt \
 *         docs/clients/cts/2026-11-golden-china-reel-01/stills \
 *         /tmp/cts-golden-china-reel-01.mp4 [--bgm <path>] [--per-shot 3.75]
 *
 * (b) MANIFEST 模式（v2 起；混编静图 + 真视频剪辑；每格 kind/path/duration/caption/clipStart 全指定）：
 *     WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
 *       npx tsx scripts/render-cts-golden-china-reel.ts \
 *         --manifest docs/clients/cts/2026-11-golden-china-reel-01/manifest.v2.json \
 *         /tmp/cts-golden-china-reel-02.mp4 [--bgm <path>]
 *
 * 零 provider · 零 DB · 零上传 · 零联网（--bgm 指本地文件时除外）。
 *
 * 前置一次性：python3 -m venv /tmp/walktalk-venv && /tmp/walktalk-venv/bin/pip install pillow
 */

import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname, isAbsolute } from 'node:path'
import { renderStillsSlideshowReel, REEL_HARD_CAP_SEC, type ShotSpec } from '../src/lib/factory/stills-slideshow-reel'

interface Args {
  mode: 'stills' | 'manifest'
  scriptPath?: string
  stillsDir?: string
  manifestPath?: string
  outPath: string
  bgmPath?: string
  perShotSec: number
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  let bgmPath: string | undefined
  let perShotSec = 3.75
  let manifestPath: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--bgm') {
      bgmPath = argv[++i]
    } else if (a === '--per-shot') {
      perShotSec = Number(argv[++i])
      if (!Number.isFinite(perShotSec) || perShotSec <= 0) throw new Error(`--per-shot 非法：${argv[i]}`)
    } else if (a === '--manifest') {
      manifestPath = argv[++i]
    } else {
      positional.push(a)
    }
  }
  if (manifestPath) {
    const [outPath] = positional
    if (!outPath) throw new Error('用法：render-cts-golden-china-reel.ts --manifest <manifest.json> <outMp4> [--bgm <path>]')
    return { mode: 'manifest', manifestPath, outPath, perShotSec, bgmPath }
  }
  const [scriptPath, stillsDir, outPath] = positional
  if (!scriptPath || !stillsDir || !outPath) {
    throw new Error('用法：render-cts-golden-china-reel.ts <scriptTxt> <stillsDir> <outMp4> [--bgm <path>] [--per-shot <sec>]')
  }
  return { mode: 'stills', scriptPath, stillsDir, outPath, perShotSec, bgmPath }
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
    .sort()
    .map((f) => resolve(dir, f))
  if (files.length === 0) throw new Error(`stills 目录里没有可用图片：${dir}`)
  return files
}

/** manifest.v2.json 契约：{ shots: [{kind, path, durationSec, caption, clipStartSec?}], bgm?: path } */
interface ManifestShot {
  kind: 'still' | 'clip'
  path: string
  durationSec: number
  caption: string
  clipStartSec?: number
}
interface Manifest {
  shots: ManifestShot[]
  bgm?: string
}

async function loadManifest(manifestPath: string): Promise<{ shots: ShotSpec[]; bgmPath?: string }> {
  const raw = await readFile(manifestPath, 'utf8')
  const m = JSON.parse(raw) as Manifest
  if (!Array.isArray(m.shots) || m.shots.length === 0) {
    throw new Error(`manifest 缺 shots[]：${manifestPath}`)
  }
  const baseDir = dirname(manifestPath)
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(baseDir, p))
  const shots: ShotSpec[] = m.shots.map((s, i) => {
    if (s.kind !== 'still' && s.kind !== 'clip') throw new Error(`shot #${i}: kind 必须为 'still' 或 'clip'`)
    if (!s.path) throw new Error(`shot #${i}: path 缺失`)
    if (!Number.isFinite(s.durationSec)) throw new Error(`shot #${i}: durationSec 缺失或非法`)
    if (typeof s.caption !== 'string') throw new Error(`shot #${i}: caption 必须为字符串`)
    return {
      kind: s.kind,
      imagePath: abs(s.path),
      durationSec: s.durationSec,
      caption: s.caption,
      ...(s.clipStartSec !== undefined ? { clipStartSec: s.clipStartSec } : {}),
    }
  })
  return { shots, bgmPath: m.bgm ? abs(m.bgm) : undefined }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const pythonBin = process.env.WALKTALK_PYTHON
  if (!pythonBin) throw new Error('缺 WALKTALK_PYTHON（隔离 venv 的 python，内含 Pillow）')

  let shots: ShotSpec[]
  let bgmPath: string | undefined = args.bgmPath

  if (args.mode === 'manifest') {
    const loaded = await loadManifest(args.manifestPath!)
    shots = loaded.shots
    if (!bgmPath && loaded.bgmPath) bgmPath = loaded.bgmPath
  } else {
    const raw = await readFile(args.scriptPath!, 'utf8')
    const captions = readShotLines(raw)
    const stills = await listStills(args.stillsDir!)
    if (captions.length !== stills.length) {
      throw new Error(
        `字幕格数 (${captions.length}) ≠ 图片数 (${stills.length})。` +
        `请让 script.txt 每一非空行对应一张 stills 里的图（当前 stills：${stills.map((s) => s.split('/').pop()).join(', ')})`,
      )
    }
    shots = stills.map((imagePath, i) => ({
      kind: 'still' as const, imagePath, durationSec: args.perShotSec, caption: captions[i],
    }))
  }

  const total = shots.reduce((a, s) => a + s.durationSec, 0)
  if (total > REEL_HARD_CAP_SEC) {
    throw new Error(`总时长 ${total.toFixed(2)}s 超过硬顶 ${REEL_HARD_CAP_SEC}s；调小 durationSec 或减 shots。`)
  }

  const res = await renderStillsSlideshowReel({
    shots, outPath: args.outPath, pythonBin, bgmPath,
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
