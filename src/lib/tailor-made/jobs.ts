import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

/** 给一段输入内容算个短指纹，只用来判断"是不是同一次提交"，不追求密码学强度。 */
export function fingerprintInput(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * tailor_made_jobs 的读写。
 *
 * 存在的原因：ME 后台正式域名走 Cloudflare 代理，CF 对被代理的请求有约 100
 * 秒等待上限。27 天以上的团光生成就要 100-180 秒，同步一个 HTTP 请求等 AI
 * 写完这套做法在这类超长团上必然被 CF 掐断——见 CTS 2027 China Panorama
 * 报障。这张表把「建任务」和「跑任务」拆开：POST 只建行立刻回，AI 调用放进
 * fire-and-forget 的后台函数，前端改成轮询这张表拿结果。
 *
 * ⚠️ 租户隔离靠代码，不靠 RLS，见 store.ts 同一条注释——每个查询都必须带 client_id。
 */

const TABLE = 'tailor_made_jobs'

export type TailorMadeJobKind = 'import_file' | 'extract_text'
export type TailorMadeJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface TailorMadeJobRow {
  id: string
  client_id: string
  itinerary_id: string
  kind: TailorMadeJobKind
  status: TailorMadeJobStatus
  /** 排查用的轻量元信息（文件名/来源类型等）——真正的输入在同进程闭包里传值，不落库 */
  input: unknown
  result: unknown
  error: string | null
  created_at: string
  completed_at: string | null
}

const ACTIVE_STATUSES: TailorMadeJobStatus[] = ['queued', 'running']

/**
 * 一个任务超过这么久还没跑完，就当它是僵尸任务（Render 部署重启 / 进程被杀
 * 死在半路，没人再去 markCompleted/markFailed）。
 *
 * 没有这道判断的后果不是"轮询超时"这么轻——createOrReuseJob 的复用逻辑会
 * 一直认为"还有任务在跑"，永远把新请求导向这条早就死透的旧任务，用户往后
 * 每一次重新上传都会静默失败（点了没反应，因为其实在复用一个不会再更新的
 * 僵尸行）。跟前端 10 分钟轮询上限对齐，双保险：前端等太久会自己报错，
 * 这里保证服务端也不会永远认为旧任务还活着。
 */
const STALE_MS = 10 * 60 * 1000

function staleCutoffIso(): string {
  return new Date(Date.now() - STALE_MS).toISOString()
}

/**
 * 清掉这个 (client_id, itinerary_id, kind, fingerprint) 组合下卡住的僵尸任务。
 *
 * 必须在查 active / 插入之前做：数据库那道部分唯一索引（同一组合最多一条
 * queued/running）不知道"僵尸"这个概念，只要 status 还是 running 它就会
 * 挡住新任务插入。不先清，一条真正死掉的任务会把这个组合永久锁死。
 */
async function sweepStaleForKey(
  clientId: string, itineraryId: string, kind: TailorMadeJobKind, fingerprint: string
): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ status: 'failed', error: '任务卡住了，很可能是服务重启导致没跑完。请重新提交一次', completed_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('itinerary_id', itineraryId)
    .eq('kind', kind)
    .eq('input_fingerprint', fingerprint)
    .in('status', ACTIVE_STATUSES)
    .lt('created_at', staleCutoffIso())
}

/**
 * 建任务。同一份行程、同一种任务、**同一份输入内容**如果还有没跑完的，直接
 * 复用它而不是新开一条——防手抖连点两次上传，白白多花一次 AI 调用的钱。
 *
 * 内容不同的两次提交永远各建各的任务，不能互相复用：两个人（或两个标签页）
 * 几乎同时对同一份行程提交了不同的文件/文字，如果只按行程+任务种类判断，
 * 第二份提交的输入会被无声丢弃，第一份的结果还会被错当成第二份的结果应用
 * 到编辑器上（Codex 复审点出来的真实场景）。fingerprintInput() 就是干这个的。
 *
 * 并发安全靠数据库的部分唯一索引（uniq_tailor_made_jobs_active），不是这里
 * 的「先查后插」——两个请求间隔太近时查询看到的都是"没有活跃任务"，真正
 * 挡住重复插入的是插入时的唯一约束冲突（23505），冲突后退化为复用先建成
 * 的那条，而不是把错误甩给调用方。
 */
export async function createOrReuseJob(params: {
  clientId: string
  itineraryId: string
  kind: TailorMadeJobKind
  inputFingerprint: string
  input: unknown
}): Promise<{ jobId: string; reused: boolean }> {
  const { clientId, itineraryId, kind, inputFingerprint, input } = params

  await sweepStaleForKey(clientId, itineraryId, kind, inputFingerprint)

  const activeJob = async () => {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('id')
      .eq('client_id', clientId)
      .eq('itinerary_id', itineraryId)
      .eq('kind', kind)
      .eq('input_fingerprint', inputFingerprint)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw new Error(`查询任务失败：${error.message}`)
    return data && data.length > 0 ? (data[0].id as string) : null
  }

  const existingId = await activeJob()
  if (existingId) return { jobId: existingId, reused: true }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({ client_id: clientId, itinerary_id: itineraryId, kind, input_fingerprint: inputFingerprint, input, status: 'queued' })
    .select('id')
    .single()

  if (error) {
    // 唯一索引冲突（23505）= 并发请求刚好抢先建了一条活跃任务，复用它
    if (error.code === '23505') {
      const winnerId = await activeJob()
      if (winnerId) return { jobId: winnerId, reused: true }
    }
    throw new Error(`建任务失败：${error.message}`)
  }
  return { jobId: data.id as string, reused: false }
}

export async function getJob(clientId: string, jobId: string): Promise<TailorMadeJobRow | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('id', jobId)
    .maybeSingle()

  if (error) throw new Error(`读取任务失败：${error.message}`)
  const row = (data as TailorMadeJobRow) ?? null
  if (!row) return null

  // 读到一条卡在 queued/running 太久的僵尸任务——顺手标记失败，
  // 既让这次轮询的人得到明确结果，也让它以后不再被 createOrReuseJob 复用。
  if (ACTIVE_STATUSES.includes(row.status) && row.created_at < staleCutoffIso()) {
    const message = '任务卡住了，很可能是服务重启导致没跑完。请重新提交一次'
    await markFailed(row.id, message)
    return { ...row, status: 'failed', error: message, completed_at: new Date().toISOString() }
  }

  return row
}

export async function markRunning(jobId: string): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).update({ status: 'running' }).eq('id', jobId)
  if (error) console.error('[tailor-made/jobs] markRunning 写入失败', jobId, error.message)
}

/**
 * AI 已经跑完、结果就在手上——这一步写库失败是这条链路里代价最大的失败模式：
 * 生成本身没问题，但结果进不了这张表，任务会一直停在 running，最终被轮询
 * 上限或 sweeper 判成 failed，用户看到的是"失败"，代价是重新花一次 AI
 * 调用去生成本来已经生成好的东西。Supabase JS 客户端的写入失败是走
 * `{ error }` 返回、不是 throw，不查 error 就是当没看见——重试一次，
 * 仍失败就把完整结果吼进日志，好歹留一条能人工找回的痕迹。
 */
export async function markCompleted(jobId: string, result: unknown): Promise<void> {
  const write = () =>
    supabaseAdmin
      .from(TABLE)
      .update({ status: 'completed', result, completed_at: new Date().toISOString() })
      .eq('id', jobId)

  const first = await write()
  if (!first.error) return

  console.error('[tailor-made/jobs] markCompleted 写入失败，重试一次', jobId, first.error.message)
  const second = await write()
  if (second.error) {
    console.error(
      '[tailor-made/jobs] markCompleted 重试后仍失败——结果原样记进日志，避免彻底丢掉这次生成',
      jobId, second.error.message, JSON.stringify(result)
    )
  }
}

export async function markFailed(jobId: string, error: string): Promise<void> {
  const { error: writeError } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'failed', error, completed_at: new Date().toISOString() })
    .eq('id', jobId)
  if (writeError) console.error('[tailor-made/jobs] markFailed 写入失败', jobId, writeError.message)
}
