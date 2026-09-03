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

/**
 * 本次改动**新增**的 CREATE POLICY 语句。
 *
 * 为什么不是「改动过的文件里的全部策略」：那样太粗 —— 只改了某文件的一行种子，
 * 会把该文件里本来就存在的历史策略一起算成违规，把无关 PR 拦下。
 * 这里只看 diff 里的**新增行**：新建文件的全部内容算新增，改动文件只算 + 的那些行。
 *
 * 返回 null 表示拿不到 origin/main（浅克隆），调用方应退回盘点模式而不是判失败。
 */
function addedPolicyStatements() {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' })
  } catch {
    return null
  }
  // -U0：只要变更行本身，不要上下文
  const diff = execFileSync(
    'git', ['diff', '-U0', 'origin/main...HEAD', '--', MIGRATIONS],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )

  // 按文件收集新增行
  const addedByFile = new Map()
  let cur = null
  for (const line of diff.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/)
    if (m) { cur = m[1]; if (!addedByFile.has(cur)) addedByFile.set(cur, []); continue }
    if (!cur) continue
    if (line.startsWith('+') && !line.startsWith('+++')) addedByFile.get(cur).push(line.slice(1))
  }

  const out = []
  for (const [file, lines] of addedByFile) {
    if (!file.endsWith('.sql') || !existsSync(file)) continue
    // 新增行拼回一段文本再按语句解析。跨越新旧行的语句会被拆散，
    // 但那种情况下 CREATE POLICY 本身若是新增的，它的关键行必然在这里。
    const chunk = lines.join('\n')
    if (!/\bcreate\s+policy\b/i.test(stripComments(chunk))) continue
    for (const v of findViolations2(chunk)) out.push({ file, ...v })
  }
  return out
}

/** 跟 findViolations 同逻辑，但吃字符串而不是文件路径。 */
function findViolations2(rawText) {
  const text = stripComments(rawText)
  const out = []
  for (const stmt of text.split(';')) {
    if (!/\bcreate\s+policy\b/i.test(stmt)) continue
    if (/\bfor\s+\w+\s+to\s+/i.test(stmt) || /\bon\s+[^\s]+\s+(as\s+\w+\s+)?(for\s+\w+\s+)?to\s+/i.test(stmt)) continue
    const name = (stmt.match(/create\s+policy\s+("?[^"\s]+"?)/i) || [])[1] || '<未命名>'
    const on = (stmt.match(/\bon\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)/i) || [])[1] || '<未知表>'
    out.push({ policy: name, table: on })
  }
  return out
}

const allFiles = globSync(`${MIGRATIONS}/*.sql`).sort()
let violations = []

if (scanAll) {
  for (const f of allFiles) {
    for (const v of findViolations(f)) violations.push({ file: f, ...v })
  }
} else {
  const added = addedPolicyStatements()
  if (added === null) {
    // 浅克隆等拿不到 origin/main 的情况：退回盘点，**不判失败**。
    // 判失败会让 120 条历史存量把每个 PR 都拦下 —— 那不是这道闸的职责。
    console.log('（拿不到 origin/main，无法算 diff。退回全仓盘点，不影响退出码。）')
    let n = 0
    for (const f of allFiles) n += findViolations(f).length
    console.log(`全仓存量：${n} 条 CREATE POLICY 漏写 TO 子句。`)
    console.log('提示：CI 里给 actions/checkout 配 fetch-depth: 0 才能算 diff。')
    process.exit(0)
  }
  violations = added
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
  console.log('✅ CREATE POLICY TO 子句检查通过：本次改动没有新增漏写 TO 的策略')
  process.exit(0)
}

console.error(`🛑 本次改动新增了 ${violations.length} 条漏写 TO 子句的 CREATE POLICY：\n`)
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
