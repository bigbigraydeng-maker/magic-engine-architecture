/**
 * GitHub-backed workspace inspector.
 *
 * Used when the run has a pull request: GitHub's own file list is the record of
 * what the branch contains, independent of both the model's self-report and of
 * whatever state a runner's working tree happens to be in.
 *
 * The fingerprint here is the PR file's `sha` (the blob), which gives the same
 * round-over-round delta property the git inspector gets from `hash-object`.
 */

import type { GitHubClient } from '../github/client'
import type { WorkspaceInspector, WorkspaceState } from './inspector'

export class GitHubPullRequestInspector implements WorkspaceInspector {
  readonly name = 'github-pr'

  constructor(
    private readonly client: GitHubClient,
    private readonly prNumber: number
  ) {}

  async capture(): Promise<WorkspaceState> {
    const [files, pr] = await Promise.all([
      this.client.listPullRequestFiles(this.prNumber),
      this.client.getPullRequest(this.prNumber),
    ])

    const fingerprints: Record<string, string> = {}
    for (const file of files) fingerprints[file.filename] = file.sha

    return {
      head_sha: pr?.head_sha ?? null,
      branch: pr?.head_ref ?? null,
      file_fingerprints: fingerprints,
      pull_request: pr,
      source: 'github:pr-files',
    }
  }
}

/**
 * Prefer GitHub's file list once a PR exists; fall back to the local git view
 * before then. Both are authoritative; neither is the model.
 */
export function selectInspector(args: {
  prNumber: number | null
  github: GitHubClient
  local: WorkspaceInspector
}): WorkspaceInspector {
  return args.prNumber === null
    ? args.local
    : new GitHubPullRequestInspector(args.github, args.prNumber)
}
