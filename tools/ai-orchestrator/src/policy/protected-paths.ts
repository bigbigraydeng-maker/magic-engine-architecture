/**
 * The self-protection surface.
 *
 * These are the files that decide what the orchestrator is allowed to do. An
 * agent running under the orchestrator must never be able to change them in the
 * same run that they govern — otherwise every other guard in this directory is
 * advisory.
 *
 * Defence in depth (weakest listed last):
 *   1. GITHUB_TOKEN has no `workflows: write`, so GitHub itself rejects any push
 *      that touches `.github/workflows/**`. This holds on GitHub Free.
 *   2. `enforceProtectedPaths` below rejects the turn before anything is applied.
 *   3. `assertPolicyIntegrity` re-hashes these files after each turn and halts on
 *      drift.
 *   4. Branch protection + CODEOWNERS — NOT available on this repository today
 *      (private repo on the Free plan). Tracked as an Enable-phase blocker.
 */

import { createHash } from 'node:crypto'
import { matchesAnyGlob } from './glob'

export const PROTECTED_PATHS = [
  '.github/**',
  'CODEOWNERS',
  'tools/ai-orchestrator/src/policy/**',
  'tools/ai-orchestrator/src/prompts/**',
  'tools/ai-orchestrator/src/domain/state-machine.ts',
] as const

export function isProtectedPath(path: string): boolean {
  return matchesAnyGlob(path, PROTECTED_PATHS)
}

export function selectProtected(paths: readonly string[]): readonly string[] {
  return paths.filter(isProtectedPath)
}

// ─────────────────────────────────────────────────────────────────────────────
// Integrity snapshot
// ─────────────────────────────────────────────────────────────────────────────

/** path -> sha256 of the file contents, captured at run start. */
export type PolicySnapshot = Readonly<Record<string, string>>

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function snapshotPolicy(files: Readonly<Record<string, string>>): PolicySnapshot {
  const snapshot: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    snapshot[path] = hashContent(content)
  }
  return snapshot
}

export interface IntegrityResult {
  intact: boolean
  /** Files whose hash changed, plus files that appeared or disappeared. */
  drifted: readonly string[]
}

export function comparePolicySnapshots(before: PolicySnapshot, after: PolicySnapshot): IntegrityResult {
  const paths = Object.keys(before).concat(
    Object.keys(after).filter((path) => !(path in before))
  )
  const drifted: string[] = []

  for (const path of paths) {
    if (before[path] !== after[path]) drifted.push(path)
  }

  return { intact: drifted.length === 0, drifted: drifted.sort() }
}
