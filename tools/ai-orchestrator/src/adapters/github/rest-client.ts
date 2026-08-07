/**
 * Real GitHub REST client — safety skeleton for the Enable phase.
 *
 * Fails closed in two ways:
 *   - no token -> `MissingSecretError` at construction, before any network call;
 *   - `readOnly` (the default) -> `createIssueComment` throws instead of writing.
 *
 * The scaffold never constructs this client: the manual workflow runs with mock
 * providers and the in-memory client, so nothing here executes today.
 */

import { LedgerWriteBlockedError, MissingSecretError } from '../../domain/errors'
import type { RepositoryRef } from '../../domain/schema'
import type {
  GitHubClient,
  IssueComment,
  PullRequestFacts,
  PullRequestFile,
  PullRequestFileList,
} from './client'

export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN'

/** GitHub's maximum. Fewer per page means more round trips, not more safety. */
export const PR_FILES_PER_PAGE = 100
/** Bounds the walk. Hitting either bound is an error, not a truncation. */
export const MAX_PR_FILE_PAGES = 30
export const MAX_PR_FILES = 3000

export interface RestGitHubClientConfig {
  token: string | undefined
  repository: RepositoryRef
  /** Defaults to true. Writing requires an explicit opt-in from the caller. */
  readOnly?: boolean
  baseUrl?: string
  fetchImpl?: typeof fetch
}

interface RawComment {
  id: number
  body: string | null
  created_at: string
  user: { login: string } | null
}

interface RawLabel {
  name: string
}

interface RawPullRequest {
  number: number
  merged: boolean
  head: { sha: string; ref: string }
}

interface RawPullRequestFile {
  filename: string
  sha: string
}

export class RestGitHubClient implements GitHubClient {
  readonly name = 'github-rest'

  private readonly token: string
  private readonly repository: RepositoryRef
  private readonly readOnly: boolean
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(config: RestGitHubClientConfig) {
    if (!config.token) throw new MissingSecretError(GITHUB_TOKEN_SECRET)

    this.token = config.token
    this.repository = config.repository
    this.readOnly = config.readOnly ?? true
    this.baseUrl = config.baseUrl ?? 'https://api.github.com'
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API ${init?.method ?? 'GET'} ${path} failed: ${response.status}`)
    }

    return (await response.json()) as T
  }

  private get repoPath(): string {
    return `/repos/${this.repository.owner}/${this.repository.repo}`
  }

  async listIssueComments(issueNumber: number): Promise<readonly IssueComment[]> {
    const raw = await this.request<RawComment[]>(
      `${this.repoPath}/issues/${issueNumber}/comments?per_page=100`
    )
    return raw.map((comment) => ({
      id: comment.id,
      author_login: comment.user?.login ?? 'unknown',
      body: comment.body ?? '',
      created_at: comment.created_at,
    }))
  }

  async listIssueLabels(issueNumber: number): Promise<readonly string[]> {
    const raw = await this.request<RawLabel[]>(
      `${this.repoPath}/issues/${issueNumber}/labels?per_page=100`
    )
    return raw.map((label) => label.name)
  }

  /**
   * Walks every page.
   *
   * The first version asked for `per_page=100` and stopped, which silently
   * capped the authoritative file list at 100 entries: a protected or
   * out-of-scope file at position 101 never reached `evaluateImplementerTurn`.
   *
   * Every failure mode here is an exception, never a shorter list. A partial
   * answer that looks complete is worse than no answer, because the policy layer
   * cannot tell the difference.
   */
  async listPullRequestFiles(prNumber: number): Promise<PullRequestFileList> {
    const files: PullRequestFile[] = []
    const seen = new Set<string>()
    let page = 1

    for (; page <= MAX_PR_FILE_PAGES; page += 1) {
      const raw = await this.request<RawPullRequestFile[]>(
        `${this.repoPath}/pulls/${prNumber}/files?per_page=${PR_FILES_PER_PAGE}&page=${page}`
      )

      for (const file of raw) {
        // First occurrence wins, so the order is stable and a duplicate cannot
        // overwrite the entry the policy layer already reasoned about.
        if (seen.has(file.filename)) continue
        seen.add(file.filename)
        files.push({ filename: file.filename, sha: file.sha })
      }

      if (raw.length < PR_FILES_PER_PAGE) {
        return { files, pages_read: page, file_count: files.length }
      }

      if (files.length > MAX_PR_FILES) {
        throw new Error(
          `pull request #${prNumber} has more than ${MAX_PR_FILES} changed files; ` +
            'refusing to treat a capped list as the authoritative record'
        )
      }
    }

    throw new Error(
      `pull request #${prNumber} exceeded ${MAX_PR_FILE_PAGES} pages of files; ` +
        'refusing to treat a truncated list as the authoritative record'
    )
  }

  async getPullRequest(prNumber: number): Promise<PullRequestFacts | null> {
    const raw = await this.request<RawPullRequest>(`${this.repoPath}/pulls/${prNumber}`)
    return {
      number: raw.number,
      head_sha: raw.head.sha,
      head_ref: raw.head.ref,
      merged: raw.merged,
    }
  }

  async createIssueComment(issueNumber: number, body: string): Promise<IssueComment> {
    if (this.readOnly) {
      throw new LedgerWriteBlockedError('RestGitHubClient is in read-only mode')
    }

    const raw = await this.request<RawComment>(`${this.repoPath}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })

    return {
      id: raw.id,
      author_login: raw.user?.login ?? 'unknown',
      body: raw.body ?? '',
      created_at: raw.created_at,
    }
  }
}

/** Fail-closed factory. Returns a typed error rather than a half-built client. */
export function createRestGitHubClient(
  config: RestGitHubClientConfig
): { ok: true; client: GitHubClient } | { ok: false; error: MissingSecretError } {
  try {
    return { ok: true, client: new RestGitHubClient(config) }
  } catch (error) {
    if (error instanceof MissingSecretError) return { ok: false, error }
    throw error
  }
}
