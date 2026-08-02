import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncClientMail, type MailSyncClient } from '@/lib/microsoft/mail-ingest'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/mailbox-sync
 *
 * 每小时把每个**已连邮箱**的客户的新邮件接进 CRM。
 *
 * 为什么按小时、不按分钟：邮件不是即时通讯，客人不会指望十分钟内回；而每次
 * 跑都要读收件箱 + 已发送两个文件夹，频率越高越容易撞上 Graph 的限流，
 * 结果是**该来的信反而来得更慢**。
 *
 * 只跑连过邮箱的客户（platform_oauth_connections 里有一条 active 的
 * microsoft_mail）—— 没连的客户一次网络调用都不该为他发生。
 *
 * 一个客户失败不影响其他客户：syncClientMail 永不抛异常。
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 600

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const run = await startCronRun('mailbox-sync')

  // 先问「谁连了邮箱」，再按这批 id 取客户 —— 反过来（取全部客户再逐个试）
  // 会为每一个没连邮箱的客户白跑一次授权查询。
  const { data: conns, error: connErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('client_id')
    .eq('provider', MICROSOFT_MAIL_PROVIDER)
    .eq('status', CONNECTION_STATUS.ACTIVE)

  if (connErr) {
    await run.finish({ error: connErr.message })
    return NextResponse.json({ error: connErr.message }, { status: 500 })
  }

  const clientIds = Array.from(new Set((conns ?? []).map((c) => c.client_id as string)))
  if (clientIds.length === 0) {
    await run.finish({ processed: 0, completed: 0, failed: 0, summary: { note: '还没有客户连邮箱' } })
    return NextResponse.json({ ok: true, clients: 0, results: [] })
  }

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .in('id', clientIds)

  if (error) {
    await run.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = []
  for (const client of (clients ?? []) as MailSyncClient[]) {
    results.push(await syncClientMail(client))
  }

  const newContacts = results.reduce((n, r) => n + r.newContacts, 0)
  const messages = results.reduce((n, r) => n + r.messages, 0)
  const touchpoints = results.reduce((n, r) => n + r.touchpoints, 0)
  // 这次一共丢了多少封（noreply / 内部 / 读不出对方）。判据判错了要能从这个数
  // 看出规模 —— 突然从每天 30 跳到 300，就是有一类真客人被当成机器人了。
  const skippedMessages = results.reduce(
    (n, r) => n + r.skipped.reduce((m, s) => m + s.messages, 0),
    0,
  )
  const failed = results.filter((r) => r.error).length
  // 邮箱太忙一次没读完 —— 下一次水位线会接着读，但要说出来。
  const truncated = results.filter((r) => r.truncated).map((r) => r.clientId)

  await run.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { newContacts, messages, touchpoints, skippedMessages, truncated, results },
  })

  return NextResponse.json({
    ok: true,
    clients: results.length,
    newContacts,
    messages,
    touchpoints,
    skippedMessages,
    truncated,
    results,
  })
}
