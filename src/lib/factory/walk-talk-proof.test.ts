import { describe, it, expect } from 'vitest'
import {
  parseScriptLines,
  stripMarks,
  parseRuns,
  buildCaptionCues,
  validateCaptionCues,
  buildProofFfmpegArgs,
  assertInputReadable,
  extractHighlightTerms,
  splitByLength,
  applyHighlights,
  segmentsToCaptionCues,
  cleanFiller,
  type CaptionCue,
} from './walk-talk-proof'

const cue = (index: number, start: number, end: number, text: string): CaptionCue => ({
  index,
  start,
  end,
  text,
  runs: [{ t: text, hi: false }],
})

describe('parseScriptLines', () => {
  it('每一非空行一条，剥掉 markdown 结构行、保留 ** 高亮标记', () => {
    const raw = ['# 标题', '', '第一句。', '> 有 **106 条**。', '---', '| 表格 |', '```', '   '].join('\n')
    expect(parseScriptLines(raw)).toEqual(['第一句。', '有 **106 条**。'])
  })
})

describe('stripMarks / parseRuns', () => {
  it('stripMarks 去掉 **', () => {
    expect(stripMarks('有 **106 条** 客资')).toBe('有 106 条 客资')
  })
  it('parseRuns 拆出高亮段与普通段', () => {
    expect(parseRuns('看 **GA4** 就够')).toEqual([
      { t: '看 ', hi: false },
      { t: 'GA4', hi: true },
      { t: ' 就够', hi: false },
    ])
  })
  it('parseRuns 无标记时整行普通', () => {
    expect(parseRuns('没有高亮')).toEqual([{ t: '没有高亮', hi: false }])
  })
})

describe('buildCaptionCues', () => {
  it('无缝均摊：首条 start=0、末条 end=总时长、单调递增', () => {
    const cues = buildCaptionCues(['短', '这是一句比较长的话'], 100)
    expect(cues[0].start).toBeCloseTo(0, 6)
    expect(cues[cues.length - 1].end).toBeCloseTo(100, 6)
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end, 6)
  })
  it('计时权重用去标记后的长度（** 不计入时长）', () => {
    const [a, b] = buildCaptionCues(['**a**', 'abc'], 100)
    // 'a'(1) : 'abc'(3) → 25s : 75s
    expect(a.end - a.start).toBeCloseTo(25, 4)
    expect(b.end - b.start).toBeCloseTo(75, 4)
    expect(a.runs).toEqual([{ t: 'a', hi: true }])
    expect(a.text).toBe('a')
  })
  it('空稿 / 非法时长 fail-closed', () => {
    expect(() => buildCaptionCues([], 100)).toThrow()
    expect(() => buildCaptionCues(['x'], 0)).toThrow()
    expect(() => buildCaptionCues(['x'], NaN)).toThrow()
  })
})

describe('validateCaptionCues', () => {
  const total = 60
  it('正常轴通过', () => {
    expect(() => validateCaptionCues(buildCaptionCues(['a', 'bb', 'ccc'], total), total)).not.toThrow()
  })
  it('end<=start / 越界 / 重叠 都抛', () => {
    expect(() => validateCaptionCues([cue(0, 5, 5, 'x')], total)).toThrow()
    expect(() => validateCaptionCues([cue(0, 0, total + 5, 'x')], total)).toThrow()
    expect(() => validateCaptionCues([cue(0, 0, 30, 'a'), cue(1, 10, 40, 'b')], total)).toThrow()
    expect(() => validateCaptionCues([], total)).toThrow()
  })
})

describe('buildProofFfmpegArgs', () => {
  const cues: CaptionCue[] = [cue(0, 0, 12.5, 'a'), cue(1, 12.5, 30, 'b')]
  const args = buildProofFfmpegArgs({
    rawPath: '/x/raw.MP4',
    capPngPaths: ['/x/cap0.png', '/x/cap1.png'],
    cues,
    outPath: '/x/out.mp4',
  })
  it('原声保留：映射 0:a 且音频 copy', () => {
    expect(args).toContain('0:a')
    const i = args.indexOf('-c:a')
    expect(args[i + 1]).toBe('copy')
  })
  it('竖屏裁切 + 每条字幕一个 overlay/enable(between)，时间保留三位', () => {
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('crop=1080:1920')
    expect((fc.match(/overlay=0:0:enable=/g) || []).length).toBe(2)
    expect(fc).toContain('between(t,0.000,12.500)')
    expect(fc).toContain('between(t,12.500,30.000)')
  })
  it('最终画面标签映射到最后一条 overlay 输出', () => {
    const mapIdx = args.indexOf('-map')
    expect(args[mapIdx + 1]).toBe('[v1]')
  })
  it('字幕图数与轴数不符 fail-closed', () => {
    expect(() =>
      buildProofFfmpegArgs({ rawPath: 'r', capPngPaths: ['only-one.png'], cues, outPath: 'o' }),
    ).toThrow()
  })
})

describe('ASR 模式纯逻辑', () => {
  it('extractHighlightTerms 从 ** 收集去重词表', () => {
    expect(extractHighlightTerms('看 **GA4**，再看 **GA4** 和 **Submit**')).toEqual(['GA4', 'Submit'])
  })
  it('splitByLength 按标点切、超长再切', () => {
    expect(splitByLength('第一句。第二句。', 20)).toEqual(['第一句。', '第二句。'])
    expect(splitByLength('一二三四五六', 3)).toEqual(['一二三', '四五六'])
  })
  it('splitByLength 不拦腰切断英文/数字单词', () => {
    const pieces = splitByLength('然后点了Submit好了', 4)
    expect(pieces).toContain('Submit')
    expect(pieces.every((p) => !/Subm(?!it)|ubmit/.test(p) || p.includes('Submit'))).toBe(true)
  })
  it('splitByLength 句末标点附前段、不单独成帧（P2#1）', () => {
    expect(splitByLength('一二三，', 3)).toEqual(['一二三，'])
    const pieces = splitByLength('一二三四五，六七八', 5)
    expect(pieces.every((p) => !/^[，。！？；、：]+$/.test(p))).toBe(true)
  })
  it('splitByLength 丢弃句首孤儿标点、不产生纯标点字幕帧（PATCH5）', () => {
    expect(splitByLength('。然后我们看 GA4', 14)).toEqual(['然后我们看 GA4'])
    expect(splitByLength('。', 14)).toEqual([]) // 整段只剩标点 → 不出帧
    expect(splitByLength('一二三，', 3)).toEqual(['一二三，']) // 句末标点保护不变
  })
  it('segmentsToCaptionCues 清洗后不产生纯标点字幕（PATCH5 端到端）', () => {
    const cues = segmentsToCaptionCues([{ start: 0, end: 4, text: '嗯。然后我们看 GA4' }], 4, 14, ['GA4'], true)
    expect(cues.length).toBeGreaterThan(0)
    expect(cues.every((c) => c.text.trim() !== '。' && !/^[。！？；，、：]/.test(c.text.trim()))).toBe(true)
  })
  it('cleanFiller 只删完整独立语气词；仅串首/串尾不足（PATCH4）', () => {
    // Codex 明例：句首合法词——「唉」右侧是汉字 → 保留整句（不得只凭串首判独立）
    expect(cleanFiller('唉声叹气并不能解决问题')).toBe('唉声叹气并不能解决问题')
    // 句中合法词（回归）
    expect(cleanFiller('不要唉声叹气')).toBe('不要唉声叹气')
    // 句尾黏在汉字后的 filler 字符——不再因串尾就删
    expect(cleanFiller('开完会啊')).toBe('开完会啊')
    // 被真边界（标点/空白）隔开的独立语气词仍删（保留既有能力）
    expect(cleanFiller('嗯，我们才告诉 GA4')).toBe('我们才告诉 GA4')
    expect(cleanFiller('啊 好的')).toBe('好的')
    // 正常词不动
    expect(cleanFiller('这个功能很方便')).toBe('这个功能很方便')
  })
  it('segmentsToCaptionCues clean=true 删独立语气词', () => {
    const cues = segmentsToCaptionCues([{ start: 0, end: 3, text: '啊，聊到 GA4' }], 3, 20, ['GA4'], true)
    expect(cues.map((c) => c.text).join('')).not.toContain('啊')
  })
  it('applyHighlights 最长优先标高亮', () => {
    expect(applyHighlights('拿到真正的 Lead 了', ['Lead', '真正的 Lead'])).toEqual([
      { t: '拿到', hi: false },
      { t: '真正的 Lead', hi: true },
      { t: ' 了', hi: false },
    ])
  })
  it('segmentsToCaptionCues 用真实时间戳、跨段单调、末端不超总时长', () => {
    const segs = [
      { start: 0.5, end: 4.0, text: '刚刚和一个客户开完会。' },
      { start: 4.0, end: 8.0, text: '聊到 GA4 的坑。' },
    ]
    const cues = segmentsToCaptionCues(segs, 8, 8, ['GA4'])
    expect(cues[0].start).toBeCloseTo(0.5, 3)
    expect(cues[cues.length - 1].end).toBeLessThanOrEqual(8 + 1e-6)
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end - 1e-6)
    // 高亮词进了 runs
    expect(cues.some((c) => c.runs.some((r) => r.hi && r.t === 'GA4'))).toBe(true)
  })
  it('空听写分段 fail-closed', () => {
    expect(() => segmentsToCaptionCues([], 10, 12, [])).toThrow()
  })
})

describe('assertInputReadable', () => {
  it('缺文件即抛（fail-closed）', async () => {
    await expect(assertInputReadable('/no/such/file-xyz.MP4', '原片')).rejects.toThrow('原片')
  })
  it('存在文件通过', async () => {
    await expect(assertInputReadable(__filename, '本测试文件')).resolves.toBeUndefined()
  })
})
