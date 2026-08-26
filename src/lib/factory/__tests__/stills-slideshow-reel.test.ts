// #1159 · stills-slideshow-reel 单测：纯逻辑（validateShots / shotsToCues / buildKenburnsChain / buildStillsSlideshowFfmpegArgs）。
// 真跑 ffmpeg / Pillow 不进单测，出片在 scripts/render-cts-golden-china-reel.ts CLI。

import { describe, it, expect } from 'vitest'
import {
  validateShots,
  shotsToCues,
  buildKenburnsChain,
  buildStillsSlideshowFfmpegArgs,
  REEL_HARD_CAP_SEC,
  SHOT_MIN_SEC,
  FPS,
  type ShotSpec,
} from '../stills-slideshow-reel'

const s = (i: number, dur = 3.75, cap = ''): ShotSpec => ({
  imagePath: `/tmp/img${i}.jpg`,
  durationSec: dur,
  caption: cap,
})

describe('validateShots — 硬约束（Ray FB 实测 <15s）', () => {
  it('空 shots 直接拒', () => {
    expect(() => validateShots([])).toThrow(/shots 不能为空/)
  })

  it('总时长超 15s 硬顶拒', () => {
    const shots = [s(0, 4), s(1, 4), s(2, 4), s(3, 4)] // 16s
    expect(() => validateShots(shots)).toThrow(/超过硬顶 15s/)
  })

  it('恰好 15s 放行', () => {
    const shots = [s(0, 3.75), s(1, 3.75), s(2, 3.75), s(3, 3.75)]
    expect(() => validateShots(shots)).not.toThrow()
  })

  it('单格短于 SHOT_MIN_SEC 拒（防闪帧）', () => {
    const shots = [s(0, SHOT_MIN_SEC - 0.5)]
    expect(() => validateShots(shots)).toThrow(/durationSec 非法或过短/)
  })

  it('shots 太多（>8）拒', () => {
    const shots = Array.from({ length: 9 }, (_, i) => s(i, SHOT_MIN_SEC))
    // 也可能先撞 15s 硬顶；两条 guard 之一命中都算 fail-closed
    expect(() => validateShots(shots)).toThrow(/(shots 太多|超过硬顶)/)
  })

  it('imagePath / caption 类型不对拒', () => {
    expect(() => validateShots([{ imagePath: '', durationSec: 3, caption: '' } as ShotSpec])).toThrow(/imagePath 缺失/)
    // caption undefined
    expect(() => validateShots([{ imagePath: '/a', durationSec: 3 } as unknown as ShotSpec])).toThrow(/caption 必须为字符串/)
  })
})

describe('shotsToCues — 字幕轴严格递增，空 caption 不产 cue', () => {
  it('4 格全带字 → 4 cue，时间窗按 durationSec 累加', () => {
    const shots = [s(0, 3.75, 'A'), s(1, 3.75, 'B'), s(2, 3.75, 'C'), s(3, 3.75, 'D')]
    const cues = shotsToCues(shots)
    expect(cues.length).toBe(4)
    expect(cues[0].start).toBe(0)
    expect(cues[0].end).toBeCloseTo(3.75)
    expect(cues[1].start).toBeCloseTo(3.75)
    expect(cues[3].end).toBeCloseTo(15)
    // 严格递增
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i].end).toBeGreaterThan(cues[i].start)
      if (i > 0) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end)
    }
    // index 从 0 单调
    expect(cues.map((c) => c.index)).toEqual([0, 1, 2, 3])
  })

  it('空 caption 的格不产 cue，但仍占它的时间窗（后续 cue 起点向后推）', () => {
    const shots = [s(0, 3, 'A'), s(1, 3, ''), s(2, 3, 'C')]
    const cues = shotsToCues(shots)
    expect(cues.length).toBe(2)
    expect(cues[0].text).toBe('A')
    expect(cues[1].text).toBe('C')
    expect(cues[1].start).toBeCloseTo(6) // 前两格共 6s
  })

  it('caption 里的 `**双星号**` 高亮标记传到 runs，text 是去标记版', () => {
    const shots = [s(0, 3, 'Zero visa for **NZ passports**')]
    const cues = shotsToCues(shots)
    expect(cues.length).toBe(1)
    expect(cues[0].text).toBe('Zero visa for NZ passports')
    const hi = cues[0].runs.find((r) => r.hi)
    expect(hi?.t).toBe('NZ passports')
  })
})

describe('buildKenburnsChain — d 参数 = frames = duration*FPS', () => {
  it('3.75s @ 30fps → d=113 (round)', () => {
    const chain = buildKenburnsChain(0, 3.75, 'k0')
    expect(chain).toContain(`d=${Math.round(3.75 * FPS)}`)
    expect(chain).toContain(`s=1080x1920`)
    expect(chain).toContain(`fps=${FPS}`)
    expect(chain).toContain('trim=duration=3.750')
    expect(chain).toMatch(/\[k0\]$/)
  })

  it('极短 duration 也至少 1 帧（fail-closed）', () => {
    const chain = buildKenburnsChain(2, 0.001, 'kX')
    expect(chain).toContain('d=1')
  })
})

describe('buildStillsSlideshowFfmpegArgs — 输入顺序 / filter 图 / 音轨模式', () => {
  const shots = [s(0, 4, 'Hook'), s(1, 4, 'Beat'), s(2, 4, 'CTA')]

  it('无 BGM 时用 aevalsrc 合成 ambient bed，音量默认 0.05', () => {
    const cues = shotsToCues(shots)
    const args = buildStillsSlideshowFfmpegArgs({
      shots, capPngPaths: ['/tmp/c0.png', '/tmp/c1.png', '/tmp/c2.png'], cues,
      outPath: '/tmp/out.mp4',
    })
    // 输入：3 张图（-loop 1 -t ... -i）+ 3 张字幕 PNG（-i）+ 1 lavfi bed（-f lavfi -t ... -i aevalsrc=...）
    const iOccurrences = args.filter((a) => a === '-i').length
    expect(iOccurrences).toBe(7)
    expect(args).toContain('-f')
    expect(args).toContain('lavfi')
    expect(args.some((a) => a.startsWith('aevalsrc='))).toBe(true)
    // 音量：合成 bed 默认 0.05
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toMatch(/volume=0\.05/)
    // shortest：避免 loop 图无限拉长
    expect(args).toContain('-shortest')
    // 输出容器
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
    // 编码
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
  })

  it('有 BGM 时用文件输入，默认音量 0.5', () => {
    const cues = shotsToCues(shots)
    const args = buildStillsSlideshowFfmpegArgs({
      shots, capPngPaths: ['/tmp/c0.png', '/tmp/c1.png', '/tmp/c2.png'], cues,
      outPath: '/tmp/out.mp4',
      bgmPath: '/tmp/bgm.mp3',
    })
    // 找到 bgm 输入
    expect(args).toContain('/tmp/bgm.mp3')
    // 未使用 lavfi
    expect(args).not.toContain('lavfi')
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toMatch(/volume=0\.5/)
  })

  it('filter 图：3 格 → 3 ken-burns → concat=n=3 → 3 次 overlay + 音轨 afade', () => {
    const cues = shotsToCues(shots)
    const args = buildStillsSlideshowFfmpegArgs({
      shots, capPngPaths: ['/tmp/c0.png', '/tmp/c1.png', '/tmp/c2.png'], cues,
      outPath: '/tmp/out.mp4',
    })
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[k0]')
    expect(fc).toContain('[k1]')
    expect(fc).toContain('[k2]')
    expect(fc).toContain('concat=n=3:v=1:a=0[base]')
    // 3 次 overlay
    expect(fc.match(/overlay=0:0:enable=/g)?.length).toBe(3)
    // 音轨 afade in + out
    expect(fc).toContain('afade=t=in')
    expect(fc).toContain('afade=t=out')
    // 输出映射
    expect(args).toContain('[aout]')
  })

  it('字幕 PNG 数量与 cue 不匹配 fail-closed', () => {
    const cues = shotsToCues(shots)
    expect(() => buildStillsSlideshowFfmpegArgs({
      shots, capPngPaths: ['/tmp/c0.png'], cues, // 只给 1 张，cue 有 3 条
      outPath: '/tmp/out.mp4',
    })).toThrow(/字幕图与轴数量不符/)
  })

  it('无字幕的场景（cues=[]，capPngPaths=[]）也能出片（纯图 + 音）', () => {
    const shotsNoCap = [s(0, 5, ''), s(1, 5, ''), s(2, 5, '')]
    const cues = shotsToCues(shotsNoCap)
    expect(cues.length).toBe(0)
    const args = buildStillsSlideshowFfmpegArgs({
      shots: shotsNoCap, capPngPaths: [], cues, outPath: '/tmp/out.mp4',
    })
    const fc = args[args.indexOf('-filter_complex') + 1]
    // 无 overlay
    expect(fc.match(/overlay=/g)).toBeNull()
    // 输出映射直接用 [base]
    const mapIdx = args.indexOf('-map')
    expect(args[mapIdx + 1]).toBe('[base]')
  })
})

describe('REEL_HARD_CAP_SEC 与业务事实同步', () => {
  it('等于 15（Ray 2026-08-27 FB 实测口径）', () => {
    expect(REEL_HARD_CAP_SEC).toBe(15)
  })
})

// ─── 视频剪辑（v2 iteration，viral-上片后新加 kind='clip' 路径）───────────────

describe('kind="clip" — 真视频剪辑本格链', () => {
  it('validateShots 接受 clip / 拒非法 kind', () => {
    expect(() => validateShots([{ kind: 'clip', imagePath: '/tmp/v.mp4', durationSec: 3, caption: '' }])).not.toThrow()
    expect(() => validateShots([{ kind: 'x' as unknown as 'clip', imagePath: '/tmp/v.mp4', durationSec: 3, caption: '' }])).toThrow(/kind 非法/)
  })

  it('validateShots 拒 clipStartSec 负数', () => {
    expect(() => validateShots([{ kind: 'clip', imagePath: '/tmp/v.mp4', durationSec: 3, caption: '', clipStartSec: -1 }])).toThrow(/clipStartSec 非法/)
  })

  it('mixed still + clip 顺序稳定，ffmpeg 输入组织符合预期', () => {
    const shots: ShotSpec[] = [
      { kind: 'still', imagePath: '/tmp/a.jpg', durationSec: 2, caption: 'A' },
      { kind: 'clip', imagePath: '/tmp/b.mp4', durationSec: 3, caption: 'B', clipStartSec: 2 },
      { kind: 'still', imagePath: '/tmp/c.jpg', durationSec: 2, caption: 'C' },
    ]
    const cues = shotsToCues(shots)
    const args = buildStillsSlideshowFfmpegArgs({
      shots, capPngPaths: ['/tmp/c0.png', '/tmp/c1.png', '/tmp/c2.png'], cues, outPath: '/tmp/out.mp4',
    })
    // still 用 -loop 1 -t d -i；clip 只有 -i
    const argsStr = args.join(' ')
    expect(argsStr).toContain('-loop 1 -t 2.000 -i /tmp/a.jpg')
    expect(argsStr).toContain('-loop 1 -t 2.000 -i /tmp/c.jpg')
    // clip 不能带 -loop 1
    expect(argsStr).toMatch(/-i \/tmp\/b\.mp4/)
    expect(argsStr).not.toMatch(/-loop 1 -t 3\.000 -i \/tmp\/b\.mp4/)
    // filter_complex 里第二格用 clip 链（含 trim start），其余用 ken-burns（含 zoompan）
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toMatch(/\[0:v\]scale=2160:3840/)          // still #0 → ken-burns
    expect(fc).toMatch(/\[1:v\]trim=start=2\.000/)         // clip #1 → trim 从 2s 起
    expect(fc).toMatch(/\[2:v\]scale=2160:3840/)          // still #2 → ken-burns
    expect(fc).toContain('concat=n=3:v=1:a=0[base]')
  })
})
