#!/usr/bin/env node
/**
 * CREATE POLICY 必须写 TO 子句（#1326 静态闸）
 *
 * Postgres 里 CREATE POLICY 不写 TO = TO PUBLIC = 对所有角色生效（含 anon）。
 * 而 Supabase 默认给 anon/authenticated GRANT 了 public schema 全部表的增删改查，
 * 平时全靠 RLS 兜着 —— 漏写 TO 等于把兜底拆了。
 * 2026-08-03 实测：118 条策略这么漏，anon 用公开 key 读到了 outbound_prospects
 * 2678 行、conversation_messages 2135 行，还能 PATCH。
 *
 * 为什么默认只检查「本次改动的文件」而不是全仓：
 *   存量有一批历史文件漏写（数量见 --all 输出）。它们的实际暴露面已由
 *   20260803020000 在库层收紧，且 CI 的数据库不变量探针
 *   （.github/workflows/db-security-invariants.yml）会在末态兜住。
 *   一次性重写几十个历史 migration 是大 diff、高风险、低收益；
 *   真正要防的是**下一次**再写出漏 TO 的策略 —— 那正是这个闸的职责。
 *
 * 用法：
 *   node scripts/check-policy-to-clause.mjs            # 只查相对 origin/main 改动过的文件
 *   node scripts/check-policy-to-clause.mjs --all      # 全仓盘点（报存量，不影响退出码）
 *   node scripts/check-policy-to-clause.mjs --strict-all  # 全仓且存量也算失败
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { globSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const scanAll = args.has('--all') || args.has('--strict-all')
const strictAll = args.has('--strict-all')

const MIGRATIONS = 'supabase/migrations'

/** 去掉行注释和块注释，避免把注释里的示例当成真语句。 */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

/**
 * 找出所有 CREATE POLICY 语句并判断有没有 TO 子句。
 * 注意 CREATE POLICY 常跨多行写，所以按分号切语句，不按行。
 */
function findViolations(file) {
  const text = stripComments(readFileSync(file, 'utf8'))
  const out = []
  // 按分号切成语句；CREATE POLICY 内部不会出现裸分号。
  for (const stmt of text.split(';')) {
    if (!/\bcreate\s+policy\b/i.test(stmt)) continue
    // TO 子句：TO <role>[, <role>...]，出现在 USING / WITH CHECK 之前。
    if (/\bto\s+("?[a-z_][a-z0-9_]*"?)\s*(,|\s|$)/i.test(stmt.replace(/\bcreate\s+policy\b[\s\S]*?\bon\b/i, ''))) {
      // 再确认这个 TO 不是别的东西（例如 RENAME ... TO）——本分支里没有那种组合。
      if (/\bfor\s+\w+\s+to\s+/i.test(stmt) || /\bon\s+[^\s]+\s+(as\s+\w+\s+)?(for\s+\w+\s+)?to\s+/i.test(stmt)) continue
    }
    const name = (stmt.match(/create\s+policy\s+("?[^"\s]+"?)/i) || [])[1] || '<未命名>'
    const on = (stmt.match(/\bon\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)/i) || [])[1] || '<未知表>'
    out.push({ policy: name, table: on })
  }
  return out
}

function changedFiles() {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' })
  } catch {
    return null // 没有 origin/main（浅克隆等），退回全仓
  }
  const diff = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', 'origin/main...HEAD'],
    { encoding: 'utf8' })
  return diff.split('\n').filter(f => f.startsWith(MIGRATIONS + '/') && f.endsWith('.sql') && existsSync(f))
}

const allFiles = globSync(`${MIGRATIONS}/*.sql`).sort()
let targets
if (scanAll) {
  targets = allFiles
} else {
  targets = changedFiles()
  if (targets === null) {
    console.log('（拿不到 origin/main，退回全仓盘点模式，不影响退出码）')
    targets = allFiles
  }
}

const violations = []
for (const f of targets) {
  for (const v of findViolations(f)) violations.push({ file: f, ...v })
}

if (scanAll) {
  const byFile = new Map()
  for (const v of violations) byFile.set(v.file, (byFile.get(v.file) || 0) + 1)
  console.log(`全仓盘点：${allFiles.length} 个 migration 文件，${violations.length} 条 CREATE POLICY 漏写 TO 子句，涉及 ${byFile.size} 个文件。`)
  if (violations.length) {
    console.log('\n条数最多的 10 个文件：')
    ;[...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([f, n]) => console.log(`  ${n.toString().padStart(3)}  ${f.replace(MIGRATIONS + '/', '')}`))
  }
  if (!strictAll) {
    console.log('\n（--all 为盘点模式，存量不算失败。用 --strict-all 让存量也失败。）')
    process.exit(0)
  }
}

if (violations.length === 0) {
  console.log(`✅ CREATE POLICY TO 子句检查通过（检查了 ${targets.length} 个文件）`)
  process.exit(0)
}

console.error(`🛑 有 ${violations.length} 条 CREATE POLICY 漏写 TO 子句：\n`)
for (const v of violations) {
  console.error(`  ${v.file.replace(MIGRATIONS + '/', '')}`)
  console.error(`      策略 ${v.policy} ON ${v.table}`)
}
console.error(`
不写 TO 子句 = TO PUBLIC = 对所有角色生效，包含 anon。
Supabase 默认给 anon/authenticated GRANT 了 public schema 全部表的增删改查，
平时全靠 RLS 兜着 —— 漏写 TO 等于把兜底拆了（2026-08-03 实测泄露 118 条）。

正确写法（CLAUDE.md 模板）：
  CREATE POLICY "service_role_full" ON public.<表>
    FOR ALL TO service_role USING (true) WITH CHECK (true);
`)
process.exit(1)
