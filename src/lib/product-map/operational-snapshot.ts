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
  /**
   * B4：可审计的**证据身份指针**，不是散文结论。形如 `#962`（PR 号）/
   * `production_run:<ref>` / `importer:<path>` / `blocker:<id>` / `operationalStatus:<值>`。
   */
  readonly evidenceSource: string
  /**
   * YYYY-MM-DD 的机器核验日期。
   * 🔴 B3：`status==='yes'` ⟹ 此值**必非 null** —— 正向断言必须由带日期的机器证据
   *    支撑，拿不到日期就退回 unknown（见 confirmedYes）。`no`（来自已登记 blocker /
   *    operationalStatus 的结构性负向信号）与 `unknown` 允许 null。
   */
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

/**
 * B3：把"yes"这一步收成"必须有 checkedAt"。正向断言（code in main / 生产依赖存在 /
 * 真实调用方 / 生产跑过）是对动态现实的声明，会过期；没有带日期的机器证据就不能确认，
 * 退回 unknown，而不是编一个 checkedAt=null 的 yes。
 */
function confirmedYes(evidenceSource: string, checkedAt: string | null): OperationalProbe {
  if (checkedAt === null) {
    return { status: 'unknown', evidenceSource: `${evidenceSource}（缺 checkedAt，无法确认）`, checkedAt: null }
  }
  return { status: 'yes', evidenceSource, checkedAt }
}

function deriveCodeInMain(c: ProductMapComponent, facts: ExternalFacts): OperationalProbe {
  if (c.origin === 'legacy') {
    // B3：ownedPaths 存在于磁盘 ≠ 带日期地证明它在 main。没有 GitHub 同步事实就没有
    // checkedAt → unknown（PR2 的同步快照到位后，这里可变成带日期的 yes）。
    return {
      status: 'unknown',
      evidenceSource: 'legacy: 无 GitHub 同步事实可确认 main 归属（PR2 起提供带日期的 sync fact）',
      checkedAt: null,
    }
  }

  const implementsPrs = c.linkedPullRequests.filter((pr) => pr.role === 'implements')
  if (implementsPrs.length === 0) {
    return { status: 'unknown', evidenceSource: '未登记 role=implements 的 PR', checkedAt: null }
  }
  for (const pr of implementsPrs) {
    const fact = facts.pullRequests[pr.number]
    if (fact?.state === 'merged') {
      return confirmedYes(`#${pr.number}`, fact.observedAt ?? null)
    }
  }
  for (const pr of implementsPrs) {
    const fact = facts.pullRequests[pr.number]
    if (fact !== undefined) {
      // 负向来自机器事实（同步快照），带 observedAt
      return { status: 'no', evidenceSource: `#${pr.number}`, checkedAt: fact.observedAt ?? null }
    }
  }
  return { status: 'unknown', evidenceSource: 'PR 状态未同步（ExternalFacts 查无此 PR）', checkedAt: null }
}

function deriveProductionPrerequisites(c: ProductMapComponent): OperationalProbe {
  const provisioning = c.currentBlockers.find((b) => b.kind === 'provisioning')
  if (provisioning) {
    // 已登记的结构性负向信号：身份 = blocker id，允许 checkedAt=null
    return { status: 'no', evidenceSource: `blocker:${provisioning.id}`, checkedAt: null }
  }
  const dataEvidence = c.productionEvidence.find((e) => e.kind === 'production_data')
  if (dataEvidence) {
    return confirmedYes(`production_data:${dataEvidence.ref}`, dataEvidence.observedAt ?? null)
  }
  return { status: 'unknown', evidenceSource: '未登记 provisioning blocker 或 production_data 证据', checkedAt: null }
}

function deriveRealCallerWired(c: ProductMapComponent): OperationalProbe {
  const first = c.integrationEvidence[0]
  if (first) {
    return confirmedYes(`${first.kind}:${first.ref}`, first.observedAt ?? null)
  }
  const negative = c.currentBlockers.find((b) => NO_CALLER_PATTERN.test(b.summary))
  if (negative) {
    return { status: 'no', evidenceSource: `blocker:${negative.id}`, checkedAt: null }
  }
  return { status: 'unknown', evidenceSource: '未登记 integrationEvidence，也无明确负向 blocker', checkedAt: null }
}

function deriveProductionRunObserved(c: ProductMapComponent): OperationalProbe {
  if (c.origin === 'me2_native') {
    const run = c.productionEvidence.find((e) => e.kind === 'production_run')
    if (run) return confirmedYes(`production_run:${run.ref}`, run.observedAt ?? null)
    if (c.operationalStatus === 'not_operating') {
      return { status: 'no', evidenceSource: 'operationalStatus:not_operating', checkedAt: null }
    }
    return { status: 'unknown', evidenceSource: '未登记 production_run 证据', checkedAt: null }
  }
  // legacy：legacyOperationalNote 是静态声明，非机器核验 —— Blocker 3 明确它不能单独把
  // 运营格变成 yes。operating_legacy → unknown（有声明但无带日期核验）；
  // not_operating 是明确负向 → no。
  if (c.operationalStatus === 'not_operating') {
    return { status: 'no', evidenceSource: 'operationalStatus:not_operating', checkedAt: null }
  }
  if (c.operationalStatus === 'operating_legacy') {
    return {
      status: 'unknown',
      evidenceSource: c.legacyOperationalNote
        ? 'operationalStatus:operating_legacy（legacyOperationalNote 是静态声明，无带日期核验）'
        : 'operationalStatus:operating_legacy（未登记 legacyOperationalNote）',
      checkedAt: null,
    }
  }
  return { status: 'unknown', evidenceSource: 'operationalStatus 未提供可判定信号', checkedAt: null }
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
