/**
 * Manual, one-shot validation of the review-request identity.
 *
 * ME2-OPS02 required-validation item #6 — does the native Codex GitHub App
 * accept a bot-authored "@codex review"? — is ANSWERED, by production
 * evidence: it does not. Four bot-authored requests (PR #898 2026-08-11
 * 12:38/13:58, PR #924 2026-08-12 01:21/02:52) each drew "To use Codex here,
 * create a Codex account and connect to github", because Codex Cloud resolves
 * the request against the *comment author's* Codex account and
 * github-actions[bot] has none.
 *
 * So this script no longer posts as the bot. It posts through OPS_REVIEW_PAT
 * (the Product Owner's fine-grained PAT) and exists to prove that replacement
 * path works on demand, without waiting for a qualifying PR to get a commit.
 */
import { createIssueComment } from './github.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const pr = Number(process.env.PR_NUMBER)

if (!Number.isInteger(pr) || pr <= 0) {
  throw new Error(`PR_NUMBER must be a positive integer, got: ${process.env.PR_NUMBER}`)
}

await createIssueComment(
  token,
  owner,
  repo,
  pr,
  '@codex review\n\n<!-- ops-codex-loop:smoke-test -->\n\nME2-OPS02 smoke test: this comment was posted via workflow_dispatch through `OPS_REVIEW_PAT`, to confirm that a workflow-posted review request authored under the Product Owner account gets a real Codex review — the replacement for bot-authored requests, which Codex refuses.'
)
console.log(`Posted smoke-test "@codex review" comment on PR #${pr}. Now watch the PR for a Codex response.`)
