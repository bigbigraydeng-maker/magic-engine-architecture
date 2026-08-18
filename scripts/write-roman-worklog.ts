/**
 * WP05 · Roman 工作日志写入（Issue #879 / #1032）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 这是**唯一一次 INSERT**：向 fde_work_logs 写一条 Roman 本次会话的工作日志。
 *    别的什么都不写、不改、不删。由协调会话放行后运行（后台会被自动拒）。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 用主库 service-role 凭据（不走 MCP），同 diagnose-roman-geo.ts 的 .env.local 解析。
 *
 * 运行（由协调会话发起，PO 放行）：
 *   cd <worktree 根>
 *   npx tsx scripts/write-roman-worklog.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const ROMAN_CLIENT_ID = 'e7465ac7-4f3d-4d6a-afbe-d036ab419708'
const AUTHOR_EMAIL = 'bigbigraydeng@gmail.com'

/**
 * 本次工作日志的**来源标签**（Codex #1032 第 5 轮 C · 幂等键修）。
 *
 * 🔴 幂等键不是 `(client_id, log_date)`：`fde_work_logs` 允许同天多条不同来源的日志
 *    （PM 手写、其它 cron、别的 agent），只锁客户 + 日期会把当天更早的正常日志误当
 *    「本次已写」，导致本次实际工作**静默漏写**。幂等键改为
 *    `(client_id, log_date, summary 前缀 = SOURCE_TAG)`，只识别本会话来源、不吞别人的行。
 * 🔴 SOURCE_TAG **必须放在 summary 最前面**（用 `startsWith` / `LIKE 'tag%'` 匹配）。
 */
const SOURCE_TAG = '【GEO WP05 首诊】'

/**
 * 摘要长度硬上限（Codex #1032 第 5 轮 D）。
 *
 * 🔴 CLAUDE.md 会话结束协议明写「摘要格式 …≤300 字」。库列虽无长度约束、写入不会报错，
 *    但落进「客户 fde 日志」这种被人看的地方，超长静默入库是自欺。超限一律**抛错拒写**，
 *    不静默截断（截断会把关键事实吃掉）。
 */
const MAX_SUMMARY_CHARS = 300

/** 摘要（≤300 字，中文，SOURCE_TAG 起头）。本次事实。协调会话可按新诊断数字覆盖。 */
const SUMMARY =
  `${SOURCE_TAG}激活 Roman 21 页台账（#930）；` +
  'WP05 GEO Module v1 上线（#879/#1032），首诊 12 问：' +
  '正文合格提及 2/12、显式正向推荐 0/12、defer 0。' +
  'owned citation 2/12 是引用覆盖，M1 §7 不得当提及/推荐。' +
  '下一步：①grounding 后产出 PageOptimizationRequest' +
  '（现 defer=unattributable_proposed_value）；' +
  '②WP09 页面写入卡 cms_connections=0；③WP10 归因回流。'

// ── 极简 .env.local 解析（不引 dotenv 依赖，同 diagnose 脚本）──────────────────

function loadEnvLocal(): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

function makeClient(): SupabaseClient {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

function main(): void {
  const sb = makeClient()
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD（CURRENT_DATE 等价）

  Promise.resolve()
    .then(async () => {
      // ── D · 长度硬检查（Codex 第 5 轮 D）：超限拒写，不静默入库 ──
      if (SUMMARY.length > MAX_SUMMARY_CHARS) {
        throw new Error(
          `摘要 ${SUMMARY.length} 字超上限 ${MAX_SUMMARY_CHARS} 字，拒写。请压缩摘要后重跑。`,
        )
      }
      if (!SUMMARY.startsWith(SOURCE_TAG)) {
        throw new Error(`摘要必须以 SOURCE_TAG「${SOURCE_TAG}」起头（幂等键需要），拒写。`)
      }

      // ── C · 幂等保护（Codex 第 5 轮 C）：按 SOURCE_TAG 前缀识别本会话来源 ──
      //   PostgREST `like` 是大小写敏感精确前缀（`%` 通配后缀）。SOURCE_TAG 里的方括号
      //   不是 SQL LIKE 元字符（那是 `%` / `_`），所以直接拼即可。
      const { data: existing, error: readErr } = await sb
        .from('fde_work_logs')
        .select('id, summary')
        .eq('client_id', ROMAN_CLIENT_ID)
        .eq('log_date', today)
        .like('summary', `${SOURCE_TAG}%`)
      if (readErr) throw new Error(`预检读取失败：${readErr.message}`)
      if (existing && existing.length > 0) {
        process.stdout.write(
          `已存在 ${today} 的「${SOURCE_TAG}」工作日志（${existing.length} 条），不重复写入。\n`,
        )
        return
      }

      const { data, error } = await sb
        .from('fde_work_logs')
        .insert({
          client_id: ROMAN_CLIENT_ID,
          log_date: today,
          summary: SUMMARY,
          author_email: AUTHOR_EMAIL,
        })
        .select('id')
      if (error) throw new Error(`写入失败：${error.message}`)
      process.stdout.write(`✅ 已写入 Roman 工作日志（${today}），id=${JSON.stringify(data)}\n`)
    })
    .catch((err) => {
      process.stdout.write(`🔴 中止：${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}

main()
