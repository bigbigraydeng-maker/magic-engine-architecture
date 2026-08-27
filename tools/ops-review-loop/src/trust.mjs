/**
 * The only identity this loop's own dev-gate records trust — the author
 * `gate-marker.mjs`'s `selectTrustedGateMarkers` is told to accept.
 *
 * Every marker this tool writes for itself (rating, quality decision) is
 * posted with the ambient `GITHUB_TOKEN`, which authors as exactly this
 * login. Two identities are deliberately excluded:
 *
 *   - The PR author. A gate marker is a verdict about the PR; letting the PR
 *     author's own login count would let them hand-type a downgrade (see
 *     gate-marker.mjs's header comment and tests).
 *   - `OPS_REVIEW_PAT`'s identity (a human Product Owner account). It posts
 *     "@codex review" because Codex only answers a human-authored comment —
 *     but that same human can comment on their own PRs for any reason, and
 *     trusting that account here would let an ordinary comment carry the
 *     same weight as this tool's own computed output.
 *
 * A single shared constant so every script that reads a gate marker uses the
 * same allowlist rather than each hand-typing the login and drifting apart.
 */
export const TRUSTED_GATE_AUTHORS = ['github-actions[bot]']
