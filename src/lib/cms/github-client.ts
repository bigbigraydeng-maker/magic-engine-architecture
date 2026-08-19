/**
 * Minimal GitHub REST API client for CMS Connector.
 *
 * Only implements the subset of GitHub API calls required to:
 *  1. Verify a PAT has repo write access (test connection)
 *  2. Read a file from a repo branch
 *  3. Create a new branch from a commit SHA
 *  4. Write (commit) a file to a branch
 *  5. Open a pull request
 *
 * Zero npm dependencies — uses native fetch (available in Node ≥ 18 / Next.js 14).
 *
 * Security: the PAT is passed via the Authorization header and is NEVER
 * included in error messages returned to callers. Errors only expose the
 * HTTP status code and GitHub's `message` field.
 */

import { GITHUB_API_BASE } from './vocabulary'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitHubRepo {
  full_name:        string
  default_branch:   string
  permissions?: {
    push:  boolean
    pull:  boolean
    admin: boolean
  }
}

export interface GitHubFileContent {
  sha:     string   // blob SHA — required for the PUT contents call
  content: string   // base64-encoded file content
  size:    number
}

export interface GitHubRef {
  object: { sha: string }
}

export interface GitHubPullRequest {
  number:   number
  html_url: string
  title:    string
}

// ─── GithubClient ─────────────────────────────────────────────────────────────

export class GithubClient {
  private readonly headers: Record<string, string>

  constructor(pat: string) {
    this.headers = {
      Authorization: `Bearer ${pat}`,
      Accept:        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    }
  }

  // ── Repo info ───────────────────────────────────────────────────────────────

  /**
   * Fetch repo metadata. Used to verify the PAT has read access.
   * Throws if the repo doesn't exist or the token lacks permission.
   */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>('GET', `/repos/${owner}/${repo}`)
  }

  // ── File read ───────────────────────────────────────────────────────────────

  /**
   * Read a file from a specific branch.
   * Returns the blob SHA (needed for the commit) and the decoded content.
   */
  async getFileContent(
    owner:  string,
    repo:   string,
    path:   string,
    branch: string,
  ): Promise<GitHubFileContent & { decodedContent: string }> {
    const raw = await this.request<GitHubFileContent>(
      'GET',
      `/repos/${owner}/${repo}/contents/${encodeFilePath(path)}?ref=${branch}`,
    )
    return {
      ...raw,
      decodedContent: Buffer.from(raw.content.replace(/\n/g, ''), 'base64').toString('utf8'),
    }
  }

  // ── Branch management ───────────────────────────────────────────────────────

  /**
   * Get the latest commit SHA on a branch.
   */
  async getBranchSha(owner: string, repo: string, branch: string): Promise<string> {
    const ref = await this.request<GitHubRef>(
      'GET',
      `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    )
    return ref.object.sha
  }

  /**
   * Create a new branch from a commit SHA.
   */
  async createBranch(
    owner:     string,
    repo:      string,
    newBranch: string,
    fromSha:   string,
  ): Promise<void> {
    await this.request('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${newBranch}`,
      sha: fromSha,
    })
  }

  // ── File commit ─────────────────────────────────────────────────────────────

  /**
   * Commit a file to a branch. Creates a new file if blobSha is omitted;
   * updates an existing file when blobSha (from getFileContent) is supplied.
   */
  async commitFile(
    owner:       string,
    repo:        string,
    path:        string,
    branch:      string,
    content:     string,  // UTF-8 content (will be base64-encoded for the API)
    message:     string,
    blobSha?:    string,  // omit to create a new file
  ): Promise<void> {
    await this.request('PUT', `/repos/${owner}/${repo}/contents/${encodeFilePath(path)}`, {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(blobSha !== undefined ? { sha: blobSha } : {}),
      branch,
    })
  }

  // ── Pull request ────────────────────────────────────────────────────────────

  /**
   * Open a pull request from `head` branch into `base` branch.
   *
   * `draft: true` opens the PR in Draft state (GitHub REST supports this
   * natively on `POST /repos/{owner}/{repo}/pulls`). Defaults to `false`
   * to keep existing callers' behavior unchanged.
   */
  async createPullRequest(
    owner: string,
    repo:  string,
    params: {
      title: string
      body:  string
      head:  string   // source branch
      base:  string   // target branch (e.g. "main")
      draft?: boolean // open as Draft PR (structural anti-auto-merge)
    },
  ): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(
      'POST',
      `/repos/${owner}/${repo}/pulls`,
      { ...params, draft: params.draft ?? false },
    )
  }

  /**
   * List open PRs whose head is `head` branch (formatted `owner:branch`).
   *
   * Used by `page.apply_optimization_request` capability to recover from the
   * 422 "A pull request already exists" case idempotently — that error is
   * NEVER retryable (state won't change), so we look up the existing PR and
   * return its number instead of letting Kernel burn retry budget.
   */
  async listPullRequestsByHead(
    owner: string,
    repo: string,
    headBranch: string,
  ): Promise<GitHubPullRequest[]> {
    // GitHub head filter is `owner:branch`; state=open covers our idempotency case
    // (Draft PRs count as open until merged/closed).
    return this.request<GitHubPullRequest[]>(
      'GET',
      `/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(headBranch)}`,
    )
  }

  /**
   * Read a PR's lifecycle state. Used by blog pr-sync (2026-08-01): posts in
   * status 'pr_open' poll this to learn whether the human merged or closed
   * the PR, so the post's status (and the site-content registry) stays true.
   */
  async getPullRequestState(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<{ state: 'open' | 'closed'; merged: boolean; mergedAt: string | null }> {
    const pr = await this.request<{
      state: 'open' | 'closed'
      merged: boolean
      merged_at: string | null
    }>(
      'GET',
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
    )
    return {
      state: pr.state,
      merged: pr.merged === true,
      mergedAt: pr.merged_at,
    }
  }

  /**
   * Read a PR's **full ownership shape** —— draft/state/head/base/body/merged。
   *
   * Used by `page.apply_optimization_request` capability to verify that any PR
   * we're about to close or adopt actually belongs to the current run
   * (body contains our `kernel_run_id` + `authorization_decision_id` receipt,
   * head === our owned branch, base === current default_branch, draft === true,
   * not merged). **This is the ownership proof for close/adopt paths.**
   *
   * Kept separate from `getPullRequestState` so existing pr-sync callers
   * (which only need lifecycle state) stay on the smaller return type.
   */
  async getPullRequestDetail(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<{
    number: number
    state: 'open' | 'closed'
    merged: boolean
    mergedAt: string | null
    draft: boolean
    headRef: string
    baseRef: string
    title: string
    body: string
    htmlUrl: string
  }> {
    const pr = await this.request<{
      number: number
      state: 'open' | 'closed'
      merged: boolean
      merged_at: string | null
      draft?: boolean
      head: { ref: string }
      base: { ref: string }
      title: string
      body: string | null
      html_url: string
    }>('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`)
    return {
      number: pr.number,
      state: pr.state,
      merged: pr.merged === true,
      mergedAt: pr.merged_at,
      draft: pr.draft === true,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      title: pr.title,
      body: pr.body ?? '',
      htmlUrl: pr.html_url,
    }
  }

  /**
   * Read a commit's **message** (used to verify a branch tip is ours by
   * looking for the `[kernel run <runId>]` marker embedded in our commit
   * message convention). Minimal shape — only what ownership check needs.
   */
  async getCommit(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<{ sha: string; message: string }> {
    const commit = await this.request<{
      sha: string
      commit: { message: string }
    }>('GET', `/repos/${owner}/${repo}/commits/${sha}`)
    return { sha: commit.sha, message: commit.commit.message }
  }

  /**
   * Close a pull request without merging.
   * Used by GEO-B+ Stage 1 B2: when re-publishing the same directive, the
   * previous still-open PR is closed and a fresh one opened, so review
   * history on the old PR is preserved rather than force-pushed away.
   */
  async closePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.request(
      'PATCH',
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
      { state: 'closed' },
    )
  }

  /**
   * Delete a branch reference. After closing a stale PR we tidy up the branch.
   * Safe to call when the branch is already gone (caller should swallow 404).
   */
  async deleteBranch(owner: string, repo: string, branch: string): Promise<void> {
    await this.request(
      'DELETE',
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    )
  }

  /**
   * List a directory's entries (name + path + type). Used by the SEO meta
   * executor to discover which data files exist before reading them, instead
   * of guessing filenames from URL slugs.
   */
  async listDirectory(
    owner:  string,
    repo:   string,
    path:   string,
    branch: string,
  ): Promise<Array<{ name: string; path: string; type: string }>> {
    return this.request<Array<{ name: string; path: string; type: string }>>(
      'GET',
      `/repos/${owner}/${repo}/contents/${encodeFilePath(path)}?ref=${branch}`,
    )
  }

  // ── Private request helper ──────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path:   string,
    body?:  unknown,
  ): Promise<T> {
    const url      = `${GITHUB_API_BASE}${path}`
    const response = await fetch(url, {
      method,
      headers: this.headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    if (!response.ok) {
      let message: string
      try {
        const json = await response.json() as { message?: string }
        message = json.message ?? response.statusText
      } catch {
        message = response.statusText
      }
      throw new GitHubApiError(response.status, message)
    }

    // 204 No Content (branch create returns 201, but guard anyway)
    const text = await response.text()
    if (!text) return undefined as unknown as T
    return JSON.parse(text) as T
  }
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`GitHub API ${status}: ${message}`)
    this.name = 'GitHubApiError'
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Encode forward slashes in paths for GitHub API URLs. */
function encodeFilePath(path: string): string {
  // Only encode special characters; forward slashes must stay as-is in the path.
  // GitHub's Contents API expects the path as-is with slashes.
  return path.split('/').map(encodeURIComponent).join('/')
}
