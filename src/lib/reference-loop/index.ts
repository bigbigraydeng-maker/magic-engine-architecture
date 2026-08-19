/**
 * Magic Engine · Reference Loop adapter —— 门面（Issue #1041 Slice 1）
 *
 * 这一层的价值就是「拼装 + 保血缘 + typed 失败」：把已经存在的 Growth 契约与
 * WP06 Page Optimization 五段 (resolve → snapshot → draft → diff → validate) 串起来，
 * 产出一份可评审的 `ReferenceLoopPreparation`。
 *
 * 🔴 **本模块不导出任何变更器 / 授权器 / 执行器 / 落库器**：想让系统真做事只有一条路——
 *    把 `preparation.request` 交给 WP07 Kernel 授权 apply。本层产出的是候选，不是命令。
 * 🔴 **不发明并行 Page Optimization 实现，不发明并行 Growth 契约，不新增 Agent。**
 */

export type {
  ReferenceLoopAuthorizationReadiness,
  ReferenceLoopEvidenceRef,
  ReferenceLoopFailureCode,
  ReferenceLoopFailureStage,
  ReferenceLoopInput,
  ReferenceLoopPreparation,
  ReferenceLoopProvenance,
  ReferenceLoopResult,
} from './types'

export { prepareReferenceLoopChange } from './prepare'
