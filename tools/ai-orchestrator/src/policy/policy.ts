/**
 * Policy envelope: the limits and grants the runner checks before and after
 * every agent turn.
 *
 * Nothing here calls out to the network or reads a database. It is pure
 * evaluation over already-parsed values so the tests can drive every branch.
 */

import type {
  ImplementerTurnOutput,
  OrchestrationRun,
  SideEffectClass,
  StopReason,
  WorkPackageAuthorization,
  WorkPackageScope,
} from '../domain/schema'
import { ALWAYS_PROHIBITED_OPERATIONS } from '../domain/schema'
import { matchesAnyWildcard, selectMatching, selectNotMatching } from './glob'
import { selectProtected } from './protected-paths'

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorLimits {
  /** One round == one agent turn. */
  max_rounds: number
  cost_cap_usd: number
  max_wall_clock_ms: number
  /** How many schema-invalid provider outputs before the run is declared FAILED. */
  max_invalid_outputs: number
}

export const DEFAULT_LIMITS: OrchestratorLimits = {
  max_rounds: 6,
  cost_cap_usd: 2,
  max_wall_clock_ms: 20 * 60 * 1000,
  max_invalid_outputs: 2,
}

// ─────────────────────────────────────────────────────────────────────────────
// Kill switch — default off
// ─────────────────────────────────────────────────────────────────────────────

export const ENABLE_ENV_VAR = 'ME2_ORCHESTRATOR_ENABLED'
export const KILL_SWITCH_LABEL = 'me2-orchestrator:stop'

export interface KillSwitchInput {
  /** The workflow_dispatch `enabled` input. Defaults to false in the workflow. */
  workflowEnabledInput: boolean
  env: Readonly<Record<string, string | undefined>>
  issueLabels: readonly string[]
}

export interface KillSwitchResult {
  stopped: boolean
  reason: string | null
}

/**
 * Three independent ways to stop, all fail-closed. The env var must be the exact
 * string "true"; anything else — unset, empty, "1", "yes" — keeps the run off.
 */
export function evaluateKillSwitch(input: KillSwitchInput): KillSwitchResult {
  if (input.issueLabels.includes(KILL_SWITCH_LABEL)) {
    return { stopped: true, reason: `kill switch label "${KILL_SWITCH_LABEL}" is present` }
  }
  if (!input.workflowEnabledInput) {
    return { stopped: true, reason: 'workflow input `enabled` is false (default)' }
  }
  if (input.env[ENABLE_ENV_VAR] !== 'true') {
    return { stopped: true, reason: `${ENABLE_ENV_VAR} is not "true" (default off)` }
  }
  return { stopped: false, reason: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget
// ─────────────────────────────────────────────────────────────────────────────

export type BudgetResult =
  | { ok: true }
  | { ok: false; stop_reason: StopReason; message: string }

export function checkBudget(
  run: OrchestrationRun,
  limits: OrchestratorLimits,
  now: Date
): BudgetResult {
  const roundCap = Math.min(run.max_rounds, limits.max_rounds)
  if (run.current_round >= roundCap) {
    return {
      ok: false,
      stop_reason: 'max_rounds_reached',
      message: `round ${run.current_round} reached the cap of ${roundCap}`,
    }
  }

  const costCap = Math.min(run.cost_cap_usd, limits.cost_cap_usd)
  if (run.cumulative_cost_usd >= costCap) {
    return {
      ok: false,
      stop_reason: 'cost_cap_reached',
      message: `cumulative cost $${run.cumulative_cost_usd.toFixed(4)} reached the cap of $${costCap.toFixed(4)}`,
    }
  }

  if (now.getTime() >= Date.parse(run.deadline_at)) {
    return {
      ok: false,
      stop_reason: 'wall_clock_exceeded',
      message: `wall-clock deadline ${run.deadline_at} has passed`,
    }
  }

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope / tool / side-effect enforcement
// ─────────────────────────────────────────────────────────────────────────────

export type PolicyViolationCode =
  | 'PROTECTED_PATH_TOUCHED'
  | 'PATH_OUT_OF_SCOPE'
  | 'PATH_EXPLICITLY_DENIED'
  | 'TOOL_NOT_ALLOWED'
  | 'COMMIT_NOT_AUTHORIZED'
  | 'PR_NOT_AUTHORIZED'
  | 'AUTHORIZATION_EXPIRED'
  | 'SIDE_EFFECT_CLASS_NOT_ALLOWED'
  | 'PROHIBITED_OPERATION_MISSING'

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: PolicyViolationCode; message: string; offending: readonly string[] }

const ALLOWED: PolicyDecision = { allowed: true }

function deny(
  code: PolicyViolationCode,
  message: string,
  offending: readonly string[] = []
): PolicyDecision {
  return { allowed: false, code, message, offending }
}

export function enforceProtectedPaths(files: readonly string[]): PolicyDecision {
  const offending = selectProtected(files)
  if (offending.length > 0) {
    return deny(
      'PROTECTED_PATH_TOUCHED',
      'turn attempted to modify the control plane that governs it',
      offending
    )
  }
  return ALLOWED
}

export function enforceFileScope(scope: WorkPackageScope, files: readonly string[]): PolicyDecision {
  const denied = selectMatching(files, scope.denied_paths)
  if (denied.length > 0) {
    return deny('PATH_EXPLICITLY_DENIED', 'turn touched explicitly denied paths', denied)
  }

  const outOfScope = selectNotMatching(files, scope.allowed_paths)
  if (outOfScope.length > 0) {
    return deny('PATH_OUT_OF_SCOPE', 'turn touched paths outside the authorized scope', outOfScope)
  }

  return ALLOWED
}

export function enforceToolUse(scope: WorkPackageScope, tools: readonly string[]): PolicyDecision {
  const offending = tools.filter(
    (tool) =>
      matchesAnyWildcard(tool, scope.disallowed_tools) ||
      !matchesAnyWildcard(tool, scope.allowed_tools)
  )
  if (offending.length > 0) {
    return deny('TOOL_NOT_ALLOWED', 'turn used tools outside the allowlist', offending)
  }
  return ALLOWED
}

export function enforceAuthorizationWindow(
  authorization: WorkPackageAuthorization,
  now: Date
): PolicyDecision {
  if (Date.parse(authorization.expires_at) <= now.getTime()) {
    return deny(
      'AUTHORIZATION_EXPIRED',
      `work package ${authorization.work_package_id} expired at ${authorization.expires_at}`
    )
  }

  const declared = new Set(authorization.prohibited_operations)
  const missing = ALWAYS_PROHIBITED_OPERATIONS.filter((op) => !declared.has(op))
  if (missing.length > 0) {
    return deny(
      'PROHIBITED_OPERATION_MISSING',
      'authorization does not prohibit every always-prohibited operation',
      missing
    )
  }

  return ALLOWED
}

export function enforceSideEffectClass(
  authorization: WorkPackageAuthorization,
  permitted: readonly SideEffectClass[]
): PolicyDecision {
  if (!permitted.includes(authorization.side_effect_class)) {
    return deny(
      'SIDE_EFFECT_CLASS_NOT_ALLOWED',
      `side effect class "${authorization.side_effect_class}" is not permitted in this deployment`,
      [authorization.side_effect_class]
    )
  }
  return ALLOWED
}

/**
 * The single call the runner makes after an implementer turn. Order matters:
 * self-protection first, then scope, then tools, then write permissions — so the
 * most serious violation is the one that gets reported.
 */
export function evaluateImplementerTurn(
  authorization: WorkPackageAuthorization,
  output: ImplementerTurnOutput
): PolicyDecision {
  const checks: readonly PolicyDecision[] = [
    enforceProtectedPaths(output.files_changed),
    enforceFileScope(authorization.scope, output.files_changed),
    enforceToolUse(authorization.scope, output.tools_used),
  ]

  const violation = checks.find((decision) => !decision.allowed)
  if (violation) return violation

  if (output.commit_evidence && !authorization.scope.can_commit) {
    return deny('COMMIT_NOT_AUTHORIZED', 'turn reported a commit but committing is not authorized', [
      output.commit_evidence.commit_sha,
    ])
  }

  if (output.commit_evidence?.pr_number != null && !authorization.scope.can_open_draft_pr) {
    return deny('PR_NOT_AUTHORIZED', 'turn opened a pull request but that is not authorized', [
      String(output.commit_evidence.pr_number),
    ])
  }

  return ALLOWED
}
