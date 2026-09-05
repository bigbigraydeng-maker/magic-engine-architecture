/**
 * Magic Insight 研究报告发布前核查 CLI。
 *
 * 用法：
 *   npx vite-node scripts/magic-insight-prepublish-check.ts -- <报告.html> [选项]
 *
 * 选项：
 *   --artifact <path>   声称做过的一手调研的产物（可重复）
 *   --receipt <path>    搜索类指标的实时拉取凭证（可重复）
 *   --source <name>     来源清单里的一个来源名（可重复，用于查装饰性引用）
 *   --json              输出 JSON 而不是人读格式
 *
 * 退出码：有 blocking 时为 1，便于挂进发布前的 CI 或 pre-commit。
 *
 * 为什么是 CLI 而不是只留个函数：2026-09-03 事故的教训是「靠自觉的清单等于没有」。
 * 只有能一条命令跑出来、并且能让流水线红掉的检查，才算真装上了闸。
 */

import { readFileSync } from 'node:fs'
import { runPrepublishCheck, type PrepublishFinding } from '../src/lib/magic-insight/prepublish-check'

interface CliOptions {
  file: string
  artifacts: string[]
  receipts: string[]
  sources: string[]
  json: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2).filter((a) => a !== '--')
  const opts: CliOptions = { file: '', artifacts: [], receipts: [], sources: [], json: false }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--artifact') opts.artifacts.push(args[(i += 1)] ?? '')
    else if (arg === '--receipt') opts.receipts.push(args[(i += 1)] ?? '')
    else if (arg === '--source') opts.sources.push(args[(i += 1)] ?? '')
    else if (!arg.startsWith('--') && !opts.file) opts.file = arg
  }

  if (!opts.file) {
    throw new Error('用法：magic-insight-prepublish-check.ts <报告.html> [--artifact p] [--receipt p] [--source n] [--json]')
  }
  return opts
}

const SEVERITY_LABEL: Record<PrepublishFinding['severity'], string> = {
  block: '🔴 拦截',
  warn: '🟡 提醒',
}

function printHuman(findings: PrepublishFinding[], blockingCount: number, file: string): void {
  console.log(`\nMagic Insight 发布前核查 — ${file}\n${'─'.repeat(60)}`)

  if (findings.length === 0) {
    console.log('✅ 全部通过，没有发现问题。')
    return
  }

  for (const f of findings) {
    console.log(`\n${SEVERITY_LABEL[f.severity]}  [${f.rule}]`)
    console.log(`  ${f.message}`)
    if (f.excerpt) console.log(`  原文：${f.excerpt.slice(0, 100)}`)
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(
    blockingCount > 0
      ? `🔴 有 ${blockingCount} 条拦截项，不可发布。修完再跑一次。`
      : `🟡 无拦截项，但有 ${findings.length} 条提醒，建议逐条看一眼。`
  )
}

function main(): void {
  const opts = parseArgs(process.argv)
  const source = readFileSync(opts.file, 'utf8')

  const report = runPrepublishCheck(
    { source, fieldworkArtifacts: opts.artifacts, dataPullReceipts: opts.receipts },
    opts.sources
  )

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHuman(report.findings, report.blocking.length, opts.file)
  }

  if (!report.passed) process.exit(1)
}

try {
  main()
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
