/**
 * In-memory GitHub client used by the tests and by the dry-run harness.
 *
 * `writeCount` is the thing the dry-run tests assert on: it separates "the run
 * chose not to comment" from "the run tried to comment and the call failed",
 * which are the two ways an empty comment list can come about.
 */

import type { GitHubClient, IssueComment } from './client'

export class InMemoryGitHubClient implements GitHubClient {
  readonly name = 'in-memory'

  private readonly comments: IssueComment[]
  private readonly labels: string[]
  private nextId: number

  /** Number of write calls that actually reached this client. */
  writeCount = 0

  constructor(options?: {
    comments?: readonly IssueComment[]
    labels?: readonly string[]
    startId?: number
  }) {
    this.comments = [...(options?.comments ?? [])]
    this.labels = [...(options?.labels ?? [])]
    this.nextId = options?.startId ?? 1000
  }

  async listIssueComments(): Promise<readonly IssueComment[]> {
    return [...this.comments]
  }

  async listIssueLabels(): Promise<readonly string[]> {
    return [...this.labels]
  }

  async createIssueComment(_issueNumber: number, body: string): Promise<IssueComment> {
    this.writeCount += 1
    const comment: IssueComment = {
      id: this.nextId++,
      author_login: 'me2-orchestrator-bot',
      body,
      created_at: new Date().toISOString(),
    }
    this.comments.push(comment)
    return comment
  }

  /** Test helper: append a comment without counting it as an orchestrator write. */
  seedComment(comment: Omit<IssueComment, 'id'> & { id?: number }): IssueComment {
    const seeded: IssueComment = { ...comment, id: comment.id ?? this.nextId++ }
    this.comments.push(seeded)
    return seeded
  }

  addLabel(label: string): void {
    this.labels.push(label)
  }
}
