import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  formatSrtTime,
  parseSrtTime,
  cueToEditableText,
  cuesToSrt,
  srtToCues,
  parseHighlightRuns,
} from './caption-srt'
import {
  buildCaptionCues,
  segmentsToCaptionCues,
  validateCaptionCues,
  transcribeAudio,
  type CaptionCue,
} from './walk-talk-proof'

const cue = (index: number, start: number, end: number, runs: CaptionCue['runs']): CaptionCue => ({
  index,
  start,
  end,
  text: runs.map((r) => r.t).join(''),
  runs,
})

describe('formatSrtTime / parseSrtTime', () => {
  it('秒 → HH:MM:SS,mmm，毫秒三位', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000')
    expect(formatSrtTime(2.5)).toBe('00:00:02,500')
    expect(formatSrtTime(3661.007)).toBe('01:01:01,007')
  })
  it('往返到毫秒精度', () => {
    for (const t of [0, 0.05, 2.5, 12.345, 3661.007]) {
      expect(parseSrtTime(formatSrtTime(t))).toBeCloseTo(t, 3)
    }
  })
  it('非法时间 fail-closed', () => {
    expect(() => formatSrtTime(-1)).toThrow()
    expect(() => formatSrtTime(NaN)).toThrow()
    expect(() => parseSrtTime('00:00:02.500')).toThrow() // 点非逗号
    expect(() => parseSrtTime('0:0:2,5')).toThrow() // 位数不对
    expect(() => parseSrtTime('00:60:00,000')).toThrow() // 分越界
    expect(() => parseSrtTime('00:00:60,000')).toThrow() // 秒越界
  })
})

describe('cueToEditableText / cuesToSrt', () => {
  it('高亮段还原为 **...** 标记', () => {
    expect(cueToEditableText(cue(0, 0, 1, [
      { t: '看 ', hi: false },
      { t: 'GA4', hi: true },
      { t: ' 就够', hi: false },
    ]))).toBe('看 **GA4** 就够')
  })
  it('SRT 块号 1-based、时间行含 -->、保留高亮标记', () => {
    const srt = cuesToSrt([
      cue(0, 0, 2.5, [{ t: '第一句', hi: false }]),
      cue(1, 2.5, 5, [{ t: '有 ', hi: false }, { t: '106 条', hi: true }]),
    ])
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\n第一句')
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:05,000\n有 **106 条**')
  })
  it('空轴 / 时长非正 fail-closed', () => {
    expect(() => cuesToSrt([])).toThrow()
    expect(() => cuesToSrt([cue(0, 5, 5, [{ t: 'x', hi: false }])])).toThrow()
  })
})

describe('srtToCues 解析', () => {
  it('丢弃块号行、还原时间/文本/高亮、index 重编 0-based', () => {
    const srt = ['1', '00:00:00,000 --> 00:00:02,500', '第一句。', '', '2', '00:00:02,500 --> 00:00:05,000', '看 **GA4** 就够'].join('\n')
    const cues = srtToCues(srt)
    expect(cues.map((c) => c.index)).toEqual([0, 1])
    expect(cues[0].start).toBeCloseTo(0, 3)
    expect(cues[1].end).toBeCloseTo(5, 3)
    expect(cues[1].text).toBe('看 GA4 就够')
    expect(cues[1].runs).toEqual([
      { t: '看 ', hi: false },
      { t: 'GA4', hi: true },
      { t: ' 就够', hi: false },
    ])
  })
  it('无块号行也能解析（时间行起）', () => {
    const cues = srtToCues('00:00:00,000 --> 00:00:01,000\n只有一条')
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe('只有一条')
  })
  it('多文本行合并成单行大字', () => {
    const cues = srtToCues('1\n00:00:00,000 --> 00:00:02,000\n上半句\n下半句')
    expect(cues[0].text).toBe('上半句 下半句')
  })
  it('容忍 CRLF、BOM、尾随空块', () => {
    const cues = srtToCues('﻿1\r\n00:00:00,000 --> 00:00:01,000\r\nHi\r\n\r\n')
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe('Hi')
  })
  it('malformed fail-closed：空/缺-->/时间非法/end<=start/文本空', () => {
    expect(() => srtToCues('')).toThrow()
    expect(() => srtToCues('   \n\n  ')).toThrow()
    expect(() => srtToCues('1\n00:00:00,000 00:00:02,000\n缺箭头')).toThrow()
    expect(() => srtToCues('1\n00:00:00.000 --> 00:00:02,000\n点误用')).toThrow()
    expect(() => srtToCues('1\n00:00:03,000 --> 00:00:02,000\nend早于start')).toThrow()
    expect(() => srtToCues('1\n00:00:00,000 --> 00:00:02,000\n')).toThrow() // 文本空
  })
})

describe('parseHighlightRuns（PATCH2 fix2：不成对标记 fail-closed）', () => {
  it('成对标记正常解析', () => {
    expect(parseHighlightRuns('看 **GA4** 就够')).toEqual([
      { t: '看 ', hi: false },
      { t: 'GA4', hi: true },
      { t: ' 就够', hi: false },
    ])
    expect(parseHighlightRuns('没有高亮')).toEqual([{ t: '没有高亮', hi: false }])
  })
  it('孤立/不成对 ** 即抛', () => {
    expect(() => parseHighlightRuns('看 **GA4')).toThrow(/不成对/)
    expect(() => parseHighlightRuns('**GA4')).toThrow(/不成对/)
    expect(() => parseHighlightRuns('a**b**c**d')).toThrow(/不成对/) // 3 个标记
  })
  it('空高亮 **** 即抛', () => {
    expect(() => parseHighlightRuns('前****后')).toThrow(/空高亮/)
  })
})

describe('srtToCues PATCH2 加固', () => {
  it('fix2：Ray 误删一侧 ** 的块被拒（不渲染字面星号）', () => {
    expect(() => srtToCues('1\n00:00:00,000 --> 00:00:02,000\n看 **GA4')).toThrow(/不成对/)
  })
  it('fix2：text 与 runs 出自同一次解析（去标记文本一致）', () => {
    const [c] = srtToCues('1\n00:00:00,000 --> 00:00:02,000\n看 **GA4** 就够')
    expect(c.text).toBe('看 GA4 就够')
    expect(c.runs.map((r) => r.t).join('')).toBe(c.text)
  })
  it('fix3：缺空行导致两条 cue 并块 → 拒（不静默合并时间轴）', () => {
    const merged = ['1', '00:00:00,000 --> 00:00:02,000', '第一条', '2', '00:00:02,000 --> 00:00:04,000', '第二条'].join('\n')
    expect(() => srtToCues(merged)).toThrow(/多条时间行|缺空行/)
  })
  it('fix3：正确空行分隔的多条 cue 仍正常往返', () => {
    const good = ['1', '00:00:00,000 --> 00:00:02,000', '第一条', '', '2', '00:00:02,000 --> 00:00:04,000', '第二条'].join('\n')
    const cues = srtToCues(good)
    expect(cues).toHaveLength(2)
    expect(cues[1].text).toBe('第二条')
  })
})

describe('round-trip：export → (edit) → import 时间/文本/高亮保真', () => {
  it('确定性均摊 cues 往返一致（毫秒精度）', () => {
    const total = 47.3
    const orig = buildCaptionCues(['第一句短', '这是一句稍微长一点的话', '有 **106 条** 客资'], total)
    const back = srtToCues(cuesToSrt(orig))
    expect(back).toHaveLength(orig.length)
    orig.forEach((o, i) => {
      expect(back[i].start).toBeCloseTo(o.start, 3)
      expect(back[i].end).toBeCloseTo(o.end, 3)
      expect(back[i].text).toBe(o.text)
      expect(back[i].runs).toEqual(o.runs)
    })
    // 往返后的轴仍能过既有渲染前校验
    expect(() => validateCaptionCues(back, total)).not.toThrow()
  })
  it('ASR 真实时间戳 cues 往返一致', () => {
    const total = 8
    const orig = segmentsToCaptionCues(
      [{ start: 0.5, end: 4.0, text: '刚刚和一个客户开完会。' }, { start: 4.0, end: 8.0, text: '聊到 GA4 的坑。' }],
      total, 8, ['GA4'],
    )
    const back = srtToCues(cuesToSrt(orig))
    orig.forEach((o, i) => {
      expect(back[i].start).toBeCloseTo(o.start, 3)
      expect(back[i].end).toBeCloseTo(o.end, 3)
      expect(back[i].text).toBe(o.text)
    })
  })
  it('Ray 编辑文字（含 Claude→Strategy Engine 措辞校正）后 import 反映新文本、时间轴不变', () => {
    const orig = buildCaptionCues(['我用 Claude 帮你做', '出一支片'], 10)
    const edited = cuesToSrt(orig).replace('Claude', 'Strategy Engine')
    const back = srtToCues(edited)
    expect(back[0].text).toBe('我用 Strategy Engine 帮你做')
    expect(back[0].start).toBeCloseTo(orig[0].start, 3)
    expect(back[0].end).toBeCloseTo(orig[0].end, 3)
  })
})

describe('zero-provider：import/序列化路径绝不联网', () => {
  afterEach(() => vi.restoreAllMocks())
  it('cuesToSrt→srtToCues 全程零 fetch 调用', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    const cues = buildCaptionCues(['一', '二三', '四五六'], 30)
    const back = srtToCues(cuesToSrt(cues))
    validateCaptionCues(back, 30)
    expect(spy).not.toHaveBeenCalled()
  })
  it('srtToCues 确定性：同输入两次产出全等', () => {
    const srt = '1\n00:00:00,000 --> 00:00:02,500\n看 **GA4**\n\n2\n00:00:02,500 --> 00:00:05,000\n就够了'
    expect(srtToCues(srt)).toEqual(srtToCues(srt))
  })
})

describe('provider-call count：seed 听写恰好一次 fetch', () => {
  // transcribeAudio 用 node fs.readFile 读音频，ESM 下不可 spy —— 用真实临时文件，只 mock fetch。
  let audioPath: string
  beforeAll(async () => {
    audioPath = join(await mkdtemp(join(tmpdir(), 'srt-provider-')), 'audio.mp3')
    await writeFile(audioPath, Buffer.from('fake-audio-bytes'))
  })
  afterAll(async () => {
    await rm(dirname(audioPath), { recursive: true, force: true }).catch(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('transcribeAudio 只发一次请求并解析 verbose_json', async () => {
    const fakeJson = { segments: [{ start: 0, end: 2, text: '你好' }, { start: 2, end: 4, text: '世界' }] }
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(fakeJson), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const segs = await transcribeAudio(audioPath, 'sk-test')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(segs).toEqual([{ start: 0, end: 2, text: '你好' }, { start: 2, end: 4, text: '世界' }])
  })
  it('听写失败即抛，不自动重试（仍只一次 fetch）', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(transcribeAudio(audioPath, 'sk-test')).rejects.toThrow()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
