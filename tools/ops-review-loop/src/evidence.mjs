/**
 * Deterministic detectors for the delivery-quality signals `quality.mjs`
 * accepts, plus the specialised-evidence claims an A-level PR owes.
 *
 * 🔴 Every detector here reads only facts obtainable from the GitHub API or
 * the PR body text — never a judgement about whether the work is actually
 * good. That is the whole point of `quality.mjs`'s signal-table design (see
 * its header comment): a signal is present or it is not, and nothing in this
 * module infers intent, quality, or completeness from prose it cannot verify.
 *
 * The body patterns are keyed to the section headings
 * `docs/ENGINEERING_QUALITY_GATES.md` already asks every PR to write (风险级别
 * / 判定理由 / 验收条件 / 明确不做 / Reuse Statement). A PR that does not write
 * in that shape scores 0 on the matching signal — that is the incentive, not
 * a bug: a claim not made in a checkable form is not evidence.
 *
 * Pure module: no I/O, no clock. `tests/evidence.test.ts` exercises it
 * offline.
 */

/**
 * Regexes for the signals derivable from PR body text alone. Kept narrow and
 * literal on purpose — a pattern loose enough to match unrelated prose would
 * let a PR "earn" a signal by accident, and Codex's PR #1205 findings on this
 * same tool were all about exactly that kind of accidental leniency.
 */
const BODY_SIGNAL_PATTERNS = {
  'linked-issue': /(?:closes|fixes|resolves)\s+#\d+|(?:^|[^\w#])#\d+\b/i,
  'acceptance-criteria': /验收条件|验收证据|acceptance criteria/i,
  'scope-statement': /明确不做|不做的范围|out of scope/i,
  'reuse-statement': /reuse statement|复用声明/i,
  'failure-handling': /失败处理|fail[- ]closed|失败关闭|失败会/i,
  observability: /观测|observability|会被(?:谁|看见)|谁.{0,6}发现/i,
  'build-evidence': /npm run build|build\s*(?:通过|succeeded|结果|passed)/i,
  'test-output': /npx vitest|vitest run|npm test|测试命令/i,
}

/**
 * Which body-derived signal ids a PR body positively contains.
 *
 * @param {string|null|undefined} prBody
 * @returns {string[]}
 */
export function bodySignals(prBody) {
  if (typeof prBody !== 'string') return []
  return Object.entries(BODY_SIGNAL_PATTERNS)
    .filter(([, pattern]) => pattern.test(prBody))
    .map(([id]) => id)
}

/** Matches the same test-file shape `risk.mjs`'s C-safe rules recognise. */
const TEST_FILE_RULES = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /\/__tests__\//]

/** @param {string} path */
export function isTestFile(path) {
  return typeof path === 'string' && TEST_FILE_RULES.some((rule) => rule.test(path))
}

/**
 * True when the diff touches at least one non-test file and at least one
 * test file — "changed code has tests", not "the diff contains a test file"
 * (a test-only diff has nothing to pair a test against, and a code-only diff
 * has no test at all; neither is the signal this claims to be).
 *
 * @param {Array<{filename?: unknown}>|null|undefined} files
 * @returns {boolean}
 */
export function changedCodeHasTests(files) {
  if (!Array.isArray(files)) return false
  const paths = files.map((f) => f?.filename).filter((p) => typeof p === 'string')
  return paths.some(isTestFile) && paths.some((p) => !isTestFile(p))
}

/**
 * Whether the diff touches a dependency manifest without the body explaining
 * why. Absence of the file in the diff is the common case, and is treated as
 * "nothing to explain" per the signal's own name (`no-unexplained-dependency`).
 *
 * @param {Array<{filename?: unknown}>|null|undefined} files
 * @param {string|null|undefined} prBody
 * @returns {boolean}
 */
export function noUnexplainedDependency(files, prBody) {
  const touchesManifest = Array.isArray(files)
    ? files.some((f) => f?.filename === 'package.json' || f?.filename === 'package-lock.json')
    : false
  if (!touchesManifest) return true
  return /新增依赖|new dependency|依赖.{0,10}(?:理由|原因)|dependency.{0,20}(?:justif|reason|because)/i.test(
    prBody ?? '',
  )
}

/**
 * Assemble the full observed-signal list `quality.mjs`'s `scoreDelivery`
 * accepts, from facts a caller has already fetched.
 *
 * @param {{
 *   prBody?: string|null,
 *   files?: Array<{filename?: unknown}>|null,
 *   requiredCiPassed?: boolean,
 *   scopeGuardPassed?: boolean,
 *   riskRated?: boolean,
 *   specializedEvidenceComplete?: boolean,
 * }} [input]
 * @returns {string[]}
 */
export function collectObservedSignals({
  prBody,
  files,
  requiredCiPassed = false,
  scopeGuardPassed = false,
  riskRated = false,
  specializedEvidenceComplete = false,
} = {}) {
  const signals = new Set(bodySignals(prBody))
  if (requiredCiPassed) signals.add('required-ci-green')
  if (changedCodeHasTests(files)) signals.add('changed-code-has-tests')
  if (riskRated) signals.add('risk-rated')
  if (scopeGuardPassed) signals.add('scope-guard-green')
  if (specializedEvidenceComplete) signals.add('specialized-evidence-complete')
  if (noUnexplainedDependency(files, prBody)) signals.add('no-unexplained-dependency')
  return [...signals]
}

/**
 * Which specialised-evidence ids a PR body positively *claims* as addressed,
 * out of the ids `categories` could owe (see `quality.mjs`'s
 * `SPECIALIZED_EVIDENCE` table).
 *
 * A claim only counts on a *checked* list item — `- [x] ... (the-evidence-id)`
 * — never the id merely appearing somewhere in prose. `quality.mjs`'s own
 * header is explicit about why this asymmetry matters: an unchecked box or a
 * passing mention is not a positive assertion of completeness, and this
 * module must not manufacture one.
 *
 * @param {string|null|undefined} prBody
 * @param {Iterable<{id: string}>} requiredEvidence output of
 *   `quality.mjs`'s `requiredSpecializedEvidence`
 * @returns {string[]}
 */
export function observedSpecializedEvidence(prBody, requiredEvidence) {
  if (typeof prBody !== 'string') return []
  const observed = []
  for (const item of requiredEvidence) {
    const id = item?.id
    if (typeof id !== 'string' || id === '') continue
    const pattern = new RegExp(`^[ \\t]*-[ \\t]*\\[x\\][^\\n]*\\(${id}\\)`, 'im')
    if (pattern.test(prBody)) observed.push(id)
  }
  return observed
}
