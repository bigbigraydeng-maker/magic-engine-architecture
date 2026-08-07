/**
 * The only GitHub surface the orchestrator is allowed to touch.
 *
 * Five methods, four of them read-only. There is deliberately no `merge`, no
 * `createRelease`, no `dispatchWorkflow` and no `updateBranchProtection` — an
 * operation that is absent from the interface cannot be reached by any amount of
 * prompt cleverness.
 *
 * `listPullRequestFiles` and `getPullRequest` exist so the runner can establish
 * what a turn actually changed without asking the model.
 */

export interface IssueComment {
  id: number
  author_login: string
  body: string
  created_at: string
}

export interface PullRequestFacts {
  number: number
  head_sha: string
  head_ref: string
  merged: boolean
}

export interface GitHubClient {
  readonly name: string
  listIssueComments(issueNumber: number): Promise<readonly IssueComment[]>
  listIssueLabels(issueNumber: number): Promise<readonly string[]>
  createIssueComment(issueNumber: number, body: string): Promise<IssueComment>
  /** Authoritative changed-file list for a PR. */
  listPullRequestFiles(prNumber: number): Promise<readonly string[]>
  /** Authoritative commit/branch/merge facts for a PR. */
  getPullRequest(prNumber: number): Promise<PullRequestFacts | null>
}
