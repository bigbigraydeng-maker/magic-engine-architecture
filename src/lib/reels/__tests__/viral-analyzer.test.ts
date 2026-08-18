/**
 * 只测 finalizeAnalysis 的字段合并逻辑 —— 不碰 yt-dlp / Gemini，那两块要真下载/真调用
 * 才测得出东西，不划算。这里测的是「分析完成时会不会把已有的好数据冲成 null」。
 *
 * 真实事故（2026-08-17 生产库实查）：`metadata` 来自 fetchYouTubeMetadata，
 * 对非 YouTube 源永远返回全 null；finalize 无条件用它覆盖，等于每次分析完成
 * 都把插入时已经拿到的 like_count / channel_title 冲掉 —— Facebook 14/14、
 * Xiaohongshu 8/8 的 done 行 like_count 全部是 null。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { finalizeAnalysis, type ViralAnalysisResult } from '../viral-analyzer'

const RESULT: ViralAnalysisResult = {
  style_scores: { energy: 5, luxury: 1, authenticity: 8, emotional: 4, humor: 2, urgency: 3, offer_signal: 6 },
  style_tags: ['educational'],
  style_description: '测试用',
  persona_fit: [],
  key_techniques: ['talking-head'],
  detected_content_goal: 'education',
  detected_industry: 'digital_marketing',
  opening_hook: { type: 'text_overlay_question', script: '你知道吗', feel: 'smooth-reveal' },
}

const NULL_METADATA = { view_count: null, like_count: null, published_at: null, video_title: null, channel_title: null }
const REAL_METADATA = {
  view_count: 999999, like_count: 88888, published_at: '2026-01-01T00:00:00Z',
  video_title: '新抓到的标题', channel_title: '新抓到的作者',
}

/** existing 行 + 记录 update 收到的 payload */
function fakeDb(existingRow: Record<string, unknown>) {
  const updatePayload = { current: null as Record<string, unknown> | null }
  mocks.from.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }) })),
    })),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayload.current = payload
      return { eq: vi.fn().mockResolvedValue({ error: null }) }
    }),
  })
  return updatePayload
}

beforeEach(() => vi.resetAllMocks())

describe('🔴 metadata 全 null（非 YouTube 的真实情况）时，不许清掉已有数据', () => {
  it('like_count / channel_title 等五个字段全部保留旧值', async () => {
    const captured = fakeDb({
      is_our_video: false, content_goal: 'brand', view_threshold_min: 5000,
      view_count: null, like_count: 25757, published_at: '2026-08-01T00:00:00Z',
      video_title: '旧标题（插入时已经写好）', channel_title: '刘葵安|获客思维',
    })
    await finalizeAnalysis('ref-1', RESULT, NULL_METADATA)
    expect(captured.current).toMatchObject({
      like_count: 25757,
      channel_title: '刘葵安|获客思维',
      video_title: '旧标题（插入时已经写好）',
      published_at: '2026-08-01T00:00:00Z',
      analysis_status: 'done',
    })
  })

  it('view_count 两边都没有 → is_learnable 不因为「看不见播放量」被误判为不可学', async () => {
    const captured = fakeDb({
      is_our_video: false, content_goal: 'brand', view_threshold_min: 5000,
      view_count: null, like_count: 100, published_at: null, video_title: null, channel_title: null,
    })
    await finalizeAnalysis('ref-2', RESULT, NULL_METADATA)
    expect(captured.current).toMatchObject({ is_learnable: true })
  })
})

describe('拿到新值时，新值照样覆盖旧值（YouTube 那条路径不能被这次修复带歪）', () => {
  it('五个字段全部换成 metadata 的新值', async () => {
    const captured = fakeDb({
      is_our_video: false, content_goal: 'brand', view_threshold_min: 5000,
      view_count: 100, like_count: 200, published_at: '2020-01-01T00:00:00Z',
      video_title: '旧标题', channel_title: '旧频道',
    })
    await finalizeAnalysis('ref-3', RESULT, REAL_METADATA)
    expect(captured.current).toMatchObject({
      view_count: 999999, like_count: 88888, published_at: '2026-01-01T00:00:00Z',
      video_title: '新抓到的标题', channel_title: '新抓到的作者',
    })
  })

  it('新值是 0（真实的零播放/零点赞，不是「没抓到」）要原样写入，不当成缺失退回旧值', async () => {
    const captured = fakeDb({
      is_our_video: false, content_goal: 'brand', view_threshold_min: 5000,
      view_count: 500, like_count: 500, published_at: null, video_title: null, channel_title: null,
    })
    await finalizeAnalysis('ref-4', RESULT, { ...REAL_METADATA, view_count: 0, like_count: 0 })
    expect(captured.current).toMatchObject({ view_count: 0, like_count: 0 })
  })
})

describe('is_our_video / content_goal 覆盖逻辑不受这次改动影响', () => {
  it('自己发的视频永远 is_learnable=false，不管播放量多高', async () => {
    const captured = fakeDb({
      is_our_video: true, content_goal: 'brand', view_threshold_min: 5000,
      view_count: null, like_count: null, published_at: null, video_title: null, channel_title: null,
    })
    await finalizeAnalysis('ref-5', RESULT, REAL_METADATA)
    expect(captured.current).toMatchObject({ is_learnable: false })
  })

  it('用户手动选过非默认 content_goal 时保留用户的选择，不被检测结果覆盖', async () => {
    const captured = fakeDb({
      is_our_video: false, content_goal: 'sales', view_threshold_min: 5000,
      view_count: null, like_count: null, published_at: null, video_title: null, channel_title: null,
    })
    await finalizeAnalysis('ref-6', RESULT, NULL_METADATA)
    expect(captured.current).toMatchObject({ content_goal: 'sales' })
  })
})
