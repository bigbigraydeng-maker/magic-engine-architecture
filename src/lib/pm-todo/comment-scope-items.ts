/**
 * 评论自动回复读不到评论 → 下发给人。
 *
 * 🔴 2026-08-15 实测：CTS 的评论 cron 每半小时扫 149 个帖子，其中一批固定回
 *    Meta 的 400 —— 最要命的一类是 `(#10) 需要 pages_read_user_content 权限`：
 *    **令牌没有「读别人写的评论」这项权限**。于是客人在帖子下面提的问题，
 *    系统一条都看不见，而那一轮 cron 照样记成 `ok: true, new_comments: 0`。
 *
 *    这正是「发现死在日志里」：唯一的痕迹是 Render 日志里一行 console.error，
 *    没有任何人会去翻。权限只有人能补（要拿管理员账号点授权），所以必须下发。
 *
 * 另一类是令牌整个被拒（#190 过期 / 被撤销）—— 同样只有人能换。
 *
 * 判据取自 cron 自己写进运行记录的那份 summary（跟 `ad_readback_blocker` 同一
 * 个套路）：说的话跟机器真做的事永远一致，也不用再查一遍 Meta。
 *
 * 🔴 2026-09-15 补两类：
 *    - 这一轮压根没扫完（拉帖子列表被 Meta 回 500 / 权限列表读不到 / 没令牌）——
 *      之前那轮照样记成「完成」，每 30 分钟失败一次也没人知道；
 *    - 令牌少了「以主页身份回评论、隐藏评论」（pages_manage_engagement）——
 *      生产上所有令牌都没有，自动回复不可能成功，引擎现在直接暂停不发，由这里下发。
 *
 * 「帖子不存在」「老式端点已下线」那两类**不下发** —— 人做不了什么，
 * 机器已经把它们记进跳过名单不再重试了。下发等于制造噪音。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** 运行记录多旧就不能用了 —— 这个 cron 每 30 分钟一轮，两天足够宽松。 */
const RUN_STALE_DAYS = 2

/** Meta 的令牌工具首页 —— 登录类站点，稳定入口不是深链。 */
const GRAPH_EXPLORER_URL = 'https://developers.facebook.com/tools/explorer/'

/** 只声明这条读得到的字段：这是**已经落库的旧数据**，当外部输入处理。 */
export interface CommentRunResult {
  client_id: string
  ok?: boolean
  error?: string
  scan_error?: string
  engagement_scope_missing?: boolean
  new_comments?: number
  page_id?: string
  posts_scanned?: number
  permission_denied_count?: number
  permission_denied_sample?: string[]
  token_invalid?: string
}

interface CommentRunSummary {
  results?: CommentRunResult[]
}

export type CommentScopeTodoKind =
  | 'comment_scope_missing'
  | 'comment_engagement_scope_missing'
  | 'comment_token_invalid'
  | 'comment_scan_failed'

export interface CommentScopeTodo {
  kind: CommentScopeTodoKind
  client_id: string
  what: string
  how: string
  href: string
}

/**
 * Render 后台里那条环境变量叫什么，取决于当初是按域名配的还是用的公共那条。
 * 与其猜一个名字让人白找，不如说清怎么认出它。
 */
const REPLACE_TOKEN_STEPS =
  '复制生成的令牌 → 打开 Render 后台的 crazycontent 服务 → Environment → ' +
  '找到名字以 META_SYSTEM_USER_TOKEN 开头的那一条（可能带客户后缀，比如 ' +
  '..._CTSTOURS_CO_NZ；只有一条就是它）→ 把值换成新令牌 → Save。' +
  '换完不用管，最多半小时这条待办会自己消失。'

const ENGAGEMENT_APP_REVIEW_NOTE =
  '如果勾选列表里找不到 pages_manage_engagement，或者点授权时报错，说明我们的 Facebook 应用' +
  '还没拿到这项权限，要先走 Meta 的应用审核 —— 这一步找开发，别自己卡着。'

/**
 * 一个客户的一轮结果 → 最多一条待办。
 *
 * 先后顺序：令牌被拒 → 这一轮没扫完 → 缺权限。前一件没解决，后一件查不准：
 * 令牌都用不了谈不上权限；帖子都没扫完，缺权限的数也是残缺的。
 * 两条一起摆出来只会让人不知道先做哪个。
 */
export function buildCommentScopeTodo(r: CommentRunResult): CommentScopeTodo | null {
  const page = r.page_id ? `（${r.page_id}）` : ''

  if (r.token_invalid) return tokenInvalidTodo(r, page)
  if (r.ok === false) return scanFailedTodo(r, page)
  return scopeMissingTodo(r, page)
}

function tokenInvalidTodo(r: CommentRunResult, page: string): CommentScopeTodo {
  const reason = r.token_invalid ?? ''
  return {
    kind: 'comment_token_invalid',
    client_id: r.client_id,
    what:
      `这个客户的 Facebook 令牌${page}被 Meta 拒了，评论自动回复整个停了 —— ` +
      `客人在帖子下面问什么，系统现在一条都看不见。Meta 的原话：${reason.slice(0, 120)}`,
    how:
      '打开链接（Meta 的令牌工具）→ 右上角选我们的 Facebook 应用 → ' +
      '用能管理这个主页的账号点 Generate Access Token 重新授权 → ' +
      REPLACE_TOKEN_STEPS,
    href: GRAPH_EXPLORER_URL,
  }
}

/**
 * 这一轮没扫完。人能做的是先排除权限/令牌（设置页上那个按钮一点就知道），
 * 排除了就是代码侧的事 —— 把原话交给开发，而不是让人去猜。
 */
function scanFailedTodo(r: CommentRunResult, page: string): CommentScopeTodo {
  const reason = (r.scan_error ?? r.error ?? '没有记录原因').slice(0, 160)
  return {
    kind: 'comment_scan_failed',
    client_id: r.client_id,
    what:
      `这个客户 Facebook 主页${page}的评论自动回复，最近一轮没扫完 —— ` +
      `漏扫的帖子下面客人的新评论，系统看不见，也就不会有人回。原话：${reason}`,
    how:
      '打开链接（这个客户的设置页）→ 往下找到「评论自动回复」→ 点「检查 Meta 权限」：' +
      '有打 ✗ 的一项就按页面提示补上；全是 ✓ 说明不是权限问题，把上面的原话发给开发。' +
      '修好后下一轮（最多半小时）这条待办会自己消失。',
    href: `https://app.magicengine.com.au/dashboard/clients/${r.client_id}/settings`,
  }
}

function scopeMissingTodo(r: CommentRunResult, page: string): CommentScopeTodo | null {
  const denied = r.permission_denied_count ?? 0
  const engagementMissing = r.engagement_scope_missing === true
  if (denied <= 0 && !engagementMissing) return null

  const problems: string[] = []
  const scopes: string[] = []
  if (denied > 0) {
    const scanned = r.posts_scanned
    // 带上分母：「12 个」和「149 个里的 12 个」是两件事
    const scale = typeof scanned === 'number' && scanned > 0 ? `${scanned} 个帖子里有 ${denied} 个` : `${denied} 个帖子`
    const sample = (r.permission_denied_sample ?? []).slice(0, 3)
    const sampleText = sample.length > 0 ? `（比如 ${sample.join('、')}）` : ''
    problems.push(
      `${scale}读不到评论${sampleText} —— Meta 说我们的令牌少了「读别人写的评论」这项权限（pages_read_user_content）。` +
      '这些帖子下面客人的提问，系统看不见，也就不会有人回。',
    )
    scopes.push('pages_read_user_content')
  }
  if (engagementMissing) {
    const waiting = r.new_comments ?? 0
    problems.push(
      '评论自动回复已经暂停：我们的令牌少了「以主页身份回评论、隐藏评论」这项权限（pages_manage_engagement），' +
      'Meta 会拒掉每一条自动回复，所以系统这轮一条都没发。' +
      (waiting > 0 ? `现在有 ${waiting} 条新评论在等回复，权限补上之前请先在 Business Suite 收件箱里人工回。` : ''),
    )
    scopes.push('pages_manage_engagement')
  }

  return {
    kind: denied > 0 ? 'comment_scope_missing' : 'comment_engagement_scope_missing',
    client_id: r.client_id,
    what: `这个客户的 Facebook 主页${page}上，${problems.join('另外，')}`,
    how:
      '打开链接（Meta 的令牌工具）→ 右上角选我们的 Facebook 应用 → ' +
      `点 Add a Permission，勾上 ${scopes.join('、')} → ` +
      '用能管理这个主页的账号点 Generate Access Token 确认 → ' +
      REPLACE_TOKEN_STEPS +
      (engagementMissing ? ENGAGEMENT_APP_REVIEW_NOTE : ''),
    href: GRAPH_EXPLORER_URL,
  }
}

/** 上一轮跑完多久了。跑到一半没写完 finished_at 的当作太旧，不用。 */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 86_400_000
}

export async function fetchCommentScopeTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<CommentScopeTodo[]> {
  const { data } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'social-comment-autoreply')
    .order('started_at', { ascending: false })
    .limit(1)

  const run = (data ?? [])[0] as
    | { finished_at: string | null; summary: CommentRunSummary | null }
    | undefined
  if (!run?.summary) return []

  // 「该跑没跑」有 pushCronHealthItems 在管，这里不重复报，只在结果够新时说话
  const age = daysSince(run.finished_at, now)
  if (age === null || age > RUN_STALE_DAYS) return []

  const todos: CommentScopeTodo[] = []
  for (const r of run.summary.results ?? []) {
    if (!r || typeof r.client_id !== 'string') continue
    const todo = buildCommentScopeTodo(r)
    if (todo) todos.push(todo)
  }
  return todos
}
