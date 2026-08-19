/**
 * 死信 / 等审批 / 被拒绝 → 下发成人工任务。
 *
 * 铁律的下半句：确实做不了，也不许烂尾。**必须下发成人工任务，且进同一个管道**
 * （今日待办），不能只写进 cron summary / console.log / 只有开发看得到的表。
 *
 * 三件套缺一条就是没下发好：
 *   what —— 问题**和影响**，说人话
 *   how  —— 具体点哪里，让 FDE 不用问人
 *   href —— 直达链接，连粘贴都不用
 *
 * 🔴 **但「三件套齐全」不等于「这条待办真能做完」。**
 *
 *    早先 `pending_approval` 那条写的是「打开执行看板点『同意执行』」，链接指向
 *    `/dashboard/clients/<id>/execution`。实际上那个页面**根本不读 `action_runs`**，
 *    全仓也没有任何 UI / API 会调 `approveAndRun` / `rejectPendingRun` ——
 *    也就是说：点进去既找不到这条 run，也没有那两个按钮。
 *
 *    一条**指向不存在的操作**的待办比没有待办更糟：它看起来已经下发好了，
 *    于是没有人再去建那个入口，而审批和死信会永久停住。
 *
 *    v1 是**未启用的空转内核**，所以正确做法不是编一个假入口，而是如实说
 *    「审批入口还没上线，这条已经安全停住、不会自动执行」，并把入口本身
 *    列成 Enable 前的硬前提（见 KERNEL-E7-APPROVAL-SURFACE）。
 *    有一条守卫测试盯着这里不许再出现假的可操作文案和假链接。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun } from './types'
import { listDeadLetterRuns } from './store'

export interface KernelHandoffTodo {
  client_id: string
  run_id: string
  what: string
  how: string
  href: string
}

/** 多久以内的需要人处理的执行才捞。太老的说明已经不重要了，天天刷屏反而没人看。 */
export const HANDOFF_WINDOW_DAYS = 14

/**
 * 🔴 Enable 前的硬前提。**在任何可能产生 `pending_approval` 的动作接真实调用方
 *    / apply 迁移 / 启用之前**，下面七件事必须先存在：
 *
 *      1. 认证过的操作者身份（不能信请求体里的 `approvedByUser`）；
 *      2. 真能读到 `action_runs` + 当前那条 pending 决策的 UI 或 API；
 *      3. 同意 → `approveAndRun`；
 *      4. 不做 → `rejectPendingRun`；
 *      5. 已结束 / 已被别人处理（settled / stale）要如实反馈，不能假装还在等；
 *      6. 客户归属与授权校验（谁能批哪个客户的东西）；
 *      7. 审批操作本身要留审计。
 *
 *    **本 PR 不实现它，也不假装它存在。**
 */
export const APPROVAL_SURFACE_BLOCKER = 'KERNEL-E7-APPROVAL-SURFACE'

export async function fetchKernelHandoffTodos(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<KernelHandoffTodo[]> {
  const since = new Date(now.getTime() - HANDOFF_WINDOW_DAYS * 86_400_000).toISOString()
  const runs = await listDeadLetterRuns(sb, since)
  return runs.map((run) => toTodo(run))
}

function toTodo(run: ActionRun): KernelHandoffTodo {
  // 🔴 **这三种待办都不给 action URL。**
  //    执行看板（`/dashboard/clients/<id>/execution`）**不读 `action_runs`** ——
  //    点进去既找不到这条 run，也没有任何能处理它的按钮。
  //    给一个打得开但看不到这件事的链接，跟给一个 404 一样是假的三件套：
  //    人点过去以为自己漏看了，然后回来问「在哪」。
  //    没有链接时渲染器不会画「去做这件事」按钮，而 dropBrokenLinks 也不会
  //    把「没链接」当成「链接坏了」丢掉（两处都有守卫测试）。

  if (run.status === 'pending_approval') {
    return {
      client_id: run.client_id,
      run_id: run.id,
      what:
        `有一件「${run.action_key}」按这个客户的规则要人点头才做。` +
        `它已经安全停住了 —— 不会自动执行，也不会重复扣费。`,
      // 🔴 不给假的操作步骤，也不给假的链接。审批入口还没上线，
      //    这条待办现在**做不完**，如实说出来，并说清缺的是什么。
      how:
        '现在还没有可以点的审批入口：执行内核 v1 是未启用的空转版本，' +
        `审批界面 / 操作者 API 尚未上线（${APPROVAL_SURFACE_BLOCKER}）。` +
        '这条不用你做任何事 —— 回我一句，我来把审批入口排进计划。' +
        '在它上线之前，不会有任何需要人点头的动作被启用。',
      href: '',
    }
  }

  if (run.status === 'denied') {
    return {
      client_id: run.client_id,
      run_id: run.id,
      what: `有一件「${run.action_key}」被系统挡下来了：${run.last_error ?? '未说明原因'}`,
      how:
        '大多数是两种情况：① 这个客户还没给这类动作设自动化规则；' +
        '② 这个动作系统还没实现。两种都不用你自己动手做那件事 —— 回我一句，我来处理',
      href: '',
    }
  }

  const errorText = run.last_error ?? '未说明原因'

  // 🔴 检测 capability 在 humanReason / verification.failure_reason 里塞的孤儿
  //    artefact 直达链接。仅在真找到**合法 GitHub URL** 时才提到 `href` ——
  //    找不到就保持原有的空 `href`（不给假入口）。
  //    这是本模块允许出现的**唯一**非空 href：链接是 provider（客户自己的 GitHub）
  //    的**真实、外部、可点开**的资源，不是本仓库不存在的假入口。
  //    严格匹配 `<host>/<owner>/<repo>/(tree|pull)/<...>` 且 owner/repo 只允许
  //    GitHub slug 合法字符集，防注入。
  const orphan = extractOrphanArtefactUrl(errorText)
  if (orphan) {
    return {
      client_id: run.client_id,
      run_id: run.id,
      what:
        `有一件「${run.action_key}」在客户 GitHub 仓库里留了未合并的 Draft PR / 分支，需要手工清理。` +
        `已经停手，不会自己重试，也不会重复扣费。原始错误：${errorText}`,
      // 🔴 这里的 how 必须**主动**告诉 PM 去清理，不能像下面 fallback 分支那样
      //    说「不用你做」—— 因为 provider 侧确实残留了副作用，v1 无 auto rollback。
      how:
        `点右边「去做这件事」进客户 GitHub：${orphan.kind === 'pr' ? '关掉这条 Draft PR' : '删掉这条分支'}。` +
        `清理完回我一句「清理完了」我记录一下。（自动撤回在下一版内核补，v1 只能靠手工）`,
      href: orphan.url,
    }
  }

  return {
    client_id: run.client_id,
    run_id: run.id,
    what: `有一件「${run.action_key}」重试到上限还是没做成，已经停手：${errorText}`,
    how: '这条不用你做那件事本身 —— 回我一句「查一下这条」，我去看是哪一步卡住的。在修好之前它不会自己重试，也不会重复扣费',
    href: '',
  }
}

/**
 * 🔴 从 `run.last_error` 文本里提取**合法的** GitHub PR 或 branch 直达链接。
 *
 * 仅接受 owner / repo / branch 全部命中 GitHub slug 合法字符集的 URL；
 * 出现斜杠注入（e.g. `attacker/repo` 塞在 owner 位）→ 视作无匹配。
 *
 * PR URL 优先（关 PR 顺带会 delete-branch-on-close，且 PR 页信息更完整）。
 *
 * 只识别 capability 自己拼出来的两种 URL 形状 —— **不用通用 URL 正则**，
 * 免得把随便一条 https 链接错认成孤儿目标。
 */
export function extractOrphanArtefactUrl(
  text: string,
): { kind: 'pr' | 'branch'; url: string } | null {
  // GitHub username / repo / branch 合法字符（防 `..`、`/`、`?`、`#` 注入）：
  //   owner: [A-Za-z0-9-]{1,39}（GitHub 官方限制）
  //   repo:  [A-Za-z0-9._-]{1,100}
  //   branch: [A-Za-z0-9._/-]{1,255}（branch 允许 `/`，但外围锚点保证不出 URL 边界）
  const OWNER = '[A-Za-z0-9-]{1,39}'
  const REPO = '[A-Za-z0-9._-]{1,100}'
  const BRANCH = '[A-Za-z0-9._/-]{1,255}'

  const prRe = new RegExp(
    `https://github\\.com/(${OWNER})/(${REPO})/pull/\\d{1,10}`,
  )
  const branchRe = new RegExp(
    `https://github\\.com/(${OWNER})/(${REPO})/tree/(${BRANCH})`,
  )

  // 从匹配位置开始向后判一个字符：不能是 URL-safe 继续字符
  //（防 branch 后面粘着别的路径 segment 被误吞）
  const boundary = (idx: number, str: string): boolean => {
    if (idx >= str.length) return true
    const c = str.charCodeAt(idx)
    // 允许边界：空格、换行、tab、括号闭、引号、中英文标点
    return !(
      (c >= 0x30 && c <= 0x39) || // 0-9
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a) || // a-z
      c === 0x2d || c === 0x2e || c === 0x5f || c === 0x2f // - . _ /
    )
  }

  const prM = text.match(prRe)
  if (prM && prM.index !== undefined && boundary(prM.index + prM[0].length, text)) {
    return { kind: 'pr', url: prM[0] }
  }
  const brM = text.match(branchRe)
  if (brM && brM.index !== undefined && boundary(brM.index + brM[0].length, text)) {
    return { kind: 'branch', url: brM[0] }
  }
  return null
}
