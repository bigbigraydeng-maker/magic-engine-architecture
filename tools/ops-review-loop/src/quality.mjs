/**
 * Delivery quality score and the hard gates that outrank it.
 *
 * The risk level (see `risk.mjs`) decides *how much process* a PR goes through.
 * This module decides *whether the result is good enough to hand to the Product
 * Owner*. They are separate questions and are deliberately not blended: an
 * A-level change with excellent evidence still gets A's process, and a C-level
 * change with no evidence at all still fails.
 *
 * 🔴 **Why the score is a sum of named signals rather than a judgement.**
 *
 * A "score out of 100" produced by a model is a number with the shape of
 * evidence and none of the substance — and the model producing it is the same
 * one that wrote the code. So nothing here scores anything. `scoreDelivery`
 * accepts a list of *signal ids* that a caller has already observed
 * (a check run's conclusion, a section present in the PR body, a test file in
 * the diff), looks each one up in a fixed table, and adds up the points. A
 * signal that was not observed contributes 0; there is no partial credit and no
 * "looks about right" path. An id the table does not contain throws, rather
 * than being silently ignored — an invented signal must not be able to buy
 * points, and a renamed one must break loudly instead of quietly scoring zero.
 *
 * 🔴 **Why hard gates outrank the total.**
 *
 * Points are fungible; safety is not. A PR could reach 92 on documentation and
 * reuse while its required CI is red. `decideReadiness` therefore evaluates the
 * hard gates first and independently: red CI, an unresolved Codex P0/P1/P2 on
 * the current head, a rating bound to a stale sha, missing A-level evidence, or
 * *any* unreadable input blocks readiness at any score.
 *
 * 🔴 **What Codex does and does not contribute here.**
 *
 * The native Codex GitHub App posts prose ("### 💡 Codex Review", a
 * "**Reviewed commit:** `<sha>`" line, then findings) — verified against real
 * reviews on PR #1204 (2026-08-27, four reviews across four head shas). It does
 * not emit a machine-readable quality object, and this module does not pretend
 * otherwise: `CODEX_QUALITY_FIELDS` is exported as `unavailable` so a report can
 * say so out loud. Codex's contribution to this decision is exactly one fact —
 * how many P0/P1/P2 findings stand against the current head, via the existing
 * `severity.mjs` heuristic — and that fact is a hard gate, not a score.
 *
 * Pure module: no I/O, no clock. `tests/quality.test.ts` exercises it offline.
 */

/**
 * Codex quality reporting status. Reported verbatim so a summary never implies
 * a structured Codex verdict exists. See the module header for the evidence.
 */
export const CODEX_QUALITY_FIELDS = 'unavailable'

/**
 * The five scoring dimensions and their weights, straight from the Product
 * Owner's spec. Each dimension's signals must sum to exactly its `max`; a test
 * asserts that, so the table cannot drift into scoring out of 103.
 */
export const SCORE_DIMENSIONS = [
  {
    key: 'acceptance',
    max: 30,
    label: '需求与验收条件完成',
    signals: [
      { id: 'linked-issue', points: 10, label: 'PR 关联到 Issue / 需求卡' },
      { id: 'acceptance-criteria', points: 10, label: 'PR 正文写了验收条件' },
      { id: 'scope-statement', points: 10, label: 'PR 正文写了「明确不做」的范围声明' },
    ],
  },
  {
    key: 'tests',
    max: 25,
    label: '测试、构建和运行证据',
    signals: [
      { id: 'required-ci-green', points: 10, label: '必过 CI 检查 completed+success' },
      { id: 'build-evidence', points: 5, label: '有构建结果证据' },
      { id: 'test-output', points: 5, label: '有测试命令与结果证据' },
      { id: 'changed-code-has-tests', points: 5, label: 'diff 里非测试代码有配套测试改动' },
    ],
  },
  {
    key: 'security',
    max: 20,
    label: '安全、权限、客户隔离证据',
    signals: [
      { id: 'risk-rated', points: 5, label: '风险等级已绑定 base+head 落盘' },
      { id: 'scope-guard-green', points: 5, label: '爆炸半径闸门通过' },
      { id: 'isolation-evidence', points: 10, label: '有鉴权 / 权限 / 客户隔离的专项证据' },
    ],
  },
  {
    key: 'reuse',
    max: 15,
    label: '复用现有架构、没有重复建设',
    signals: [
      { id: 'reuse-statement', points: 10, label: '有 Reuse Statement（CLAUDE.md §0 强制）' },
      { id: 'no-unexplained-dependency', points: 5, label: '没有新依赖，或新依赖已说明理由' },
    ],
  },
  {
    key: 'resilience',
    max: 10,
    label: '失败处理、观测和恢复说明',
    signals: [
      { id: 'failure-handling', points: 5, label: '说明了失败时会怎样' },
      { id: 'observability', points: 5, label: '说明了失败会被谁 / 怎么发现' },
    ],
  },
]

/** Ready thresholds by risk level. */
export const READY_THRESHOLD = { A: 90, B: 85, C: 75 }

/**
 * Signals that must be present for an A-level PR to be Ready at all — the
 * "A 级缺少对应专项证据：不得 Ready" hard gate, expressed as data so the gate
 * and the score read the same table.
 */
export const A_REQUIRED_SIGNALS = ['isolation-evidence', 'required-ci-green']

/** id -> {dimension, points, label}, built once from the table above. */
const SIGNAL_INDEX = new Map(
  SCORE_DIMENSIONS.flatMap((dimension) =>
    dimension.signals.map((signal) => [signal.id, { dimension: dimension.key, ...signal }]),
  ),
)

/** @returns {string[]} every signal id the table knows about */
export function knownSignalIds() {
  return [...SIGNAL_INDEX.keys()]
}

/**
 * Add up the observed signals.
 *
 * @param {{signals?: Iterable<string>}} input observed signal ids
 * @returns {{total: number, dimensions: Array<{key: string, label: string, max: number, awarded: number, present: string[], missing: string[]}>}}
 * @throws if a signal id is not in the table
 */
export function scoreDelivery({ signals = [] } = {}) {
  const observed = new Set(signals)
  for (const id of observed) {
    if (!SIGNAL_INDEX.has(id)) {
      throw new Error(
        `unknown evidence signal "${id}" — 未登记的证据不许得分（已登记：${knownSignalIds().join(', ')}）`,
      )
    }
  }

  const dimensions = SCORE_DIMENSIONS.map((dimension) => {
    const present = dimension.signals.filter((s) => observed.has(s.id))
    const missing = dimension.signals.filter((s) => !observed.has(s.id))
    return {
      key: dimension.key,
      label: dimension.label,
      max: dimension.max,
      awarded: present.reduce((sum, s) => sum + s.points, 0),
      present: present.map((s) => s.id),
      missing: missing.map((s) => s.id),
    }
  })

  return { total: dimensions.reduce((sum, d) => sum + d.awarded, 0), dimensions }
}

/**
 * Collect every hard-gate blocker. Returns all of them, not the first: a report
 * that names one blocker invites a fix-and-retry cycle that discovers the next
 * one only after another full round.
 *
 * @param {{risk?: string, gates?: Record<string, unknown>|null, observedSignals?: Iterable<string>}} input
 * @returns {string[]}
 */
function hardGateBlockers({ risk, gates, observedSignals }) {
  const blockers = []
  const g = gates ?? {}

  if (g.evidenceReadable !== true) {
    blockers.push('读不到判定所需的证据 —— 失败关闭，不得当成「没有问题」')
  }
  if (g.shaMatches !== true) {
    blockers.push('评级 / 评分绑定的 commit 与当前 head 对不上 —— head 一动，旧结论立即作废')
  }
  if (g.requiredCiPassed !== true) {
    blockers.push(
      g.requiredCiPassed === null || g.requiredCiPassed === undefined
        ? '必过 CI 状态读不到 —— 按未通过处理'
        : '必过 CI 未通过',
    )
  }
  if (typeof g.openBlockerCount !== 'number') {
    blockers.push('当前 head 的 Codex 未解决问题数读不到 —— 按有问题处理')
  } else if (g.openBlockerCount > 0) {
    blockers.push(`当前 head 还有 ${g.openBlockerCount} 条 Codex P0/P1/P2 未解决`)
  }
  if (risk === 'A') {
    const observed = new Set(observedSignals ?? [])
    const missing = A_REQUIRED_SIGNALS.filter((id) => !observed.has(id))
    if (missing.length > 0) {
      blockers.push(`A 级缺少专项证据：${missing.join('、')}`)
    }
  }
  return blockers
}

/**
 * Final Ready / Blocked / Needs-product-decision call.
 *
 * `NEEDS_PRODUCT_DECISION` is never inferred from a low score or a stuck loop —
 * a technical dead end is a technical problem, and routing it to the Product
 * Owner as a "decision" is how a PM ends up carrying Codex comments around
 * again. It is returned only when the caller explicitly asserts a business
 * question exists (scope, money, a client fact, accepting a risk).
 *
 * Every input is optional on purpose: this function's contract is that missing
 * or unreadable evidence produces blockers, not a crash. A caller that cannot
 * fetch the check runs must be able to say so by passing nothing.
 *
 * @param {{risk?: string, score?: {total?: number}, gates?: Record<string, unknown>|null, observedSignals?: Iterable<string>}} [input]
 * @returns {{decision: 'READY_FOR_PRODUCT_OWNER'|'BLOCKED'|'NEEDS_PRODUCT_DECISION', ready: boolean, threshold: number, score: number, blockers: string[], productDecisionReason: string|null}}
 */
export function decideReadiness({ risk, score, gates, observedSignals } = {}) {
  const threshold = READY_THRESHOLD[risk] ?? READY_THRESHOLD.A
  const total = Number.isFinite(score?.total) ? score.total : -1
  const blockers = hardGateBlockers({ risk, gates, observedSignals })

  if (total < 0) {
    blockers.push('质量分算不出来 —— 失败关闭')
  } else if (total < threshold) {
    blockers.push(`质量分 ${total} 低于 ${risk} 级门槛 ${threshold}`)
  }

  const g = gates ?? {}
  if (g.productDecisionNeeded === true) {
    return {
      decision: 'NEEDS_PRODUCT_DECISION',
      ready: false,
      threshold,
      score: total,
      blockers,
      productDecisionReason: typeof g.productDecisionReason === 'string' ? g.productDecisionReason : null,
    }
  }

  return {
    decision: blockers.length === 0 ? 'READY_FOR_PRODUCT_OWNER' : 'BLOCKED',
    ready: blockers.length === 0,
    threshold,
    score: total,
    blockers,
    productDecisionReason: null,
  }
}
