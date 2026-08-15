/**
 * 只读 GitHub provider 抽象 —— 生产用 github-rest-provider,测试用 fake-provider。
 *
 * 🔴 接口上没有 owner/repo 参数:v1 只允许读 APPROVED_REPO,
 *    跨仓输入在结构上不存在(fail closed)。
 *
 * 🔴 限流契约:批量方法**不许因限流丢掉已抓成果** —— 限流时返回
 *    已抓到的 facts + 未尝试号码进 failed + `rateLimited: true`,
 *    由上层照常落库并把 run 标 partial。整批一个没抓到才允许 throw
 *    (如 getMainHead 这类单发调用)。
 */

import type { IssueFact, PrFactDetail, RecentWorkItem } from './types'

export interface BatchResult<T> {
  readonly facts: T[]
  readonly failed: { number: number; reason: string }[]
  /** 本批因限流提前中止(已抓的在 facts 里,没轮到的在 failed 里)。 */
  readonly rateLimited: boolean
}

/** 未分类存量复核用的轻量状态(/issues/ 端点,PR 与 issue 通吃)。 */
export interface WorkItemState {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly body: string
}

export interface GithubReadProvider {
  /** main 分支最新 head。 */
  getMainHead(): Promise<{ sha: string; observedAt: string }>
  /** 批量拉 PR 事实。单个号码失败不拖垮整批(失败号码进 failed,旧行由上层保留)。 */
  getPullRequestFacts(numbers: readonly number[]): Promise<BatchResult<PrFactDetail>>
  /** 批量拉 issue 事实。号码指向 PR 时 fail-closed(进 failed,不冒充 issue)。 */
  getIssueFacts(numbers: readonly number[]): Promise<BatchResult<IssueFact>>
  /** 未分类发现:since 之后有动静的开放 Issue/PR(带 body 供标记解析)。 */
  listRecentWork(sinceIso: string): Promise<{ items: RecentWorkItem[]; truncated: boolean }>
  /**
   * 未分类存量逐个复核(收编判定用):只回 state+body。
   * 限流时同 BatchResult 契约 —— 没轮到的进 failed,不 throw。
   */
  getWorkItemStates(numbers: readonly number[]): Promise<BatchResult<WorkItemState>>
}
