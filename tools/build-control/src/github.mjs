/**
 * Minimal `fetch`-based GitHub REST client for the build-control CLIs.
 *
 * No SDK dependency — same reasoning as `tools/ops-review-loop/src/github.mjs`:
 * this has to run on a bare `ubuntu-latest` runner with only `actions/setup-node`,
 * before any `npm ci` step, so the dispatch preflight can block a Claude run
 * without first installing the whole application's dependency tree.
 *
 * Pagination is complete-or-throw, following
 * `tools/ai-orchestrator/src/adapters/github/rest-client.ts`: a page that
 * fails to fetch is a thrown error, never treated as the end of the list. A
 * short page (`length < per_page`) is the only legitimate way to stop.
 */

const API = 'https://api.github.com'
const PER_PAGE = 100

/**
 * @param {{ token: string, fetchImpl?: typeof fetch }} config
 */
export function createGitHubClient({ token, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('GitHub token is required — refusing to construct an unauthenticated client')

  async function request(path) {
    const res = await fetchImpl(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) {
      throw new Error(`GitHub API GET ${path} failed: ${res.status} ${await res.text()}`)
    }
    return res.json()
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
      // as a thrown exception out of `paginate`. There is no catch here that
      // could turn a failed page into a shorter-but-"complete" list.
      const batch = await request(`${pathWithoutPage}${separator}per_page=${PER_PAGE}&page=${page}`)
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

  return {
    /**
     * Every open PR (Draft included — GitHub's `state=open` already covers
     * Draft, so no separate `draft=` filter is applied or needed).
     * @param {{ owner: string, repo: string }} repo
     */
    async listOpenPullRequests({ owner, repo }) {
      const raw = await paginate(`/repos/${owner}/${repo}/pulls?state=open`)
      return raw.map((pr) => ({
        number: pr.number,
        body: pr.body ?? '',
        isDraft: Boolean(pr.draft),
        state: pr.state,
        createdAt: pr.created_at,
        headSha: pr.head?.sha ?? null,
        headRef: pr.head?.ref ?? null,
      }))
    },

    /** @param {{ owner: string, repo: string, prNumber: number }} args */
    async getPullRequest({ owner, repo, prNumber }) {
      const pr = await request(`/repos/${owner}/${repo}/pulls/${prNumber}`)
      return {
        number: pr.number,
        body: pr.body ?? '',
        isDraft: Boolean(pr.draft),
        state: pr.state,
        createdAt: pr.created_at,
        headSha: pr.head?.sha ?? null,
        headRef: pr.head?.ref ?? null,
        merged: Boolean(pr.merged),
      }
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
      const raw = await paginate(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, 5)
      return raw.map((l) => l.name)
    },

    /** @param {{ owner: string, repo: string, issueNumber: number, name: string }} args */
    async addIssueLabel({ owner, repo, issueNumber, name }) {
      const res = await fetchImpl(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ labels: [name] }),
      })
      if (!res.ok) throw new Error(`GitHub API POST labels failed: ${res.status} ${await res.text()}`)
      return res.json()
    },

    /**
     * Idempotent: GitHub returns 404 when the label is not on the issue,
     * which is already the desired end state, so it is swallowed rather than
     * thrown.
     * @param {{ owner: string, repo: string, issueNumber: number, name: string }} args
     */
    async removeIssueLabel({ owner, repo, issueNumber, name }) {
      const res = await fetchImpl(
        `${API}/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      )
      if (!res.ok && res.status !== 404) {
        throw new Error(`GitHub API DELETE label failed: ${res.status} ${await res.text()}`)
      }
    },

    /** @param {{ owner: string, repo: string, issueNumber: number, body: string }} args */
    async createIssueComment({ owner, repo, issueNumber, body }) {
      const res = await fetchImpl(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error(`GitHub API POST comment failed: ${res.status} ${await res.text()}`)
      return res.json()
    },

    /** @param {{ owner: string, repo: string, issueNumber: number, state: 'open' | 'closed' }} args */
    async setIssueState({ owner, repo, issueNumber, state }) {
      const res = await fetchImpl(`${API}/repos/${owner}/${repo}/issues/${issueNumber}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state }),
      })
      if (!res.ok) throw new Error(`GitHub API PATCH issue state failed: ${res.status} ${await res.text()}`)
      return res.json()
    },

    /**
     * Explicitly writes a check run on an exact SHA. This is what makes the
     * merge-authorisation check reflect reality after an `issue_comment`
     * event (the marker being posted), not only after a `pull_request` event
     * (a push) — a comment alone does not otherwise produce a new check
     * result tied to the PR's current head.
     * @param {{ owner: string, repo: string, headSha: string, name: string, conclusion: 'success' | 'failure', summary: string }} args
     */
    async createCheckRun({ owner, repo, headSha, name, conclusion, summary }) {
      const res = await fetchImpl(`${API}/repos/${owner}/${repo}/check-runs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          head_sha: headSha,
          status: 'completed',
          conclusion,
          output: { title: name, summary },
        }),
      })
      if (!res.ok) throw new Error(`GitHub API POST check-runs failed: ${res.status} ${await res.text()}`)
      return res.json()
    },
  }
}
