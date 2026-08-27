/**
 * Video Factory adapter — 把上游能力对齐到既有 render-assemble 的 input 形状。
 *
 * 上游（都在 src/lib/factory/ 内）:
 *   - client-asset-pool.ts  → 客户素材 URL 数组
 *   - shot-recipes.ts       → ShotRecipe（每格 role/duration_hint_s/transition/motion）
 *   - viral-structure.ts    → 行业爆款结构（rhythm/hook 分布，可空）
 *   - narrative-beats.ts    → i2v prompt hint（不是字幕文案，字幕由调用方提供）
 *
 * 下游: src/lib/factory/render-assemble.ts 的 JobRow 内层 payload
 *   { scenes: [{ index, captionText }], clip_urls: string[], vo_urls: string[] }
 *
 * 本文件只做纯映射 + fail-closed 校验，不复制字幕/Ken Burns/FFmpeg overlay/BGM 逻辑。
 * client-agnostic：任何客户名/客户 ID/行业事实都留给调用方。
 */
import type { ShotRecipe } from './shot-recipes'
import type { ViralStructure } from './viral-structure'

/** 与 render-assemble.ts 的 JobRow.scenes 元素同形。 */
export interface RenderScene {
  index: number
  captionText: string
}

/**
 * 与 render-assemble.ts 的 JobRow 内层同形（不含 id/client_id/content_post_id，
 * 那些属于 job 编排层，不属于本 adapter 的职责范围）。
 */
export interface VideoFactoryRenderInput {
  scenes: RenderScene[]
  clip_urls: string[]
  vo_urls: string[]
}

export interface ComposeRenderInputParams {
  /** 从 client-asset-pool 出来的素材 URL；顺序即镜头顺序。 */
  assetUrls: string[]
  /** 从 shot-recipes 出来的配方；shots.length 定义镜头数。 */
  recipe: ShotRecipe
  /** 每格字幕；长度必须与 recipe.shots.length 严格相等。 */
  captions: string[]
  /** 每格配音 MP3 URL；render-assemble 用其 duration 驱动每段时长。 */
  voUrls: string[]
  /**
   * 可选：行业爆款结构。留占位以后放节奏微调；本 adapter 只保留字段，
   * 不改变现有 recipe 的 duration/transition —— 那属于 recipe 选择层的职责。
   */
  viral?: ViralStructure | null
}

export class VideoFactoryAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoFactoryAdapterError'
  }
}

/**
 * 把上游产物映射成 render-assemble 可消费的形状。
 *
 * 顺序保留（hook → middle... → cta），一格一格对齐 assetUrls[i] / captions[i] / voUrls[i]。
 * 任一维度不齐或空 → 立即抛错（fail closed），绝不静默截断或填占位。
 */
export function composeRenderInput(params: ComposeRenderInputParams): VideoFactoryRenderInput {
  const { assetUrls, recipe, captions, voUrls } = params

  if (!recipe || !Array.isArray(recipe.shots) || recipe.shots.length === 0) {
    throw new VideoFactoryAdapterError('recipe.shots 为空 —— 无法确定镜头数')
  }
  const n = recipe.shots.length

  if (!Array.isArray(assetUrls) || assetUrls.length < n) {
    throw new VideoFactoryAdapterError(
      `assetUrls 长度 ${assetUrls?.length ?? 0} < 镜头数 ${n} —— 素材不足`,
    )
  }
  if (!Array.isArray(captions) || captions.length !== n) {
    throw new VideoFactoryAdapterError(
      `captions 长度 ${captions?.length ?? 0} 与镜头数 ${n} 不一致`,
    )
  }
  if (!Array.isArray(voUrls) || voUrls.length !== n) {
    throw new VideoFactoryAdapterError(
      `voUrls 长度 ${voUrls?.length ?? 0} 与镜头数 ${n} 不一致 —— render-assemble 用配音时长驱动每段`,
    )
  }
  for (let i = 0; i < n; i += 1) {
    if (typeof assetUrls[i] !== 'string' || assetUrls[i].length === 0) {
      throw new VideoFactoryAdapterError(`assetUrls[${i}] 空/非字符串`)
    }
    if (typeof voUrls[i] !== 'string' || voUrls[i].length === 0) {
      throw new VideoFactoryAdapterError(`voUrls[${i}] 空/非字符串`)
    }
    if (typeof captions[i] !== 'string') {
      throw new VideoFactoryAdapterError(`captions[${i}] 非字符串`)
    }
  }

  const scenes: RenderScene[] = recipe.shots.map((_shot, index) => ({
    index,
    captionText: captions[index],
  }))

  return {
    scenes,
    clip_urls: assetUrls.slice(0, n),
    vo_urls: voUrls.slice(0, n),
  }
}
