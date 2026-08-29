/**
 * The small amount of runtime plumbing every build-control CLI needs:
 * step-summary output, job outputs, allowlist parsing and required-env
 * checking. Shared so five entrypoints cannot disagree about, say, whether an
 * empty allowlist is fatal.
 */
import { appendFileSync } from 'node:fs'

/** @param {string} text */
export function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
}

/** @param {string} name @param {string} value */
export function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

/**
 * @param {string[]} names
 * @returns {Record<string, string>}
 */
export function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`missing required environment variable(s): ${missing.join(', ')}`)
    process.exit(1)
  }
  return Object.fromEntries(names.map((name) => [name, String(process.env[name])]))
}

/**
 * An empty allowlist is fatal for every caller: "trusted by nobody" must fail
 * closed, never degrade into "trusted by anybody".
 * @param {string} name
 * @returns {string[]}
 */
export function requireAllowlist(name) {
  const logins = (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (logins.length === 0) {
    summary(`## ❌ Build Control：\`${name}\` 未配置，按失败处理（空 allowlist 不等于放行）`)
    process.exit(1)
  }
  return logins
}

/** @param {string} repository `owner/repo` */
export function splitRepository(repository) {
  const [owner, repo] = repository.split('/')
  return { owner, repo }
}
