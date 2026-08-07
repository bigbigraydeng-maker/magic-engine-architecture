/**
 * Git-backed workspace inspector and control-plane integrity checker.
 *
 * Both shell out through an injected `CommandRunner`, so the tested paths never
 * touch a real repository and the Enable phase can supply the real executor
 * without changing any logic here.
 *
 * Why both committed and uncommitted changes are collected: an implementer that
 * edits a protected file and simply does not commit it has still edited it, and a
 * `git diff base...HEAD` alone would report nothing.
 */

import { PROTECTED_PATHS } from '../../policy/protected-paths'
import type { ControlPlaneIntegrityChecker } from '../../policy/protected-paths'
import type { CommitFacts, WorkspaceInspector, WorkspaceSnapshot } from './inspector'

export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>

function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * `git status --porcelain` lines look like `XY path` or `XY old -> new` for
 * renames. Both sides of a rename count as changed.
 */
export function parsePorcelain(output: string): string[] {
  const paths: string[] = []
  for (const line of output.split('\n')) {
    if (line.trim().length === 0) continue
    const body = line.slice(3).trim()
    const arrow = body.indexOf(' -> ')
    if (arrow >= 0) {
      paths.push(body.slice(0, arrow).trim(), body.slice(arrow + 4).trim())
    } else {
      paths.push(body)
    }
  }
  return paths.map((path) => path.replace(/^"(.*)"$/, '$1'))
}

export interface GitWorkspaceInspectorOptions {
  /** The ref the run started from, e.g. `origin/main`. */
  baseRef: string
  run: CommandRunner
}

export class GitWorkspaceInspector implements WorkspaceInspector {
  readonly name = 'git'

  constructor(private readonly options: GitWorkspaceInspectorOptions) {}

  async inspect(): Promise<WorkspaceSnapshot> {
    const { baseRef, run } = this.options

    const [committed, working, sha, branch] = await Promise.all([
      run('git', ['diff', '--name-only', `${baseRef}...HEAD`]),
      run('git', ['status', '--porcelain']),
      run('git', ['rev-parse', 'HEAD']),
      run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    ])

    const changed = new Set<string>()
    for (const path of splitLines(committed)) changed.add(path)
    for (const path of parsePorcelain(working)) changed.add(path)

    const commit: CommitFacts | null = sha.trim()
      ? { sha: sha.trim(), branch: branch.trim() }
      : null

    return {
      changed_files: Array.from(changed).sort(),
      commit,
      pull_request: null,
      source: 'git:diff+status',
    }
  }
}

/**
 * Control-plane drift, asked of git rather than of the model.
 *
 * Scoped to the protected globs so an ordinary in-scope change does not read as
 * tampering.
 */
export class GitControlPlaneIntegrityChecker implements ControlPlaneIntegrityChecker {
  readonly name = 'git'

  constructor(private readonly options: { baseRef: string; run: CommandRunner }) {}

  async drift(): Promise<readonly string[]> {
    const { baseRef, run } = this.options
    const pathspec = PROTECTED_PATHS.map((pattern) => pattern.replace(/\/\*\*$/, ''))

    const [committed, working] = await Promise.all([
      run('git', ['diff', '--name-only', `${baseRef}...HEAD`, '--', ...pathspec]),
      run('git', ['status', '--porcelain', '--', ...pathspec]),
    ])

    const drifted = new Set<string>()
    for (const path of splitLines(committed)) drifted.add(path)
    for (const path of parsePorcelain(working)) drifted.add(path)

    return Array.from(drifted).sort()
  }
}
