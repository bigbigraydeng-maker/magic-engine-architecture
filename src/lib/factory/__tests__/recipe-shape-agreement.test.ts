// TS/MJS 双侧 registry / plan / timeline 必须字段级一致 —— 改一边不改另一边即断(R13)。
// 直接从 mjs 侧 import(vitest 允许);对齐字段:id、version、caption_mode、tts_enabled、kenburns、
// endcard_dur、xfade、min/max_final_dur、hook_max_words_en、hook_max_chars_cjk、min_loudness_lufs、
// segments 每段:role/duration_hint_s/motion_type/transition/prompt_keyword。

import { describe, expect, it } from 'vitest'
import {
  assertRecipeBriefComplete as tsAssertRecipeBriefComplete,
  assertRecipeReplanAcknowledged as tsAssertRecipeReplanAcknowledged,
  buildFullRecipeBrief as tsBuildFullRecipeBrief,
  buildRecipePlan as tsBuildRecipePlan,
  computeRecipeFinalDuration as tsComputeDuration,
  computeReviewFeedbackDigest as tsComputeDigest,
  pickRecipeSourceOrReject as tsPickSource,
  resolveRecipe as tsResolveRecipe,
  WINNER_RECIPE_IDS,
} from '../recipe'
import {
  RECIPE_ID as mjsId,
  RECIPE_VERSION as mjsVersion,
  assertRecipeBriefComplete as mjsAssertRecipeBriefComplete,
  assertRecipeReceipt as mjsAssertRecipeReceipt,
  assertRecipeReplanAcknowledged as mjsAssertRecipeReplanAcknowledged,
  buildRecipePlan as mjsBuildRecipePlan,
  computeRecipeFinalDuration as mjsComputeDuration,
  computeReviewFeedbackDigest as mjsComputeDigest,
  pickRecipeSourceOrReject as mjsPickSource,
  resolveRecipe as mjsResolveRecipe,
  WINNER_RECIPES as mjsRegistry,
} from '../../../../scripts/factory-worker/creative-recipe.mjs'
import { assertRecipeReceipt as tsAssertRecipeReceipt } from '../recipe'

describe('shape agreement — TS vs MJS registry(R13)', () => {
  it('id / version 一致', () => {
    expect(mjsId).toBe('single_image_i2v_pullback_12s')
    expect(mjsVersion).toBe(1)
    expect(WINNER_RECIPE_IDS).toContain(mjsId)
  })
  it('recipe descriptor 全字段一致', () => {
    const t = tsResolveRecipe(mjsId)!
    const m = mjsResolveRecipe(mjsId)
    expect(t.id).toBe(m.id)
    expect(t.version).toBe(m.version)
    expect(t.endcard_dur).toBe(m.endcard_dur)
    expect(t.xfade).toBe(m.xfade)
    expect(t.min_final_dur).toBe(m.min_final_dur)
    expect(t.max_final_dur).toBe(m.max_final_dur)
    expect(t.caption_mode).toBe(m.caption_mode)
    expect(t.tts_enabled).toBe(m.tts_enabled)
    expect(t.kenburns).toBe(m.kenburns)
    expect(t.hook_max_words_en).toBe(m.hook_max_words_en)
    expect(t.hook_max_chars_cjk).toBe(m.hook_max_chars_cjk)
    expect(t.min_loudness_lufs).toBe(m.min_loudness_lufs)
    expect(t.segments.length).toBe(m.segments.length)
    for (let i = 0; i < t.segments.length; i++) {
      const ts = t.segments[i]
      const ms = m.segments[i]
      expect(ts.role).toBe(ms.role)
      expect(ts.duration_hint_s).toBe(ms.duration_hint_s)
      expect(ts.motion_type).toBe(ms.motion_type)
      expect(ts.camera_action).toBe(ms.camera_action)
      expect(ts.transition).toBe(ms.transition)
      expect(ts.prompt_keyword).toBe(ms.prompt_keyword)
    }
  })
  it('mjs registry 键集 = WINNER_RECIPE_IDS', () => {
    expect(Object.keys(mjsRegistry).sort()).toEqual([...WINNER_RECIPE_IDS].sort())
  })
  it('两侧 buildRecipePlan 在相同输入下产出完全一致的 plan', () => {
    const recipe = tsResolveRecipe('single_image_i2v_pullback_12s')!
    const source = 'https://cdn.example.com/x.jpg'
    const ns = 'sig_agreement'
    const t = tsBuildRecipePlan({ recipe, angle: 'brand story', sourceImageUrl: source, keyNamespace: ns })
    const m = mjsBuildRecipePlan({ recipe: mjsResolveRecipe('single_image_i2v_pullback_12s'), angle: 'brand story', sourceImageUrl: source, keyNamespace: ns })
    expect(t.segments).toEqual(m.segments)
    expect(t.clip_generation_plan).toEqual(m.clip_generation_plan)
    expect(t.creative_recipe).toEqual(m.creative_recipe)
    expect(t.max_new_clips).toBe(m.max_new_clips)
  })
  it('两侧 computeRecipeFinalDuration 精确 12.0', () => {
    const recipe = tsResolveRecipe('single_image_i2v_pullback_12s')!
    expect(Math.round(tsComputeDuration(recipe) * 1000) / 1000).toBe(12.0)
    expect(Math.round(mjsComputeDuration(mjsResolveRecipe('single_image_i2v_pullback_12s')) * 1000) / 1000).toBe(12.0)
  })
})

// ── receipt validator 双侧对抗性一致(worker.mjs 直接 import mjs 侧,TS 侧兜生产 API)─
describe('assertRecipeReceipt — TS/MJS 对抗性一致', () => {
  const RECIPE = tsResolveRecipe('single_image_i2v_pullback_12s')!
  const SOURCE = 'https://cdn.example.com/hero.jpg'
  const goodReceipt = () => ({
    recipe: { id: RECIPE.id, version: RECIPE.version },
    motion: false,
    tts: false,
    segments: [
      {
        role: 'hook', planned_duration_s: 5, actual_duration_s: 5.02,
        motion_type: 'push_in', camera_action: RECIPE.segments[0].camera_action,
        transition_out: RECIPE.segments[0].transition, clip_source: 'ai_i2v',
        source_image_url: SOURCE, provider: { name: 'muapi', request_id: 'req-1' }, caption: 'Hook',
      },
      {
        role: 'cta', planned_duration_s: 5, actual_duration_s: 5.01,
        motion_type: 'pull_back', camera_action: RECIPE.segments[1].camera_action,
        transition_out: RECIPE.segments[1].transition, clip_source: 'ai_i2v',
        source_image_url: SOURCE, provider: { name: 'muapi', request_id: 'req-2' }, caption: '',
      },
    ],
    endcard: { planned_duration_s: RECIPE.endcard_dur, cta: 'Book now', transition_in: RECIPE.endcard_transition },
    music: { id: 'epic_a.mp3', source: 'library', loudness_lufs: -20 },
    xfade: RECIPE.xfade,
    final: { duration_s: 12.0, loudness_lufs: -18 },
  })
  const mjsRecipe = mjsResolveRecipe('single_image_i2v_pullback_12s')

  const expectBothPass = (r: ReturnType<typeof goodReceipt>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => tsAssertRecipeReceipt(r as any, RECIPE)).not.toThrow()
    expect(() => mjsAssertRecipeReceipt(r, mjsRecipe)).not.toThrow()
  }
  const expectBothReject = (r: ReturnType<typeof goodReceipt>, pattern: RegExp) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => tsAssertRecipeReceipt(r as any, RECIPE)).toThrow(pattern)
    expect(() => mjsAssertRecipeReceipt(r, mjsRecipe)).toThrow(pattern)
  }

  it('good receipt → 两侧都通过', () => {
    expectBothPass(goodReceipt())
  })
  it('actual_duration_s 偏差 > 0.6s → 两侧都拒(planned 冒充 actual 防御)', () => {
    const r = goodReceipt()
    r.segments[0].actual_duration_s = 3.0
    expectBothReject(r, /actual_duration_s/)
  })
  it('actual_duration_s 非数字 → 两侧都拒', () => {
    const r = goodReceipt()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(r.segments[1] as any).actual_duration_s = null
    expectBothReject(r, /actual_duration_s/)
  })
  it('provider 证据空字符串 → 两侧都拒', () => {
    const r = goodReceipt()
    r.segments[0].provider = { name: '', request_id: '' }
    expectBothReject(r, /provider/)
  })
  it('provider 缺 request_id → 两侧都拒', () => {
    const r = goodReceipt()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(r.segments[1] as any).provider = { name: 'muapi' }
    expectBothReject(r, /provider/)
  })
  it('transition_out 被覆盖成非 recipe 值 → 两侧都拒', () => {
    const r = goodReceipt()
    r.segments[1].transition_out = 'wipeleft'
    expectBothReject(r, /transition_out/)
  })
  it('music.id 是绝对路径 → 两侧都拒(必须 portable)', () => {
    const r = goodReceipt()
    r.music = { id: '/abs/path.mp3', source: 'library', loudness_lufs: -20 }
    expectBothReject(r, /portable/)
  })
  it('music.loudness_lufs ≤ 阈值 → 两侧都拒', () => {
    const r = goodReceipt()
    r.music = { id: 'epic_a.mp3', source: 'library', loudness_lufs: -60 }
    expectBothReject(r, /music\.loudness_lufs/)
  })
  it('final.loudness_lufs ≤ 阈值 → 两侧都拒(视作静音)', () => {
    const r = goodReceipt()
    r.final = { duration_s: 12.0, loudness_lufs: -60 }
    expectBothReject(r, /final\.loudness_lufs/)
  })
  it('final.duration_s 略超 max_final_dur → 两侧都拒', () => {
    const r = goodReceipt()
    r.final = { duration_s: 12.05, loudness_lufs: -18 }
    expectBothReject(r, /final\.duration_s/)
  })
  it('motion=true / tts=true → 两侧都拒', () => {
    const r1 = goodReceipt()
    ;(r1 as { motion: unknown }).motion = true
    expectBothReject(r1, /motion/)
    const r2 = goodReceipt()
    ;(r2 as { tts: unknown }).tts = true
    expectBothReject(r2, /tts/)
  })
})

// ── R3/R5/R6 新助手在 TS/MJS 之间的字节级 + 行为级对齐 ─────────────────────
describe('computeReviewFeedbackDigest — TS/MJS 字节级一致(R3)', () => {
  it('同一字符串 → 相同 64 hex digest', () => {
    for (const raw of ['画面太慢', 'Book now was blurry', '  混合  空格 ', 'a']) {
      expect(tsComputeDigest(raw)).toBe(mjsComputeDigest(raw))
      expect(tsComputeDigest(raw)).toMatch(/^[0-9a-f]{64}$/)
    }
  })
  it('空 / 非字符串 → 两侧都拒', () => {
    for (const bad of ['', '   ', null, undefined]) {
      expect(() => tsComputeDigest(bad as unknown as string)).toThrow()
      expect(() => mjsComputeDigest(bad)).toThrow()
    }
  })
})

describe('assertRecipeReplanAcknowledged — TS/MJS 行为对齐(R3)', () => {
  const digest = tsComputeDigest('画面太慢')
  const briefOk = {
    review_feedback_digest: digest,
    creative_recipe: { id: 'x', version: 1, acknowledged_review_feedback_digest: digest },
  }
  const briefStale = {
    review_feedback_digest: digest,
    creative_recipe: {
      id: 'x', version: 1,
      acknowledged_review_feedback_digest: tsComputeDigest('旧反馈'),
    },
  }
  it('无 digest → 两侧无操作', () => {
    expect(() => tsAssertRecipeReplanAcknowledged({})).not.toThrow()
    expect(() => mjsAssertRecipeReplanAcknowledged({})).not.toThrow()
  })
  it('ack 匹配 → 两侧通过', () => {
    expect(() => tsAssertRecipeReplanAcknowledged(briefOk)).not.toThrow()
    expect(() => mjsAssertRecipeReplanAcknowledged(briefOk)).not.toThrow()
  })
  it('ack 缺 / stale → 两侧都拒', () => {
    expect(() => tsAssertRecipeReplanAcknowledged({ review_feedback_digest: digest, creative_recipe: { id: 'x', version: 1 } }))
      .toThrow(/REPLAN_REQUIRED/)
    expect(() => mjsAssertRecipeReplanAcknowledged({ review_feedback_digest: digest, creative_recipe: { id: 'x', version: 1 } }))
      .toThrow(/REPLAN_REQUIRED/)
    expect(() => tsAssertRecipeReplanAcknowledged(briefStale)).toThrow(/REPLAN_REQUIRED/)
    expect(() => mjsAssertRecipeReplanAcknowledged(briefStale)).toThrow(/REPLAN_REQUIRED/)
  })
})

describe('assertRecipeBriefComplete — TS/MJS 行为对齐(R5)', () => {
  const RECIPE_TS = tsResolveRecipe('single_image_i2v_pullback_12s')!
  const RECIPE_MJS = mjsResolveRecipe('single_image_i2v_pullback_12s')
  const buildBrief = () =>
    tsBuildFullRecipeBrief({
      recipe: RECIPE_TS, angle: 'brand', sourceImageUrl: 'https://cdn.example.com/x.jpg',
      creativeProfile: {}, copy: { hook: 'a', cta: 'b' }, keyNamespace: 'sig_x',
    })

  it('完整 brief → 两侧通过', () => {
    const b = buildBrief()
    expect(() => tsAssertRecipeBriefComplete(b, RECIPE_TS)).not.toThrow()
    expect(() => mjsAssertRecipeBriefComplete(b, RECIPE_MJS)).not.toThrow()
  })
  it('缺 copy.hook → 两侧都拒', () => {
    const b = buildBrief() as Record<string, unknown>
    b.copy = { cta: 'b' }
    expect(() => tsAssertRecipeBriefComplete(b, RECIPE_TS)).toThrow(/hook \/ cta missing/)
    expect(() => mjsAssertRecipeBriefComplete(b, RECIPE_MJS)).toThrow(/hook \/ cta missing/)
  })
  it('idempotency_key 占位符 → 两侧都拒', () => {
    const b = buildBrief() as { clip_generation_plan: Array<{ idempotency_key: string }> }
    b.clip_generation_plan[0].idempotency_key = '{work_order_id}:hook:0'
    expect(() => tsAssertRecipeBriefComplete(b, RECIPE_TS)).toThrow(/placeholder/)
    expect(() => mjsAssertRecipeBriefComplete(b, RECIPE_MJS)).toThrow(/placeholder/)
  })
})

describe('pickRecipeSourceOrReject — TS/MJS 行为对齐(R6)', () => {
  const RECIPE_TS = tsResolveRecipe('single_image_i2v_pullback_12s')!
  const RECIPE_MJS = mjsResolveRecipe('single_image_i2v_pullback_12s')
  it('有源图 → 两侧都返回 trim 后的 source', () => {
    const url = '  https://a.jpg  '
    expect(tsPickSource([url], RECIPE_TS)).toEqual({ source: 'https://a.jpg' })
    expect(mjsPickSource([url], RECIPE_MJS)).toEqual({ source: 'https://a.jpg' })
  })
  it('空 pool → 两侧都返回 rejection 且含 recipe id', () => {
    const ts = tsPickSource([], RECIPE_TS)
    const mjs = mjsPickSource([], RECIPE_MJS)
    expect('rejection' in ts && ts.rejection).toContain(RECIPE_TS.id)
    expect(mjs.rejection).toContain(RECIPE_MJS.id)
  })
})
