/**
 * 一次性回填：给**更早的** Meta 广告线索补上来源标签。
 *
 * ## 背景
 *
 * `meta-lead.ts` 原来只在「新建 Mailchimp 会员」那一次请求里顺带带标签。人已经
 * 在名单里时 Mailchimp 回 400 `Member Exists`，整次请求作废 —— 标签一个字都没
 * 写进去。CTS 的线索绝大多数是回头客，所以来源标签整整一个月一条都没打上
 * （见 `src/lib/mailchimp/tags.ts` 文件头）。
 *
 * PR #1448 修好了往后的：每小时同步碰到已在名单里的人会补打标签。但那个同步
 * **只回看 24 小时内的线索**，更早的永远轮不到。2026-09-07 实测：修复上线后
 * `fb_lead` 从 33 涨到 35（窗口内真缺的那 2 条补上了），仍有 13 个更早的线索
 * 在名单里却没有标签。这个脚本补的就是那一批。
 *
 * ## 只加不摘
 *
 * 只 `add`，绝不 `remove` —— 摘标签会直接改变一个人收不收得到邮件，而这个脚本
 * 面对的是历史数据，我们对这些人身上别的标签一无所知。
 *
 * 人不在名单里就跳过并计数，**绝不新建联系人**（同 `tags.ts` 那条护栏：给一个
 * 来路不明的地址建人再打标签，等于凭空把他塞进营销名单）。
 *
 * ## 幂等
 *
 * `applyMemberTags` 先查后改，标签已经对了就不发写请求。跑第二遍是安全的、
 * 而且便宜（只有查询，没有写入）。
 *
 * 用法：
 *   npx tsx scripts/backfills/tag-historical-meta-leads.ts                 # 预演，零写入
 *   npx tsx scripts/backfills/tag-historical-meta-leads.ts --live          # 真的打
 *   npx tsx scripts/backfills/tag-historical-meta-leads.ts --client-id=<uuid>
 */

import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const LIVE = process.argv.includes('--live')
const clientIdArg = process.argv.find((a) => a.startsWith('--client-id='))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let ONLY_CLIENT_ID: string | null = null
if (clientIdArg) {
  const value = clientIdArg.slice('--client-id='.length).trim()
  if (!UUID_RE.test(value)) {
    // 空值或写错的 UUID 绝不能悄悄退化成「不过滤」—— 那会让一次本该只打
    // 一个客户的回填，误伤所有配了 Mailchimp 出口的客户。
    console.error(`--client-id 不是合法 UUID（收到 "${value}"），停手`)
    process.exit(1)
  }
  ONLY_CLIENT_ID = value
}

async function main() {
  // 动态引，等上面把 .env.local 灌进 process.env 之后再加载这些模块 ——
  // supabase 客户端在模块顶层就读 env。
  const { supabaseAdmin } = await import('../../src/lib/supabase')
  const { readAudienceId, readLeadSourceTag } = await import('../../src/lib/mailchimp/audience-config')
  const { applyMemberTags } = await import('../../src/lib/mailchimp/tags')
  const { evaluateDnc } = await import('../../src/lib/crm/meta-lead')

  const apiKey = process.env.MAILCHIMP_API_KEY ?? ''
  if (!apiKey.trim()) {
    console.error('缺 MAILCHIMP_API_KEY，停手')
    process.exit(1)
  }

  console.log(LIVE ? '模式：真的打标签\n' : '模式：预演（零写入）\n')

  let q = supabaseAdmin.from('clients').select('id, name')
  if (ONLY_CLIENT_ID) q = q.eq('id', ONLY_CLIENT_ID)
  const { data: clients, error: clientsErr } = await q
  if (clientsErr) {
    console.error('读客户列表失败:', clientsErr.message)
    process.exit(1)
  }

  const totals = { applied: 0, alreadyTagged: 0, notInAudience: 0, failed: 0, dncSkipped: 0 }

  for (const c of clients ?? []) {
    const audience = await readAudienceId(c.id)
    if (!audience.ok) {
      console.log(`⚠ ${c.name}: audience 配置读不出来（${audience.message}）—— 跳过，不猜`)
      continue
    }
    if (!audience.audienceId) continue // 这个客户没配出口，正常

    const tagRead = await readLeadSourceTag(c.id)
    if (!tagRead.ok) {
      console.log(`⚠ ${c.name}: 来源标签配置读不出来（${tagRead.message}）—— 跳过，不拿默认值糊`)
      continue
    }

    // 目标集合必须从「真的提交过 Meta Lead Form」这件事派生 —— 触点表
    // `contact_touchpoints.source = 'meta_lead_form'`，不能用联系人级的
    // `attr_platform`：官网表单带 Meta UTM 时也会把 attr_platform 写成
    // 'meta'（误伤），而 first-touch 是别的渠道、后来又交过 Meta 表单的人
    // 又会被漏掉（identity.ts 的 first-touch 规则不会覆盖 attr_platform）。
    const { data: touches, error: touchesErr } = await supabaseAdmin
      .from('contact_touchpoints')
      .select('contact_id')
      .eq('client_id', c.id)
      .eq('source', 'meta_lead_form')
    if (touchesErr) {
      console.log(`⚠ ${c.name}: 读触点失败（${touchesErr.message}）—— 跳过`)
      continue
    }
    const contactIds = [...new Set((touches ?? []).map((t) => t.contact_id))]
    if (!contactIds.length) continue

    const { data: contacts, error: contactsErr } = await supabaseAdmin
      .from('contacts')
      .select('id, primary_email')
      .in('id', contactIds)
      .not('primary_email', 'is', null)
    if (contactsErr) {
      console.log(`⚠ ${c.name}: 读客人失败（${contactsErr.message}）—— 跳过`)
      continue
    }
    if (!contacts?.length) continue

    console.log(`\n${c.name} —— ${contacts.length} 个 Meta 表单客人，标签 "${tagRead.tag}"`)
    const cfg = { apiKey, audienceId: audience.audienceId }
    const per = { applied: 0, alreadyTagged: 0, notInAudience: 0, failed: 0, dncSkipped: 0 }

    for (const row of contacts) {
      const email = String(row.primary_email).trim().toLowerCase()
      if (!email) continue

      // 复用 meta-lead.ts 正常入口写 Mailchimp 前用的同一份统一 DNC 判据 ——
      // 拒联或查询失败（fail closed）一律不打标签，避免把已拒联的人重新
      // 拉进 `fb_lead` 分段，被后续按标签群发再次触达。
      const dnc = await evaluateDnc(row.id)
      if (dnc !== 'ok') {
        per.dncSkipped++
        console.log(`  ⛔ 跳过（${dnc === 'blocked' ? '拒联' : 'DNC 查询失败'}）: ${mask(email)}`)
        continue
      }

      const r = await applyMemberTags(cfg, email, { add: [tagRead.tag] }, { dryRun: !LIVE })

      if (r.status === 'applied') {
        per.applied++
        console.log(`  ${LIVE ? '打上' : '会打上'}: ${mask(email)}`)
      } else if (r.status === 'noop') {
        per.alreadyTagged++
      } else if (r.status === 'skipped') {
        per.notInAudience++
      } else {
        per.failed++
        // 不回显邮箱以外的 provider 细节；错误原因本身不含 PII。
        console.log(`  ✗ 失败: ${mask(email)} —— ${r.reason}`)
      }
    }

    console.log(
      `  小计：${LIVE ? '打上' : '会打上'} ${per.applied} · 本来就有 ${per.alreadyTagged} · ` +
        `不在名单里 ${per.notInAudience} · DNC 跳过 ${per.dncSkipped} · 失败 ${per.failed}`,
    )
    totals.applied += per.applied
    totals.alreadyTagged += per.alreadyTagged
    totals.notInAudience += per.notInAudience
    totals.dncSkipped += per.dncSkipped
    totals.failed += per.failed
  }

  console.log(
    `\n合计：${LIVE ? '打上' : '会打上'} ${totals.applied} · 本来就有 ${totals.alreadyTagged} · ` +
      `不在名单里 ${totals.notInAudience} · DNC 跳过 ${totals.dncSkipped} · 失败 ${totals.failed}`,
  )
  if (!LIVE) console.log('\n这是预演，一个字都没写。确认没问题加 --live 再跑一遍。')
  if (totals.failed > 0) process.exit(1)
}

/** 日志里不回显完整邮箱。 */
function mask(email: string): string {
  return email.replace(/^(.).*(@.*)$/, (_m, a, b) => `${a}***${b}`)
}

main().catch((e) => {
  console.error('脚本挂了:', e)
  process.exit(1)
})
