/**
 * Deliberately tiny REST wrapper around Node's built-in fetch — no SDK
 * dependency, so this module runs on a bare `ubuntu-latest` runner with no
 * `npm ci` step. Every call here is I/O, so unlike the rest of this tool it is
 * not exercised by the offline unit tests; it is what a live run would prove.
 */
const API = 'https://api.github.com'

async function request(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.status === 204 ? null : res.json()
}

export function listIssueComments(token, owner, repo, issueNumber) {
  return request(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`)
}

export function createIssueComment(token, owner, repo, issueNumber, body) {
  return request(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
}

export function listReviewComments(token, owner, repo, pullNumber, reviewId) {
  return request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews/${reviewId}/comments?per_page=100`)
}

export function getPullRequest(token, owner, repo, pullNumber) {
  return request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}`)
}

export async function listCheckRunsForRef(token, owner, repo, ref) {
  const data = await request(token, `/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`)
  return data.check_runs ?? []
}

/**
 * Hard cap on pages fetched for one PR's changed-file list. 300 pages * 100
 * files = 30,000 changed files — far beyond anything this repo's PRs
 * produce, so hitting it means pagination itself is broken, not that the PR
 * is unusually large. It throws rather than returning a silently truncated
 * list: risk.mjs's whole "unreadable means A" rule depends on the caller
 * never handing it a partial file list dressed up as a complete one.
 */
const MAX_FILE_PAGES = 300

/**
 * Every file the PR changed, fully paginated. Each entry keeps whatever
 * GitHub returns — `filename`, `status`, `previous_filename` for renames —
 * so callers (risk.mjs's `classifyRisk`) can rate both ends of a rename.
 *
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number|string} pullNumber
 * @returns {Promise<Array<Record<string, unknown>>>}
 * @throws if a page request fails or pagination does not terminate within
 *   {@link MAX_FILE_PAGES}
 */
export async function listPullRequestFiles(token, owner, repo, pullNumber) {
  const files = []
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const batch = await request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`)
    files.push(...batch)
    if (batch.length < 100) return files
  }
  throw new Error(
    `pulls/${pullNumber}/files did not terminate within ${MAX_FILE_PAGES} pages — refusing to return a possibly-truncated list`,
  )
}
