// 出片前的两道确定性质量闸 —— 都是纯函数（同输入永远同输出，无外部调用、无 vision 猜测）。
//
// 为什么不用视觉模型判断：face-frame.ts 已记录教训——让视觉模型判断图像内容，它是在猜，
// 同一张图两次给不同答案，已废弃。这两道闸只吃"图自带的文字信息"和"分镜描述"，确定性可测。
//
// 返回值刻意做成"回执形状"（带判定 + 证据 + 原因），为以后接 Inngest 逐步留档铺路——
// 每道闸的结论都能原样写进 receipt，不用改返回结构。
//
// 落点：这两道闸目前是纯逻辑 + 测试，未接进 live 出片管线（选图走 stock-harvest，
// 分镜走 scene-plan）。接线是下一步，见 PR 说明——现在不声称已在管线里生效。

// ─────────────────────────────────────────────────────────────────────────
// 闸 1 · 地点来源核验
// ─────────────────────────────────────────────────────────────────────────

export interface PlaceProvenanceResult {
  ok: boolean
  matchedKeyword: string | null
  reason: string
}

/**
 * 一张图能不能打上某个地名大字，取决于**这张图自己的来源信息**（摄影师描述 / alt /
 * 拍摄地 / 标题）有没有指名这个地方——而不是"我用什么搜索词找到它"。
 *
 * 2026-09-04 事故：用 "Xian Bell Tower" 搜到一座临水的塔，摄影师只写了 "a tall pagoda
 * illuminated at night"，根本不是西安；用 "christmas" 搜到爱丁堡圣诞市集。两张都因
 * 搜索词命中被误当合格。搜索词命中 ≠ 内容正确。
 *
 * @param sourceMetadata 图自带的描述 / alt / location / 标题，合并成一段文本
 * @param requiredPlaceKeywords 该镜声称的地点关键词（如 ["xi'an","xian","shaanxi"]）
 */
export function verifyPlaceProvenance(
  sourceMetadata: string,
  requiredPlaceKeywords: readonly string[],
): PlaceProvenanceResult {
  const hay = sourceMetadata.toLowerCase()
  if (!hay.trim()) {
    return { ok: false, matchedKeyword: null, reason: '来源无任何文字信息，无法证明地点，不得打地名大字' }
  }
  for (const raw of requiredPlaceKeywords) {
    const kw = raw.trim().toLowerCase()
    if (kw && hay.includes(kw)) {
      return { ok: true, matchedKeyword: raw, reason: `来源文字含 "${raw}"` }
    }
  }
  const list = requiredPlaceKeywords.join(' / ')
  return { ok: false, matchedKeyword: null, reason: `来源文字未提及 ${list}，不得打此地名大字` }
}

// ─────────────────────────────────────────────────────────────────────────
// 闸 2 · i2v 适用性（该图生视频，还是走真实像素推进）
// ─────────────────────────────────────────────────────────────────────────

export type RenderMode = 'i2v' | 'real_pixel'

export interface RenderModeDecision {
  mode: RenderMode
  reason: string
  riskSignals: string[]
}

// i2v 逐帧重画，画面里的**可读文字**或**密集人脸**会被涂糊 / 改写成乱码。
// 2026-09-04 三次实测：兵马俑俑脸融成团、西安街头真人和"小卖部"招牌糊掉、
// 重庆"重庆你好"楼体字糊掉。这类镜头改走真实像素推进（Ken Burns），一帧都不重画。
//
// 单词类信号（按词边界匹配，避免 sign⊂design、shop⊂shopping 之类误伤）。
const RISK_WORD_SIGNALS: readonly string[] = [
  // 文字类
  'sign', 'signs', 'signage', 'shopfront', 'storefront', 'billboard',
  'text', 'letters', 'lettering', 'menu', 'poster', 'banner', 'slogan',
  '招牌', '字', '标语', '菜单',
  // 密集人脸 / 人群类
  'face', 'faces', 'facial', 'portrait', 'portraits', 'crowd', 'crowds',
  'people', 'pedestrian', 'pedestrians', 'tourists', 'warriors', 'warrior',
  '人', '人群', '脸', '游客',
]

// 短语类信号（多词，走 substring）。
const RISK_PHRASE_SIGNALS: readonly string[] = [
  'street food', 'street market', 'night market', 'shop front', 'store front',
  'neon sign', 'led screen', 'reads ', 'chinese characters',
]

function wordTokens(s: string): Set<string> {
  // 英文按词切；中文按单字切（描述多为英文，中文信号是加成）。
  return new Set(s.toLowerCase().match(/[a-z]+|[一-鿿]/g) ?? [])
}

/**
 * 判断一个镜头该走 i2v 还是真实像素。偏保守：拿不准偏 real_pixel——
 * 真实像素最坏只是"少一点 AI 运动"，无害；i2v 碰上文字/人脸则必崩，有害。
 *
 * @param shotDescription 分镜的画面描述（生成镜的 imagePrompt，或选图的来源描述）
 */
export function classifyRenderMode(shotDescription: string): RenderModeDecision {
  const hay = shotDescription.toLowerCase()
  const tokenSet = wordTokens(shotDescription)

  const hits: string[] = []
  for (const w of RISK_WORD_SIGNALS) {
    // 中文单字用 substring；英文用词边界（token 命中）
    if (/[一-鿿]/.test(w) ? hay.includes(w) : tokenSet.has(w)) hits.push(w)
  }
  for (const p of RISK_PHRASE_SIGNALS) {
    if (hay.includes(p)) hits.push(p.trim())
  }

  if (hits.length > 0) {
    return {
      mode: 'real_pixel',
      reason: 'i2v 会糊掉可读文字 / 密集人脸，改真实像素推进',
      riskSignals: Array.from(new Set(hits)),
    }
  }
  return { mode: 'i2v', reason: '无文字 / 人脸风险，可安全 i2v 加动', riskSignals: [] }
}
