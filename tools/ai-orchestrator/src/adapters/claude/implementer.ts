/**
 * Claude implementer adapter — safety skeleton for the Enable phase.
 *
 * Decision (see docs/specs/2026-08-07-ai-orchestrator-v0.1.md §5): the Enable
 * phase drives Claude through `anthropics/claude-code-action@v1` inside the
 * runner, not through a bespoke SDK loop. The Action already owns git identity,
 * token exchange, tool sandboxing, `max_turns` and `timeout_minutes`; re-writing
 * those is exactly the wrong thing to hand-roll. The orchestrator core only ever
 * sees this interface, so swapping to the SDK later is a one-file change.
 *
 * v0.1 ships the guards, not the call.
 */

import { MissingSecretError, ProviderDisabledError, ProviderNotWiredError } from '../../domain/errors'
import type { ImplementerProvider, ProviderTurnResult, TurnRequest } from '../provider-types'

export const ANTHROPIC_API_KEY_SECRET = 'ME2_ORCHESTRATOR_ANTHROPIC_API_KEY'
export const DEFAULT_IMPLEMENTER_MODEL = 'claude-opus-5'

/**
 * Tools the implementer may never be granted, regardless of work package. These
 * are enforced again by `enforceToolUse` after the turn, so a provider that
 * ignores its own configuration is still caught.
 */
export const NEVER_ALLOWED_TOOLS = [
  'Bash(gh pr merge*)',
  'Bash(git push --force*)',
  'Bash(npx supabase*)',
  'Bash(render*)',
  'WebFetch',
] as const

export interface ClaudeImplementerConfig {
  enabled: boolean
  apiKey?: string
  model?: string
  allowedTools?: readonly string[]
  maxTurns?: number
  timeoutMinutes?: number
}

class ClaudeCodeActionProvider implements ImplementerProvider {
  readonly name = 'claude-code-action'

  constructor(private readonly config: Required<Omit<ClaudeImplementerConfig, 'enabled'>>) {}

  async implement(_request: TurnRequest): Promise<ProviderTurnResult> {
    void this.config
    throw new ProviderNotWiredError(this.name)
  }
}

export type ImplementerFactoryResult =
  | { ok: true; provider: ImplementerProvider }
  | { ok: false; error: MissingSecretError | ProviderDisabledError }

/** Fail-closed factory. */
export function createClaudeImplementer(
  config: ClaudeImplementerConfig
): ImplementerFactoryResult {
  if (!config.enabled) {
    return { ok: false, error: new ProviderDisabledError('claude-code-action') }
  }
  if (!config.apiKey) {
    return { ok: false, error: new MissingSecretError(ANTHROPIC_API_KEY_SECRET) }
  }
  return {
    ok: true,
    provider: new ClaudeCodeActionProvider({
      apiKey: config.apiKey,
      model: config.model ?? DEFAULT_IMPLEMENTER_MODEL,
      allowedTools: config.allowedTools ?? [],
      maxTurns: config.maxTurns ?? 12,
      timeoutMinutes: config.timeoutMinutes ?? 20,
    }),
  }
}
