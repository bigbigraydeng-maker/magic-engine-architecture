import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RankableAsset } from './rank-assets-by-prompt'

const asset = (id: string, opts: Partial<RankableAsset> = {}): RankableAsset => ({
  id,
  storage_url: `https://x/${id}.jpg`,
  original_filename: `${id}.jpg`,
  vision_metadata: { objects: [], quality_score: 5 },
  source: 'client_verified',
  ...opts,
})

describe('rankAssetsByPrompt — 小素材库不烧 LLM 调用', () => {
  it('素材数 <= topN 时全给，按质量分排序，不调用 OpenAI', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [
      asset('a', { vision_metadata: { quality_score: 3 } }),
      asset('b', { vision_metadata: { quality_score: 9 } }),
    ]
    const picks = await rankAssetsByPrompt('great wall', assets, 5)
    expect(picks.map((p) => p.id)).toEqual(['b', 'a'])
    expect(picks[0].reason).toBe('Closest available library photo')
  })

  it('requireVerified=true 时过滤掉未核实来源，剩余不足 topN 也不调用 LLM', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [
      asset('verified', { source: 'client_verified' }),
      asset('unverified', { source: 'client_provided' }),
      asset('ai', { source: 'ai_generated' }),
    ]
    const picks = await rankAssetsByPrompt('great wall', assets, 5, { requireVerified: true })
    expect(picks.map((p) => p.id)).toEqual(['verified'])
  })

  it('requireVerified=true 且素材池全不合格时返回空数组，不炸', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('a', { source: 'client_provided' }), asset('b', { source: 'unknown' })]
    const picks = await rankAssetsByPrompt('great wall', assets, 5, { requireVerified: true })
    expect(picks).toEqual([])
  })

  it('素材池本来就是空数组，直接返回空，不崩', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    expect(await rankAssetsByPrompt('great wall', [], 5)).toEqual([])
  })
})

describe('rankAssetsByPrompt — requireConfidentMatch 挡住文不对题的选图', () => {
  it('挑出来的图跟 prompt 零关键词重叠时丢弃,返回空数组（复现 2026-09-14 故宫误配长城）', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // 小素材池(<=topN)分支：只有一张长城照,prompt 问故宫,零重叠。
    const assets = [asset('great-wall', { vision_metadata: { objects: ['Great Wall', 'mountains', 'fog'], quality_score: 9 } })]
    const picks = await rankAssetsByPrompt('forbidden city courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks).toEqual([])
  })

  it('挑出来的图跟 prompt 有关键词重叠时正常返回', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('palace', { vision_metadata: { objects: ['palace', 'lion statue'], quality_score: 8 } })]
    const picks = await rankAssetsByPrompt('forbidden city palace courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks.map((p) => p.id)).toEqual(['palace'])
  })

  it('不开 requireConfidentMatch 时保持原样,零重叠也照样返回（人工选图界面靠这个看"最接近的几张"）', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('great-wall', { vision_metadata: { objects: ['Great Wall'], quality_score: 9 } })]
    const picks = await rankAssetsByPrompt('forbidden city courtyard', assets, 1)
    expect(picks.map((p) => p.id)).toEqual(['great-wall'])
  })

  it('通用词(city/people/building...)单独命中不算重叠,不能靠它蒙混过 requireConfidentMatch', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // "Forbidden City courtyard" 跟错误素材 "city skyline" 光凭 city 这个通用词就有
    // 表面重叠,但两者根本不是同一个地方——city/skyline 都太笼统,不该算数。
    const assets = [asset('wrong-city', { vision_metadata: { objects: ['city skyline'], quality_score: 9 } })]
    const picks = await rankAssetsByPrompt('Forbidden City courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks).toEqual([])
  })

  it('大素材池、真正走 LLM 排序分支时,LLM 选出的图跟 prompt 零重叠照样会被过滤（复现 2026-09-14 真实故障链路：素材池里明明有 palace 那张对的图,LLM 却选了 great-wall）', async () => {
    vi.resetModules()
    vi.doMock('@/lib/ai/openai-client', () => ({
      getOpenAIClient: () => ({
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      picks: [{ id: 'great-wall', reason: '长城雾景符合古代遗迹氛围' }],
                    }),
                  },
                },
              ],
            }),
          },
        },
      }),
    }))
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // pool 长度(3) > topN(1),强制走 rankWithLlm,不是小池分支。
    const assets = [
      asset('great-wall', { vision_metadata: { objects: ['Great Wall', 'mountains', 'fog'], quality_score: 9 } }),
      asset('palace', { vision_metadata: { objects: ['palace', 'lion statue'], quality_score: 8 } }),
      asset('other', { vision_metadata: { objects: ['skyline'], quality_score: 7 } }),
    ]
    const picks = await rankAssetsByPrompt('forbidden city courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks).toEqual([])
    vi.doUnmock('@/lib/ai/openai-client')
  })
})

describe('rankAssetsByPrompt — LLM 调用失败时降级关键词兜底', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('OpenAI 客户端不可用时，走关键词重叠兜底而不是抛错', async () => {
    vi.doMock('@/lib/ai/openai-client', () => ({
      getOpenAIClient: () => {
        throw new Error('no client in test')
      },
    }))
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')

    // 素材数 > topN，强制走 LLM 分支（进而触发 catch → keywordFallback）
    const assets = [
      asset('wall', { vision_metadata: { objects: ['great wall'], quality_score: 5 } }),
      asset('duck', { vision_metadata: { objects: ['peking duck'], quality_score: 8 } }),
      asset('bund', { vision_metadata: { objects: ['bund skyline'], quality_score: 6 } }),
    ]
    const picks = await rankAssetsByPrompt('a shot of the great wall at sunrise', assets, 1)
    expect(picks).toHaveLength(1)
    expect(picks[0].id).toBe('wall')
    expect(picks[0].reason).toMatch(/Matches/)
  })
})
