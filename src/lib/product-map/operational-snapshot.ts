/**
 * 四问运营快照 —— PO 看的运营真相（Issue #974 / Build Control Room 2026-08-15
 * 05:43 复审 Blocker 4）：code in main? / production prerequisites exist? /
 * real caller wired? / production run observed?
 *
 * 不替代 M0–M5（types.ts 顶部注释）：M0/M1 仍表达"只有想法/契约已冻结"，
 * M5 仍要求重复运行与可归因 outcome。
 *
 * 四问与 deriveMaturity（maturity.ts）读同一组证据 —— contractEvidence /
 * integrationEvidence / productionEvidence / currentBlockers /
 * linkedPullRequests + ExternalFacts，不建第二套手抄真值。
 *
 * 三条铁律：
 * - 没有对应探针可跑 = unknown，不是 no；
 * - no 必须来自明确的负向信号（显式非 merged 的 PR 状态 / provisioning blocker /
 *   明确写"零调用方"的 blocker / operationalStatus='not_operating'）；
 * - 本文件只读结构化证据字段，不读 description 之类的自由文本 —— 天然满足
 *   "docs/Issue 只能是线索，不能单独把格子填成 yes"。
 */

import type { ExternalFacts } from './external-facts'
import type { ProductMapComponent } from './types'

export const PROBE_STATUS = ['yes', 'no', 'unknown'] as const
export type ProbeStatus = (typeof PROBE_STATUS)[number]

export interface OperationalProbe {
  readonly status: ProbeStatus
  /** 可审计指针：证据 ref / blocker ref / 字段名，禁止散文结论。 */
  readonly evidenceSource: string
  /** YYYY-MM-DD；探针从未跑过时为 null，不得虚构一个日期。 */
  readonly checkedAt: string | null
}

export interface OperationalSnapshot {
  readonly componentId: string
  readonly codeInMain: OperationalProbe
  readonly productionPrerequisitesExist: OperationalProbe
  readonly realCallerWired: OperationalProbe
  readonly productionRunObserved: OperationalProbe
}

/** 只认这几种明确写出"零调用方"的措辞；查不到不等于查到了"没有"。 */
const NO_CALLER_PATTERN = /零\s*(个\s*)?(importer|调用方|caller)|没有(任何)?调用方|未接(入|线)|电没通/

function deriveCodeInMain(c: ProductMapComponent, facts: ExternalFacts): OperationalProbe {
  if (c.origin === 'legacy') {
    if (c.ownedPaths.length > 0) {
      return {
        status: 'yes',
        evidenceSource: `ownedPaths 对磁盘核验（registry.test 持续复验）：${c.ownedPaths[0]}`,
        checkedAt: null,
      }
    }
    return { status: 'unknown', evidenceSource: '未登记 ownedPaths，没有探针可跑', checkedAt: null }
  }

  const implementsPrs = c.linkedPullRequests.filter((pr) => pr.role === 'implements')
  if (implementsPrs.length === 0) {
    return { status: 'unknown', evidenceSource: '未登记 role=implements 的 PR', checkedAt: null }
  }
  for (const pr of implementsPrs) {
    const fact = facts.pullRequests[pr.number]
    if (fact?.state === 'merged') {
      return {
        status: 'yes',
        evidenceSource: `PR #${pr.number} merged（${fact.source}）`,
        checkedAt: fact.observedAt,
      }
    }
  }
  for (const pr of implementsPrs) {
    const fact = facts.pullRequests[pr.number]
    if (fact !== undefined) {
      return {
        status: 'no',
        evidenceSource: `PR #${pr.number} state=${fact.state}（${fact.source}）`,
        checkedAt: fact.observedAt,
      }
    }
  }
  return { status: 'unknown', evidenceSource: 'PR 状态未同步（ExternalFacts 查无此 PR）', checkedAt: null }
}

function deriveProductionPrerequisites(c: ProductMapComponent): OperationalProbe {
  const provisioning = c.currentBlockers.find((b) => b.kind === 'provisioning')
  if (provisioning) {
    return {
      status: 'no',
      evidenceSource: `blocker '${provisioning.id}'：${provisioning.summary}`,
      checkedAt: null,
    }
  }
  const dataEvidence = c.productionEvidence.find((e) => e.kind === 'production_data')
  if (dataEvidence) {
    return { status: 'yes', evidenceSource: dataEvidence.ref, checkedAt: dataEvidence.observedAt ?? null }
  }
  return { status: 'unknown', evidenceSource: '未登记 provisioning blocker 或 production_data 证据', checkedAt: null }
}

function deriveRealCallerWired(c: ProductMapComponent): OperationalProbe {
  const first = c.integrationEvidence[0]
  if (first) {
    return { status: 'yes', evidenceSource: `${first.kind}:${first.ref}`, checkedAt: first.observedAt ?? null }
  }
  const negative = c.currentBlockers.find((b) => NO_CALLER_PATTERN.test(b.summary))
  if (negative) {
    return { status: 'no', evidenceSource: `blocker '${negative.id}'：${negative.summary}`, checkedAt: null }
  }
  return { status: 'unknown', evidenceSource: '未登记 integrationEvidence，也无明确负向 blocker', checkedAt: null }
}

function deriveProductionRunObserved(c: ProductMapComponent): OperationalProbe {
  if (c.origin === 'me2_native') {
    const run = c.productionEvidence.find((e) => e.kind === 'production_run')
    if (run) return { status: 'yes', evidenceSource: run.ref, checkedAt: run.observedAt ?? null }
    if (c.operationalStatus === 'not_operating') {
      return { status: 'no', evidenceSource: "operationalStatus='not_operating'", checkedAt: null }
    }
    return { status: 'unknown', evidenceSource: '未登记 production_run 证据', checkedAt: null }
  }
  if (c.operationalStatus === 'operating_legacy' && c.legacyOperationalNote) {
    return { status: 'yes', evidenceSource: c.legacyOperationalNote, checkedAt: null }
  }
  if (c.operationalStatus === 'not_operating') {
    return { status: 'no', evidenceSource: "operationalStatus='not_operating'", checkedAt: null }
  }
  return {
    status: 'unknown',
    evidenceSource: 'operationalStatus=operating_legacy 但未登记 legacyOperationalNote',
    checkedAt: null,
  }
}

export function deriveOperationalSnapshot(
  component: ProductMapComponent,
  facts: ExternalFacts,
): OperationalSnapshot {
  return {
    componentId: component.id,
    codeInMain: deriveCodeInMain(component, facts),
    productionPrerequisitesExist: deriveProductionPrerequisites(component),
    realCallerWired: deriveRealCallerWired(component),
    productionRunObserved: deriveProductionRunObserved(component),
  }
}
