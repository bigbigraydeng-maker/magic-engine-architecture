// 按一句画面描述,从一批已分析素材里挑最匹配的几张。
//
// 抽出这份逻辑之前,`asset-library/search` 路由(人工选图界面)和 Creatomate
// 出片管线(scene-assets.ts,自动选图)各写一份的话,任何一处改排序规则都会
// 悄悄跟另一处岔开——两个调用方现在共用同一份判断(设计复审 ⚠️ 提出的要求)。
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { canBackRealPrice, normaliseSource, type AssetSource } from '@/lib/assets/provenance'

export interface VisionMetadata {
  objects?: string[]
  scene?: string
  emotion?: string
  has_people?: boolean
  brand_elements?: string[]
  quality_score?: number
  ai_notes?: string
}

export interface RankableAsset {
  id: string
  storage_url: string | null
  original_filename: string | null
  /** 数据库读出来的原始形状,不假设一定符合 VisionMetadata(同 client-asset-pool.ts
   *  的教训:quality_score 是 jsonb 里的键,老数据/坏数据可能什么都没有)。 */
  vision_metadata: unknown
  source: unknown
}

export interface AssetPick {
  id: string
  storageUrl: string
  reason: string
  qualityScore: number
  metadata: VisionMetadata | null
  source: AssetSource
}

function visionOf(a: RankableAsset): VisionMetadata {
  return (a.vision_metadata ?? {}) as VisionMetadata
}

function scoreOf(a: RankableAsset): number {
  return visionOf(a).quality_score ?? 0
}

function toPick(a: RankableAsset, reason: string): AssetPick {
  return {
    id: a.id,
    storageUrl: a.storage_url ?? '',
    reason,
    qualityScore: scoreOf(a),
    metadata: a.vision_metadata ? visionOf(a) : null,
    source: normaliseSource(a.source),
  }
}

/**
 * 按 prompt 排序一批素材,返回 topN。
 *
 * `requireVerified: true` 时只保留能打真实价格的来源(`client_verified`/`fde_shot`,
 * 见 provenance.ts::canBackRealPrice)——出片自动选图管线必须开这个,不然免登录
 * 上传链接传进来的网图/AI 图会被自动当"客户真实照片"塞进无人审核的成片
 * (设计复审 ❌ 指出的红线风险)。人工选图界面(FDE 自己挑)不受此限,人能看见
 * 也能选未核实的图,所以那条调用路径保持 `requireVerified` 默认 false。
 *
 * `requireConfidentMatch: true` 时,挑出来的图跟 prompt 一个关键词都对不上也会被
 * 丢掉(丢完可能变成返回空数组)——2026-09-14 实测发现:素材库明明有标注清楚的
 * 故宫/兵马俑真实照片,LLM 排序还是选了完全文不对题的长城/梯田照片,且自己编的
 * reason 读起来像真的匹配上了,调用方无从分辨。出片自动选图管线必须开这个,
 * 选不准就该走回原有的 AI 现画兜底,而不是把猜错的图当"匹配成功"直接发布
 * (对应 CLAUDE.md 客户数据红线:对外画面配错等于内容跟文案对不上)。人工选图
 * 界面让人自己挑,"最接近的几张"本身有用,所以默认 false 不受此限。
 */
export async function rankAssetsByPrompt(
  prompt: string,
  assets: RankableAsset[],
  topN: number,
  opts: { requireVerified?: boolean; requireConfidentMatch?: boolean } = {},
): Promise<AssetPick[]> {
  const pool = opts.requireVerified
    ? assets.filter((a) => canBackRealPrice(a.source as string | null | undefined))
    : assets
  if (pool.length === 0) return []

  let picks: AssetPick[]
  // 素材少的时候不必烧一次 LLM 调用,全给,按质量分排。
  if (pool.length <= topN) {
    picks = pool
      .slice()
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .map((a) => toPick(a, 'Closest available library photo'))
  } else {
    try {
      picks = await rankWithLlm(prompt, pool, topN)
    } catch (err: unknown) {
      console.error('[rank-assets-by-prompt] LLM ranking failed, using fallback:', err)
      picks = keywordFallback(prompt, pool, topN)
    }
  }

  return opts.requireConfidentMatch ? picks.filter((p) => keywordOverlap(prompt, p) > 0) : picks
}

/** 只按 ASCII 字母数字切词——CTS 现有 imagePrompt 全英文,够用。哪天有客户的
 *  imagePrompt/objects 混进中文,纯中文段会被当分隔符整段吃掉,判成零重叠,
 *  `requireConfidentMatch` 会把这类 prompt 的匹配全部清空,不是漏改,是已知边界。 */
function promptWordsOf(prompt: string): Set<string> {
  return new Set(
    prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  )
}

/** prompt 分词与一组 object 短语的重叠数,`keywordFallback` 排序和 `keywordOverlap` 判定共用。 */
function objectOverlap(promptWords: Set<string>, objects: string[]): number {
  return objects.reduce((n, obj) => {
    const words = obj.toLowerCase().split(/[^a-z0-9]+/)
    return n + (words.some((w) => promptWords.has(w)) ? 1 : 0)
  }, 0)
}

/** prompt 与素材 objects 的名词重叠数——挑图理由文字读着再确定,这个数字对不上就不算数。
 *  只看 `vision_metadata.objects`(最多 5 项"主要物体"),不看自由文本的 `ai_notes`——
 *  地标名字只写在 ai_notes 里、没挤进 objects 的图会被误判成零重叠,即使排序本来选对了。
 *  这是"宁可错杀不可放过"的保守选择,不是遗漏;objects 命中率不够再考虑纳入 ai_notes。 */
function keywordOverlap(prompt: string, pick: AssetPick): number {
  return objectOverlap(promptWordsOf(prompt), pick.metadata?.objects ?? [])
}

// 让 GPT-4o-mini 挑最匹配的几张。模型不可用/返回不可用结果时降级关键词重叠打分。
async function rankWithLlm(prompt: string, assets: RankableAsset[], topN: number): Promise<AssetPick[]> {
  const client = getOpenAIClient()
  const candidates = assets.map((a) => ({
    id: a.id,
    filename: a.original_filename,
    scene: visionOf(a).scene,
    emotion: visionOf(a).emotion,
    objects: visionOf(a).objects ?? [],
    ai_notes: visionOf(a).ai_notes,
    quality_score: scoreOf(a),
    brand_elements: visionOf(a).brand_elements ?? [],
  }))

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Given an image generation prompt and a library of analyzed photos with structured metadata, ' +
          `return the top ${topN} most relevant photos for the prompt. ` +
          'Reply JSON only in the shape {"picks":[{"id":string,"reason":string}]}. ' +
          'Order picks best-first. reason is one short sentence on why the photo fits the prompt.',
      },
      { role: 'user', content: JSON.stringify({ image_prompt: prompt, candidates }) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(raw) as { picks?: Array<{ id?: string; reason?: string }> }
  const byId = new Map(assets.map((a) => [a.id, a]))

  const picks = (parsed.picks ?? [])
    .map((p) => {
      const asset = p.id ? byId.get(p.id) : undefined
      if (!asset) return null
      return toPick(asset, p.reason?.trim() || 'Recommended by Content Engine')
    })
    .filter((r): r is AssetPick => r !== null)
    .slice(0, topN)

  if (picks.length > 0) return picks
  return keywordFallback(prompt, assets, topN)
}

// 确定性兜底：按 prompt 与素材 objects 的名词重叠数排序，重叠数打平再按质量分。
function keywordFallback(prompt: string, assets: RankableAsset[], topN: number): AssetPick[] {
  const promptWords = promptWordsOf(prompt)

  return assets
    .map((a) => ({ asset: a, overlap: objectOverlap(promptWords, visionOf(a).objects ?? []) }))
    .sort((x, y) => y.overlap - x.overlap || scoreOf(y.asset) - scoreOf(x.asset))
    .slice(0, topN)
    .map(({ asset, overlap }) =>
      toPick(asset, overlap > 0 ? `Matches ${overlap} subject(s) in the prompt` : 'Best available library photo'),
    )
}
