/**
 * Fixed manifest + reverse-discovery guard for the crawler.test.ts split
 * (Codex review on PR #963, P1 — the combined file exceeded the repo's
 * 800-line-per-file cap and was mechanically split by theme).
 *
 * 🔴 Splitting into multiple files creates a new silent-failure mode: a themed
 *    file can be deleted, renamed, or simply never created by a future editor,
 *    and `npm test` still exits green — it just silently runs fewer tests.
 *    There is no other single place that says "these are all the crawler
 *    suite files"; vitest's own glob discovery finds whatever happens to be
 *    on disk, so it can't detect a *missing* file, only run what exists.
 *
 *    This file is that single place. CRAWLER_SPLIT_TEST_FILES is the fixed
 *    manifest (updated by hand whenever a themed file is added or removed);
 *    the test below re-discovers what's actually on disk and diffs it against
 *    the manifest, so drift between "what should exist" and "what does exist"
 *    fails loudly instead of quietly shipping fewer tests.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join } from 'path'

export const CRAWLER_SPLIT_TEST_FILES = [
  'crawler-parsing.test.ts',
  'crawler-discovery.test.ts',
  'crawler-jina-fallback.test.ts',
  'crawler-crawling.test.ts',
  'crawler-ssrf-guard.test.ts',
  'crawler-safe-fetch-wiring.test.ts',
] as const

// This guard file's own name matches the crawler-*.test.ts glob below but is
// not one of the themed split files, so it's excluded from the comparison.
const SELF = 'crawler-test-files.test.ts'

describe('crawler.test.ts split — file manifest', () => {
  it('every file listed in the manifest actually exists on disk', () => {
    const dir = join(__dirname)
    const onDisk = new Set(readdirSync(dir))
    for (const file of CRAWLER_SPLIT_TEST_FILES) {
      expect(onDisk.has(file), `${file} is listed in CRAWLER_SPLIT_TEST_FILES but missing from disk`).toBe(true)
    }
  })

  it('every crawler-*.test.ts file on disk is registered in the manifest (reverse discovery)', () => {
    const onDisk = readdirSync(__dirname)
      .filter((f) => /^crawler-.*\.test\.ts$/.test(f))
      .filter((f) => f !== SELF)
      .sort()
    const manifest = [...CRAWLER_SPLIT_TEST_FILES].sort()
    expect(onDisk).toEqual(manifest)
  })
})
