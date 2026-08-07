/**
 * The only GitHub surface the orchestrator is allowed to touch.
 *
 * Three methods, two of them read-only. There is deliberately no `merge`, no
 * `createRelease`, no `dispatchWorkflow` and no `updateBranchProtection` — an
 * operation that is absent from the interface cannot be reached by any amount of
 * prompt cleverness.
 */

export interface IssueComment {
  id: number
  author_login: string
  body: string
  created_at: string
}

export interface GitHubClient {
  readonly name: string
  listIssueComments(issueNumber: number): Promise<readonly IssueComment[]>
  listIssueLabels(issueNumber: number): Promise<readonly string[]>
  createIssueComment(issueNumber: number, body: string): Promise<IssueComment>
}
