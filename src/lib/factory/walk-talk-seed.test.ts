import { describe, it, expect, vi } from 'vitest'
import {
  estimateWhisperCostUsd,
  assertWithinSeedBudget,
  seedWalkTalkSrt,
  SEED_CAP_USD,
  WHISPER_USD_PER_MIN,
  type SeedDeps,
} from './walk-talk-seed'
import type { CaptionCue, WhisperSegment } from './walk-talk-proof'

const fakeCue = (): CaptionCue => ({ index: 0, start: 0, end: 1, text: 'x', runs: [{ t: 'x', hi: false }] })

/** 造一套可监视的 deps；默认 destExists=false、时长可配、听写返回一条分段。 */
function makeDeps(over?: Partial<SeedDeps> & { duration?: number }): SeedDeps & {
  spies: Record<string, ReturnType<typeof vi.fn>>
} {
  const spies = {
    probeDuration: vi.fn(async () => over?.duration ?? 60),
    extractAudio: vi.fn(async () => {}),
    transcribe: vi.fn(async (): Promise<WhisperSegment[]> => [{ start: 0, end: 1, text: '你好' }]),
    buildCues: vi.fn((): CaptionCue[] => [fakeCue()]),
    serialize: vi.fn(() => '1\n00:00:00,000 --> 00:00:01,000\nx\n'),
    destExists: vi.fn(async () => false),
    writeExclusive: vi.fn(async () => {}),
    makeAudioPath: vi.fn(async () => '/tmp/fake/audio.mp3'),
    cleanup: vi.fn(async () => {}),
  }
  return { ...spies, ...over, spies } as SeedDeps & { spies: typeof spies }
}

describe('estimateWhisperCostUsd / assertWithinSeedBudget', () => {
  it('保守估算：秒向上取整 × $0.006/min', () => {
    expect(WHISPER_USD_PER_MIN).toBe(0.006)
    expect(estimateWhisperCostUsd(60)).toBeCloseTo(0.006, 6)
    expect(estimateWhisperCostUsd(60.1)).toBeCloseTo((61 / 60) * 0.006, 6) // 向上取整
  })
  it('非法时长即抛', () => {
    expect(() => estimateWhisperCostUsd(0)).toThrow()
    expect(() => estimateWhisperCostUsd(NaN)).toThrow()
  })
  it('边界：正好 200s（=$0.02 上限）通过，200.1s 超限即抛', () => {
    expect(assertWithinSeedBudget(200)).toBeCloseTo(0.02, 6) // 200/60*0.006 = 0.02，不 > 上限
    expect(() => assertWithinSeedBudget(200.1)).toThrow(/预算闸/)
  })
  it('218.9s（实际 seed 用的源片）会被预算闸拦下', () => {
    expect(() => assertWithinSeedBudget(218.9)).toThrow(/超过授权上限/)
    // 失败信息带时长与估算，供 Ray 决策
    try {
      assertWithinSeedBudget(218.9)
    } catch (e) {
      expect((e as Error).message).toContain('218.9')
      expect((e as Error).message).toContain('$0.02')
    }
  })
  it('默认上限 = 授权的 US$0.02', () => {
    expect(SEED_CAP_USD).toBe(0.02)
  })
})

describe('seedWalkTalkSrt 守卫 1：预算前置', () => {
  it('超预算：在抽音频/听写/写文件之前 fail-closed', async () => {
    const deps = makeDeps({ duration: 300 })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'out.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/预算闸/)
    expect(deps.spies.extractAudio).not.toHaveBeenCalled()
    expect(deps.spies.transcribe).not.toHaveBeenCalled()
    expect(deps.spies.writeExclusive).not.toHaveBeenCalled()
  })
  it('边界内（180s）：恰好一次 provider 调用、无重试、正常写出', async () => {
    const deps = makeDeps({ duration: 180 })
    const res = await seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'out.srt', apiKey: 'sk', deps })
    expect(deps.spies.transcribe).toHaveBeenCalledTimes(1)
    expect(res.providerCalls).toBe(1)
    expect(deps.spies.writeExclusive).toHaveBeenCalledTimes(1)
    expect(res.estimatedCostUsd).toBeCloseTo((180 / 60) * 0.006, 6)
  })
  it('听写失败：抛且不重试（仍只一次 transcribe），不写文件', async () => {
    const deps = makeDeps({ duration: 60, transcribe: vi.fn(async () => { throw new Error('whisper 500') }) })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'out.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/whisper 500/)
    expect(deps.transcribe).toHaveBeenCalledTimes(1)
    expect(deps.spies.writeExclusive).not.toHaveBeenCalled()
  })
})

describe('seedWalkTalkSrt 守卫 2：绝不覆盖', () => {
  it('目标已存在：在抽音频/听写之前 fail-closed', async () => {
    const deps = makeDeps({ destExists: vi.fn(async () => true) })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'exists.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/覆盖闸/)
    expect(deps.spies.probeDuration).not.toHaveBeenCalled()
    expect(deps.spies.extractAudio).not.toHaveBeenCalled()
    expect(deps.spies.transcribe).not.toHaveBeenCalled()
  })
  it('独占写竞态（wx EEXIST）：抛且不吞掉，不覆盖已存在内容', async () => {
    const eexist = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
    const deps = makeDeps({ duration: 60, writeExclusive: vi.fn(async () => { throw eexist }) })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'race.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/EEXIST/)
    expect(deps.transcribe).toHaveBeenCalledTimes(1) // 已听写但写失败——不重试、不覆盖
  })
})
