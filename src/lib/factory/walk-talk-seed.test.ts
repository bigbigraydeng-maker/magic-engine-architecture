import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, unlink, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  estimateWhisperCostUsd,
  assertWithinSeedBudget,
  seedWalkTalkSrt,
  reserveOutputFile,
  SEED_CAP_USD,
  WHISPER_USD_PER_MIN,
  type SeedDeps,
  type OutputReservation,
} from './walk-talk-seed'
import type { CaptionCue, WhisperSegment } from './walk-talk-proof'

const fakeCue = (): CaptionCue => ({ index: 0, start: 0, end: 1, text: 'x', runs: [{ t: 'x', hi: false }] })

/** 造一个可监视的预留句柄。 */
function makeReservation(): OutputReservation & { spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    write: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
  }
  return { ...spies, spies }
}

/** 造一套可监视的 deps；默认预留成功、时长可配、听写返回一条分段。 */
function makeDeps(over?: Partial<SeedDeps> & { duration?: number; reservation?: OutputReservation }): SeedDeps & {
  spies: Record<string, ReturnType<typeof vi.fn>>
  reservation: ReturnType<typeof makeReservation>
} {
  const reservation = (over?.reservation as ReturnType<typeof makeReservation>) ?? makeReservation()
  const spies = {
    reserveOutput: vi.fn(async () => reservation),
    probeDuration: vi.fn(async () => over?.duration ?? 60),
    extractAudio: vi.fn(async () => {}),
    transcribe: vi.fn(async (): Promise<WhisperSegment[]> => [{ start: 0, end: 1, text: '你好' }]),
    buildCues: vi.fn((): CaptionCue[] => [fakeCue()]),
    serialize: vi.fn(() => '1\n00:00:00,000 --> 00:00:01,000\nx\n'),
    makeAudioPath: vi.fn(async () => '/tmp/fake/audio.mp3'),
    cleanup: vi.fn(async () => {}),
  }
  const { reservation: _r, duration: _d, ...depsOver } = over ?? {}
  return { ...spies, ...depsOver, spies, reservation } as SeedDeps & {
    spies: typeof spies
    reservation: ReturnType<typeof makeReservation>
  }
}

describe('estimateWhisperCostUsd / assertWithinSeedBudget', () => {
  it('保守估算：秒向上取整 × $0.006/min', () => {
    expect(WHISPER_USD_PER_MIN).toBe(0.006)
    expect(estimateWhisperCostUsd(60)).toBeCloseTo(0.006, 6)
    expect(estimateWhisperCostUsd(60.1)).toBeCloseTo((61 / 60) * 0.006, 6)
  })
  it('非法时长即抛', () => {
    expect(() => estimateWhisperCostUsd(0)).toThrow()
    expect(() => estimateWhisperCostUsd(NaN)).toThrow()
  })
  it('边界：正好 200s（=$0.02 上限）通过，200.1s 超限即抛', () => {
    expect(assertWithinSeedBudget(200)).toBeCloseTo(0.02, 6)
    expect(() => assertWithinSeedBudget(200.1)).toThrow(/预算闸/)
  })
  it('218.9s（实际 seed 用的源片）会被预算闸拦下，信息带时长+上限', () => {
    expect(() => assertWithinSeedBudget(218.9)).toThrow(/超过授权上限/)
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

describe('seedWalkTalkSrt 预算前置', () => {
  it('超预算：在抽音频/听写/写文件之前 fail-closed，并 discard 本次预留', async () => {
    const deps = makeDeps({ duration: 300 })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'out.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/预算闸/)
    expect(deps.spies.extractAudio).not.toHaveBeenCalled()
    expect(deps.spies.transcribe).not.toHaveBeenCalled()
    expect(deps.reservation.spies.write).not.toHaveBeenCalled()
    expect(deps.reservation.spies.commit).not.toHaveBeenCalled()
    expect(deps.reservation.spies.discard).toHaveBeenCalledTimes(1) // 只清理本次预留的空文件
  })
  it('边界内（180s）：恰好一次 provider 调用、无重试、write+commit 各一次', async () => {
    const deps = makeDeps({ duration: 180 })
    const res = await seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'out.srt', apiKey: 'sk', deps })
    expect(deps.spies.transcribe).toHaveBeenCalledTimes(1)
    expect(res.providerCalls).toBe(1)
    expect(deps.reservation.spies.write).toHaveBeenCalledTimes(1)
    expect(deps.reservation.spies.commit).toHaveBeenCalledTimes(1)
    expect(deps.reservation.spies.discard).not.toHaveBeenCalled()
    expect(res.estimatedCostUsd).toBeCloseTo((180 / 60) * 0.006, 6)
  })
  it('听写失败：抛且不重试（仍只一次 transcribe），不 commit，discard 清理本次预留', async () => {
    const deps = makeDeps({ duration: 60, transcribe: vi.fn(async () => { throw new Error('whisper 500') }) })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'out.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/whisper 500/)
    expect(deps.transcribe).toHaveBeenCalledTimes(1)
    expect(deps.reservation.spies.commit).not.toHaveBeenCalled()
    expect(deps.reservation.spies.discard).toHaveBeenCalledTimes(1)
  })
})

describe('seedWalkTalkSrt 原子预留（PATCH2 fix1）', () => {
  it('目标已存在/被抢先：reserveOutput 抛，在探测/抽音频/听写之前 fail-closed', async () => {
    const eexist = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
    const deps = makeDeps({ reserveOutput: vi.fn(async () => { throw eexist }) })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'exists.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/EEXIST/)
    expect(deps.spies.probeDuration).not.toHaveBeenCalled()
    expect(deps.spies.extractAudio).not.toHaveBeenCalled()
    expect(deps.spies.transcribe).not.toHaveBeenCalled()
    // reserveOutput 失败=没拿到句柄，既有文件不进 try，绝不被 discard
    expect(deps.reservation.spies.discard).not.toHaveBeenCalled()
  })

  it('两个并发 seed 抢同一输出：只有一个进到 extract/transcribe，另一个在付费前失败', async () => {
    // 共享注册表模拟原子占位：第一个 reserve 成功，第二个 EEXIST。
    const reserved = new Set<string>()
    const madeReservations: ReturnType<typeof makeReservation>[] = []
    const reserveOutput = vi.fn(async (p: string) => {
      if (reserved.has(p)) {
        throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
      }
      reserved.add(p)
      const r = makeReservation()
      madeReservations.push(r)
      return r
    })
    // 两个 deps 共用同一个 reserveOutput（同一目标路径）
    const mk = () =>
      ({
        reserveOutput,
        probeDuration: vi.fn(async () => 60),
        extractAudio: vi.fn(async () => {}),
        transcribe: vi.fn(async (): Promise<WhisperSegment[]> => [{ start: 0, end: 1, text: 'hi' }]),
        buildCues: vi.fn((): CaptionCue[] => [fakeCue()]),
        serialize: vi.fn(() => 's'),
        makeAudioPath: vi.fn(async () => '/tmp/a.mp3'),
        cleanup: vi.fn(async () => {}),
      }) as unknown as SeedDeps & { transcribe: ReturnType<typeof vi.fn> }
    const dA = mk()
    const dB = mk()
    const results = await Promise.allSettled([
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'same.srt', apiKey: 'sk', deps: dA }),
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'same.srt', apiKey: 'sk', deps: dB }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length
    const rejected = results.filter((r) => r.status === 'rejected').length
    expect(fulfilled).toBe(1)
    expect(rejected).toBe(1)
    // 恰好一个进到听写；总付费调用数 = 1
    const totalTranscribe =
      (dA.transcribe as ReturnType<typeof vi.fn>).mock.calls.length +
      (dB.transcribe as ReturnType<typeof vi.fn>).mock.calls.length
    expect(totalTranscribe).toBe(1)
  })

  it('provider 失败只 discard 本次执行拥有的预留（既有/他人文件不受影响）', async () => {
    const myReservation = makeReservation()
    const deps = makeDeps({
      duration: 60,
      reservation: myReservation,
      extractAudio: vi.fn(async () => { throw new Error('ffmpeg 崩') }),
    })
    await expect(
      seedWalkTalkSrt({ rawPath: 'r.mp4', outSrtPath: 'out.srt', apiKey: 'sk', deps }),
    ).rejects.toThrow(/ffmpeg 崩/)
    expect(deps.spies.transcribe).not.toHaveBeenCalled() // extract 就崩了
    expect(myReservation.spies.discard).toHaveBeenCalledTimes(1)
    expect(myReservation.spies.commit).not.toHaveBeenCalled()
  })
})

describe('reserveOutputFile 失败清理按 inode 归属（FINAL DATA-LOSS PATCH）', () => {
  let dir: string
  const exists = async (p: string) => access(p).then(() => true).catch(() => false)
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'srt-reserve-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }).catch(() => {}) })

  it('目标已存在：open wx EEXIST，绝不触碰既有文件', async () => {
    const p = join(dir, 'ray-edited.srt')
    await writeFile(p, 'RAY 手改内容')
    await expect(reserveOutputFile(p)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(p, 'utf8')).toBe('RAY 手改内容') // 原内容不变
  })

  it('原预留仍在：discard 只删本次预留的文件', async () => {
    const p = join(dir, 'out.srt')
    const r = await reserveOutputFile(p)
    expect(await exists(p)).toBe(true)
    await r.discard()
    expect(await exists(p)).toBe(false)
  })

  it('失败前路径被另一进程替换：discard 保留替换物（不删刚保存的人工 SRT）', async () => {
    const p = join(dir, 'out.srt')
    const r = await reserveOutputFile(p) // 本次预留（空文件，inode A）
    // 模拟并发：另一进程 unlink 我们的预留，再在同路径写入人工 SRT（inode B）
    await unlink(p)
    await writeFile(p, 'RAY 刚保存的人工 SRT')
    await r.discard() // 应识别 inode 不同 → 不删
    expect(await exists(p)).toBe(true)
    expect(await readFile(p, 'utf8')).toBe('RAY 刚保存的人工 SRT') // 替换物完好
  })

  it('失败前路径已被移走：discard 不抛、无可删', async () => {
    const p = join(dir, 'out.srt')
    const r = await reserveOutputFile(p)
    await unlink(p) // 路径已不在
    await expect(r.discard()).resolves.toBeUndefined()
    expect(await exists(p)).toBe(false)
  })

  it('commit 保留文件，写入内容可读', async () => {
    const p = join(dir, 'out.srt')
    const r = await reserveOutputFile(p)
    await r.write('字幕内容')
    await r.commit()
    expect(await readFile(p, 'utf8')).toBe('字幕内容')
  })
})
