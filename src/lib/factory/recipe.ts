// P21.J.M2 — 版本化 winner recipe(合同 5469105522)。服务端唯一真相源。
//
// 关键契约:
// - endcard_dur=2.7 让 final = 2*5 + 2.7 - 2*0.35 = 12.0(不多不少,不依赖 renderer 兜底裁剪)
// - creative_recipe 出现在 client-config → id + version 必须都存在且匹配注册,否则 throw
// - assertReopenedRecipeReplan 只吃 brief.recipe_replan_required 明确标记,不看 review_feedback
//   (legacy 无 recipe 的 review 重试路径保持不变)
// - buildFullRecipeBrief 一次性构造完整可执行 brief(不再 insert 空壳后 patch)
// - assertRecipeBriefComplete 在 pre-insert / pre-provider 两处双重确认所有 claim-critical 字段就位
// - assertRecipePlanShape 严格逐字段校验:duration/transition/motion/role/prompt/same source
//   / unique idempotency / zero inventory clip / max_new_clips
// - validateRecipeCopy 强约束 hook+CTA(禁 middle 段其它文案 / 禁 VO / 禁多行 / 禁数字绕过)
// - assertRecipeReceipt 消费真实探测数据(duration/loudness/portable BGM id/provider evidence)
// - computeReviewFeedbackDigest / assertRecipeReplanAcknowledged 把 quality-reject 反馈用 sha256
//   digest 硬绑定到 replanned recipe,禁止「静默换个新 recipe 但没吃掉最新意见」

import { createHash } from 'node:crypto'

export const WINNER_RECIPE_IDS = ['single_image_i2v_pullback_12s'] as const
export type WinnerRecipeId = (typeof WINNER_RECIPE_IDS)[number]

export interface RecipeSegmentSpec {
  readonly role: 'hook' | 'middle' | 'cta'
  readonly duration_hint_s: number
  readonly motion_type: 'push_in' | 'pull_back'
  /** 落进 prompt_hint 的相机动作原文,worker 断言 prompt 里真的带这串(case-insensitive) */
  readonly camera_action: string
  /** ffmpeg xfade 名。recipe 路径下 transition 由 recipe 定义,brief 不可覆盖(R8) */
  readonly transition: string
  /** 与 camera_action 对齐的关键词,plan validator 用其 lowercase 匹配 */
  readonly prompt_keyword: string
}

export interface WinnerRecipe {
  readonly id: WinnerRecipeId
  readonly version: number
  readonly label: string
  readonly segments: readonly RecipeSegmentSpec[]
  readonly endcard_dur: number
  readonly xfade: number
  readonly min_final_dur: number
  readonly max_final_dur: number
  readonly caption_mode: string
  readonly tts_enabled: false
  readonly kenburns: false
  /** hook / CTA 硬字数上限(超即 fail-closed) */
  readonly hook_max_words_en: number
  readonly hook_max_chars_cjk: number
  /**
   * 最终成片积分响度下限(严格 `>`;LUFS 越小越静;单独用于 final probe = silence detection)。
   * 与 min_bgm_input_loudness_lufs 分开:BGM 输入必须"真的有声"(≥ -50),final 只挡 muted 结果。
   */
  readonly min_loudness_lufs: number
  /**
   * BGM 输入文件必须超过的响度下限(严格 `>`);-54 LUFS 视作事实性太静,拒。
   * 单独字段:blocker 7 明确要求 input 门槛比 final silence 门槛更严。
   */
  readonly min_bgm_input_loudness_lufs: number
  /** 端卡 transition into endcard;renderer 拿它铺 cta→endcard;必须是 renderer 支持的名称 */
  readonly endcard_transition: string
}

const SINGLE_IMAGE_I2V_PULLBACK_12S: WinnerRecipe = Object.freeze({
  id: 'single_image_i2v_pullback_12s',
  version: 1,
  label: '单图 · 推近 + 拉远 12 秒',
  segments: Object.freeze([
    Object.freeze({
      role: 'hook' as const,
      duration_hint_s: 5.0,
      motion_type: 'push_in' as const,
      camera_action: 'focus / push-in cinematic close-up',
      transition: 'fade',
      prompt_keyword: 'push-in',
    }),
    Object.freeze({
      role: 'cta' as const,
      duration_hint_s: 5.0,
      motion_type: 'pull_back' as const,
      camera_action: 'pull-back / reveal wide cinematic shot',
      transition: 'dissolve',
      prompt_keyword: 'pull-back',
    }),
  ]),
  // 2*5 + 2.7 - 2*0.35 = 12.0(不依赖 renderer 「大约裁到 12」的兜底,由 verifyFinalMedia 硬校验)
  endcard_dur: 2.7,
  xfade: 0.35,
  min_final_dur: 11.8,
  max_final_dur: 12.0,
  caption_mode: 'short_big',
  tts_enabled: false,
  kenburns: false,
  hook_max_words_en: 6,
  hook_max_chars_cjk: 12,
  // -55 LUFS 用于 final probe = silence detection(-60 明显是彻底 muted)。
  min_loudness_lufs: -55,
  // -50 LUFS 用于 BGM 输入(严格 `>`);-54 LUFS 视作太静,拒。合规音频通常 -23 ~ -18 LUFS。
  min_bgm_input_loudness_lufs: -50,
  // renderer 支持 dissolve(cta→endcard);与 segments[1].transition 语义对齐(cta 出场即入 endcard)
  endcard_transition: 'dissolve',
})

const REGISTRY: Record<WinnerRecipeId, WinnerRecipe> = Object.freeze({
  single_image_i2v_pullback_12s: SINGLE_IMAGE_I2V_PULLBACK_12S,
})

export function resolveRecipe(id: unknown): WinnerRecipe | null {
  if (typeof id !== 'string') return null
  return (REGISTRY as Record<string, WinnerRecipe>)[id] ?? null
}

/** recipe 时间轴纯函数(合同 §1):sum(segments) + endcard - N*xfade,N = 段间过渡数(含 →endcard) */
export function computeRecipeFinalDuration(recipe: WinnerRecipe): number {
  const segTotal = recipe.segments.reduce((s, x) => s + x.duration_hint_s, 0)
  const transitionCount = recipe.segments.length // hook→cta xfade + cta→endcard xfade = 2 for 2-seg
  return segTotal + recipe.endcard_dur - transitionCount * recipe.xfade
}

// ── 错误类型 ──────────────────────────────────────────────────────────────────

export const RECIPE_ERR = Object.freeze({
  REPLAN_REQUIRED: 'WINNER_RECIPE_REPLAN_REQUIRED',
  PLAN_INVALID: 'WINNER_RECIPE_PLAN_INVALID',
  SOURCE_MISSING: 'WINNER_RECIPE_SOURCE_MISSING',
  CONFIG_INVALID: 'WINNER_RECIPE_CONFIG_INVALID',
  COPY_INVALID: 'WINNER_RECIPE_COPY_INVALID',
  BUDGET_INSUFFICIENT: 'WINNER_RECIPE_BUDGET_INSUFFICIENT',
  RENDERER_UNAPPROVED: 'WINNER_RECIPE_RENDERER_UNAPPROVED',
})

export class RecipeConfigError extends Error {
  constructor(msg: string) {
    super(`${RECIPE_ERR.CONFIG_INVALID}: ${msg}`)
    this.name = 'RecipeConfigError'
  }
}

// ── client-config 输入闸(R2 严格解析) ────────────────────────────────────────

/**
 * factory_config.creative_recipe 输入解析。
 * - null / undefined → null(未配 recipe)
 * - 对象:id 与 version **都必须存在**,且都必须匹配注册白名单;否则 throw RecipeConfigError
 *   (评估路径 catch → 走 outer reject;UI/API 层直接把错误暴露给 PM)
 */
export function parseFactoryRecipeConfig(raw: unknown):
  | { id: WinnerRecipeId; version: number }
  | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RecipeConfigError('creative_recipe 必须是对象 {id, version}')
  }
  const o = raw as { id?: unknown; version?: unknown }
  if (typeof o.id !== 'string' || o.id.trim().length === 0) {
    throw new RecipeConfigError('creative_recipe.id 缺失或非字符串')
  }
  const recipe = resolveRecipe(o.id.trim())
  if (!recipe) {
    throw new RecipeConfigError(
      `creative_recipe.id "${String(o.id)}" 不在白名单(${WINNER_RECIPE_IDS.join(', ')})`,
    )
  }
  if (o.version === undefined || o.version === null) {
    throw new RecipeConfigError(
      `creative_recipe.version 必须显式提供(不接受静默补齐:升级 recipe 是 breaking change)`,
    )
  }
  const v = Number(o.version)
  if (!Number.isInteger(v) || v !== recipe.version) {
    throw new RecipeConfigError(
      `creative_recipe.version ${String(o.version)} 与已注册 "${recipe.id}" v${recipe.version} 不匹配`,
    )
  }
  return { id: recipe.id, version: v }
}

/**
 * clients.factory_config → recipe intent(纯函数,便于测试;由 claim route 消费)。
 * - null / 无 creative_recipe → { recipeIntent: null, recipeIntentInvalidReason: null }(legacy)
 * - 合法解析 → { recipeIntent: {...}, recipeIntentInvalidReason: null }
 * - RecipeConfigError → { recipeIntent: null, recipeIntentInvalidReason: e.message }
 *   worker 收到 recipeIntentInvalidReason 会在任何 provider 之前 fail-closed。
 */
export function deriveRecipeIntent(factoryConfig: unknown): {
  recipeIntent: { id: WinnerRecipeId; version: number } | null
  recipeIntentInvalidReason: string | null
} {
  const cfg = ((factoryConfig ?? {}) as Record<string, unknown>)['creative_recipe']
  try {
    return { recipeIntent: parseFactoryRecipeConfig(cfg), recipeIntentInvalidReason: null }
  } catch (e) {
    if (e instanceof RecipeConfigError) {
      return { recipeIntent: null, recipeIntentInvalidReason: e.message }
    }
    throw e
  }
}

/**
 * brief.creative_recipe → recipe descriptor。
 * key 出现但不合法 → throw(不再静默 null,worker 会因此 fail-closed)。
 * key 完全缺失 → null(legacy 分支)。
 */
export function winnerRecipeFromBrief(brief: unknown): WinnerRecipe | null {
  const b = (brief as { creative_recipe?: unknown } | null)?.creative_recipe
  if (b === undefined || b === null) return null
  if (typeof b !== 'object' || Array.isArray(b)) {
    throw new RecipeConfigError('brief.creative_recipe 存在但非对象')
  }
  const m = b as { id?: unknown; version?: unknown }
  const recipe = resolveRecipe(m.id)
  if (!recipe) throw new RecipeConfigError(`brief.creative_recipe.id 未知或非法: ${String(m.id)}`)
  if (m.version === undefined || m.version === null) {
    throw new RecipeConfigError('brief.creative_recipe.version 缺失(必须与已注册 recipe 匹配)')
  }
  const v = Number(m.version)
  if (!Number.isInteger(v) || v !== recipe.version) {
    throw new RecipeConfigError(
      `brief.creative_recipe.version ${String(m.version)} 与已注册 v${recipe.version} 不匹配`,
    )
  }
  return recipe
}

// ── 结构化 recipe 文案(R9)────────────────────────────────────────────────────

export interface RecipeCopyInput {
  hook: string
  cta: string
}

// 表情符号:tsconfig 目标不支持 /u 属性类。用固定 BMP 范围 + 常见 emoji 前缀近似检查。
// 覆盖 U+1F300–U+1FAFF(surrogate pair) 与常见 dingbats;够拦「hi 🎉」类绕过。
const EMOJI_RE = /\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F\uDE80-\uDEFF]|\uD83E[\uDD00-\uDDFF]|[☀-➿]/
// 中日韩 BMP 常用区间(不含极稀有 CJK ext);够拦「一二三…」超字数
function isCjkText(text: string): boolean {
  const cjk = (text.match(/[一-鿿぀-ヿ]/g) ?? []).length
  const en = (text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length
  return cjk > en
}
function countGraphemes(text: string): number {
  // Array.from 按 code point 切分,BMP + surrogate pair 都计一格;够 CJK 硬上限用。
  return Array.from(text).length
}

/**
 * recipe 路径下的文案强约束(合同 §5 defect#R9):
 * - hook / CTA 都必须非空、单行、无 emoji / 无纯数字
 * - hook 与 CTA 不能相同(禁止「同一句复读」)
 * - 中英分别按 recipe.hook_max_chars_cjk / hook_max_words_en 判限;超限一律拒
 */
export function validateRecipeCopy(input: unknown, recipe: WinnerRecipe): RecipeCopyInput {
  if (!input || typeof input !== 'object') {
    throw new Error(`${RECIPE_ERR.COPY_INVALID}: copy is missing`)
  }
  const c = input as { hook?: unknown; cta?: unknown; segments?: unknown; endcard?: unknown }
  const pick = (v: unknown, name: string): string => {
    if (typeof v !== 'string') throw new Error(`${RECIPE_ERR.COPY_INVALID}: ${name} must be string`)
    const trimmed = v.trim()
    if (trimmed.length === 0) throw new Error(`${RECIPE_ERR.COPY_INVALID}: ${name} is empty`)
    if (/[\r\n]/.test(trimmed)) throw new Error(`${RECIPE_ERR.COPY_INVALID}: ${name} must be single-line`)
    if (EMOJI_RE.test(trimmed)) throw new Error(`${RECIPE_ERR.COPY_INVALID}: ${name} contains emoji`)
    // 纯数字 / 只有数字与标点视作数字绕过(如 "$99")。
    // 不使用 Unicode property escape，保持与仓库当前 TS target 兼容。
    if (!/[A-Za-z一-鿿぀-ヿ]/.test(trimmed)) {
      throw new Error(`${RECIPE_ERR.COPY_INVALID}: ${name} is numeric/punct-only`)
    }
    return trimmed
  }
  const hook = pick(c.hook, 'hook')
  const cta = pick(c.cta, 'cta')
  if (hook.toLowerCase() === cta.toLowerCase()) {
    throw new Error(`${RECIPE_ERR.COPY_INVALID}: hook and cta must differ`)
  }
  // 禁 middle 段其它文案 / VO:copy.segments 或 copy.endcard.vo / copy.hook_alt 出现即拒
  if (Array.isArray(c.segments) && c.segments.length > 0) {
    throw new Error(`${RECIPE_ERR.COPY_INVALID}: recipe forbids segment-array copy (use {hook, cta})`)
  }
  const endcard = c.endcard as Record<string, unknown> | undefined
  if (endcard && (endcard.vo != null || endcard.offer != null || endcard.url != null)) {
    throw new Error(`${RECIPE_ERR.COPY_INVALID}: recipe forbids endcard.vo/offer/url extras`)
  }
  for (const [text, name] of [
    [hook, 'hook'],
    [cta, 'cta'],
  ] as const) {
    if (isCjkText(text)) {
      const chars = countGraphemes(text)
      if (chars > recipe.hook_max_chars_cjk) {
        throw new Error(
          `${RECIPE_ERR.COPY_INVALID}: ${name} exceeds ${recipe.hook_max_chars_cjk} CJK graphemes (got ${chars}: "${text}")`,
        )
      }
    } else {
      const words = (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length
      if (words > recipe.hook_max_words_en) {
        throw new Error(
          `${RECIPE_ERR.COPY_INVALID}: ${name} exceeds ${recipe.hook_max_words_en} EN words (got ${words}: "${text}")`,
        )
      }
    }
  }
  // 数字/emoji 检查已在 pick 内串内匹配;这里不再引用 DIGIT_RE(避免 TS unused-symbol)。
  return { hook, cta }
}

// ── server-side planner ───────────────────────────────────────────────────────

export interface RecipePlanSegment {
  role: 'hook' | 'middle' | 'cta'
  duration_hint_s: number
  description: string
  clip_ids: string[]
  transition: string
}

export interface RecipePlanItem {
  segment_role: 'hook' | 'middle' | 'cta'
  position: number
  scene_tag: 'client_source_derived'
  motion_type: 'push_in' | 'pull_back'
  prompt_hint: string
  idempotency_key: string
  source_image_url: string
  requires_source_resolution: false
}

export interface RecipePlan {
  segments: RecipePlanSegment[]
  clip_generation_plan: RecipePlanItem[]
  creative_recipe: { id: WinnerRecipeId; version: number }
  max_new_clips: number
}

export function buildRecipePlan(args: {
  recipe: WinnerRecipe
  angle: string
  sourceImageUrl: string
  /**
   * idempotency key 前缀。**必须**在 insert 之前已稳定(通常 = signal.id 或已知 work_order_id)。
   * R5:禁止用 `{work_order_id}` 占位再 post-insert patch —— 那会让 queued brief 一度带占位符,
   * worker 若抢跑就会读到不合法的 key。
   */
  keyNamespace: string
}): RecipePlan {
  const { recipe, sourceImageUrl } = args
  if (typeof sourceImageUrl !== 'string' || sourceImageUrl.trim().length === 0) {
    throw new Error(`${RECIPE_ERR.SOURCE_MISSING}: planner requires a concrete source image URL`)
  }
  const ns = typeof args.keyNamespace === 'string' ? args.keyNamespace.trim() : ''
  if (!ns) {
    throw new Error(
      `${RECIPE_ERR.PLAN_INVALID}: buildRecipePlan requires a non-empty keyNamespace (deterministic pre-insert; use signal.id or work_order_id)`,
    )
  }
  const trimmed = sourceImageUrl.trim()
  const safeAngle =
    typeof args.angle === 'string' && args.angle.trim().length > 0 ? args.angle.trim() : 'brand-story'
  const woToken = ns
  const segments: RecipePlanSegment[] = recipe.segments.map((s) => ({
    role: s.role,
    duration_hint_s: s.duration_hint_s,
    description: `${s.role} — ${s.camera_action} (${recipe.id})`,
    clip_ids: [],
    transition: s.transition,
  }))
  const clip_generation_plan: RecipePlanItem[] = recipe.segments.map((s, i) => ({
    segment_role: s.role,
    position: i,
    scene_tag: 'client_source_derived',
    motion_type: s.motion_type,
    prompt_hint: `${safeAngle} — ${s.camera_action}, 9:16 vertical, cinematic realism`,
    idempotency_key: `${woToken}:${s.role}:${i}`,
    source_image_url: trimmed,
    requires_source_resolution: false,
  }))
  return {
    segments,
    clip_generation_plan,
    creative_recipe: { id: recipe.id, version: recipe.version },
    max_new_clips: recipe.segments.length,
  }
}

// ── 严格 shape 校验(R8)──────────────────────────────────────────────────────

export function assertRecipePlanShape(brief: unknown, recipe: WinnerRecipe): void {
  const b = (brief as Record<string, unknown>) ?? {}
  const segs = Array.isArray(b.segments) ? (b.segments as Array<Record<string, unknown>>) : []
  if (segs.length !== recipe.segments.length) {
    throw new Error(
      `${RECIPE_ERR.PLAN_INVALID}: expected ${recipe.segments.length} segments, got ${segs.length}`,
    )
  }
  for (let i = 0; i < recipe.segments.length; i++) {
    const seg = segs[i]
    const spec = recipe.segments[i]
    if (!seg || seg.role !== spec.role) {
      throw new Error(`${RECIPE_ERR.PLAN_INVALID}: segment[${i}].role expected "${spec.role}"`)
    }
    if (seg.duration_hint_s !== spec.duration_hint_s) {
      throw new Error(
        `${RECIPE_ERR.PLAN_INVALID}: segment[${i}].duration_hint_s expected ${spec.duration_hint_s}, got ${String(seg.duration_hint_s)}`,
      )
    }
    // recipe 定义的 transition 是权威,brief 不可覆盖(R8)
    if (seg.transition !== undefined && seg.transition !== spec.transition) {
      throw new Error(
        `${RECIPE_ERR.PLAN_INVALID}: segment[${i}].transition must be "${spec.transition}" (recipe-locked), got "${String(seg.transition)}"`,
      )
    }
    if (Array.isArray(seg.clip_ids) && (seg.clip_ids as unknown[]).length > 0) {
      throw new Error(`${RECIPE_ERR.PLAN_INVALID}: segment[${i}] must not reference inventory clip_ids`)
    }
  }
  const plan = Array.isArray(b.clip_generation_plan)
    ? (b.clip_generation_plan as Array<Record<string, unknown>>)
    : []
  if (plan.length !== recipe.segments.length) {
    throw new Error(
      `${RECIPE_ERR.PLAN_INVALID}: clip_generation_plan expected ${recipe.segments.length} entries, got ${plan.length}`,
    )
  }
  const firstSource = plan[0]?.source_image_url
  if (typeof firstSource !== 'string' || firstSource.trim().length === 0) {
    throw new Error(`${RECIPE_ERR.PLAN_INVALID}: source_image_url missing/empty on first plan entry`)
  }
  const seenKeys = new Set<string>()
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i]
    const spec = recipe.segments[i]
    if (p.segment_role !== spec.role) {
      throw new Error(`${RECIPE_ERR.PLAN_INVALID}: plan[${i}].segment_role expected "${spec.role}"`)
    }
    if (p.position !== i) {
      throw new Error(`${RECIPE_ERR.PLAN_INVALID}: plan[${i}].position expected ${i}`)
    }
    if (p.motion_type !== spec.motion_type) {
      throw new Error(
        `${RECIPE_ERR.PLAN_INVALID}: plan[${i}].motion_type expected "${spec.motion_type}"`,
      )
    }
    if (p.source_image_url !== firstSource) {
      throw new Error(`${RECIPE_ERR.PLAN_INVALID}: plan[${i}] must reuse the same source_image_url`)
    }
    if (p.requires_source_resolution !== false) {
      throw new Error(
        `${RECIPE_ERR.PLAN_INVALID}: plan[${i}].requires_source_resolution must be false (server already resolved)`,
      )
    }
    const prompt = String(p.prompt_hint ?? '').toLowerCase()
    if (!prompt.includes(spec.prompt_keyword)) {
      throw new Error(
        `${RECIPE_ERR.PLAN_INVALID}: plan[${i}].prompt_hint missing camera keyword "${spec.prompt_keyword}"`,
      )
    }
    const key = String(p.idempotency_key ?? '')
    if (!key) throw new Error(`${RECIPE_ERR.PLAN_INVALID}: plan[${i}].idempotency_key missing`)
    if (seenKeys.has(key)) {
      throw new Error(`${RECIPE_ERR.PLAN_INVALID}: duplicate idempotency_key "${key}"`)
    }
    seenKeys.add(key)
  }
  if (Number(b.max_new_clips) !== recipe.segments.length) {
    throw new Error(
      `${RECIPE_ERR.PLAN_INVALID}: max_new_clips expected ${recipe.segments.length}, got ${String(b.max_new_clips)}`,
    )
  }
}

// ── 反复引用的 replan marker(R3/R4) ─────────────────────────────────────────

/**
 * review-apply 决定 reopen recipe 单时打上 `recipe_replan_required: true` + 结构化 reason,
 * 并**从新单 brief 里移除** stale creative_recipe。
 * worker 与 evaluate 遇到这个 marker → fail-closed,直到服务端产出新的合法 recipe 计划。
 * 无 marker 的 reopened 单不受此闸约束(legacy 无 recipe review 重试保持不变,R3 兼容)。
 */
export function assertReopenedRecipeReplan(brief: unknown): void {
  const b = (brief as Record<string, unknown>) ?? {}
  if (b.recipe_replan_required !== true) return
  if (winnerRecipeFromBrief(b) === null) {
    throw new Error(
      `${RECIPE_ERR.REPLAN_REQUIRED}: reopened order marked recipe_replan_required but has no compatible structured creative_recipe; refusing to run any provider until server rebuilds the plan`,
    )
  }
}

/**
 * 双向 intent 对比(blocker 4):
 * - 两侧都缺 → legacy 单,通过
 * - 精确 id + version 匹配 → 通过
 * - client intent 缺但 brief 带 recipe → fail-closed(客户已下架 recipe,不许跑旧 recipe queued)
 * - client intent 有但 brief 缺 / 版本对不上 → fail-closed(客户已换 recipe,旧壳单不能跑)
 * 无效 config 由 deriveRecipeIntent 侧走 fail-closed(recipeIntentInvalidReason)。
 */
export function assertClientRecipeIntentMatchesBrief(
  brief: unknown,
  clientIntent: { id: WinnerRecipeId; version: number } | null,
): void {
  const b = (brief as Record<string, unknown>) ?? {}
  const meta = b.creative_recipe as { id?: unknown; version?: unknown } | null | undefined
  const briefHasRecipe = meta != null && typeof meta === 'object'
  if (!clientIntent && !briefHasRecipe) return
  if (!clientIntent && briefHasRecipe) {
    throw new Error(
      `${RECIPE_ERR.REPLAN_REQUIRED}: brief carries recipe "${String(meta?.id)}" v${String(meta?.version)} but client currently has no creative_recipe intent; refusing to run stale recipe queued (client took recipe off)`,
    )
  }
  if (clientIntent && !briefHasRecipe) {
    throw new Error(
      `${RECIPE_ERR.REPLAN_REQUIRED}: client currently expects recipe "${clientIntent.id}" v${clientIntent.version} but queued brief has no creative_recipe; refusing to run legacy shell for recipe client`,
    )
  }
  if (clientIntent && briefHasRecipe && (meta!.id !== clientIntent.id || Number(meta!.version) !== clientIntent.version)) {
    throw new Error(
      `${RECIPE_ERR.REPLAN_REQUIRED}: client currently expects recipe "${clientIntent.id}" v${clientIntent.version}, but queued brief is incompatible (id=${String(meta!.id)} v=${String(meta!.version)}); refusing to run until server rebuilds the order`,
    )
  }
}

/**
 * R3 硬绑定:把 quality-reject 的 free-text feedback 折成 sha256 digest。
 * review-apply 在 reopen 时写入 brief.review_feedback_digest;replanner 必须把它 acknowledge
 * 进 brief.creative_recipe.acknowledged_review_feedback_digest。worker 用 assertRecipeReplanAcknowledged
 * 验证 —— 阻止「静默换一个新 recipe 但没吃掉最新意见」这条绕过路径。
 */
export function computeReviewFeedbackDigest(text: string): string {
  if (typeof text !== 'string') {
    throw new Error(`${RECIPE_ERR.REPLAN_REQUIRED}: feedback must be string for digest`)
  }
  const t = text.normalize('NFC').trim()
  if (!t) {
    throw new Error(`${RECIPE_ERR.REPLAN_REQUIRED}: feedback empty; cannot compute digest`)
  }
  return createHash('sha256').update(t, 'utf8').digest('hex')
}

/**
 * R3 acknowledgement gate:
 * - 无 brief.review_feedback_digest → 无操作(legacy 无 recipe review 重试保持不变)
 * - 有 digest 且 creative_recipe.acknowledged_review_feedback_digest 匹配 → 通过
 * - 有 digest 但 recipe 没 ack / ack 与 digest 不同 → fail-closed
 * 与 assertReopenedRecipeReplan 联合使用:marker 覆盖「还没重规划」,digest 覆盖「重规划了但没吃反馈」
 */
export function assertRecipeReplanAcknowledged(brief: unknown): void {
  const b = (brief as Record<string, unknown>) ?? {}
  const digest = b.review_feedback_digest
  if (typeof digest !== 'string' || digest.trim().length === 0) return
  const meta = b.creative_recipe as { acknowledged_review_feedback_digest?: unknown } | null | undefined
  const ack = meta?.acknowledged_review_feedback_digest
  if (typeof ack !== 'string' || ack !== digest) {
    throw new Error(
      `${RECIPE_ERR.REPLAN_REQUIRED}: brief.review_feedback_digest exists but creative_recipe.acknowledged_review_feedback_digest does not match (expected "${digest}", got "${String(ack)}"); refusing to run any provider until server rebuilds the plan against the current feedback`,
    )
  }
}

// ── budget gate(R7)──────────────────────────────────────────────────────────

export interface RecipeBudgetInputs {
  budgetCapUsd: number
  maxNewClips: number
  clipUnitCostUsd: number
  recipe: WinnerRecipe
}

/**
 * blocker 5:budget-adjacent number must be finite AND non-negative;NaN / Infinity / 负数
 * 全部当作 fatal（不静默降级 0，那会让爆预算的调用直接过闸）。字段名带进错误里帮追根。
 */
export function assertBudgetFiniteNonNeg(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${RECIPE_ERR.BUDGET_INSUFFICIENT}: ${field} must be finite non-negative number, got ${String(value)}`,
    )
  }
  return value
}

export function assertRecipeBudget(inputs: RecipeBudgetInputs): { projectedCostUsd: number } {
  const { recipe } = inputs
  const budgetCapUsd = assertBudgetFiniteNonNeg(inputs.budgetCapUsd, 'budgetCapUsd')
  const clipUnitCostUsd = assertBudgetFiniteNonNeg(inputs.clipUnitCostUsd, 'clipUnitCostUsd')
  const maxNewClips = inputs.maxNewClips
  if (typeof maxNewClips !== 'number' || !Number.isInteger(maxNewClips) || maxNewClips < 0) {
    throw new Error(
      `${RECIPE_ERR.BUDGET_INSUFFICIENT}: maxNewClips must be finite non-negative integer, got ${String(maxNewClips)}`,
    )
  }
  if (maxNewClips < recipe.segments.length) {
    throw new Error(
      `${RECIPE_ERR.BUDGET_INSUFFICIENT}: brief.max_new_clips=${maxNewClips} < recipe.segments=${recipe.segments.length}`,
    )
  }
  const projectedCostUsd = clipUnitCostUsd * recipe.segments.length
  if (projectedCostUsd > budgetCapUsd) {
    throw new Error(
      `${RECIPE_ERR.BUDGET_INSUFFICIENT}: projected cost $${projectedCostUsd.toFixed(3)} > budget_cap $${budgetCapUsd.toFixed(2)}`,
    )
  }
  return { projectedCostUsd }
}

// ── receipt validator(R12)────────────────────────────────────────────────────

export interface RecipeExecutedSegment {
  role: 'hook' | 'middle' | 'cta'
  planned_duration_s: number
  actual_duration_s: number
  motion_type: 'push_in' | 'pull_back'
  camera_action: string
  transition_out: string | null
  clip_source: 'ai_i2v'
  source_image_url: string
  provider: { name: string; request_id: string }
  caption: string
}

export interface RecipeExecutedReceipt {
  recipe: { id: WinnerRecipeId; version: number }
  motion: false
  tts: false
  segments: RecipeExecutedSegment[]
  /** blocker 6:endcard.transition_in 必须等于 recipe.endcard_transition —— renderer 真实用的切法 */
  endcard: { planned_duration_s: number; cta: string; transition_in: string }
  music: { id: string; source: 'library' | 'pool'; loudness_lufs: number }
  xfade: number
  final: { duration_s: number; loudness_lufs: number }
}

/**
 * receipt validator:consumed by both worker before /complete and by external tooling.
 * 关键防御:duration 由 ffprobe 得来(不能用 planned time 冒充);loudness 高于 -55 LUFS;
 * 至少一段 provider evidence 存在;music.id 是 portable(basename 或 library id),不是本地绝对路径。
 */
export function assertRecipeReceipt(payload: unknown, recipe: WinnerRecipe): void {
  const r = payload as Partial<RecipeExecutedReceipt> | null
  const fail = (m: string): never => {
    throw new Error(`${RECIPE_ERR.PLAN_INVALID}: ${m}`)
  }
  if (!r || typeof r !== 'object') fail('receipt payload is not an object')
  const rec = r as RecipeExecutedReceipt
  if (!rec.recipe || rec.recipe.id !== recipe.id || rec.recipe.version !== recipe.version) {
    fail('receipt.recipe mismatch')
  }
  if (rec.motion !== false) fail('receipt.motion must be false (recipe forbids ken-burns)')
  if (rec.tts !== false) fail('receipt.tts must be false (recipe forbids TTS)')
  if (!Array.isArray(rec.segments) || rec.segments.length !== recipe.segments.length) {
    fail(`receipt.segments expected ${recipe.segments.length} entries`)
  }
  const firstSource = rec.segments[0]?.source_image_url
  if (!firstSource) fail('receipt.segments[0].source_image_url missing')
  for (let i = 0; i < recipe.segments.length; i++) {
    const s = rec.segments[i]
    const spec = recipe.segments[i]
    if (!s || s.role !== spec.role) fail(`receipt.segments[${i}].role expected "${spec.role}"`)
    if (s.motion_type !== spec.motion_type) fail(`receipt.segments[${i}].motion_type mismatch`)
    if (s.clip_source !== 'ai_i2v') fail(`receipt.segments[${i}].clip_source must be "ai_i2v"`)
    if (s.source_image_url !== firstSource) {
      fail(`receipt.segments[${i}].source_image_url must reuse first entry`)
    }
    if (typeof s.actual_duration_s !== 'number' || Math.abs(s.actual_duration_s - spec.duration_hint_s) > 0.6) {
      fail(`receipt.segments[${i}].actual_duration_s off contract`)
    }
    // provider evidence — 需要真实非空的 name + request_id(空字符串等于没证据)
    if (!s.provider
      || typeof s.provider.name !== 'string' || s.provider.name.trim().length === 0
      || typeof s.provider.request_id !== 'string' || s.provider.request_id.trim().length === 0) {
      fail(`receipt.segments[${i}].provider evidence missing`)
    }
    // transition out: hook 段 → cta 用 recipe.segments[0].transition;cta 段 → endcard 用 recipe.segments[1].transition
    const expectedTransition = spec.transition
    if (s.transition_out !== expectedTransition) {
      fail(`receipt.segments[${i}].transition_out expected "${expectedTransition}"`)
    }
  }
  if (!rec.endcard || rec.endcard.planned_duration_s !== recipe.endcard_dur) {
    fail('receipt.endcard.planned_duration_s mismatch')
  }
  // blocker 6:endcard.transition_in 必须等于 recipe.endcard_transition;不允许 receipt 声称
  // 没在 assemble config 里用的过渡（"claiming unused transitions" 防御）
  if (rec.endcard.transition_in !== recipe.endcard_transition) {
    fail(`receipt.endcard.transition_in must equal recipe.endcard_transition (${recipe.endcard_transition})`)
  }
  if (typeof rec.xfade !== 'number' || rec.xfade !== recipe.xfade) {
    fail(`receipt.xfade must equal recipe.xfade (${recipe.xfade})`)
  }
  const music = rec.music
  if (!music || typeof music.id !== 'string' || music.id.trim().length === 0) {
    fail('receipt.music.id missing')
  }
  if (music.id.startsWith('/') || /^[A-Za-z]:\\/.test(music.id)) {
    fail('receipt.music.id must be portable (basename / library key), not local absolute path')
  }
  if (music.source !== 'library' && music.source !== 'pool') {
    fail('receipt.music.source must be "library" or "pool"')
  }
  // blocker 7:BGM 输入用更严的门槛 min_bgm_input_loudness_lufs（-50，拒 -54）;
  // final 仍用 min_loudness_lufs（-55）做 silence detection。
  if (typeof music.loudness_lufs !== 'number' || !Number.isFinite(music.loudness_lufs)
      || music.loudness_lufs <= recipe.min_bgm_input_loudness_lufs) {
    fail(`receipt.music.loudness_lufs (${music.loudness_lufs}) must exceed ${recipe.min_bgm_input_loudness_lufs}`)
  }
  const final = rec.final
  if (!final || typeof final.duration_s !== 'number' || !Number.isFinite(final.duration_s)) {
    fail('receipt.final.duration_s missing/non-finite')
  }
  if (final.duration_s < recipe.min_final_dur || final.duration_s > recipe.max_final_dur) {
    fail(`receipt.final.duration_s ${final.duration_s} ∉ [${recipe.min_final_dur}, ${recipe.max_final_dur}]`)
  }
  if (typeof final.loudness_lufs !== 'number' || !Number.isFinite(final.loudness_lufs)
      || final.loudness_lufs <= recipe.min_loudness_lufs) {
    fail(`receipt.final.loudness_lufs (${final.loudness_lufs}) must exceed ${recipe.min_loudness_lufs}`)
  }
}

// ── R6 source-picker(pre-insert pure fn;evaluate.persistDecision 消费)──────
//
// recipe 路径必须有 ≥1 张真源图,否则连 plan 都构造不出来。抽成纯函数是为了让
// evaluate 的「no-source → 真实 rejected」路径可单测(不需要 mock supabase)。
export type RecipeSourcePick =
  | { source: string }
  | { rejection: string }

export function pickRecipeSourceOrReject(
  pool: ReadonlyArray<string | null | undefined>,
  recipe: WinnerRecipe,
): RecipeSourcePick {
  for (const raw of pool) {
    if (typeof raw === 'string' && raw.trim().length > 0) return { source: raw.trim() }
  }
  return {
    rejection: `gate_data_unavailable: creative_recipe "${recipe.id}" requires ≥1 client-owned or transformed source image (sourceImagePool empty)`,
  }
}

// ── R5 brief completeness gate(pre-insert + pre-provider 双重验证)─────────────
//
// 补 buildFullRecipeBrief 之外的第二道防线:即便未来有人绕过 buildFullRecipeBrief 直接
// 手拼 brief,只要 assertRecipeBriefComplete 通过,就保证 claim-critical 字段 (creative_recipe
// / copy / segments / plan / max_new_clips / creative_profile / non-placeholder idempotency key)
// 齐全。evaluate 在 insert 前调、worker 在任何 provider 之前再调一遍(defense-in-depth)。
export function assertRecipeBriefComplete(brief: unknown, recipe: WinnerRecipe): void {
  const b = (brief as Record<string, unknown>) ?? {}
  const meta = b.creative_recipe as { id?: unknown; version?: unknown } | null | undefined
  if (!meta || meta.id !== recipe.id || Number(meta.version) !== recipe.version) {
    throw new Error(
      `${RECIPE_ERR.PLAN_INVALID}: brief.creative_recipe missing/mismatch (expected ${recipe.id} v${recipe.version})`,
    )
  }
  const copy = b.copy as { hook?: unknown; cta?: unknown } | null | undefined
  const hookOk = copy && typeof copy.hook === 'string' && copy.hook.trim().length > 0
  const ctaOk = copy && typeof copy.cta === 'string' && copy.cta.trim().length > 0
  if (!hookOk || !ctaOk) {
    throw new Error(
      `${RECIPE_ERR.PLAN_INVALID}: brief.copy.hook / cta missing (recipe brief must be shape-complete before insert)`,
    )
  }
  if (!('creative_profile' in b) || typeof b.creative_profile !== 'object' || b.creative_profile === null) {
    throw new Error(`${RECIPE_ERR.PLAN_INVALID}: brief.creative_profile missing`)
  }
  // 延续 plan shape 检查(段/plan/idempotency/source 同图/max_new_clips)。
  assertRecipePlanShape(brief, recipe)
  // R5:idempotency_key 必须已经是 deterministic(evaluate 传 signal.id ns),
  // 不能仍带 `{work_order_id}` 占位符 —— 那意味着有人在 insert 后打算 patch(旧竞态窗口)。
  const plan = Array.isArray(b.clip_generation_plan) ? (b.clip_generation_plan as Array<Record<string, unknown>>) : []
  for (let i = 0; i < plan.length; i++) {
    const key = String(plan[i]?.idempotency_key ?? '')
    if (key.includes('{work_order_id}') || key.includes('{signal_id}')) {
      throw new Error(
        `${RECIPE_ERR.PLAN_INVALID}: plan[${i}].idempotency_key still holds a placeholder ("${key}"); brief was not shape-completed before insert (R5 race window)`,
      )
    }
  }
}

// ── 完整 recipe brief 构造器(R5 原子插入前置)────────────────────────────────

export interface FullRecipeBriefInput {
  recipe: WinnerRecipe
  angle: string
  sourceImageUrl: string
  creativeProfile: Record<string, unknown> // 已经过 client-config compact
  copy: RecipeCopyInput
  /** R5:deterministic 前缀。必须。evaluate 传 signal.id。 */
  keyNamespace: string
  aspectRatio?: '9:16'
  notes?: string
  attribution?: { goal_id: string; expected_metric: string | null } | null
  clipUnitCostUsd?: number
  budgetCapUsd?: number
  /**
   * R3:未来 replanner 用 buildFullRecipeBrief 重建时,把当前 review_feedback_digest 传进来,
   * 会作为 creative_recipe.acknowledged_review_feedback_digest 落入 brief;
   * assertRecipeReplanAcknowledged 据此判定 ack 一致。首次落单不需传(digest 只在 reopen 才有)。
   */
  acknowledgedReviewFeedbackDigest?: string | null
  /** R3:reopen 场景下从旧 brief 抄过来,配合 ack digest 让 worker 侧断言可运行。 */
  reviewFeedbackDigest?: string | null
}

/**
 * 一次性构造完整可执行 brief。evaluate 用它在 insert 之前拿到 recipe-shaped brief,
 * 从而 queued 单一落库就已经具备完整 recipe id/version、精确 segments/plan、creative_profile、
 * 结构化 copy 与 receipt 元数据;不再走「insert queued → patch」这条竞态窗口(R5)。
 */
export function buildFullRecipeBrief(input: FullRecipeBriefInput): Record<string, unknown> {
  const plan = buildRecipePlan({
    recipe: input.recipe,
    angle: input.angle,
    sourceImageUrl: input.sourceImageUrl,
    keyNamespace: input.keyNamespace,
  })
  const copy = validateRecipeCopy(input.copy, input.recipe)
  if (input.budgetCapUsd != null && input.clipUnitCostUsd != null) {
    assertRecipeBudget({
      budgetCapUsd: input.budgetCapUsd,
      maxNewClips: plan.max_new_clips,
      clipUnitCostUsd: input.clipUnitCostUsd,
      recipe: input.recipe,
    })
  }
  const creativeRecipeMeta: Record<string, unknown> = { ...plan.creative_recipe }
  if (typeof input.acknowledgedReviewFeedbackDigest === 'string'
      && input.acknowledgedReviewFeedbackDigest.trim().length > 0) {
    creativeRecipeMeta.acknowledged_review_feedback_digest = input.acknowledgedReviewFeedbackDigest.trim()
  }
  const brief: Record<string, unknown> = {
    segments: plan.segments,
    clip_generation_plan: plan.clip_generation_plan,
    creative_recipe: creativeRecipeMeta,
    creative_profile: input.creativeProfile,
    copy,
    max_new_clips: plan.max_new_clips,
    aspect_ratio: input.aspectRatio ?? '9:16',
    notes: input.notes ?? '',
  }
  if (input.attribution) brief.attribution = input.attribution
  if (typeof input.reviewFeedbackDigest === 'string' && input.reviewFeedbackDigest.trim().length > 0) {
    brief.review_feedback_digest = input.reviewFeedbackDigest.trim()
  }
  return brief
}
