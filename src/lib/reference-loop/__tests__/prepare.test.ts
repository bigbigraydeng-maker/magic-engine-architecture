/**
 * Reference Loop adapter 单元测试（Issue #1041 Slice 1）
 *
 * 目的：只测「拼装 + 保血缘 + typed 失败」这三件事本身。
 *
 * 🔴 **不 mock 数据库、不 mock provider、不 mock 网络**——本模块根本不 import
 *    这些通道，没有可 mock 的对象。所有 fixture 都是 in-memory 的值。
 * 🔴 **不用 Magic Engine client_id 或客户台账里的 33 行页面**——任何 client_id /
 *    domain / URL 都是虚构 fixture，用来测拼装本身。
 * 🔴 **每个失败用例都断言 typed shape**（`ok:false` + `stage` + 非空 `reason`），
 *    绝不接受任何 throw 出来的裸异常穿透——那就等于沉默失败。
 */

import { describe, it, expect } from 'vitest'
import { prepareReferenceLoopChange } from '../prepare'
import type { ReferenceLoopInput } from '../types'
import type {
  GrowthEvidence,
  GrowthFinding,
  GrowthPrescription,
  GrowthVerificationDefinition,
} from '@/lib/growth'
import type {
  GithubPageSnapshot,
  PageOptimizationIntent,
  ProviderCheckInput,
  RedlineCheckInput,
  ResolvePageInput,
  UnavailablePageSnapshot,
  WordpressPageSnapshot,
} from '@/lib/page-optimization'

// ── fixtures（全部虚构，纯 in-memory）─────────────────────────────────────────

const CLIENT_ID = 'fixture-client-uuid-0000-0000-0000-000000000001'
const CLIENT_DOMAIN = 'example-fixture.test'
const TARGET_URL = 'https://example-fixture.test/pricing'
const FIXTURE_ISO = '2026-08-19T00:00:00.000Z'

const evidence: GrowthEvidence = {
  source: { kind: 'fixture', sourceId: 'row-1' },
  observedAt: FIXTURE_ISO,
  rawLocator: { known: true, value: 'fixture://row-1' },
  interpretation: { known: true, value: { parserVersion: 'test-v1' } },
  confidence: { known: true, value: 0.9 },
}

const finding: GrowthFinding = {
  pillar: 'seo',
  severity: 'medium',
  statement: 'Pricing page meta_title missing pillar keyword',
  evidence: [evidence],
}

const prescription: GrowthPrescription = {
  goalId: { known: false, reason: 'not_recorded_by_source' },
  covers: [finding],
  notDoing: [{ statement: 'not rewriting body copy', reason: 'out of scope for this batch' }],
  orderingRationale: 'meta first because it drives SERP snippet impressions',
}

const verification: GrowthVerificationDefinition = {
  metricRef: 'reference-loop/test/v1:pricing_snippet',
  windowDays: 14,
  baseline: 'fixture baseline before change',
  criteria: {
    success: 'snippet impressions +10% window over window',
    failure: 'snippet impressions -5% window over window',
    indeterminate: 'not_comparable falls here, never as failure',
  },
}

const intents: readonly PageOptimizationIntent[] = [
  {
    field: 'meta_title',
    proposedValue: 'Pricing — Reference Loop Fixture',
    semanticIntent: { known: true, value: 'add pillar keyword to title' },
  },
]

const providers: ResolvePageInput['providers'] = {
  github: {
    connected: true,
    provider: 'github',
    repoOwner: 'fixture-org',
    repoName: 'fixture-repo',
    branch: 'main',
    tokenHint: null,
    status: 'connected',
    lastError: null,
    lastTestedAt: FIXTURE_ISO,
    contentTargets: [],
  },
  wordpress: null,
  shopify: null,
}

const githubSnapshotOk: GithubPageSnapshot = {
  ok: true,
  provider: 'github',
  fetchedAt: FIXTURE_ISO,
  rawContent: [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<title>Pricing — Fixture</title>',
    '<meta name="description" content="Old description">',
    '</head><body>',
    '<!--CONTENT-START-->',
    '<h1>Pricing</h1>',
    '<!--CONTENT-END-->',
    '</body></html>',
  ].join('\n').replace(/CONTENT-START/g, 'MAGIC-ENGINE-CONTENT:START').replace(/CONTENT-END/g, 'MAGIC-ENGINE-CONTENT:END'),
  versionToken: 'blob-sha-abc123',
}

const snapshotUnavailable: UnavailablePageSnapshot = {
  ok: false,
  provider: 'shopify',
  reason: 'shopify has no update-page implementation',
}

const redlineOk: RedlineCheckInput = { available: true, phrases: ['forbidden phrase'] }
const providerCheckPass: ProviderCheckInput = { evaluated: true, passed: true }

function baseProvenance(): ReferenceLoopInput['provenance'] {
  return {
    clientIdSource: 'test.fixture',
    targetPageUrlSource: 'test.fixture',
    findingSource: 'test.fixture',
    prescriptionSource: 'test.fixture',
    intentsSource: 'test.fixture',
    snapshotSource: 'test.fixture.github',
    redlineSource: 'test.fixture',
    providerCheckSource: 'test.fixture',
    verificationSource: 'test.fixture',
    findingRefsSource: 'test.fixture',
    collectedAt: FIXTURE_ISO,
    window: { known: false, reason: 'not_applicable' },
  }
}

function baseInput(overrides: Partial<ReferenceLoopInput> = {}): ReferenceLoopInput {
  return {
    clientId: CLIENT_ID,
    clientDomain: CLIENT_DOMAIN,
    targetPageUrl: TARGET_URL,
    finding,
    prescription,
    findingRefs: ['finding://fixture/pricing-meta-gap'],
    intents,
    verification,
    providers,
    snapshot: githubSnapshotOk,
    redline: redlineOk,
    providerCheck: providerCheckPass,
    provenance: baseProvenance(),
    ...overrides,
  }
}

// ── happy path ──────────────────────────────────────────────────────────────

describe('happy path — finding + prescription → 合法 PageOptimizationRequest', () => {
  it('构造出完整 preparation，字段血缘全部保留', () => {
    const result = prepareReferenceLoopChange(baseInput())
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    const p = result.preparation

    // 顶层身份
    expect(p.clientId).toBe(CLIENT_ID)
    expect(p.targetPageUrl).toBe(TARGET_URL)

    // 血缘
    expect(p.findingRefs).toEqual(['finding://fixture/pricing-meta-gap'])
    expect(p.evidenceRefs).toEqual([
      { source: { kind: 'fixture', sourceId: 'row-1' }, observedAt: FIXTURE_ISO },
    ])

    // request 形状
    expect(p.request.clientId).toBe(CLIENT_ID)
    expect(p.request.page.url).toBe(TARGET_URL)
    expect(p.request.intents).toEqual(intents)
    expect(p.request.lineage.findingRefs).toEqual(['finding://fixture/pricing-meta-gap'])
    expect(p.request.verification).toEqual(verification)
    expect(p.request.constraints.doNotTouch).toEqual(['meta_description', 'content_html'])
    expect(p.request.basedOnVersion).toEqual({ known: true, value: 'blob-sha-abc123' })

    // 五段中间产物都保留
    expect(p.resolution.canonicalIdentity).toEqual({ known: true, value: { domain: 'example-fixture.test', normalizedPath: '/pricing' } })
    expect(p.snapshot).toBe(githubSnapshotOk)
    expect(p.draft.ok).toBe(true)
    expect(p.diff.ok).toBe(true)
    if (p.diff.ok) {
      expect(p.diff.changes).toHaveLength(1)
      expect(p.diff.changes[0].field).toBe('meta_title')
      expect(p.diff.changes[0].after).toBe('Pricing — Reference Loop Fixture')
      expect(p.diff.changes[0].changed).toBe(true)
    }
    expect(p.validation.ok).toBe(true)

    // verification / provenance 原样带回
    expect(p.verification).toEqual(verification)
    expect(p.provenance.collectedAt).toBe(FIXTURE_ISO)
    expect(p.provenance.snapshotSource).toBe('test.fixture.github')

    // adapter 派生的授权准备度：validation 通过 → validation_passed
    expect(p.authorizationReadiness).toBe('validation_passed')
  })

  it('WordPress snapshot 同样能走通（触及 draft/diff 的 WP 分支）', () => {
    const wpSnapshot: WordpressPageSnapshot = {
      ok: true,
      provider: 'wordpress',
      fetchedAt: FIXTURE_ISO,
      rawFields: {
        title: 'anything',
        content: '<p>body</p>',
        seoTitle: 'Old SEO Title',
        seoDescription: 'Old SEO Description',
      },
      versionToken: '2026-08-19T00:00:00',
    }
    const result = prepareReferenceLoopChange(baseInput({ snapshot: wpSnapshot }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preparation.request.basedOnVersion).toEqual({ known: true, value: '2026-08-19T00:00:00' })
  })
})

// ── stage: input ────────────────────────────────────────────────────────────

describe('stage=input — 输入非法一律 typed 失败，不吞异常', () => {
  it('clientId 为空 → input 失败（code=client_id_empty）', () => {
    const r = prepareReferenceLoopChange(baseInput({ clientId: '' }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'client_id_empty' })
    if (!r.ok) expect(r.reason).toContain('clientId')
  })

  it('targetPageUrl 为空 → input 失败（code=target_page_url_empty）', () => {
    const r = prepareReferenceLoopChange(baseInput({ targetPageUrl: '' }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'target_page_url_empty' })
  })

  it('findingRefs 为空 → input 失败（code=finding_refs_empty）', () => {
    const r = prepareReferenceLoopChange(baseInput({ findingRefs: [] }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'finding_refs_empty' })
    if (!r.ok) expect(r.reason).toContain('findingRefs')
  })

  it('findingRefs 含空串 → input 失败（code=finding_refs_contains_invalid）', () => {
    const r = prepareReferenceLoopChange(baseInput({ findingRefs: ['ok', ''] }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'finding_refs_contains_invalid' })
  })

  it('intents 为空 → input 失败（code=intents_empty）', () => {
    const r = prepareReferenceLoopChange(baseInput({ intents: [] }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'intents_empty' })
    if (!r.ok) expect(r.reason).toContain('intents')
  })

  it('intents 里字段不在冻结字段词汇内 → input 失败（code=intents_field_out_of_vocab）', () => {
    const bad = [{ field: 'og_image' as unknown as PageOptimizationIntent['field'], proposedValue: 'x', semanticIntent: { known: false, reason: 'not_applicable' } as const }]
    const r = prepareReferenceLoopChange(baseInput({ intents: bad }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'intents_field_out_of_vocab' })
    if (!r.ok) expect(r.reason).toContain('og_image')
  })

  it('intents.proposedValue 为空 → input 失败（code=intents_proposed_value_invalid）', () => {
    const bad: readonly PageOptimizationIntent[] = [
      { field: 'meta_title', proposedValue: '', semanticIntent: { known: false, reason: 'not_applicable' } },
    ]
    const r = prepareReferenceLoopChange(baseInput({ intents: bad }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'intents_proposed_value_invalid' })
  })

  it('同字段两条 intent → input 失败（code=intents_duplicate_field）', () => {
    const dup: readonly PageOptimizationIntent[] = [
      { field: 'meta_title', proposedValue: 'a', semanticIntent: { known: false, reason: 'not_applicable' } },
      { field: 'meta_title', proposedValue: 'b', semanticIntent: { known: false, reason: 'not_applicable' } },
    ]
    const r = prepareReferenceLoopChange(baseInput({ intents: dup }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'intents_duplicate_field' })
    if (!r.ok) expect(r.reason).toMatch(/不止一次/)
  })

  it('prescription 不覆盖给定的 finding → input 失败（code=prescription_lineage_mismatch）', () => {
    const otherFinding: GrowthFinding = { ...finding, statement: 'different statement' }
    const other: GrowthPrescription = { ...prescription, covers: [otherFinding] }
    const r = prepareReferenceLoopChange(baseInput({ prescription: other }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'prescription_lineage_mismatch' })
    if (!r.ok) expect(r.reason).toContain('血缘对不上')
  })

  it('verification 非法（windowDays<=0）→ input 失败（code=verification_invalid）', () => {
    const bad: GrowthVerificationDefinition = { ...verification, windowDays: 0 }
    const r = prepareReferenceLoopChange(baseInput({ verification: bad }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'verification_invalid' })
    if (!r.ok) expect(r.reason).toContain('verification')
  })

  it('finding 缺 evidence → input 失败（code=finding_invalid）', () => {
    const bad = { ...finding, evidence: [] as GrowthEvidence[] } as GrowthFinding
    const r = prepareReferenceLoopChange(baseInput({ finding: bad, prescription: { ...prescription, covers: [bad] } }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'finding_invalid' })
    if (!r.ok) expect(r.reason).toContain('finding')
  })

  it('prescription 本身畸形（orderingRationale 空）→ input 失败（code=prescription_invalid）', () => {
    const bad = { ...prescription, orderingRationale: '' } as GrowthPrescription
    const r = prepareReferenceLoopChange(baseInput({ prescription: bad }))
    expect(r).toMatchObject({ ok: false, stage: 'input', code: 'prescription_invalid' })
  })
})

// ── stage: resolve ──────────────────────────────────────────────────────────

describe('stage=resolve — client/target mismatch 一律 typed 失败', () => {
  it('URL 域名不属于本客户 → resolve 失败（code=canonical_identity_unknown）', () => {
    const r = prepareReferenceLoopChange(baseInput({ targetPageUrl: 'https://someone-else.test/pricing' }))
    expect(r).toMatchObject({ ok: false, stage: 'resolve', code: 'canonical_identity_unknown' })
    if (!r.ok) expect(r.reason).toContain('规范身份')
  })

  it('clientDomain 为 null → resolve 失败（code=canonical_identity_unknown）', () => {
    const r = prepareReferenceLoopChange(baseInput({ clientDomain: null }))
    expect(r).toMatchObject({ ok: false, stage: 'resolve', code: 'canonical_identity_unknown' })
  })

  it('targetPageUrl 不是合法 URL → resolve 失败（code=canonical_identity_unknown）', () => {
    const r = prepareReferenceLoopChange(baseInput({ targetPageUrl: 'not-a-url' }))
    expect(r).toMatchObject({ ok: false, stage: 'resolve', code: 'canonical_identity_unknown' })
  })
})

// ── stage: draft ────────────────────────────────────────────────────────────

describe('stage=draft — 快照不可用 / 起草失败 一律 typed 失败', () => {
  it('snapshot ok:false → draft 失败（code=draft_failed）', () => {
    const r = prepareReferenceLoopChange(baseInput({ snapshot: snapshotUnavailable }))
    expect(r).toMatchObject({ ok: false, stage: 'draft', code: 'draft_failed' })
    if (!r.ok) expect(r.reason).toContain('快照不可用')
  })

  it('GitHub snapshot 缺 <title> → draft 失败（code=draft_failed）', () => {
    const noTitle: GithubPageSnapshot = {
      ok: true,
      provider: 'github',
      fetchedAt: FIXTURE_ISO,
      rawContent: '<!doctype html><html><head><meta name="description" content="x"></head><body></body></html>',
      versionToken: 'sha-no-title',
    }
    const r = prepareReferenceLoopChange(baseInput({ snapshot: noTitle }))
    expect(r).toMatchObject({ ok: false, stage: 'draft', code: 'draft_failed' })
    if (!r.ok) expect(r.reason).toMatch(/<title>|meta description/)
  })
})

// ── stage: diff ─────────────────────────────────────────────────────────────

describe('stage=draft — 提前 fail-closed；空 diff 在 WP06 契约下不可达', () => {
  it('提案 content_html 但 snapshot 里没有 managed content 块 → draft 提前失败（不许构造伪 diff）', () => {
    // 🔴 这条用例的意义不是「测 diff 空」——WP06 现行契约下 diff 空不可达。
    //    它证明当 snapshot 缺 managed 块时，pipeline 在 **draft** 段就 fail-closed，
    //    不会跨过去把「不完整快照」当成「无需改动」。返回的 stage 精确指出问题在哪。
    const noManaged: GithubPageSnapshot = {
      ...githubSnapshotOk,
      rawContent: [
        '<!doctype html>',
        '<html><head><title>Pricing — Fixture</title><meta name="description" content="Old description"></head>',
        '<body><h1>Pricing</h1></body></html>',
      ].join('\n'),
    }
    const contentIntent: readonly PageOptimizationIntent[] = [
      { field: 'content_html', proposedValue: '<h1>New</h1>', semanticIntent: { known: false, reason: 'not_applicable' } },
    ]
    const r = prepareReferenceLoopChange(baseInput({ snapshot: noManaged, intents: contentIntent }))
    expect(r).toMatchObject({ ok: false, stage: 'draft', code: 'draft_failed' })
    if (!r.ok) {
      // 明确带回底层失败原因，不吞
      expect(r.reason.length).toBeGreaterThan(0)
    }
  })
})

// ── validation preserved (not stage=validate) ───────────────────────────────

describe('validation 不算 preparation 失败——判定被原样带回评审', () => {
  it('providerCheck evaluated:false → validation.ok:false + authorizationReadiness=validation_failed', () => {
    const r = prepareReferenceLoopChange(baseInput({ providerCheck: { evaluated: false, reason: 'not run in this fixture' } }))
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (!r.ok) return
    expect(r.preparation.validation.ok).toBe(false)
    if (!r.preparation.validation.ok) {
      expect(r.preparation.validation.reason).toContain('没算过')
    }
    expect(r.preparation.authorizationReadiness).toBe('validation_failed')
  })

  it('redline available:false → validation.ok:false + authorizationReadiness=validation_failed', () => {
    const r = prepareReferenceLoopChange(baseInput({ redline: { available: false, reason: 'redlines table missing' } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preparation.validation.ok).toBe(false)
    expect(r.preparation.authorizationReadiness).toBe('validation_failed')
  })

  it('命中红线短语 → validation.ok:false + authorizationReadiness=validation_failed，违规清单原样带回', () => {
    const hitting: readonly PageOptimizationIntent[] = [
      { field: 'meta_title', proposedValue: 'This contains a forbidden phrase and other words', semanticIntent: { known: false, reason: 'not_applicable' } },
    ]
    const r = prepareReferenceLoopChange(baseInput({ intents: hitting }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preparation.validation.ok).toBe(false)
    if (!r.preparation.validation.ok) {
      expect(r.preparation.validation.violations.join(' ')).toContain('forbidden phrase')
    }
    expect(r.preparation.authorizationReadiness).toBe('validation_failed')
  })
})

// ── ownership boundary (adapter-level) ──────────────────────────────────────

describe('ownership boundary — adapter 只核对 target URL 属于传入 clientDomain', () => {
  // 🔴 本 adapter 不核对 clientId ↔ clientDomain 归属；那必须由已鉴权的上游
  //    client context 保证，Kernel/apply 层在授权时会再验一次。以下四条只测
  //    「target URL vs clientDomain」这一条最小边界，不建新的 identity 抽象。

  it('userinfo URL 不能欺骗 host —— 真实主机在 @ 之后（不是 clientDomain）→ 拒', () => {
    // URL 语义：真实 host 是 attacker.test；userinfo 段的 example-fixture.test 只是伪装。
    const r = prepareReferenceLoopChange(baseInput({
      clientDomain: 'example-fixture.test',
      targetPageUrl: 'https://example-fixture.test@attacker.test/pricing',
    }))
    expect(r).toMatchObject({ ok: false, stage: 'resolve', code: 'canonical_identity_unknown' })
  })

  it('相似域名不能冒充自家 —— example-fixture.test.evil.com ≠ example-fixture.test → 拒', () => {
    const r = prepareReferenceLoopChange(baseInput({
      targetPageUrl: 'https://example-fixture.test.evil.com/pricing',
    }))
    expect(r).toMatchObject({ ok: false, stage: 'resolve', code: 'canonical_identity_unknown' })
  })

  it('clientDomain 带 sc-domain: 前缀 —— 底层 bareHost 正确剥离 → 通过', () => {
    const r = prepareReferenceLoopChange(baseInput({
      clientDomain: 'sc-domain:example-fixture.test',
    }))
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (!r.ok) return
    expect(r.preparation.resolution.canonicalIdentity).toEqual({
      known: true,
      value: { domain: 'example-fixture.test', normalizedPath: '/pricing' },
    })
  })

  it('subdomain 属于自家域 —— 底层规则允许 blog.<own> → 通过', () => {
    const r = prepareReferenceLoopChange(baseInput({
      targetPageUrl: 'https://blog.example-fixture.test/pricing',
    }))
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (!r.ok) return
    // canonicalIdentity 的 domain 字段返回的是 clientDomain（自家域），不是子域主机名——
    // 这一点是 WP06 resolveCanonicalIdentity 的既有语义（bareHost(clientDomain)），
    // 不属于本轮修改范围。
    expect(r.preparation.resolution.canonicalIdentity.known).toBe(true)
  })
})

// ── verification + provenance preservation ──────────────────────────────────

describe('verification / provenance / evidence refs / window 全部原样带回', () => {
  it('verification 对象在 request 与 preparation 里都是同一份', () => {
    const r = prepareReferenceLoopChange(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preparation.verification).toEqual(verification)
    expect(r.preparation.request.verification).toEqual(verification)
  })

  it('provenance.window 为已知区间时原样带回', () => {
    const prov = baseProvenance()
    const withWindow: ReferenceLoopInput['provenance'] = {
      ...prov,
      window: { known: true, value: { startAt: '2026-08-01T00:00:00.000Z', endAt: '2026-08-15T00:00:00.000Z' } },
    }
    const r = prepareReferenceLoopChange(baseInput({ provenance: withWindow }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preparation.provenance.window).toEqual({ known: true, value: { startAt: '2026-08-01T00:00:00.000Z', endAt: '2026-08-15T00:00:00.000Z' } })
  })

  it('evidence refs 从 finding.evidence 结构化抽取（不复制 payload、不改字段）', () => {
    const twoEv: GrowthFinding = {
      ...finding,
      evidence: [
        evidence,
        { source: { kind: 'other', sourceId: 'row-99' }, observedAt: '2026-08-18T00:00:00.000Z', rawLocator: { known: false, reason: 'not_recorded_by_source' }, interpretation: { known: false, reason: 'not_applicable' }, confidence: { known: false, reason: 'not_applicable' } },
      ],
    }
    const r = prepareReferenceLoopChange(baseInput({ finding: twoEv, prescription: { ...prescription, covers: [twoEv] } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preparation.evidenceRefs).toEqual([
      { source: { kind: 'fixture', sourceId: 'row-1' }, observedAt: FIXTURE_ISO },
      { source: { kind: 'other', sourceId: 'row-99' }, observedAt: '2026-08-18T00:00:00.000Z' },
    ])
  })
})

// ── side-effect surface（拼装本身证明无 apply/publish/DB/provider）──────────

describe('本层不 apply / publish / DB / provider —— 结构性证明', () => {
  it('preparation 不携带任何授权 / apply / execution 字段', () => {
    const r = prepareReferenceLoopChange(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const flat = JSON.stringify(r.preparation).toLowerCase()
    // 授权 / 执行相关关键字都不出现在 preparation payload 里
    for (const forbidden of ['approved', 'authorized', 'actionkey', 'execution_item', 'apply', 'commit_sha', 'published_at']) {
      expect(flat.includes(forbidden), `preparation payload 里出现了禁词 "${forbidden}"`).toBe(false)
    }
  })

  it('导出面只含 prepareReferenceLoopChange 一个运行时符号（其它都是 type-only）', async () => {
    const mod = await import('../index')
    expect(Object.keys(mod).sort()).toEqual(['prepareReferenceLoopChange'])
    expect(typeof mod.prepareReferenceLoopChange).toBe('function')
  })
})
