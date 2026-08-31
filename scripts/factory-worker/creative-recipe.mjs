// P21.J.M2 — Content Factory 版本化 winner recipe(合同 5469105522)。worker-side 执行契约。
//
// 与 src/lib/factory/recipe.ts 共享 id/version/segments,由 recipe-shape-agreement.test 逐字段
// 对齐(改一边不改另一边即断)。所有 IO(fs/exec/ffprobe/renderer/muapi)由调用方注入,便于测试。

import { createHash } from 'node:crypto'

export const RECIPE_ID = 'single_image_i2v_pullback_12s'
export const RECIPE_VERSION = 1

/**
 * 权威 recipe descriptor。
 * final duration = 2*5 + 2.7 - 2*0.35 = 12.0(精确到 recipe max_final_dur,无 renderer 兜底裁剪)。
 */
export const WINNER_RECIPES = Object.freeze({
  [RECIPE_ID]: Object.freeze({
    id: RECIPE_ID,
    version: RECIPE_VERSION,
    label: '单图 · 推近 + 拉远 12 秒',
    segments: Object.freeze([
      Object.freeze({
        role: 'hook',
        duration_hint_s: 5.0,
        motion_type: 'push_in',
        camera_action: 'focus / push-in cinematic close-up',
        transition: 'fade',
        prompt_keyword: 'push-in',
      }),
      Object.freeze({
        role: 'cta',
        duration_hint_s: 5.0,
        motion_type: 'pull_back',
        camera_action: 'pull-back / reveal wide cinematic shot',
        transition: 'dissolve',
        prompt_keyword: 'pull-back',
      }),
    ]),
    endcard_dur: 2.7,
    xfade: 0.35,
    min_final_dur: 11.8,
    max_final_dur: 12.0,
    hook_max_words_en: 6,
    hook_max_chars_cjk: 12,
    caption_mode: 'short_big',
    tts_enabled: false,
    kenburns: false,
    // final probe silence 检测(严格 `>`;-60 明显是彻底 muted)
    min_loudness_lufs: -55,
    // BGM 输入门槛严一档:-54 视作太静
    min_bgm_input_loudness_lufs: -50,
    // cta → endcard 的过渡（renderer 支持;必须与 segments[1].transition 同名以保证 receipt 真实）
    endcard_transition: 'dissolve',
  }),
})

export function resolveRecipe(id) {
  return WINNER_RECIPES[id] ?? null
}

/** 时间轴纯函数:与 recipe.ts computeRecipeFinalDuration 对齐,受 shape-agreement test 约束。 */
export function computeRecipeFinalDuration(recipe) {
  const segTotal = recipe.segments.reduce((s, x) => s + x.duration_hint_s, 0)
  return segTotal + recipe.endcard_dur - recipe.segments.length * recipe.xfade
}

/**
 * brief.creative_recipe → recipe descriptor。
 * - 缺 key → null(legacy,worker 走原路径)
 * - 有 key 但 id/version 不合法 → throw(worker 因此 fail-closed,不静默走 legacy)
 */
export function winnerRecipeFromBrief(brief) {
  const meta = brief?.creative_recipe
  if (meta === undefined || meta === null) return null
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('WINNER_RECIPE_CONFIG_INVALID: brief.creative_recipe must be an object')
  }
  const recipe = resolveRecipe(meta.id)
  if (!recipe) {
    throw new Error(`WINNER_RECIPE_CONFIG_INVALID: brief.creative_recipe.id "${String(meta.id)}" unknown`)
  }
  if (meta.version === undefined || meta.version === null) {
    throw new Error('WINNER_RECIPE_CONFIG_INVALID: brief.creative_recipe.version required')
  }
  if (Number(meta.version) !== recipe.version) {
    throw new Error(
      `WINNER_RECIPE_CONFIG_INVALID: brief.creative_recipe.version ${String(meta.version)} != registered v${recipe.version}`,
    )
  }
  return recipe
}

// ── legacy alias 归一化 ─────────────────────────────────────────────────────────

const ALIASES = Object.freeze({
  vo: {
    canonical: 'tts_enabled',
    coerce: (v) => {
      if (typeof v === 'boolean') return v
      throw new Error(`creative_profile alias "vo" 需为 boolean(收到 ${JSON.stringify(v)})`)
    },
  },
  caption_style: {
    canonical: 'caption_mode',
    coerce: (v) => {
      if (typeof v === 'string' && v.trim().length > 0) return v.trim()
      throw new Error(`creative_profile alias "caption_style" 需为非空字符串(收到 ${JSON.stringify(v)})`)
    },
  },
  music_fallback_mood: {
    canonical: 'music_mood',
    coerce: (v) => {
      if (typeof v === 'string' && v.trim().length > 0) return v.trim()
      throw new Error(`creative_profile alias "music_fallback_mood" 需为非空字符串(收到 ${JSON.stringify(v)})`)
    },
  },
})

export function normalizeCreativeProfile(rawProfile) {
  const src = rawProfile && typeof rawProfile === 'object' ? { ...rawProfile } : {}
  const out = { ...src }
  for (const [alias, spec] of Object.entries(ALIASES)) {
    if (!(alias in src)) continue
    const aliasVal = spec.coerce(src[alias])
    if (spec.canonical in out && out[spec.canonical] !== aliasVal) {
      throw new Error(
        `creative_profile 同时包含 alias "${alias}" 与 canonical "${spec.canonical}",但值冲突:` +
        `${JSON.stringify(src[alias])} vs ${JSON.stringify(out[spec.canonical])}`,
      )
    }
    out[spec.canonical] = aliasVal
    delete out[alias]
  }
  return out
}

/**
 * reopened 单只在**显式 marker** `recipe_replan_required=true` 时 fail-closed;
 * legacy 无 recipe 的普通 review 重试路径完全不受此闸约束(R3)。
 * server 端持续兜底:client_recipe_intent 与 brief.creative_recipe 意图不匹配 → 用
 * assertClientIntent 补一层(worker.mjs 处调用)。
 */
export function assertReopenedRecipeReplan(brief) {
  if (!brief || brief.recipe_replan_required !== true) return
  if (winnerRecipeFromBrief(brief) === null) {
    throw new Error(
      'WINNER_RECIPE_REPLAN_REQUIRED: reopened order marked recipe_replan_required but has no compatible structured creative_recipe; refusing to run any provider until server rebuilds the plan',
    )
  }
}

/**
 * 双向 intent 对比(blocker 4)—— TS 侧同款。
 * - 两侧都缺 → legacy 通过
 * - 只有其中一侧带 recipe → fail-closed
 * - 都带但 id/version 对不上 → fail-closed
 */
export function assertClientRecipeIntentMatchesBrief(brief, clientIntent) {
  const meta = brief?.creative_recipe
  const briefHasRecipe = meta != null && typeof meta === 'object'
  if (!clientIntent && !briefHasRecipe) return
  if (!clientIntent && briefHasRecipe) {
    throw new Error(
      `WINNER_RECIPE_REPLAN_REQUIRED: brief carries recipe "${String(meta?.id)}" v${String(meta?.version)} but client currently has no creative_recipe intent; refusing to run stale recipe queued (client took recipe off)`,
    )
  }
  if (clientIntent && !briefHasRecipe) {
    throw new Error(
      `WINNER_RECIPE_REPLAN_REQUIRED: client currently expects recipe "${clientIntent.id}" v${clientIntent.version} but queued brief has no creative_recipe; refusing to run legacy shell for recipe client`,
    )
  }
  if (clientIntent && briefHasRecipe && (meta.id !== clientIntent.id || Number(meta.version) !== clientIntent.version)) {
    throw new Error(
      `WINNER_RECIPE_REPLAN_REQUIRED: client expects recipe "${clientIntent.id}" v${clientIntent.version}, brief has id=${String(meta.id)} v=${String(meta.version)}`,
    )
  }
}

/**
 * R3 硬绑定:review-apply 用它把 feedback 折成 sha256 digest 写进 brief;
 * worker 侧只做 assertion,不重新计算 —— 因为 worker 拿不到 raw feedback text。
 * 与 TS 侧 computeReviewFeedbackDigest 由 recipe-shape-agreement 校验字节对齐。
 */
export function computeReviewFeedbackDigest(text) {
  if (typeof text !== 'string') {
    throw new Error('WINNER_RECIPE_REPLAN_REQUIRED: feedback must be string for digest')
  }
  const t = text.normalize('NFC').trim()
  if (!t) {
    throw new Error('WINNER_RECIPE_REPLAN_REQUIRED: feedback empty; cannot compute digest')
  }
  return createHash('sha256').update(t, 'utf8').digest('hex')
}

/**
 * R3 acknowledgement gate:
 * - 无 review_feedback_digest → 无操作(legacy path 保留)
 * - digest 存在且 creative_recipe.acknowledged_review_feedback_digest 匹配 → 通过
 * - 有 digest 但缺 ack / ack ≠ digest → fail-closed
 */
export function assertRecipeReplanAcknowledged(brief) {
  const digest = brief?.review_feedback_digest
  if (typeof digest !== 'string' || digest.trim().length === 0) return
  const ack = brief?.creative_recipe?.acknowledged_review_feedback_digest
  if (typeof ack !== 'string' || ack !== digest) {
    throw new Error(
      `WINNER_RECIPE_REPLAN_REQUIRED: brief.review_feedback_digest exists but creative_recipe.acknowledged_review_feedback_digest does not match (expected "${digest}", got "${String(ack)}"); refusing to run any provider until server rebuilds the plan against the current feedback`,
    )
  }
}

// ── R6 source-picker(pure fn;evaluate.persistDecision 消费)──────────────────
//
// recipe 路径必须至少有一张真源图。抽成纯函数是为了让「no-source → 真实 rejected」路径
// 无需 mock supabase 就能覆盖。第一个非空 trimmed 字符串命中即选。
export function pickRecipeSourceOrReject(pool, recipe) {
  const arr = Array.isArray(pool) ? pool : []
  for (const raw of arr) {
    if (typeof raw === 'string' && raw.trim().length > 0) return { source: raw.trim() }
  }
  return {
    rejection: `gate_data_unavailable: creative_recipe "${recipe.id}" requires ≥1 client-owned or transformed source image (sourceImagePool empty)`,
  }
}

/**
 * R5 brief completeness gate(pre-provider 双重验证):
 * 保证 claim-critical 字段齐(creative_recipe/copy/segments/plan/max_new_clips/creative_profile
 * / non-placeholder idempotency_key)。plan 结构由 assertRecipePlanShape 承担;此处只补它没
 * 检查的东西 —— hook/CTA、profile、占位符残留。evaluate 在 insert 前调、worker 在 provider
 * 之前再调一次。
 */
export function assertRecipeBriefComplete(brief, recipe) {
  const b = brief && typeof brief === 'object' ? brief : {}
  const meta = b.creative_recipe
  if (!meta || meta.id !== recipe.id || Number(meta.version) !== recipe.version) {
    throw new Error(
      `WINNER_RECIPE_PLAN_INVALID: brief.creative_recipe missing/mismatch (expected ${recipe.id} v${recipe.version})`,
    )
  }
  const copy = b.copy
  const hookOk = copy && typeof copy.hook === 'string' && copy.hook.trim().length > 0
  const ctaOk = copy && typeof copy.cta === 'string' && copy.cta.trim().length > 0
  if (!hookOk || !ctaOk) {
    throw new Error(
      'WINNER_RECIPE_PLAN_INVALID: brief.copy.hook / cta missing (recipe brief must be shape-complete before insert)',
    )
  }
  if (!('creative_profile' in b) || typeof b.creative_profile !== 'object' || b.creative_profile === null) {
    throw new Error('WINNER_RECIPE_PLAN_INVALID: brief.creative_profile missing')
  }
  assertRecipePlanShape(brief, recipe)
  const plan = Array.isArray(b.clip_generation_plan) ? b.clip_generation_plan : []
  for (let i = 0; i < plan.length; i++) {
    const key = String(plan[i]?.idempotency_key ?? '')
    if (key.includes('{work_order_id}') || key.includes('{signal_id}')) {
      throw new Error(
        `WINNER_RECIPE_PLAN_INVALID: plan[${i}].idempotency_key still holds a placeholder ("${key}"); brief was not shape-completed before insert (R5 race window)`,
      )
    }
  }
}

/**
 * plan validator:段数/role/duration/transition/motion/prompt-keyword/same source/unique keys
 * /zero inventory clip_ids/max_new_clips。任何字段偏离 recipe 契约即拒。
 */
export function assertRecipePlanShape(brief, recipe) {
  const segments = Array.isArray(brief?.segments) ? brief.segments : []
  if (segments.length !== recipe.segments.length) {
    throw new Error(
      `WINNER_RECIPE_PLAN_INVALID: expected ${recipe.segments.length} segments, got ${segments.length}`,
    )
  }
  for (let i = 0; i < recipe.segments.length; i++) {
    const seg = segments[i]
    const spec = recipe.segments[i]
    if (!seg || seg.role !== spec.role) {
      throw new Error(`WINNER_RECIPE_PLAN_INVALID: segment[${i}].role expected "${spec.role}"`)
    }
    if (seg.duration_hint_s !== spec.duration_hint_s) {
      throw new Error(
        `WINNER_RECIPE_PLAN_INVALID: segment[${i}].duration_hint_s expected ${spec.duration_hint_s}`,
      )
    }
    if (seg.transition !== undefined && seg.transition !== spec.transition) {
      throw new Error(
        `WINNER_RECIPE_PLAN_INVALID: segment[${i}].transition must be "${spec.transition}" (recipe-locked)`,
      )
    }
    if (Array.isArray(seg.clip_ids) && seg.clip_ids.length > 0) {
      throw new Error(`WINNER_RECIPE_PLAN_INVALID: segment[${i}] must not reference inventory clip_ids`)
    }
  }
  const plan = Array.isArray(brief?.clip_generation_plan) ? brief.clip_generation_plan : []
  if (plan.length !== recipe.segments.length) {
    throw new Error(
      `WINNER_RECIPE_PLAN_INVALID: clip_generation_plan expected ${recipe.segments.length} entries, got ${plan.length}`,
    )
  }
  const firstSource = plan[0]?.source_image_url
  if (typeof firstSource !== 'string' || firstSource.trim().length === 0) {
    throw new Error('WINNER_RECIPE_PLAN_INVALID: source_image_url missing/empty on first plan entry')
  }
  const seen = new Set()
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i]
    const spec = recipe.segments[i]
    if (p.segment_role !== spec.role) {
      throw new Error(`WINNER_RECIPE_PLAN_INVALID: plan[${i}].segment_role expected "${spec.role}"`)
    }
    if (p.position !== i) {
      throw new Error(`WINNER_RECIPE_PLAN_INVALID: plan[${i}].position expected ${i}`)
    }
    if (p.source_image_url !== firstSource) {
      throw new Error(`WINNER_RECIPE_PLAN_INVALID: plan[${i}] must reuse the same source_image_url`)
    }
    if (p.motion_type !== spec.motion_type) {
      throw new Error(
        `WINNER_RECIPE_PLAN_INVALID: plan[${i}].motion_type expected "${spec.motion_type}"`,
      )
    }
    if (p.requires_source_resolution !== false) {
      throw new Error(
        `WINNER_RECIPE_PLAN_INVALID: plan[${i}].requires_source_resolution must be false`,
      )
    }
    const prompt = String(p.prompt_hint ?? '').toLowerCase()
    if (!prompt.includes(spec.prompt_keyword)) {
      throw new Error(
        `WINNER_RECIPE_PLAN_INVALID: plan[${i}].prompt_hint missing camera action "${spec.prompt_keyword}"`,
      )
    }
    const key = String(p.idempotency_key ?? '')
    if (!key) throw new Error(`WINNER_RECIPE_PLAN_INVALID: plan[${i}].idempotency_key missing`)
    if (seen.has(key)) throw new Error(`WINNER_RECIPE_PLAN_INVALID: duplicate idempotency_key "${key}"`)
    seen.add(key)
  }
  if (Number(brief?.max_new_clips) !== recipe.segments.length) {
    throw new Error(
      `WINNER_RECIPE_PLAN_INVALID: max_new_clips expected ${recipe.segments.length}, got ${String(brief?.max_new_clips)}`,
    )
  }
}

/** 组合 recipe 的强约束校验:tts=false / kenburns=false / caption_mode 一致。 */
export function assertRecipeProfileConstraints(profile, recipe) {
  if (profile.tts_enabled === true) {
    throw new Error('WINNER_RECIPE_TTS_FORBIDDEN: recipe forbids TTS but profile enables it (vo/tts_enabled=true)')
  }
  if (profile.kenburns === true) {
    throw new Error('WINNER_RECIPE_MOTION_FORBIDDEN: recipe forbids Ken Burns but profile enables it')
  }
  if (typeof profile.caption_mode === 'string' && profile.caption_mode.trim() &&
      profile.caption_mode.trim() !== recipe.caption_mode) {
    throw new Error(
      `WINNER_RECIPE_CAPTION_MODE_MISMATCH: recipe requires "${recipe.caption_mode}", profile has "${profile.caption_mode}"`,
    )
  }
}

// ── 结构化文案(R9) ───────────────────────────────────────────────────────────

const WORKER_EMOJI_RE = /[\p{Extended_Pictographic}]/u
function workerIsCjk(text) {
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length
  const en = (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length
  return cjk > en
}
function workerCountGraphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    let n = 0
    // eslint-disable-next-line no-unused-vars
    for (const _ of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) n++
    return n
  }
  return Array.from(text).length
}

export function validateRecipeCopy(input, recipe) {
  if (!input || typeof input !== 'object') {
    throw new Error('WINNER_RECIPE_COPY_INVALID: copy missing')
  }
  const pick = (v, name) => {
    if (typeof v !== 'string') throw new Error(`WINNER_RECIPE_COPY_INVALID: ${name} must be string`)
    const t = v.trim()
    if (t.length === 0) throw new Error(`WINNER_RECIPE_COPY_INVALID: ${name} empty`)
    if (/[\r\n]/.test(t)) throw new Error(`WINNER_RECIPE_COPY_INVALID: ${name} must be single-line`)
    if (WORKER_EMOJI_RE.test(t)) throw new Error(`WINNER_RECIPE_COPY_INVALID: ${name} contains emoji`)
    if (/^[\s\p{P}\p{S}\d]+$/u.test(t)) {
      throw new Error(`WINNER_RECIPE_COPY_INVALID: ${name} numeric/punct-only`)
    }
    return t
  }
  const hook = pick(input.hook, 'hook')
  const cta = pick(input.cta, 'cta')
  if (hook.toLowerCase() === cta.toLowerCase()) {
    throw new Error('WINNER_RECIPE_COPY_INVALID: hook and cta must differ')
  }
  if (Array.isArray(input.segments) && input.segments.length > 0) {
    throw new Error('WINNER_RECIPE_COPY_INVALID: recipe forbids segment-array copy')
  }
  const endcard = input.endcard
  if (endcard && (endcard.vo != null || endcard.offer != null || endcard.url != null)) {
    throw new Error('WINNER_RECIPE_COPY_INVALID: recipe forbids endcard extras (vo/offer/url)')
  }
  for (const [t, name] of [[hook, 'hook'], [cta, 'cta']]) {
    if (workerIsCjk(t)) {
      const n = workerCountGraphemes(t)
      if (n > recipe.hook_max_chars_cjk) {
        throw new Error(
          `WINNER_RECIPE_COPY_INVALID: ${name} exceeds ${recipe.hook_max_chars_cjk} CJK graphemes ("${t}")`,
        )
      }
    } else {
      const w = (t.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length
      if (w > recipe.hook_max_words_en) {
        throw new Error(
          `WINNER_RECIPE_COPY_INVALID: ${name} exceeds ${recipe.hook_max_words_en} EN words ("${t}")`,
        )
      }
    }
  }
  return { hook, cta }
}

// ── BGM(R10):music_library.json + profile.music_pool + 响度探测 ─────────────

/**
 * 解析 recipe BGM(blocker 7 强化):
 * - client-config 只能填**相对文件名**(必须在 sharedMusicDir 下),绝对路径 / `..` / `/` 前缀一律拒
 * - profile.music_pool 每条 = basename 相对文件名
 * - profile.music 单曲同样是 basename
 * - profile.music_mood 从 musicLibrary allowlist 查(id → file)
 * - 命中候选后要 existsFn 且 loudness > minLoudnessLufs（严格 `>`）
 * - 找不到 = throw WINNER_RECIPE_BGM_MISSING（不发明 canonical 文件名，不静默兜底）
 * 返回 { absPath, portableId, source: 'library'|'pool', loudnessLufs }。
 */
function assertRelativeMusicName(raw, field) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`WINNER_RECIPE_BGM_MISSING: ${field} must be non-empty string`)
  }
  const s = raw.trim()
  // 绝对路径（POSIX 或 Windows drive）
  if (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)) {
    throw new Error(
      `WINNER_RECIPE_BGM_MISSING: ${field} "${s}" must be a relative filename under shared music root (absolute paths refused)`,
    )
  }
  // 路径穿越
  if (s.includes('..') || s.includes('\\')) {
    throw new Error(
      `WINNER_RECIPE_BGM_MISSING: ${field} "${s}" must not contain path-traversal ('..' or '\\\\')`,
    )
  }
  return s
}

export function resolveRecipeBgm({
  profile,
  sharedMusicDir,
  musicLibrary = null,
  existsFn,
  probeLoudnessLufsFn,
  joinFn,
  minLoudnessLufs,
}) {
  const candidates = []
  // 1) profile.music_pool(每条 = 相对 basename;绝对路径拒收)
  if (Array.isArray(profile?.music_pool)) {
    for (const s of profile.music_pool) {
      const relOrNull = (() => {
        try { return assertRelativeMusicName(s, 'profile.music_pool[]') } catch { return null }
      })()
      if (relOrNull != null) {
        candidates.push({
          abs: joinFn(sharedMusicDir, relOrNull),
          portableId: basename(relOrNull),
          source: 'pool',
        })
      } else if (typeof s === 'string' && s.trim().length > 0) {
        // 绝对路径直接抛（不静默跳过 —— 让 PM 看到配置错误）
        assertRelativeMusicName(s, 'profile.music_pool[]')
      }
    }
  }
  // 显式 music 也走 pool 语义(单曲 pool),同样必须相对 basename
  if (typeof profile?.music === 'string' && profile.music.trim()) {
    const rel = assertRelativeMusicName(profile.music, 'profile.music')
    candidates.push({ abs: joinFn(sharedMusicDir, rel), portableId: basename(rel), source: 'pool' })
  }
  // 2) music_library.json 按 mood(仅当调用方提供了 library)
  if (musicLibrary && typeof profile?.music_mood === 'string' && profile.music_mood.trim()) {
    const mood = profile.music_mood.trim()
    const entries = musicLibrary[mood] ?? musicLibrary?.moods?.[mood] ?? null
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(
        `WINNER_RECIPE_BGM_MISSING: music_library 没有 mood "${mood}" 的 allowlist(不再兜底 canonical 文件名)`,
      )
    }
    for (const e of entries) {
      const raw = typeof e === 'string' ? e : e?.file
      const id = typeof e === 'string' ? basename(e) : e?.id ?? basename(String(raw))
      if (typeof raw === 'string' && raw.trim().length > 0) {
        // library entries 也必须 relative（studio 侧维护的 allowlist,不接受绝对路径）
        const rel = assertRelativeMusicName(raw, 'musicLibrary[].file')
        candidates.push({ abs: joinFn(sharedMusicDir, rel), portableId: id, source: 'library' })
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      'WINNER_RECIPE_BGM_MISSING: no music_pool / music / music_mood configured for recipe',
    )
  }
  for (const c of candidates) {
    if (!existsFn(c.abs)) continue
    const lufs = probeLoudnessLufsFn(c.abs)
    if (!Number.isFinite(lufs)) continue
    if (lufs <= minLoudnessLufs) continue
    return { absPath: c.abs, portableId: c.portableId, source: c.source, loudnessLufs: lufs }
  }
  throw new Error(
    `WINNER_RECIPE_BGM_MISSING: no candidate passed exist+loudness (>${minLoudnessLufs} LUFS) check`,
  )
}

function basename(p) {
  const s = String(p)
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

// ── make_promo capability gates(R11) ─────────────────────────────────────────

/**
 * 语义字段检查(次要):确认 make_promo.py 源码里出现 recipe 需要的字段名。
 * 只作为文档级 sanity;真实批准由下面 SHA gate 承担。
 */
export const REQUIRED_MAKE_PROMO_TOKENS = Object.freeze([
  'caption_mode',
  'endcard_dur',
  'transition',
  'music',
  'motion',
])

export function makePromoPreflight({ path, readFn, requiredTokens = REQUIRED_MAKE_PROMO_TOKENS }) {
  let src
  try {
    src = readFn(path)
  } catch (e) {
    throw new Error(`WINNER_RECIPE_MAKE_PROMO_UNSUPPORTED: cannot read make_promo.py at ${path}: ${e?.message ?? e}`)
  }
  const missing = requiredTokens.filter((t) => !src.includes(t))
  if (missing.length > 0) {
    throw new Error(
      `WINNER_RECIPE_MAKE_PROMO_UNSUPPORTED: make_promo.py missing recipe-required tokens: ${missing.join(', ')} (at ${path})`,
    )
  }
}

/**
 * 主批准闸(R11):recipe 路径必须匹配 approved SHA-256 白名单。
 * approvedShas 来自 env(FACTORY_RECIPE_APPROVED_MAKE_PROMO_SHA256,逗号分隔多个)。
 * 缺 env / 计算 SHA 失败 / 不匹配 → 全部 fail-closed,禁止跑 recipe。
 */
export function assertRendererApproved({
  path,
  approvedShas,
  hashFn,
}) {
  if (!Array.isArray(approvedShas) || approvedShas.length === 0) {
    throw new Error(
      'WINNER_RECIPE_RENDERER_UNAPPROVED: FACTORY_RECIPE_APPROVED_MAKE_PROMO_SHA256 未配置,拒绝跑 recipe',
    )
  }
  let actual
  try {
    actual = hashFn(path)
  } catch (e) {
    throw new Error(
      `WINNER_RECIPE_RENDERER_UNAPPROVED: hash 计算失败 at ${path}: ${e?.message ?? e}`,
    )
  }
  if (typeof actual !== 'string' || actual.length !== 64) {
    throw new Error(`WINNER_RECIPE_RENDERER_UNAPPROVED: unexpected hash "${String(actual)}"`)
  }
  const cleaned = approvedShas.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
  const lower = actual.toLowerCase()
  if (!cleaned.includes(lower)) {
    throw new Error(
      `WINNER_RECIPE_RENDERER_UNAPPROVED: make_promo.py sha256 ${lower} 不在白名单 (${cleaned.join(', ')})`,
    )
  }
}

// ── final 校验:duration + loudness(R10/R12) ────────────────────────────────

export function verifyFinalMedia({ path, recipe, ffprobeFn }) {
  const info = ffprobeFn(path)
  const duration = Number(info?.duration)
  if (!Number.isFinite(duration) || duration < recipe.min_final_dur || duration > recipe.max_final_dur) {
    throw new Error(
      `WINNER_RECIPE_DURATION_INVALID: final duration ${duration}s ∉ [${recipe.min_final_dur}, ${recipe.max_final_dur}]s (at ${path})`,
    )
  }
  const lufs = Number(info?.loudnessLufs)
  // final probe 阈值仍是 min_loudness_lufs（-55）—— silence detection;BGM 输入门槛见 resolveRecipeBgm
  if (!Number.isFinite(lufs) || lufs <= recipe.min_loudness_lufs) {
    throw new Error(
      `WINNER_RECIPE_LOUDNESS_INVALID: final loudness ${lufs} LUFS ≤ ${recipe.min_loudness_lufs} (视作静音,at ${path})`,
    )
  }
  return { duration, loudnessLufs: lufs }
}

// ── budget gate(R7) ─────────────────────────────────────────────────────────

/** blocker 5:所有 budget 数字必须 finite 且非负;NaN / Infinity / 负数直接抛 */
export function assertBudgetFiniteNonNeg(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `WINNER_RECIPE_BUDGET_INSUFFICIENT: ${field} must be finite non-negative number, got ${String(value)}`,
    )
  }
  return value
}

export function assertRecipeBudget({ budgetCapUsd, maxNewClips, clipUnitCostUsd, recipe }) {
  const cap = assertBudgetFiniteNonNeg(budgetCapUsd, 'budgetCapUsd')
  const unit = assertBudgetFiniteNonNeg(clipUnitCostUsd, 'clipUnitCostUsd')
  if (typeof maxNewClips !== 'number' || !Number.isInteger(maxNewClips) || maxNewClips < 0) {
    throw new Error(
      `WINNER_RECIPE_BUDGET_INSUFFICIENT: maxNewClips must be finite non-negative integer, got ${String(maxNewClips)}`,
    )
  }
  if (maxNewClips < recipe.segments.length) {
    throw new Error(
      `WINNER_RECIPE_BUDGET_INSUFFICIENT: brief.max_new_clips=${maxNewClips} < recipe.segments=${recipe.segments.length}`,
    )
  }
  const projectedCostUsd = unit * recipe.segments.length
  if (projectedCostUsd > cap) {
    throw new Error(
      `WINNER_RECIPE_BUDGET_INSUFFICIENT: projected $${projectedCostUsd.toFixed(3)} > budget_cap $${cap.toFixed(2)}`,
    )
  }
  return { projectedCostUsd }
}

export function assertPerCallBudget({ nextCallCostUsd, alreadySpentUsd, budgetCapUsd }) {
  const cap = assertBudgetFiniteNonNeg(budgetCapUsd, 'budgetCapUsd')
  const spent = assertBudgetFiniteNonNeg(alreadySpentUsd, 'alreadySpentUsd')
  const next = assertBudgetFiniteNonNeg(nextCallCostUsd, 'nextCallCostUsd')
  const cum = spent + next
  if (cum > cap) {
    throw new Error(
      `WINNER_RECIPE_BUDGET_INSUFFICIENT: cumulative $${cum.toFixed(3)} would exceed budget_cap $${cap.toFixed(2)}`,
    )
  }
}

// ── assemble config / executed receipt ────────────────────────────────────────

/**
 * assemble config(blocker 6:renderer transition-INTO 语义 + 显式 endcard_transition):
 * - segments[i].transition (i>0) = 前一段的 transition（渲染时"入 i" = 上一段"出到 i"）
 *   recipe.segments[k].transition 语义为"从段 k 出场（即入下一段/endcard）"，所以
 *   segments[i>0].transition = recipe.segments[i-1].transition。
 * - endcard.transition = recipe.endcard_transition（= 最后一段的 out transition，同名 dissolve）
 * - motion:false（recipe 禁 Ken Burns）· caption_mode 由 recipe 权威
 */
export function buildRecipeAssembleConfig({
  recipe,
  localPaths,
  hookText,
  ctaText,
  bgmAbsPath,
  brandKit,
  outputPath,
  profile,
}) {
  if (!Array.isArray(localPaths) || localPaths.length !== recipe.segments.length) {
    throw new Error(
      `WINNER_RECIPE_ASSEMBLE_INVALID: localPaths count ${localPaths?.length} != recipe segments ${recipe.segments.length}`,
    )
  }
  const segments = recipe.segments.map((s, i) => ({
    src: localPaths[i],
    ss: 0,
    dur: s.duration_hint_s,
    motion_type: s.motion_type,
    ...(i === 0 ? { caption: hookText } : {}),
    // 首段无「入场 transition」;后续段的 transition = 上一段的 out（真实入场切法）
    ...(i === 0 ? {} : { transition: recipe.segments[i - 1].transition }),
  }))
  return {
    output: outputPath,
    brand_kit: brandKit,
    music: bgmAbsPath,
    caption_mode: recipe.caption_mode,
    motion: false,
    xfade: recipe.xfade,
    endcard_dur: recipe.endcard_dur,
    ...(profile?.look ? { look: profile.look } : {}),
    ...(profile?.endcard_panel != null ? { endcard_panel: profile.endcard_panel } : {}),
    segments,
    // endcard.transition = renderer 支持的入场切法(=最后一段 out 的同名值)
    endcard: { cta: ctaText, transition: recipe.endcard_transition },
    recipe: { id: recipe.id, version: recipe.version },
  }
}

/**
 * receipt payload:reflect **真实探测** 数据,不再上传 raw brief.segments。
 * 每段带 provider evidence + actual_duration_s;音乐用 portable id;final 用探测值。
 */
export function buildExecutedReceipt({ recipe, hookText, ctaText, sourceImageUrl, executed, music, final }) {
  return {
    recipe: { id: recipe.id, version: recipe.version },
    motion: false,
    tts: false,
    segments: recipe.segments.map((s, i) => ({
      role: s.role,
      planned_duration_s: s.duration_hint_s,
      actual_duration_s: executed[i]?.actual_duration_s ?? s.duration_hint_s,
      motion_type: s.motion_type,
      camera_action: s.camera_action,
      transition_out: s.transition,
      clip_source: 'ai_i2v',
      source_image_url: sourceImageUrl,
      provider: {
        name: executed[i]?.provider ?? 'muapi',
        request_id: executed[i]?.request_id ?? '',
      },
      caption: i === 0 ? hookText : '',
    })),
    endcard: {
      planned_duration_s: recipe.endcard_dur,
      cta: ctaText,
      // blocker 6:receipt 真实反映 assemble config 里的入场切法（不许声称"没用过"的过渡）
      transition_in: recipe.endcard_transition,
    },
    music: { id: music.portableId, source: music.source, loudness_lufs: music.loudnessLufs },
    xfade: recipe.xfade,
    final: { duration_s: final.duration, loudness_lufs: final.loudnessLufs },
  }
}

/** SRT 只对 hook 段出一条字幕。 */
export function buildExecutedSrt({ recipe, hookText }) {
  const dur = recipe.segments[0].duration_hint_s
  const fmt = (s) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0')
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const ss = String(Math.floor(s % 60)).padStart(2, '0')
    const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0')
    return `${h}:${m}:${ss},${ms}`
  }
  return `1\n${fmt(0)} --> ${fmt(dur)}\n${hookText}\n\n`
}

/**
 * server-side planner(与 recipe.ts buildRecipePlan 对齐;由 shape-agreement 校验)。
 */
export function buildRecipePlan({ recipe, angle, sourceImageUrl, keyNamespace }) {
  if (typeof sourceImageUrl !== 'string' || sourceImageUrl.trim().length === 0) {
    throw new Error('WINNER_RECIPE_SOURCE_MISSING: planner requires a concrete source image URL')
  }
  const ns = typeof keyNamespace === 'string' ? keyNamespace.trim() : ''
  if (!ns) {
    throw new Error(
      'WINNER_RECIPE_PLAN_INVALID: buildRecipePlan requires a non-empty keyNamespace (R5)',
    )
  }
  const trimmed = sourceImageUrl.trim()
  const safeAngle = typeof angle === 'string' && angle.trim() ? angle.trim() : 'brand-story'
  const woToken = ns
  const segments = recipe.segments.map((s) => ({
    role: s.role,
    duration_hint_s: s.duration_hint_s,
    description: `${s.role} — ${s.camera_action} (${recipe.id})`,
    clip_ids: [],
    transition: s.transition,
  }))
  const clip_generation_plan = recipe.segments.map((s, i) => ({
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

// ── receipt validator(R12)——TS 侧 assertRecipeReceipt 的等价实现 ─────────────
//
// 两侧字段级一致由 recipe-shape-agreement.test.ts 的对抗性用例强制:
// 恶意 actual_duration、缺 provider 证据、篡改 transition、非法 music/final loudness
// 都必须被 TS 与 MJS 同时拒。worker.mjs 直接 import 本函数,不再动态加载 TS 源码。
export function assertRecipeReceipt(payload, recipe) {
  const fail = (m) => { throw new Error(`WINNER_RECIPE_PLAN_INVALID: ${m}`) }
  if (!payload || typeof payload !== 'object') fail('receipt payload is not an object')
  const rec = payload
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
    if (typeof s.actual_duration_s !== 'number'
      || Math.abs(s.actual_duration_s - spec.duration_hint_s) > 0.6) {
      fail(`receipt.segments[${i}].actual_duration_s off contract`)
    }
    if (!s.provider
      || typeof s.provider.name !== 'string' || s.provider.name.trim().length === 0
      || typeof s.provider.request_id !== 'string' || s.provider.request_id.trim().length === 0) {
      fail(`receipt.segments[${i}].provider evidence missing`)
    }
    if (s.transition_out !== spec.transition) {
      fail(`receipt.segments[${i}].transition_out expected "${spec.transition}"`)
    }
  }
  if (!rec.endcard || rec.endcard.planned_duration_s !== recipe.endcard_dur) {
    fail('receipt.endcard.planned_duration_s mismatch')
  }
  // blocker 6:endcard.transition_in 必须 == recipe.endcard_transition
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
  // blocker 7:BGM 输入用更严门槛(严格 `>` recipe.min_bgm_input_loudness_lufs;-54 拒);finite
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

// ── ffmpeg ebur128 纯解析(R10) ──────────────────────────────────────────────
//
// ffmpeg 的 ebur128 摘要写在 stderr(即便退出码是 0)。用 execFileSync 时若没显式
// 捕获 stderr 会看不到 Integrated loudness → 全跌到 -70 兜底,让本该通过的音频被
// 误判为静音。把解析提出来成为纯函数,worker.mjs 用 spawnSync 显式抓 stderr 后再交给它。
export function parseLufsFromEbur128(text) {
  const s = String(text || '')
  const m = s.match(/Integrated loudness:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/)
  return m ? Number(m[1]) : null
}

export const RECIPE_INTERNAL = Object.freeze({
  ALIASES,
})
