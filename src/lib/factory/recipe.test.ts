// 服务端 recipe 契约(合同 5469105522 + 12 blocker 修订)。
// 与 scripts/factory-worker/creative-recipe.mjs 由 recipe-shape-agreement 测试对齐。

import { describe, expect, it } from 'vitest'
import {
  assertClientRecipeIntentMatchesBrief,
  assertRecipeCtaFacts,
  assertRecipeBriefComplete,
  assertRecipeBudget,
  assertRecipePlanShape,
  assertRecipeReceipt,
  assertRecipeReplanAcknowledged,
  assertReopenedRecipeReplan,
  buildFullRecipeBrief,
  buildRecipePlan,
  computeRecipeFinalDuration,
  computeReviewFeedbackDigest,
  deriveRecipeIntent,
  parseFactoryRecipeConfig,
  pickRecipeSourceOrReject,
  RECIPE_ERR,
  RecipeConfigError,
  resolveRecipe,
  validateRecipeCopy,
  validateMulticutCopy,
  WINNER_RECIPE_IDS,
  winnerRecipeFromBrief,
} from './recipe'

const RECIPE = resolveRecipe('single_image_i2v_pullback_12s')!
const MULTICUT = resolveRecipe('single_image_i2v_multicut_9s')!
const SOURCE = 'https://cdn.example.com/hero.jpg'
const NS = 'sig_test-signal-id'

function plannedBrief(overrides: Partial<Record<string, unknown>> = {}) {
  const plan = buildRecipePlan({ recipe: RECIPE, angle: 'brand story', sourceImageUrl: SOURCE, keyNamespace: NS })
  return {
    creative_recipe: plan.creative_recipe,
    segments: plan.segments,
    clip_generation_plan: plan.clip_generation_plan,
    max_new_clips: plan.max_new_clips,
    ...overrides,
  }
}

describe('recipe timeline formula(R1)', () => {
  it('duration = 5 + 5 + 2.7 - 2*0.35 = 12.0 exact', () => {
    const d = computeRecipeFinalDuration(RECIPE)
    expect(Math.round(d * 1000) / 1000).toBe(12.0)
    expect(d).toBeLessThanOrEqual(RECIPE.max_final_dur)
  })
  it('multicut = 9.1s，3 段展示均不超过 4s，provider 生成 5s', () => {
    expect(Math.round(computeRecipeFinalDuration(MULTICUT) * 10) / 10).toBe(9.1)
    expect(MULTICUT.segments).toHaveLength(3)
    expect(MULTICUT.segments.every((segment) => segment.duration_hint_s <= 4)).toBe(true)
    expect(MULTICUT.segments.every((segment) => segment.gen_duration_s === 5)).toBe(true)
  })
  it('recipe max_final_dur = 12.0', () => {
    expect(RECIPE.max_final_dur).toBe(12.0)
  })
})

describe('parseFactoryRecipeConfig — client-config 输入闸(R2 严格)', () => {
  it('null/undefined → null', () => {
    expect(parseFactoryRecipeConfig(null)).toBeNull()
    expect(parseFactoryRecipeConfig(undefined)).toBeNull()
  })
  it('缺 version → 抛(禁止静默补齐)', () => {
    expect(() => parseFactoryRecipeConfig({ id: 'single_image_i2v_pullback_12s' })).toThrow(RecipeConfigError)
  })
  it('未知 id → 抛', () => {
    expect(() => parseFactoryRecipeConfig({ id: 'x', version: 1 })).toThrow(RecipeConfigError)
  })
  it('版本对不上 → 抛', () => {
    expect(() => parseFactoryRecipeConfig({ id: 'single_image_i2v_pullback_12s', version: 99 })).toThrow(RecipeConfigError)
  })
  it('合法 id+version → 解析成功', () => {
    expect(parseFactoryRecipeConfig({ id: 'single_image_i2v_pullback_12s', version: 1 }))
      .toEqual({ id: 'single_image_i2v_pullback_12s', version: 1 })
  })
})

describe('winnerRecipeFromBrief — 严格解析(R2)', () => {
  it('brief 缺 creative_recipe → null', () => {
    expect(winnerRecipeFromBrief({ segments: [] })).toBeNull()
  })
  it('brief.creative_recipe 缺 version → 抛', () => {
    expect(() => winnerRecipeFromBrief({ creative_recipe: { id: RECIPE.id } })).toThrow(RecipeConfigError)
  })
  it('版本对不上 → 抛', () => {
    expect(() => winnerRecipeFromBrief({ creative_recipe: { id: RECIPE.id, version: 99 } })).toThrow(RecipeConfigError)
  })
})

describe('buildRecipePlan — deterministic namespace(R5)', () => {
  it('keyNamespace 缺 → 抛', () => {
    expect(() => buildRecipePlan({ recipe: RECIPE, angle: 'x', sourceImageUrl: SOURCE, keyNamespace: '' })).toThrow(/keyNamespace/)
  })
  it('signal namespace → 每个 key 都以此为前缀', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: 'x', sourceImageUrl: SOURCE, keyNamespace: NS })
    expect(p.clip_generation_plan[0].idempotency_key).toBe(`${NS}:hook:0`)
    expect(p.clip_generation_plan[1].idempotency_key).toBe(`${NS}:cta:1`)
  })
  it('camera actions 分别命中 push-in / pull-back;两段同图,clip_ids 恒空', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: '6-city bakers', sourceImageUrl: SOURCE, keyNamespace: NS })
    expect(p.clip_generation_plan[0].prompt_hint.toLowerCase()).toContain('push-in')
    expect(p.clip_generation_plan[1].prompt_hint.toLowerCase()).toContain('pull-back')
    expect(p.segments.every((s) => s.clip_ids.length === 0)).toBe(true)
    expect(p.clip_generation_plan[0].source_image_url).toBe(SOURCE)
    expect(p.clip_generation_plan[1].source_image_url).toBe(SOURCE)
  })
})

describe('assertRecipePlanShape — 严格(R8)', () => {
  it('planner 输出 → 通过', () => {
    expect(() => assertRecipePlanShape(plannedBrief(), RECIPE)).not.toThrow()
  })
  it('segment 引用库存 clip_ids → 拒', () => {
    const bad = plannedBrief()
    ;(bad.segments as unknown as Array<Record<string, unknown>>)[0].clip_ids = ['stock-1']
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(RECIPE_ERR.PLAN_INVALID)
  })
  it('brief 想覆盖 recipe transition → 拒', () => {
    const bad = plannedBrief()
    ;(bad.segments as unknown as Array<Record<string, unknown>>)[1].transition = 'wipeleft'
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(RECIPE_ERR.PLAN_INVALID)
  })
  it('两段源图不同 → 拒', () => {
    const bad = plannedBrief()
    ;(bad.clip_generation_plan as unknown as Array<Record<string, unknown>>)[1].source_image_url = 'https://cdn.example.com/other.jpg'
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(RECIPE_ERR.PLAN_INVALID)
  })
  it('idempotency_key 重复 → 拒', () => {
    const bad = plannedBrief()
    ;(bad.clip_generation_plan as unknown as Array<Record<string, unknown>>)[1].idempotency_key =
      (bad.clip_generation_plan as unknown as Array<Record<string, unknown>>)[0].idempotency_key
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/duplicate/)
  })
  it('max_new_clips ≠ recipe.segments.length → 拒', () => {
    const bad = plannedBrief({ max_new_clips: 5 })
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/max_new_clips/)
  })
})

describe('assertReopenedRecipeReplan(R3/R4)', () => {
  it('marker 未设 → 通过(legacy 不受影响)', () => {
    expect(() => assertReopenedRecipeReplan({ review_feedback: '重来', segments: [] })).not.toThrow()
  })
  it('marker=true 且带合法 recipe → 通过', () => {
    const brief = plannedBrief({ recipe_replan_required: true })
    expect(() => assertReopenedRecipeReplan(brief)).not.toThrow()
  })
  it('marker=true + 缺 recipe → 抛 REPLAN_REQUIRED', () => {
    expect(() => assertReopenedRecipeReplan({ recipe_replan_required: true, segments: [], review_feedback: 'x' }))
      .toThrow(RECIPE_ERR.REPLAN_REQUIRED)
  })
})

describe('assertClientRecipeIntentMatchesBrief(R3)', () => {
  it('intent=null → 无操作', () => {
    expect(() => assertClientRecipeIntentMatchesBrief({}, null)).not.toThrow()
  })
  it('客户当前配 recipe 但 brief 缺 → fail-closed', () => {
    expect(() =>
      assertClientRecipeIntentMatchesBrief({ segments: [] }, { id: RECIPE.id, version: RECIPE.version }),
    ).toThrow(RECIPE_ERR.REPLAN_REQUIRED)
  })
  it('版本对不上 → fail-closed', () => {
    expect(() =>
      assertClientRecipeIntentMatchesBrief(plannedBrief(), { id: RECIPE.id, version: 99 }),
    ).toThrow(RECIPE_ERR.REPLAN_REQUIRED)
  })
})

describe('validateRecipeCopy(R9)', () => {
  it('short hook + independent cta → OK', () => {
    expect(validateRecipeCopy({ hook: 'Small group', cta: 'Book now' }, RECIPE))
      .toEqual({ hook: 'Small group', cta: 'Book now' })
  })
  it('缺 hook → 拒', () => {
    expect(() => validateRecipeCopy({ cta: 'Book now' }, RECIPE)).toThrow(RECIPE_ERR.COPY_INVALID)
  })
  it('多行 → 拒', () => {
    expect(() => validateRecipeCopy({ hook: 'a\nb', cta: 'x' }, RECIPE)).toThrow(/single-line/)
  })
  it('emoji → 拒', () => {
    expect(() => validateRecipeCopy({ hook: 'hi 🎉', cta: 'x' }, RECIPE)).toThrow(/emoji/)
  })
  it('hook = cta → 拒', () => {
    expect(() => validateRecipeCopy({ hook: 'Book now', cta: 'Book now' }, RECIPE)).toThrow(/differ/)
  })
})

describe('multicut copy + CTA facts', () => {
  const facts = { phone: '09 123 4567', url: 'example.com', departure: 'October 2026' }

  it('hook + middle 独立且端卡事实齐全 → 通过', () => {
    expect(validateMulticutCopy({ hook: 'Go beyond ordinary', middle: 'See China differently' }, MULTICUT))
      .toEqual({ hook: 'Go beyond ordinary', middle: 'See China differently' })
    expect(assertRecipeCtaFacts(facts, MULTICUT)).toEqual(facts)
  })

  it('middle 复读或 CTA required 缺失 → 拒', () => {
    expect(() => validateMulticutCopy({ hook: 'Go further', middle: 'Go further' }, MULTICUT))
      .toThrow(/must not repeat/)
    expect(() => assertRecipeCtaFacts({ phone: '09 123 4567' }, MULTICUT))
      .toThrow(/url/)
  })

  it('buildFullRecipeBrief 原子写入 multicut copy + verified CTA', () => {
    const brief = buildFullRecipeBrief({
      recipe: MULTICUT,
      angle: 'China beyond the postcard',
      sourceImageUrl: SOURCE,
      creativeProfile: { caption_mode: 'short_big' },
      copy: { hook: 'Beyond the postcard', middle: 'Meet the real China' },
      ctaFacts: facts,
      keyNamespace: NS,
    })
    expect(brief.copy).toEqual({ hook: 'Beyond the postcard', middle: 'Meet the real China' })
    expect(brief.cta_facts).toEqual(facts)
    expect(() => assertRecipeBriefComplete(brief, MULTICUT)).not.toThrow()
  })

  it('multicut 缺 verified CTA → build 阶段 fail-closed', () => {
    expect(() => buildFullRecipeBrief({
      recipe: MULTICUT,
      angle: 'China',
      sourceImageUrl: SOURCE,
      creativeProfile: {},
      copy: { hook: 'Beyond China', middle: 'See the story unfold' },
      keyNamespace: NS,
    })).toThrow(/CTA_FACTS_MISSING/)
  })
})

describe('assertRecipeBudget(R7)', () => {
  it('max_new_clips < segments → 拒', () => {
    expect(() =>
      assertRecipeBudget({ budgetCapUsd: 2, maxNewClips: 1, clipUnitCostUsd: 0.225, recipe: RECIPE }),
    ).toThrow(RECIPE_ERR.BUDGET_INSUFFICIENT)
  })
  it('projected > cap → 拒', () => {
    expect(() =>
      assertRecipeBudget({ budgetCapUsd: 0.1, maxNewClips: 2, clipUnitCostUsd: 0.225, recipe: RECIPE }),
    ).toThrow(RECIPE_ERR.BUDGET_INSUFFICIENT)
  })
})

describe('buildFullRecipeBrief(R5:原子插入前置)', () => {
  it('构造完整 brief + deterministic idempotency 前缀 = keyNamespace', () => {
    const brief = buildFullRecipeBrief({
      recipe: RECIPE,
      angle: 'brand story',
      sourceImageUrl: SOURCE,
      creativeProfile: { look: 'golden_hour' },
      copy: { hook: 'Small group', cta: 'Book now' },
      keyNamespace: NS,
      attribution: { goal_id: 'g1', expected_metric: 'brand_search_volume' },
      clipUnitCostUsd: 0.225,
      budgetCapUsd: 2,
    })
    expect((brief.creative_recipe as { id: string; version: number })).toEqual({ id: RECIPE.id, version: RECIPE.version })
    const plan = brief.clip_generation_plan as Array<{ idempotency_key: string }>
    expect(plan[0].idempotency_key.startsWith(NS + ':')).toBe(true)
    expect(brief.max_new_clips).toBe(RECIPE.segments.length)
    expect(brief.copy).toEqual({ hook: 'Small group', cta: 'Book now' })
    expect(brief.creative_profile).toEqual({ look: 'golden_hour' })
  })
  it('缺 keyNamespace → 抛', () => {
    expect(() =>
      buildFullRecipeBrief({
        recipe: RECIPE,
        angle: 'x',
        sourceImageUrl: SOURCE,
        creativeProfile: {},
        copy: { hook: 'x', cta: 'y' },
        keyNamespace: '',
      }),
    ).toThrow(/keyNamespace/)
  })
})

describe('assertRecipeReceipt — 生产 receipt validator(R12)', () => {
  const good = {
    recipe: { id: RECIPE.id, version: RECIPE.version },
    motion: false as const,
    tts: false as const,
    segments: [
      {
        role: 'hook' as const, planned_duration_s: 5, actual_duration_s: 5.02,
        motion_type: 'push_in' as const, camera_action: RECIPE.segments[0].camera_action,
        transition_out: RECIPE.segments[0].transition, clip_source: 'ai_i2v' as const,
        source_image_url: SOURCE, provider: { name: 'muapi', request_id: 'req-1' }, caption: 'Hook',
      },
      {
        role: 'cta' as const, planned_duration_s: 5, actual_duration_s: 5.01,
        motion_type: 'pull_back' as const, camera_action: RECIPE.segments[1].camera_action,
        transition_out: RECIPE.segments[1].transition, clip_source: 'ai_i2v' as const,
        source_image_url: SOURCE, provider: { name: 'muapi', request_id: 'req-2' }, caption: '',
      },
    ],
    endcard: { planned_duration_s: RECIPE.endcard_dur, cta: 'Book now', transition_in: RECIPE.endcard_transition },
    music: { id: 'epic_a.mp3', source: 'library' as const, loudness_lufs: -20 },
    xfade: RECIPE.xfade,
    final: { duration_s: 12.0, loudness_lufs: -18 },
  }
  it('probe-derived receipt → 通过', () => {
    expect(() => assertRecipeReceipt(good, RECIPE)).not.toThrow()
  })
  it('planned time 冒充 actual(actual 偏差 > 0.6s)→ 拒', () => {
    const bad = { ...good, segments: [{ ...good.segments[0], actual_duration_s: 3.0 }, good.segments[1]] }
    expect(() => assertRecipeReceipt(bad, RECIPE)).toThrow(/actual_duration_s/)
  })
  it('music.id 是绝对路径 → 拒(必须 portable)', () => {
    expect(() =>
      assertRecipeReceipt({ ...good, music: { id: '/abs/path.mp3', source: 'pool', loudness_lufs: -20 } }, RECIPE),
    ).toThrow(/portable/)
  })
  it('final loudness ≤ threshold → 拒', () => {
    expect(() =>
      assertRecipeReceipt({ ...good, final: { duration_s: 12.0, loudness_lufs: -60 } }, RECIPE),
    ).toThrow(/loudness_lufs/)
  })
  it('provider evidence 缺失 → 拒', () => {
    const bad = {
      ...good,
      segments: [
        { ...good.segments[0], provider: { name: '', request_id: '' } },
        good.segments[1],
      ],
    }
    expect(() => assertRecipeReceipt(bad, RECIPE)).toThrow(/provider/)
  })
  it('motion=true → 拒', () => {
    expect(() => assertRecipeReceipt({ ...good, motion: true as unknown as false }, RECIPE)).toThrow(/motion/)
  })
  it('tts=true → 拒', () => {
    expect(() => assertRecipeReceipt({ ...good, tts: true as unknown as false }, RECIPE)).toThrow(/tts/)
  })
})

describe('WINNER_RECIPE_IDS — 白名单闸', () => {
  it('只登记当前两条冻结 recipe', () => {
    expect(WINNER_RECIPE_IDS).toEqual([
      'single_image_i2v_pullback_12s',
      'single_image_i2v_multicut_9s',
    ])
  })
})

describe('computeReviewFeedbackDigest — R3 硬绑定', () => {
  it('同一 feedback 每次 digest 相同', () => {
    const a = computeReviewFeedbackDigest('画面太慢')
    const b = computeReviewFeedbackDigest('画面太慢')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  it('大小写 / 前后空格差异被 NFC + trim 消化', () => {
    expect(computeReviewFeedbackDigest('  画面太慢  ')).toBe(computeReviewFeedbackDigest('画面太慢'))
  })
  it('不同 feedback 不同 digest', () => {
    expect(computeReviewFeedbackDigest('画面太慢')).not.toBe(computeReviewFeedbackDigest('文案不对'))
  })
  it('空串 / 非字符串 → 抛(不许把空 digest 挂上去伪装 ack)', () => {
    expect(() => computeReviewFeedbackDigest('')).toThrow(RECIPE_ERR.REPLAN_REQUIRED)
    expect(() => computeReviewFeedbackDigest('   ')).toThrow(RECIPE_ERR.REPLAN_REQUIRED)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeReviewFeedbackDigest(null as any)).toThrow(RECIPE_ERR.REPLAN_REQUIRED)
  })
})

describe('assertRecipeReplanAcknowledged(R3)', () => {
  it('无 review_feedback_digest → 无操作(legacy 不受影响)', () => {
    expect(() => assertRecipeReplanAcknowledged({})).not.toThrow()
    expect(() => assertRecipeReplanAcknowledged({ review_feedback: '任何 free text' })).not.toThrow()
  })
  it('digest 存在 + creative_recipe.ack 匹配 → 通过', () => {
    const digest = computeReviewFeedbackDigest('画面太慢')
    const brief = {
      review_feedback_digest: digest,
      creative_recipe: { id: 'x', version: 1, acknowledged_review_feedback_digest: digest },
    }
    expect(() => assertRecipeReplanAcknowledged(brief)).not.toThrow()
  })
  it('digest 存在但 recipe 缺 ack → 拒(禁止静默换 recipe 但没吃反馈)', () => {
    const brief = {
      review_feedback_digest: computeReviewFeedbackDigest('画面太慢'),
      creative_recipe: { id: 'x', version: 1 },
    }
    expect(() => assertRecipeReplanAcknowledged(brief)).toThrow(RECIPE_ERR.REPLAN_REQUIRED)
  })
  it('ack 与当前 digest 不同(旧反馈的 ack)→ 拒', () => {
    const brief = {
      review_feedback_digest: computeReviewFeedbackDigest('新反馈'),
      creative_recipe: {
        id: 'x', version: 1,
        acknowledged_review_feedback_digest: computeReviewFeedbackDigest('旧反馈'),
      },
    }
    expect(() => assertRecipeReplanAcknowledged(brief)).toThrow(RECIPE_ERR.REPLAN_REQUIRED)
  })
})

describe('assertRecipeBriefComplete(R5 pre-insert + pre-provider gate)', () => {
  const RECIPE_LOCAL = resolveRecipe('single_image_i2v_pullback_12s')!

  it('buildFullRecipeBrief 的完整 brief → 通过', () => {
    const brief = buildFullRecipeBrief({
      recipe: RECIPE_LOCAL, angle: 'brand story', sourceImageUrl: SOURCE,
      creativeProfile: { look: 'golden_hour' },
      copy: { hook: 'Small group', cta: 'Book now' },
      keyNamespace: NS,
    })
    expect(() => assertRecipeBriefComplete(brief, RECIPE_LOCAL)).not.toThrow()
  })

  it('缺 creative_recipe → 拒', () => {
    const brief = buildFullRecipeBrief({
      recipe: RECIPE_LOCAL, angle: 'x', sourceImageUrl: SOURCE, creativeProfile: {},
      copy: { hook: 'a', cta: 'b' }, keyNamespace: NS,
    })
    delete (brief as Record<string, unknown>).creative_recipe
    expect(() => assertRecipeBriefComplete(brief, RECIPE_LOCAL)).toThrow(/creative_recipe missing/)
  })

  it('缺 copy.hook → 拒(R5 buildFullRecipeBrief 忘了 copy)', () => {
    const brief = buildFullRecipeBrief({
      recipe: RECIPE_LOCAL, angle: 'x', sourceImageUrl: SOURCE, creativeProfile: {},
      copy: { hook: 'a', cta: 'b' }, keyNamespace: NS,
    })
    ;(brief as Record<string, unknown>).copy = { cta: 'Book now' }
    expect(() => assertRecipeBriefComplete(brief, RECIPE_LOCAL)).toThrow(/hook \/ cta missing/)
  })

  it('缺 creative_profile → 拒', () => {
    const brief = buildFullRecipeBrief({
      recipe: RECIPE_LOCAL, angle: 'x', sourceImageUrl: SOURCE, creativeProfile: {},
      copy: { hook: 'a', cta: 'b' }, keyNamespace: NS,
    })
    delete (brief as Record<string, unknown>).creative_profile
    expect(() => assertRecipeBriefComplete(brief, RECIPE_LOCAL)).toThrow(/creative_profile missing/)
  })

  it('idempotency_key 仍含占位符 `{work_order_id}` → 拒(禁止 insert-then-patch 竞态)', () => {
    // 用 buildFullRecipeBrief 生成合法 brief,再手工植入占位符模拟绕过 R5
    const brief = buildFullRecipeBrief({
      recipe: RECIPE_LOCAL, angle: 'x', sourceImageUrl: SOURCE, creativeProfile: {},
      copy: { hook: 'a', cta: 'b' }, keyNamespace: NS,
    }) as Record<string, unknown>
    const plan = brief.clip_generation_plan as Array<{ idempotency_key: string }>
    plan[0].idempotency_key = '{work_order_id}:hook:0'
    expect(() => assertRecipeBriefComplete(brief, RECIPE_LOCAL)).toThrow(/placeholder/)
  })

  it('digest ack 可以透传:buildFullRecipeBrief 传入 ack digest → creative_recipe 带 ack', () => {
    const digest = computeReviewFeedbackDigest('画面太慢')
    const brief = buildFullRecipeBrief({
      recipe: RECIPE_LOCAL, angle: 'x', sourceImageUrl: SOURCE, creativeProfile: {},
      copy: { hook: 'a', cta: 'b' }, keyNamespace: NS,
      acknowledgedReviewFeedbackDigest: digest,
      reviewFeedbackDigest: digest,
    })
    expect((brief.creative_recipe as { acknowledged_review_feedback_digest?: string }).acknowledged_review_feedback_digest).toBe(digest)
    expect((brief as { review_feedback_digest?: string }).review_feedback_digest).toBe(digest)
    // 完备 + digest 匹配 → assertRecipeReplanAcknowledged 通过
    expect(() => assertRecipeBriefComplete(brief, RECIPE_LOCAL)).not.toThrow()
    expect(() => assertRecipeReplanAcknowledged(brief)).not.toThrow()
  })
})

describe('pickRecipeSourceOrReject(R6 truthful rejection)', () => {
  const RECIPE_LOCAL = resolveRecipe('single_image_i2v_pullback_12s')!

  it('pool 有效源图 → source(trim)', () => {
    expect(pickRecipeSourceOrReject(['  https://a.jpg  '], RECIPE_LOCAL))
      .toEqual({ source: 'https://a.jpg' })
  })
  it('pool 全空 → rejection(含 recipe id;不许静默 accepted with undefined WO id)', () => {
    const out = pickRecipeSourceOrReject([], RECIPE_LOCAL)
    expect('rejection' in out).toBe(true)
    if ('rejection' in out) {
      expect(out.rejection).toContain(RECIPE_LOCAL.id)
      expect(out.rejection).toContain('gate_data_unavailable')
    }
  })
  it('pool 全 null / 空串 / undefined → rejection', () => {
    const out = pickRecipeSourceOrReject([null, '', '   ', undefined], RECIPE_LOCAL)
    expect('rejection' in out).toBe(true)
  })
  it('pool 有效源图前有空值 → 跳过空值选第一个真实源图', () => {
    expect(pickRecipeSourceOrReject([null, '', 'https://c.jpg'], RECIPE_LOCAL))
      .toEqual({ source: 'https://c.jpg' })
  })
})

describe('deriveRecipeIntent — claim route 消费的纯函数', () => {
  it('null / 无 creative_recipe → 双 null(legacy 保留)', () => {
    expect(deriveRecipeIntent(null)).toEqual({ recipeIntent: null, recipeIntentInvalidReason: null })
    expect(deriveRecipeIntent({})).toEqual({ recipeIntent: null, recipeIntentInvalidReason: null })
  })
  it('合法 id+version → intent 有值,reason=null', () => {
    const out = deriveRecipeIntent({ creative_recipe: { id: RECIPE.id, version: RECIPE.version } })
    expect(out).toEqual({ recipeIntent: { id: RECIPE.id, version: RECIPE.version }, recipeIntentInvalidReason: null })
  })
  it('非法 recipe(未知 id)→ intent=null,reason=非空(worker 会 fail-closed)', () => {
    const out = deriveRecipeIntent({ creative_recipe: { id: 'made_up', version: 1 } })
    expect(out.recipeIntent).toBeNull()
    expect(out.recipeIntentInvalidReason).toMatch(/CONFIG_INVALID/)
  })
  it('版本对不上 → intent=null,reason=非空', () => {
    const out = deriveRecipeIntent({ creative_recipe: { id: RECIPE.id, version: 999 } })
    expect(out.recipeIntent).toBeNull()
    expect(out.recipeIntentInvalidReason).toMatch(/version/)
  })
})
