/**
 * Reads the PR's branch head and publishes it as a step output.
 *
 * Codex finding (PR #943, P2). The point of this file is the *timing*, not the
 * call: it runs in the step immediately before `claude-code-action`, so the
 * value it records brackets exactly one fix round.
 *
 * The alternative it replaces — comparing against the sha in the review event —
 * used a baseline that can be minutes stale. Anything pushed in that window (a
 * human, another automation, a second window on the same branch) would have
 * been read as "Claude pushed a fix", claimed in a PR comment, and charged
 * against the 3-round budget for work this loop never did.
 *
 * That is the same error the surrounding PR exists to fix, pointing the other
 * way: the first version trusted a step's exit code, this one would have
 * trusted any movement of the head. Neither is evidence about who moved it.
 */
import { appendFileSync } from 'node:fs'
import { getPullRequest } from './github.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const pr = Number(process.env.PR_NUMBER)

if (!Number.isInteger(pr) || pr <= 0) {
  throw new Error(`PR_NUMBER must be a positive integer, got: ${process.env.PR_NUMBER}`)
}

const head = (await getPullRequest(token, owner, repo, pr))?.head?.sha

if (typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head)) {
  throw new Error(`Could not read a usable head sha for PR #${pr}, got: ${head}`)
}

// A plain 40-char hex sha needs no delimiter games — but it is still written
// through the same key<<DELIM form the rest of the loop uses, and the value is
// validated above, so nothing attacker-influenced reaches this file.
appendFileSync(process.env.GITHUB_OUTPUT, `head_before<<OPS_LOOP_HEAD_EOF\n${head}\nOPS_LOOP_HEAD_EOF\n`)
console.log(`Branch head before this fix round: ${head}`)
