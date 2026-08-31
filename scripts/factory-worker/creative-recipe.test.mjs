// P21.J.M2 recipe helpers 回归(合同 5469105522 + 12 blocker 修订)。
// 所有 IO(fs/exec/ffprobe/renderer/muapi)由调用方注入,测试直接返回打桩值。

import { describe, expect, it } from 'vitest'
import {
  RECIPE_ID,
  RECIPE_ID_MULTICUT,
  RECIPE_VERSION,
  assertClientRecipeIntentMatchesBrief,
  assertPerCallBudget,
  assertRecipeBriefComplete,
  assertRecipeCtaFacts,
  assertRecipeBudget,
  assertRecipePlanShape,
  assertRecipeProfileConstraints,
  assertRecipeReceipt,
  assertRecipeReplanAcknowledged,
  assertRendererApproved,
  assertReopenedRecipeReplan,
  buildExecutedReceipt,
  buildExecutedSrt,
  buildRecipeAssembleConfig,
  buildRecipePlan,
  computeRecipeFinalDuration,
  computeReviewFeedbackDigest,
  makePromoPreflight,
  normalizeCreativeProfile,
  parseLufsFromEbur128,
  pickRecipeSourceOrReject,
  resolveRecipe,
  resolveRecipeBgm,
  validateMulticutCopy,
  validateRecipeCopy,
  verifyFinalMedia,
  winnerRecipeFromBrief,
} from './creative-recipe.mjs'

const RECIPE = resolveRecipe(RECIPE_ID)
const MULTICUT = resolveRecipe(RECIPE_ID_MULTICUT)
const SOURCE = 'https://cdn.example.com/product.jpg'
const NS = 'sig_abc123'

function plannedBrief(overrides = {}) {
  const p = buildRecipePlan({ recipe: RECIPE, angle: 'brand story', sourceImageUrl: SOURCE, keyNamespace: NS })
  return {
    creative_recipe: { id: RECIPE_ID, version: RECIPE_VERSION },
    segments: p.segments,
    clip_generation_plan: p.clip_generation_plan,
    max_new_clips: p.max_new_clips,
    ...overrides,
  }
}

// ── R1: 时长公式(2*5 + 2.7 - 2*0.35 = 12.0)───────────────────────────────────
describe('recipe timeline formula(R1)', () => {
  it('duration = 2*5 + 2.7 - 2*0.35 = 12.0(不多不少)', () => {
    const d = computeRecipeFinalDuration(RECIPE)
    // 严格 12.0(浮点安全比较)
    expect(Math.round(d * 1000) / 1000).toBe(12.0)
    expect(d).toBeLessThanOrEqual(RECIPE.max_final_dur)
    expect(d).toBeGreaterThanOrEqual(RECIPE.min_final_dur)
  })
  it('recipe max_final_dur = 12.0(合同上界不许被 renderer 兜底裁剪覆盖)', () => {
    expect(RECIPE.max_final_dur).toBe(12.0)
    expect(RECIPE.endcard_dur).toBe(2.7)
    expect(RECIPE.xfade).toBe(0.35)
  })
})

describe('multicut 9s recipe', () => {
  const facts = { phone: '09 123 4567', url: 'example.com', departure: 'October 2026' }

  it('三段展示 ≤4s，provider 生成 5s，final=9.1s', () => {
    expect(MULTICUT.segments).toHaveLength(3)
    expect(MULTICUT.segments.every((segment) => segment.duration_hint_s <= 4)).toBe(true)
    expect(MULTICUT.segments.every((segment) => segment.gen_duration_s === 5)).toBe(true)
    expect(Math.round(computeRecipeFinalDuration(MULTICUT) * 10) / 10).toBe(9.1)
  })

  it('hook/middle 与 CTA facts 都 fail-closed', () => {
    expect(validateMulticutCopy({ hook: 'Beyond the postcard', middle: 'Meet the real China' }, MULTICUT))
      .toEqual({ hook: 'Beyond the postcard', middle: 'Meet the real China' })
    expect(() => validateMulticutCopy({ hook: 'Same line', middle: 'Same line' }, MULTICUT))
      .toThrow(/must not repeat/)
    expect(assertRecipeCtaFacts(facts, MULTICUT)).toEqual(facts)
    expect(() => assertRecipeCtaFacts({ phone: '09 123 4567' }, MULTICUT)).toThrow(/url/)
  })

  it('assemble 真携带两段文字与已验证端卡事实', () => {
    const cfg = buildRecipeAssembleConfig({
      recipe: MULTICUT,
      profile: {},
      localPaths: ['/tmp/a.mp4', '/tmp/b.mp4', '/tmp/c.mp4'],
      captionsByRole: { hook: 'Beyond the postcard', middle: 'Meet the real China' },
      ctaFacts: facts,
      bgmAbsPath: '/tmp/music.mp3',
      brandKit: '/tmp/brandkit',
      outputPath: '/tmp/final.mp4',
    })
    expect(cfg.segments.map((segment) => segment.caption ?? '')).toEqual([
      'Beyond the postcard', 'Meet the real China', '',
    ])
    expect(cfg.endcard.facts).toEqual(facts)
    expect(cfg.endcard.cta).toContain('09 123 4567')
  })
})

// ── R2: 严格 recipe 解析 ─────────────────────────────────────────────────────
describe('winnerRecipeFromBrief — 严格解析(R2)', () => {
  it('brief 带匹配 id/version → 返回 descriptor', () => {
    expect(winnerRecipeFromBrief(plannedBrief())?.id).toBe(RECIPE_ID)
  })
  it('brief 缺 creative_recipe → null(legacy)', () => {
    expect(winnerRecipeFromBrief({ segments: [] })).toBeNull()
  })
  it('brief.creative_recipe 存在但缺 version → 抛(禁止静默补齐)', () => {
    expect(() => winnerRecipeFromBrief({ creative_recipe: { id: RECIPE_ID } })).toThrow(/CONFIG_INVALID/)
  })
  it('版本对不上 → 抛(禁止静默跨版本继续)', () => {
    expect(() => winnerRecipeFromBrief({ creative_recipe: { id: RECIPE_ID, version: 99 } })).toThrow(/CONFIG_INVALID/)
  })
  it('id 非白名单 → 抛', () => {
    expect(() => winnerRecipeFromBrief({ creative_recipe: { id: 'nope', version: 1 } })).toThrow(/CONFIG_INVALID/)
  })
})

// ── R5/R8: 严格 plan shape + deterministic keyNamespace ──────────────────────
describe('buildRecipePlan — deterministic namespace(R5)', () => {
  it('keyNamespace 缺失 → 抛(禁止 pre-insert 用占位符再 patch)', () => {
    expect(() => buildRecipePlan({ recipe: RECIPE, angle: 'x', sourceImageUrl: SOURCE, keyNamespace: '' })).toThrow(/keyNamespace/)
  })
  it('给了 signal ns → 每个 plan.idempotency_key 都以此为前缀', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: 'x', sourceImageUrl: SOURCE, keyNamespace: NS })
    expect(p.clip_generation_plan[0].idempotency_key).toBe(`${NS}:hook:0`)
    expect(p.clip_generation_plan[1].idempotency_key).toBe(`${NS}:cta:1`)
  })
  it('两段同一源图,clip_ids 恒空,camera actions 分别命中 push-in / pull-back', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: 'brand', sourceImageUrl: SOURCE, keyNamespace: NS })
    expect(p.clip_generation_plan[0].source_image_url).toBe(SOURCE)
    expect(p.clip_generation_plan[1].source_image_url).toBe(SOURCE)
    expect(p.segments[0].clip_ids).toEqual([])
    expect(p.segments[1].clip_ids).toEqual([])
    expect(p.clip_generation_plan[0].prompt_hint.toLowerCase()).toContain('push-in')
    expect(p.clip_generation_plan[1].prompt_hint.toLowerCase()).toContain('pull-back')
  })
})

describe('assertRecipePlanShape — 严格逐字段(R8)', () => {
  it('planner 输出 → 通过', () => {
    expect(() => assertRecipePlanShape(plannedBrief(), RECIPE)).not.toThrow()
  })
  it('segment 引用库存 clip_ids → 拒', () => {
    const bad = plannedBrief()
    bad.segments[0].clip_ids = ['clip-abc']
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/PLAN_INVALID/)
  })
  it('brief 想覆盖 recipe transition → 拒(合同 §5:transition 只归 recipe)', () => {
    const bad = plannedBrief()
    bad.segments[1].transition = 'wipeleft'
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/PLAN_INVALID/)
  })
  it('两段源图不同 → 拒', () => {
    const bad = plannedBrief()
    bad.clip_generation_plan[1].source_image_url = 'https://cdn.example.com/other.jpg'
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/PLAN_INVALID/)
  })
  it('plan.idempotency_key 重复 → 拒', () => {
    const bad = plannedBrief()
    bad.clip_generation_plan[1].idempotency_key = bad.clip_generation_plan[0].idempotency_key
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/duplicate idempotency_key/)
  })
  it('requires_source_resolution=true → 拒(服务端必须已解析)', () => {
    const bad = plannedBrief()
    bad.clip_generation_plan[0].requires_source_resolution = true
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/PLAN_INVALID/)
  })
  it('max_new_clips 与 recipe.segments 长度不一致 → 拒', () => {
    const bad = plannedBrief()
    bad.max_new_clips = 5
    expect(() => assertRecipePlanShape(bad, RECIPE)).toThrow(/max_new_clips/)
  })
})

// ── R3/R4: replan marker + client intent ─────────────────────────────────────
describe('assertReopenedRecipeReplan(R3/R4)', () => {
  it('marker 未设 → 通过(legacy review 重试不受影响)', () => {
    expect(() => assertReopenedRecipeReplan({ review_feedback: '重来', segments: [] })).not.toThrow()
  })
  it('marker=true 且带合法 recipe → 通过(server 已经产出新 plan)', () => {
    const brief = { ...plannedBrief(), recipe_replan_required: true }
    expect(() => assertReopenedRecipeReplan(brief)).not.toThrow()
  })
  it('marker=true 但缺 recipe → 抛 REPLAN_REQUIRED(worker fail-closed)', () => {
    expect(() =>
      assertReopenedRecipeReplan({ recipe_replan_required: true, segments: [], review_feedback: 'x' }),
    ).toThrow(/WINNER_RECIPE_REPLAN_REQUIRED/)
  })
})

describe('assertClientRecipeIntentMatchesBrief(R3)', () => {
  it('intent=null → 无操作(不改变 legacy 行为)', () => {
    expect(() => assertClientRecipeIntentMatchesBrief({ any: true }, null)).not.toThrow()
  })
  it('intent 匹配 brief → 通过', () => {
    expect(() =>
      assertClientRecipeIntentMatchesBrief(plannedBrief(), { id: RECIPE_ID, version: RECIPE_VERSION }),
    ).not.toThrow()
  })
  it('客户当前配了 recipe 但 stale queued brief 缺 recipe → fail-closed', () => {
    expect(() =>
      assertClientRecipeIntentMatchesBrief({ segments: [] }, { id: RECIPE_ID, version: RECIPE_VERSION }),
    ).toThrow(/WINNER_RECIPE_REPLAN_REQUIRED/)
  })
  it('客户当前 recipe 与 brief 版本不同 → fail-closed', () => {
    expect(() =>
      assertClientRecipeIntentMatchesBrief(plannedBrief(), { id: RECIPE_ID, version: 99 }),
    ).toThrow(/WINNER_RECIPE_REPLAN_REQUIRED/)
  })
})

// ── R9: 结构化 copy ──────────────────────────────────────────────────────────
describe('validateRecipeCopy(R9)', () => {
  it('short hook + 独立 cta → 通过', () => {
    expect(validateRecipeCopy({ hook: 'Small group', cta: 'Book now' }, RECIPE))
      .toEqual({ hook: 'Small group', cta: 'Book now' })
  })
  it('缺 hook → 拒', () => {
    expect(() => validateRecipeCopy({ cta: 'Book now' }, RECIPE)).toThrow(/COPY_INVALID/)
  })
  it('多行 → 拒', () => {
    expect(() => validateRecipeCopy({ hook: 'line1\nline2', cta: 'x' }, RECIPE)).toThrow(/single-line/)
  })
  it('emoji → 拒', () => {
    expect(() => validateRecipeCopy({ hook: 'hello 🎉', cta: 'x' }, RECIPE)).toThrow(/emoji/)
  })
  it('hook = cta → 拒(禁止复读)', () => {
    expect(() => validateRecipeCopy({ hook: 'Book now', cta: 'Book now' }, RECIPE)).toThrow(/differ/)
  })
  it('纯数字 → 拒', () => {
    expect(() => validateRecipeCopy({ hook: '$99', cta: 'Book now' }, RECIPE)).toThrow(/numeric/)
  })
  it('英文 hook 超 6 词 → 拒', () => {
    expect(() =>
      validateRecipeCopy({ hook: 'one two three four five six seven', cta: 'Book now' }, RECIPE),
    ).toThrow(/exceeds/)
  })
  it('CJK hook 超 12 字 → 拒', () => {
    expect(() =>
      validateRecipeCopy({ hook: '一二三四五六七八九十十一十二十三', cta: '下单' }, RECIPE),
    ).toThrow(/exceeds/)
  })
  it('segments 数组(legacy 结构)→ 拒', () => {
    expect(() =>
      validateRecipeCopy({ hook: 'x', cta: 'y', segments: [{ role: 'hook', caption: 'x' }] }, RECIPE),
    ).toThrow(/forbids segment-array/)
  })
  it('endcard.vo/offer/url 额外字段 → 拒', () => {
    expect(() =>
      validateRecipeCopy({ hook: 'x', cta: 'y', endcard: { vo: 'narration' } }, RECIPE),
    ).toThrow(/endcard extras/)
  })
})

// ── R3 alias 归一化 ──────────────────────────────────────────────────────────
describe('normalizeCreativeProfile — CTS alias 归一', () => {
  it('vo:false → tts_enabled:false', () => {
    expect(normalizeCreativeProfile({ vo: false })).toEqual({ tts_enabled: false })
  })
  it('caption_style:short_big → caption_mode:short_big', () => {
    expect(normalizeCreativeProfile({ caption_style: 'short_big' })).toEqual({ caption_mode: 'short_big' })
  })
  it('music_fallback_mood → music_mood', () => {
    expect(normalizeCreativeProfile({ music_fallback_mood: 'epic_cinematic' })).toEqual({ music_mood: 'epic_cinematic' })
  })
  it('alias 与 canonical 冲突 → 抛', () => {
    expect(() => normalizeCreativeProfile({ vo: true, tts_enabled: false })).toThrow(/冲突/)
  })
})

// ── R7: budget gate ──────────────────────────────────────────────────────────
describe('assertRecipeBudget / assertPerCallBudget(R7)', () => {
  it('max_new_clips ≥ segments 且 projected ≤ cap → 通过', () => {
    expect(assertRecipeBudget({ budgetCapUsd: 2, maxNewClips: 2, clipUnitCostUsd: 0.225, recipe: RECIPE }))
      .toEqual({ projectedCostUsd: 0.45 })
  })
  it('max_new_clips < segments → 拒(zero provider call)', () => {
    expect(() =>
      assertRecipeBudget({ budgetCapUsd: 2, maxNewClips: 1, clipUnitCostUsd: 0.225, recipe: RECIPE }),
    ).toThrow(/BUDGET_INSUFFICIENT/)
  })
  it('projected > cap → 拒(zero provider call)', () => {
    expect(() =>
      assertRecipeBudget({ budgetCapUsd: 0.1, maxNewClips: 2, clipUnitCostUsd: 0.225, recipe: RECIPE }),
    ).toThrow(/BUDGET_INSUFFICIENT/)
  })
  it('per-call: 已花 1.9 + 下次 0.225 > cap 2 → 拒(second call 停)', () => {
    expect(() => assertPerCallBudget({ nextCallCostUsd: 0.225, alreadySpentUsd: 1.9, budgetCapUsd: 2 }))
      .toThrow(/BUDGET_INSUFFICIENT/)
  })
  it.each([NaN, Infinity, -1])('非法 budget cap %s → fail-closed', (bad) => {
    expect(() =>
      assertRecipeBudget({ budgetCapUsd: bad, maxNewClips: 2, clipUnitCostUsd: 0.225, recipe: RECIPE }),
    ).toThrow(/BUDGET_INSUFFICIENT/)
  })
  it.each([NaN, Infinity, -0.1])('非法累计成本 %s → per-call fail-closed', (bad) => {
    expect(() => assertPerCallBudget({ nextCallCostUsd: 0.225, alreadySpentUsd: bad, budgetCapUsd: 2 }))
      .toThrow(/BUDGET_INSUFFICIENT/)
  })
})

// ── R10: BGM(music_library + music_pool + loudness)──────────────────────────
describe('resolveRecipeBgm(R10)', () => {
  const shared = '/tmp/_shared/music'
  const join = (a, b) => `${a}/${b}`
  it('profile.music_pool 命中 exists + loudness > threshold → portable id + source=pool', () => {
    const out = resolveRecipeBgm({
      profile: { music_pool: ['soft.mp3'] },
      sharedMusicDir: shared,
      existsFn: (p) => p === '/tmp/_shared/music/soft.mp3',
      probeLoudnessLufsFn: () => -20,
      joinFn: join,
      minLoudnessLufs: -55,
    })
    expect(out).toEqual({
      absPath: '/tmp/_shared/music/soft.mp3', portableId: 'soft.mp3', source: 'pool', loudnessLufs: -20,
    })
  })
  it('mood 命中 library allowlist → portable id + source=library', () => {
    const out = resolveRecipeBgm({
      profile: { music_mood: 'epic_cinematic' },
      sharedMusicDir: shared,
      musicLibrary: { epic_cinematic: [{ id: 'epic-a', file: 'epic_a.mp3' }] },
      existsFn: () => true,
      probeLoudnessLufsFn: () => -18,
      joinFn: join,
      minLoudnessLufs: -55,
    })
    expect(out).toEqual({
      absPath: '/tmp/_shared/music/epic_a.mp3', portableId: 'epic-a', source: 'library', loudnessLufs: -18,
    })
  })
  it('loudness 低于阈值 → 抛 BGM_MISSING(静音不许当有声用)', () => {
    expect(() =>
      resolveRecipeBgm({
        profile: { music_pool: ['soft.mp3'] },
        sharedMusicDir: shared,
        existsFn: () => true,
        probeLoudnessLufsFn: () => -60,
        joinFn: join,
        minLoudnessLufs: -55,
      }),
    ).toThrow(/BGM_MISSING/)
  })
  it('-54 LUFS 在可感知输入门槛 -50 下必须拒绝', () => {
    expect(() =>
      resolveRecipeBgm({
        profile: { music_pool: ['soft.mp3'] }, sharedMusicDir: shared,
        existsFn: () => true, probeLoudnessLufsFn: () => -54,
        joinFn: join, minLoudnessLufs: RECIPE.min_bgm_input_loudness_lufs,
      }),
    ).toThrow(/BGM_MISSING/)
  })
  it.each(['/private/customer-a/song.mp3', '../customer-b/song.mp3', 'C:\\secret\\song.mp3'])(
    '任意绝对/穿越路径 %s → 拒绝',
    (music) => {
      expect(() =>
        resolveRecipeBgm({
          profile: { music }, sharedMusicDir: shared,
          existsFn: () => true, probeLoudnessLufsFn: () => -18,
          joinFn: join, minLoudnessLufs: RECIPE.min_bgm_input_loudness_lufs,
        }),
      ).toThrow(/BGM_MISSING/)
    },
  )
  it('mood 不在 library allowlist → 抛(不再发明 canonical 文件名)', () => {
    expect(() =>
      resolveRecipeBgm({
        profile: { music_mood: 'made_up' },
        sharedMusicDir: shared,
        musicLibrary: { epic_cinematic: [] },
        existsFn: () => true,
        probeLoudnessLufsFn: () => -20,
        joinFn: join,
        minLoudnessLufs: -55,
      }),
    ).toThrow(/BGM_MISSING/)
  })
  it('未配任何 music/pool/mood → 抛', () => {
    expect(() =>
      resolveRecipeBgm({
        profile: {}, sharedMusicDir: shared, existsFn: () => true,
        probeLoudnessLufsFn: () => -20, joinFn: join, minLoudnessLufs: -55,
      }),
    ).toThrow(/BGM_MISSING/)
  })
})

// ── R11: renderer SHA gate ──────────────────────────────────────────────────
describe('assertRendererApproved(R11)', () => {
  const SHA = 'a'.repeat(64)
  it('sha 匹配白名单(大小写不敏感)→ 通过', () => {
    expect(() =>
      assertRendererApproved({ path: '/x/renderer.py', approvedShas: [SHA.toUpperCase()], hashFn: () => SHA }),
    ).not.toThrow()
  })
  it('approvedShas 空(env 未配)→ 拒(fail-closed)', () => {
    expect(() =>
      assertRendererApproved({ path: '/x/renderer.py', approvedShas: [], hashFn: () => SHA }),
    ).toThrow(/RENDERER_UNAPPROVED/)
  })
  it('actual sha 不在白名单 → 拒', () => {
    expect(() =>
      assertRendererApproved({ path: '/x/renderer.py', approvedShas: [SHA], hashFn: () => 'b'.repeat(64) }),
    ).toThrow(/RENDERER_UNAPPROVED/)
  })
  it('hashFn 抛 → 转成 RENDERER_UNAPPROVED', () => {
    expect(() =>
      assertRendererApproved({
        path: '/nope.py', approvedShas: [SHA], hashFn: () => { throw new Error('ENOENT') },
      }),
    ).toThrow(/RENDERER_UNAPPROVED/)
  })
})

// ── secondary semantic preflight ─────────────────────────────────────────────
describe('makePromoPreflight(次要 semantic 检查)', () => {
  it('源码含全部 required tokens → 通过', () => {
    const src = 'caption_mode endcard_dur transition music motion handled.\n'
    expect(() => makePromoPreflight({ path: '/x/renderer.py', readFn: () => src })).not.toThrow()
  })
  it('缺 caption_mode → 抛 MAKE_PROMO_UNSUPPORTED', () => {
    expect(() =>
      makePromoPreflight({ path: '/x/renderer.py', readFn: () => 'motion transition music endcard_dur' }),
    ).toThrow(/MAKE_PROMO_UNSUPPORTED/)
  })
})

// ── assemble config ─────────────────────────────────────────────────────────
describe('buildRecipeAssembleConfig — recipe transitions 权威', () => {
  const args = {
    recipe: RECIPE,
    localPaths: ['/tmp/seg_0.mp4', '/tmp/seg_1.mp4'],
    hookText: 'Hook',
    ctaText: 'Book now',
    bgmAbsPath: '/tmp/_shared/music/song.mp3',
    brandKit: '/tmp/brandkit',
    outputPath: '/tmp/final.mp4',
    profile: {},
  }
  it('输出 config 用 recipe 定义的 transitions,motion=false,tts 不下发', () => {
    const cfg = buildRecipeAssembleConfig(args)
    expect(cfg.segments[0].transition).toBeUndefined()
    // renderer 的字段语义是“转入本段”，CTA 应使用 hook 的出场 transition。
    expect(cfg.segments[1].transition).toBe(RECIPE.segments[0].transition)
    expect(cfg.endcard.transition).toBe(RECIPE.endcard_transition)
    expect(cfg.motion).toBe(false)
    expect(cfg.xfade).toBe(RECIPE.xfade)
    expect(cfg.endcard_dur).toBe(RECIPE.endcard_dur)
    expect(cfg.caption_mode).toBe(RECIPE.caption_mode)
  })
})

// ── receipt(portable id + probes)─────────────────────────────────────────
describe('buildExecutedReceipt(R12) + verifyFinalMedia', () => {
  it('receipt 消费真实 executed 数据,music 是 portable id 而非绝对路径', () => {
    const receipt = buildExecutedReceipt({
      recipe: RECIPE,
      hookText: 'Hook',
      ctaText: 'Book now',
      sourceImageUrl: SOURCE,
      executed: [
        { actual_duration_s: 5.0, provider: 'muapi', request_id: 'req-1' },
        { actual_duration_s: 5.0, provider: 'muapi', request_id: 'req-2' },
      ],
      music: { portableId: 'epic_a.mp3', source: 'library', loudnessLufs: -20 },
      final: { duration: 12.0, loudnessLufs: -18 },
    })
    expect(receipt.recipe).toEqual({ id: RECIPE.id, version: RECIPE.version })
    expect(receipt.motion).toBe(false)
    expect(receipt.tts).toBe(false)
    expect(receipt.segments).toHaveLength(2)
    expect(receipt.segments[0]).toMatchObject({ role: 'hook', motion_type: 'push_in', clip_source: 'ai_i2v', provider: { name: 'muapi', request_id: 'req-1' } })
    expect(receipt.segments[1]).toMatchObject({ role: 'cta', motion_type: 'pull_back' })
    expect(receipt.music).toEqual({ id: 'epic_a.mp3', source: 'library', loudness_lufs: -20 })
    expect(receipt.music.id.startsWith('/')).toBe(false)
    expect(receipt.final).toEqual({ duration_s: 12.0, loudness_lufs: -18 })
    expect(receipt.xfade).toBe(RECIPE.xfade)
  })
  it('verifyFinalMedia:duration 11.9s + loudness -20 → 通过', () => {
    expect(() =>
      verifyFinalMedia({ path: '/x', recipe: RECIPE, ffprobeFn: () => ({ duration: 11.9, loudnessLufs: -20 }) }),
    ).not.toThrow()
  })
  it('verifyFinalMedia:duration 12.05s(略超)→ 拒', () => {
    expect(() =>
      verifyFinalMedia({ path: '/x', recipe: RECIPE, ffprobeFn: () => ({ duration: 12.05, loudnessLufs: -20 }) }),
    ).toThrow(/DURATION_INVALID/)
  })
  it('verifyFinalMedia:loudness ≤ -55 → 拒(视作静音)', () => {
    expect(() =>
      verifyFinalMedia({ path: '/x', recipe: RECIPE, ffprobeFn: () => ({ duration: 12.0, loudnessLufs: -60 }) }),
    ).toThrow(/LOUDNESS_INVALID/)
  })
})

// ── SRT ───────────────────────────────────────────────────────────────────
describe('buildExecutedSrt', () => {
  it('只出 hook 一条字幕', () => {
    const srt = buildExecutedSrt({ recipe: RECIPE, hookText: 'Hook' })
    expect(srt.trim().split('\n\n').filter(Boolean)).toHaveLength(1)
    expect(srt).toContain('Hook')
  })
})

// ── parseLufsFromEbur128 pure parser(R10) ───────────────────────────────
describe('parseLufsFromEbur128 — 从 ffmpeg ebur128 stderr 摘要解析 integrated loudness', () => {
  it('真实 ffmpeg 摘要 → 解析出 integrated LUFS(有 target/threshold 混杂也能拿对)', () => {
    const stderr = `\n[Parsed_ebur128_0 @ 0x7f8] Summary:\n\n  Integrated loudness:\n    I:         -18.7 LUFS\n    Threshold: -28.9 LUFS\n\n  Loudness range:\n    LRA:         6.2 LU\n`
    expect(parseLufsFromEbur128(stderr)).toBe(-18.7)
  })
  it('整数样值 → 取 Integrated loudness 那个', () => {
    const stderr = 'Integrated loudness:\n    I:         -23 LUFS\n\n Threshold: -33 LUFS'
    expect(parseLufsFromEbur128(stderr)).toBe(-23)
  })
  it('空 / undefined / 无 loudness 段 → null(触发 -70 兜底)', () => {
    expect(parseLufsFromEbur128('')).toBeNull()
    expect(parseLufsFromEbur128(undefined)).toBeNull()
    expect(parseLufsFromEbur128('Some unrelated noise')).toBeNull()
  })
  it('Buffer 输入 → 会 String 化再解析', () => {
    const buf = Buffer.from('Integrated loudness:\n    I:   -14.2 LUFS')
    expect(parseLufsFromEbur128(buf)).toBe(-14.2)
  })
})

// ── assertRecipeReceipt mjs 侧完整 receipt validator(R12 · 与 TS 侧字段等价)──
describe('assertRecipeReceipt(mjs full validator)', () => {
  const good = () => ({
    recipe: { id: RECIPE.id, version: RECIPE.version },
    motion: false, tts: false,
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
  it('good receipt → 通过', () => {
    expect(() => assertRecipeReceipt(good(), RECIPE)).not.toThrow()
  })
  it('actual_duration_s 偏差 > 0.6s → 拒', () => {
    const r = good(); r.segments[0].actual_duration_s = 3.0
    expect(() => assertRecipeReceipt(r, RECIPE)).toThrow(/actual_duration_s/)
  })
  it('provider 证据空字符串 → 拒', () => {
    const r = good(); r.segments[0].provider = { name: '', request_id: '' }
    expect(() => assertRecipeReceipt(r, RECIPE)).toThrow(/provider/)
  })
  it('transition_out 被覆盖成非 recipe 值 → 拒', () => {
    const r = good(); r.segments[1].transition_out = 'wipeleft'
    expect(() => assertRecipeReceipt(r, RECIPE)).toThrow(/transition_out/)
  })
  it('music.id 是绝对路径 → 拒', () => {
    const r = good(); r.music.id = '/abs/song.mp3'
    expect(() => assertRecipeReceipt(r, RECIPE)).toThrow(/portable/)
  })
  it('music.loudness_lufs ≤ threshold → 拒', () => {
    const r = good(); r.music.loudness_lufs = -60
    expect(() => assertRecipeReceipt(r, RECIPE)).toThrow(/music\.loudness_lufs/)
  })
  it('final.loudness_lufs ≤ threshold → 拒', () => {
    const r = good(); r.final.loudness_lufs = -60
    expect(() => assertRecipeReceipt(r, RECIPE)).toThrow(/final\.loudness_lufs/)
  })
})

// ── R3 digest 绑定 ──────────────────────────────────────────────────────────
describe('computeReviewFeedbackDigest — R3 硬绑定(mjs 侧)', () => {
  it('同 feedback 每次 digest 相同,64 hex', () => {
    const a = computeReviewFeedbackDigest('画面太慢')
    expect(a).toBe(computeReviewFeedbackDigest('画面太慢'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  it('NFC + trim 消化', () => {
    expect(computeReviewFeedbackDigest('  画面太慢  ')).toBe(computeReviewFeedbackDigest('画面太慢'))
  })
  it('不同 feedback 不同 digest', () => {
    expect(computeReviewFeedbackDigest('画面太慢')).not.toBe(computeReviewFeedbackDigest('文案不对'))
  })
  it('空 / 非字符串 → 抛', () => {
    expect(() => computeReviewFeedbackDigest('')).toThrow(/REPLAN_REQUIRED/)
    expect(() => computeReviewFeedbackDigest(null)).toThrow(/REPLAN_REQUIRED/)
  })
})

describe('assertRecipeReplanAcknowledged(mjs · R3)', () => {
  it('无 review_feedback_digest → 无操作', () => {
    expect(() => assertRecipeReplanAcknowledged({})).not.toThrow()
    expect(() => assertRecipeReplanAcknowledged({ review_feedback: '任何 text' })).not.toThrow()
  })
  it('digest + creative_recipe.ack 匹配 → 通过', () => {
    const digest = computeReviewFeedbackDigest('画面太慢')
    expect(() =>
      assertRecipeReplanAcknowledged({
        review_feedback_digest: digest,
        creative_recipe: { id: 'x', version: 1, acknowledged_review_feedback_digest: digest },
      }),
    ).not.toThrow()
  })
  it('digest 存在但 ack 缺 → 拒', () => {
    expect(() =>
      assertRecipeReplanAcknowledged({
        review_feedback_digest: computeReviewFeedbackDigest('画面太慢'),
        creative_recipe: { id: 'x', version: 1 },
      }),
    ).toThrow(/REPLAN_REQUIRED/)
  })
  it('ack 是旧反馈的 digest → 拒', () => {
    expect(() =>
      assertRecipeReplanAcknowledged({
        review_feedback_digest: computeReviewFeedbackDigest('新反馈'),
        creative_recipe: {
          id: 'x', version: 1,
          acknowledged_review_feedback_digest: computeReviewFeedbackDigest('旧反馈'),
        },
      }),
    ).toThrow(/REPLAN_REQUIRED/)
  })
})

// ── R5 brief completeness(mjs 侧)──────────────────────────────────────────
describe('assertRecipeBriefComplete(mjs · R5)', () => {
  it('planner 构造的 brief + copy + profile → 通过', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: 'brand', sourceImageUrl: SOURCE, keyNamespace: NS })
    const brief = {
      creative_recipe: p.creative_recipe,
      segments: p.segments,
      clip_generation_plan: p.clip_generation_plan,
      max_new_clips: p.max_new_clips,
      copy: { hook: 'Small group', cta: 'Book now' },
      creative_profile: {},
    }
    expect(() => assertRecipeBriefComplete(brief, RECIPE)).not.toThrow()
  })
  it('缺 creative_recipe → 拒', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: 'x', sourceImageUrl: SOURCE, keyNamespace: NS })
    const brief = {
      segments: p.segments, clip_generation_plan: p.clip_generation_plan,
      max_new_clips: p.max_new_clips, copy: { hook: 'a', cta: 'b' }, creative_profile: {},
    }
    expect(() => assertRecipeBriefComplete(brief, RECIPE)).toThrow(/creative_recipe missing/)
  })
  it('缺 copy.hook → 拒(worker 不再用 angle 兜底)', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: 'x', sourceImageUrl: SOURCE, keyNamespace: NS })
    const brief = {
      creative_recipe: p.creative_recipe,
      segments: p.segments, clip_generation_plan: p.clip_generation_plan,
      max_new_clips: p.max_new_clips, copy: { cta: 'Book now' }, creative_profile: {},
    }
    expect(() => assertRecipeBriefComplete(brief, RECIPE)).toThrow(/hook \/ cta missing/)
  })
  it('idempotency_key 是占位符 → 拒(R5 竞态窗口)', () => {
    const p = buildRecipePlan({ recipe: RECIPE, angle: 'x', sourceImageUrl: SOURCE, keyNamespace: NS })
    p.clip_generation_plan[0].idempotency_key = '{work_order_id}:hook:0'
    const brief = {
      creative_recipe: p.creative_recipe,
      segments: p.segments, clip_generation_plan: p.clip_generation_plan,
      max_new_clips: p.max_new_clips, copy: { hook: 'a', cta: 'b' }, creative_profile: {},
    }
    expect(() => assertRecipeBriefComplete(brief, RECIPE)).toThrow(/placeholder/)
  })
})

// ── R6 source picker(mjs 侧)──────────────────────────────────────────────
describe('pickRecipeSourceOrReject(mjs · R6)', () => {
  it('有源图 → source', () => {
    expect(pickRecipeSourceOrReject(['  https://x.jpg  '], RECIPE)).toEqual({ source: 'https://x.jpg' })
  })
  it('空 pool → rejection with recipe id', () => {
    const out = pickRecipeSourceOrReject([], RECIPE)
    expect(out.rejection).toContain(RECIPE.id)
    expect(out.rejection).toContain('gate_data_unavailable')
  })
  it('全空值 → rejection', () => {
    expect(pickRecipeSourceOrReject([null, '', '   ', undefined], RECIPE).rejection).toMatch(/gate_data_unavailable/)
  })
})

// ── profile constraints ──────────────────────────────────────────────────
describe('assertRecipeProfileConstraints', () => {
  it('normalized profile 通过', () => {
    expect(() => assertRecipeProfileConstraints({ tts_enabled: false, caption_mode: 'short_big' }, RECIPE)).not.toThrow()
  })
  it('TTS 开着 → 拒', () => {
    expect(() => assertRecipeProfileConstraints({ tts_enabled: true }, RECIPE)).toThrow(/TTS_FORBIDDEN/)
  })
  it('kenburns 开着 → 拒', () => {
    expect(() => assertRecipeProfileConstraints({ kenburns: true }, RECIPE)).toThrow(/MOTION_FORBIDDEN/)
  })
  it('caption_mode 与 recipe 不同 → 拒', () => {
    expect(() => assertRecipeProfileConstraints({ caption_mode: 'lower_third' }, RECIPE)).toThrow(/CAPTION_MODE_MISMATCH/)
  })
})
