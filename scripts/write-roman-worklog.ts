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

/** 摘要（≤300 字，中文，【GEO】格式）。内容为本次已确认的事实。 */
const SUMMARY =
  '【GEO】激活 Roman 21 页站点台账（canonical inventory，#930）；' +
  '建成 WP05 GEO Module v1 纯推理引擎（#879/#1032，geo-module/m1/v1 冻结语义：' +
  '认名/消歧/合格提及/推荐分级/rank，证据不足一律 defer，句子级绑定防误配）。' +
  '对 Roman #883 基线首次诊断：12 问里正文合格提及 2/12、explicit_positive 推荐 0/12、defer 0。' +
  'owned citation 2/12 是引用覆盖，M1 §7 明令不得当作提及/推荐，两者不可混。' +
  '下一步：①字段级 grounding 后产出 PageOptimizationRequest（现诚实 defer=unattributable_proposed_value）；' +
  '②WP09 页面写入（卡 cms_connections=0）；③WP10 归因回流。'

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
      // 幂等保护：同客户同日已有日志则不重复插（避免多次放行插重复行）。
      const { data: existing, error: readErr } = await sb
        .from('fde_work_logs')
        .select('id')
        .eq('client_id', ROMAN_CLIENT_ID)
        .eq('log_date', today)
      if (readErr) throw new Error(`预检读取失败：${readErr.message}`)
      if (existing && existing.length > 0) {
        process.stdout.write(`已存在 ${today} 的 Roman 工作日志（${existing.length} 条），不重复写入。\n`)
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
