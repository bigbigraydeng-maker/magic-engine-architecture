/**
 * Minimal `fetch`-based GitHub REST client for the build-control CLIs.
 *
 * No SDK dependency — same reasoning as `tools/ops-review-loop/src/github.mjs`:
 * this has to run on a bare `ubuntu-latest` runner with only
 * `actions/setup-node`, before any `npm ci`, so the dispatch preflight can
 * block a Claude run without first installing the application's whole
 * dependency tree.
 *
 * Pagination is complete-or-throw, following
 * `tools/ai-orchestrator/src/adapters/github/rest-client.ts`: a page that fails
 * to fetch is a thrown error, never treated as the end of the list. A short
 * page (`length < per_page`) is the only legitimate way to stop.
 */

const API = 'https://api.github.com'
const PER_PAGE = 100

/**
 * @param {{ token: string, fetchImpl?: typeof fetch }} config
 */
export function createGitHubClient({ token, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('GitHub token is required — refusing to construct an unauthenticated client')

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  async function send(method, path, body) {
    return fetchImpl(`${API}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async function request(method, path, body) {
    const res = await send(method, path, body)
    if (!res.ok) throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${await res.text()}`)
    return res.status === 204 ? null : res.json()
  }

  /**
   * @param {string} pathWithoutPage e.g. `/repos/o/r/pulls?state=open`
   * @param {number} maxPages
   */
  async function paginate(pathWithoutPage, maxPages = 30) {
    const items = []
    const separator = pathWithoutPage.includes('?') ? '&' : '?'
    for (let page = 1; page <= maxPages; page += 1) {
      // Any failure here — network error, non-2xx, malformed JSON — propagates
      // out of `paginate`. There is no catch that could turn a failed page into
      // a shorter-but-"complete" list.
      const batch = await request('GET', `${pathWithoutPage}${separator}per_page=${PER_PAGE}&page=${page}`)
      if (!Array.isArray(batch)) {
        throw new Error(`GitHub API ${pathWithoutPage} page ${page} did not return an array`)
      }
      items.push(...batch)
      if (batch.length < PER_PAGE) return items
    }
    throw new Error(
      `${pathWithoutPage} exceeded ${maxPages} pages (${maxPages * PER_PAGE} entries); ` +
        'refusing to treat a truncated list as authoritative'
    )
  }

  const summarisePr = (pr) => ({
    number: pr.number,
    body: pr.body ?? '',
    isDraft: Boolean(pr.draft),
    state: pr.state,
    createdAt: pr.created_at,
    headSha: pr.head?.sha ?? null,
    headRef: pr.head?.ref ?? null,
  })

  return {
    /**
     * Every open PR (Draft included — GitHub's `state=open` already covers
     * Draft, so no separate `draft=` filter is applied or needed).
     * @param {{ owner: string, repo: string }} repo
     */
    async listOpenPullRequests({ owner, repo }) {
      return (await paginate(`/repos/${owner}/${repo}/pulls?state=open`)).map(summarisePr)
    },

    /** @param {{ owner: string, repo: string, prNumber: number }} args */
    async getPullRequest({ owner, repo, prNumber }) {
      const pr = await request('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`)
      return { ...summarisePr(pr), merged: Boolean(pr.merged) }
    },

    /** @param {{ owner: string, repo: string, issueNumber: number }} args */
    async listIssueComments({ owner, repo, issueNumber }) {
      const raw = await paginate(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, 50)
      return raw.map((c) => ({
        id: c.id,
        author: c.user?.login ?? null,
        body: c.body ?? '',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      }))
    },

    /** @param {{ owner: string, repo: string, issueNumber: number }} args */
    async listIssueLabels({ owner, repo, issueNumber }) {
      return (await paginate(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, 5)).map((l) => l.name)
    },

    /**
     * Creates the label only if it does not already exist. Used exclusively
     * for this system's own machine-output labels, so a fresh repository gets
     * a deterministic rollout instead of a silent 422 the first time a guard
     * needs to mark something.
     * @param {{ owner: string, repo: string, name: string, color: string, description: string }} args
     */
    async ensureLabelExists({ owner, repo, name, color, description }) {
      const existing = await send('GET', `/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`)
      if (existing.ok) return
      if (existing.status !== 404) {
        throw new Error(`GitHub API GET label failed: ${existing.status} ${await existing.text()}`)
      }
      await request('POST', `/repos/${owner}/${repo}/labels`, { name, color, description })
    },

    /** @param {{ owner: string, repo: string, issueNumber: number, name: string }} args */
    async addIssueLabel({ owner, repo, issueNumber, name }) {
      return request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, { labels: [name] })
    },

    /**
     * Idempotent: 404 means the label is not on the issue, which is already
     * the desired end state, so it is swallowed rather than thrown.
     * @param {{ owner: string, repo: string, issueNumber: number, name: string }} args
     */
    async removeIssueLabel({ owner, repo, issueNumber, name }) {
      const res = await send('DELETE', `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`)
      if (!res.ok && res.status !== 404) {
        throw new Error(`GitHub API DELETE label failed: ${res.status} ${await res.text()}`)
      }
    },

    /** @param {{ owner: string, repo: string, issueNumber: number, body: string }} args */
    async createIssueComment({ owner, repo, issueNumber, body }) {
      return request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body })
    },

    /** @param {{ owner: string, repo: string, issueNumber: number, state: 'open' | 'closed' }} args */
    async setIssueState({ owner, repo, issueNumber, state }) {
      return request('PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, { state })
    },

    /**
     * Writes a check run against an exact SHA.
     *
     * This is what makes an admission / merge-authorisation result attach to
     * the PR's *head*. A `pull_request_target` job's own status attaches to the
     * base branch, and an `issue_comment` event has no head SHA at all, so
     * without this neither event would ever produce a check a branch ruleset
     * could require on the code actually being merged.
     * @param {{ owner: string, repo: string, headSha: string, name: string, conclusion: 'success' | 'failure', title: string, summary: string }} args
     */
    async createCheckRun({ owner, repo, headSha, name, conclusion, title, summary }) {
      return request('POST', `/repos/${owner}/${repo}/check-runs`, {
        name,
        head_sha: headSha,
        status: 'completed',
        conclusion,
        output: { title, summary },
      })
    },
  }
}
