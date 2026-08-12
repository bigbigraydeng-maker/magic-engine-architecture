/**
 * 逐动作的对外副作用授权判据。
 *
 * 🔴 **这一条替代的是「注册表里一律不许出现 outward 动作」那道全局禁令，
 *    但默认仍然是拒绝。** 区别只有一个：以前是「不可能」，现在是
 *    「除非这个动作**逐条**说清了它凭什么可以对外写」。
 *
 * 🔴 **没有全局开关、没有环境变量旁路、没有通用 bypass。**
 *    唯一放宽的方式是给某一个 `ActionDefinition` 补一份完整声明 ——
 *    那是一行写在版本控制里、必须过 review 的 diff。
 *
 * 🔴 **一个 predicate，两处调用**（`authorize.ts` 的授权层、`gateway.ts` 的执行层）。
 *    共用是为了防两边判据漂移；但两层各自**独立**生效 ——
 *    拆掉任意一层，另一层仍然拦得住，且各有只有它能满足的测试。
 */

import type { ActionDefinition } from './types'

/** 有限、非负的真实金额。NaN / ±Infinity / 负数 / 非数字一律不算。 */
function isRealCeiling(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * 这个动作现在**不能**对外执行的原因；可以对外执行则返回 `null`。
 *
 * 非 outward 的动作一律返回 `null` —— 本判据只管「对外许可」这一件事，
 * 它们的 `outwardAuthorization` 保持 `null` 即可。
 */
export function outwardBlockReason(definition: ActionDefinition): string | null {
  if (definition.sideEffect !== 'outward') return null

  const declaration = definition.outwardAuthorization
  if (!declaration) {
    // 🔴 「不是等你点头，是根本不做」这半句要留着：没有声明的对外动作，
    //    **人点头也批不出来**（approveRun 走同一个 preflight）。
    //    换成一句听起来像「待审批」的话，等于告诉人这条还有戏。
    return (
      '这个动作会作用到客户自己的资产之外，但契约里没有逐动作的对外授权声明 —— ' +
      '这条不是「等你点头」，是根本不做（补声明要改代码、过 PR，不是配置项）'
    )
  }

  // 出处必须写得出来。空白等于没写 —— 出了事没人知道这条许可是谁、按哪份文件给的。
  if (typeof declaration.declaredIn !== 'string' || declaration.declaredIn.trim().length === 0) {
    return '对外授权声明必须写明出处（declaredIn），空白不算 —— 这条许可要能被追到是谁批的'
  }

  if (declaration.requiresHumanApproval !== true) {
    return '对外动作必须要求人工批准，这一项不允许声明成别的值'
  }

  if (declaration.rollback !== 'provider_native' && declaration.rollback !== 'snapshot_restore') {
    return '对外授权声明必须写明怎么撤回（provider_native 或 snapshot_restore）'
  }

  // 🔴 **声明不许覆盖或欺骗 `reversible`。**
  //    v1 只允许 `reversible === true` 的对外动作。填一个 `snapshot_restore`
  //    并不能把一个自称不可逆的动作变成可逆 —— 那是拿声明去盖事实。
  //    真要放开不可逆的对外动作，那是一次单独的、要重新评估风险的决定。
  if (definition.reversible !== true) {
    return (
      '这个动作声明了自己撤不回来（reversible: false）—— v1 不放行不可逆的对外动作。' +
      '填 rollback 不能替代 reversible：撤回路径写得再清楚，也改不了「它自称撤不回来」这个事实'
    )
  }

  // 🔴 对外动作**一定**碰外部服务，所以「不调外部服务」这个声明自相矛盾。
  //    诚实只有两个选项：认幂等键（supported）或不认（unsupported）。
  if (definition.providerIdempotency === 'not_applicable') {
    return (
      '对外动作必须如实声明外部服务的幂等能力：supported 或 unsupported。' +
      'not_applicable 的意思是「根本不调外部服务」，跟对外副作用自相矛盾'
    )
  }

  // 🔴 每一步都要有显式上界。
  //    这里**刻意不**接受 `nextStepCostCeiling` 对内部动作的那个兜底
  //    （整体 estimate 为 0 就视为每步 0）——「它不花钱」对一个真的会打到
  //    外部服务的动作来说，是要逐步写下来的承诺，不是推断出来的。
  for (const stepKey of definition.steps) {
    if (!isRealCeiling(definition.costModel.stepCeilingUsd?.[stepKey])) {
      return `对外动作的每一步都要显式声明成本上界，「${stepKey}」没有（要一个有限的非负金额）`
    }
  }

  return null
}
