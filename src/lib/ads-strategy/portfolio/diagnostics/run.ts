/**
 * 广告只读诊断 · 编排（ads IMPACT 阶段 1，设计 §3.3 + §14 M4–M9）。纯函数。
 *
 * 顺序：按账户建上下文（角色、实验排除）→ 共用账户只做账户级（D1、D7）→ 其余账户跑 D1/D3/D4/D5/D7/D8
 * → 客户级体检（日报收件人、结果阶梯配置）。
 * 健康的一天输出为空：not_comparable 只在「本可能命中但判不了」时才出。
 *
 * D2（按角色的疲劳模型）、D6（行业先验）本阶段不实现。
 */

import { buildAccountContext } from './context'
import { diagnoseDeliveryStall } from './d1-delivery-stall'
import { diagnoseSpendNoResult } from './d3-spend-no-result'
import { diagnoseUnharvestedAudience } from './d4-unharvested-audience'
import { diagnoseBudgetResultMismatch } from './d5-budget-result-mismatch'
import { diagnoseAccountHealth, diagnoseClientConfigHealth, diagnoseOutcomeTruthGap } from './d7-d8-health'
import type { Diagnosis, DiagnosisInput, DiagnosisRun, ExcludedEntity } from './types'

export function runDiagnostics(input: DiagnosisInput): DiagnosisRun {
  const diagnoses: Diagnosis[] = []
  const excluded: ExcludedEntity[] = []

  for (const account of input.accounts) {
    const ctx = buildAccountContext(account, input.date)
    excluded.push(...ctx.excluded)

    const d1 = diagnoseDeliveryStall(ctx, input.evaluatedAt)
    if (d1) diagnoses.push(d1)
    diagnoses.push(...diagnoseAccountHealth(ctx, input))

    if (account.shared) {
      // §14 M9：同一账户登记给多个客户，未落广告系列级归属表前只到账户级
      excluded.push({
        adAccountId: account.adAccountId, level: 'account', id: account.adAccountId, name: ctx.accountRow?.entity_name ?? null,
        reason: 'shared_account', detail: '这个广告账户同时登记给了别的客户，只做账户级诊断（投放卡住、授权/数据体检）',
      })
      continue
    }

    diagnoses.push(...diagnoseSpendNoResult(ctx, input))
    const d4 = diagnoseUnharvestedAudience(ctx)
    if (d4) diagnoses.push(d4)
    diagnoses.push(...diagnoseBudgetResultMismatch(ctx, input))
    const d8 = diagnoseOutcomeTruthGap(ctx, input)
    if (d8) diagnoses.push(d8)
  }

  diagnoses.push(...diagnoseClientConfigHealth(input))
  const rank = (d: Diagnosis) => (d.status === 'hit' ? 0 : 1)
  diagnoses.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
  return { clientId: input.clientId, date: input.date, evaluatedAt: input.evaluatedAt, diagnoses, excluded }
}
