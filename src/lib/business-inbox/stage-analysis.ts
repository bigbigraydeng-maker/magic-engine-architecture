/**
 * 只读商务收件箱 —— 「这条邮件对话对应的人，CRM 判到了哪一步」。
 *
 * 这里**只读**，不问模型、不写库。分析本身早就由 `src/lib/crm/stage-infer.ts`
 * 在跑私信/邮件同步时算好、落进 `contacts.stage`；收件箱只是把它取出来显示。
 * 没有分析（联系人认不出、或阶段还没填）就如实返回空 —— 上层显示「暂无分析」，
 * 绝不为了页面好看编一个阶段出来。
 *
 * 两条查询都按 `client_id` 收口，和调用方守卫过的那个客户绑死；任何一条漏了
 * client_id 就可能把别的客户的联系人阶段带出来，所以这层单独抽出来、单独测。
 */

import { supabaseAdmin } from '@/lib/supabase'

/** 一个联系人的已存 CRM 阶段分析。全部读自库，没有任何推断。 */
export interface StageAnalysis {
  /** 稳定英文 slug（stage-infer 写的 `contacts.stage`）。 */
  stage: string
  /** 运营可读的中文标签；配置里删了这个 key 时回退成原始 slug，不留空。 */
  stageLabel: string
  /** 这个阶段最后一次被写的时间（判「是否过期」用，展示层自己决定怎么用）。 */
  stageUpdatedAt: string | null
}

/** PostgREST 的 .in() 一次塞太多会把 URL 撑爆 —— 跟 stage-infer 同一个口径。 */
const IN_CHUNK = 100

/**
 * 取一批联系人的已存阶段分析。
 *
 * @returns Map<contactId, StageAnalysis> —— 只包含**真的有阶段**的联系人；
 *   认不出的人、阶段为空的人不进 Map（上层据此显示 UNKNOWN）。
 */
export async function resolveStageAnalysis(
  clientId: string,
  contactIds: readonly string[],
): Promise<Map<string, StageAnalysis>> {
  const result = new Map<string, StageAnalysis>()

  const unique = Array.from(new Set(contactIds.filter(Boolean)))
  if (unique.length === 0) return result

  // 阶段 key → 中文标签。按客户取，是这个客户自己的流水线配置。
  const labelByKey = new Map<string, string>()
  const { data: stageRows } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key, label')
    .eq('client_id', clientId)
  for (const row of (stageRows ?? []) as Array<{ stage_key: string; label: string }>) {
    labelByKey.set(row.stage_key, row.label)
  }

  // 联系人阶段。分块查，每块都按 client_id 收口 —— 不能只靠 id 猜同一个客户。
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK)
    const { data: rows } = await supabaseAdmin
      .from('contacts')
      .select('id, stage, stage_updated_at')
      .eq('client_id', clientId)
      .in('id', chunk)

    for (const row of (rows ?? []) as Array<{
      id: string
      stage: string | null
      stage_updated_at: string | null
    }>) {
      // 阶段为空 = 还没分析出来。不进 Map，让上层显示「暂无分析」。
      if (!row.stage) continue
      result.set(row.id, {
        stage: row.stage,
        stageLabel: labelByKey.get(row.stage) ?? row.stage,
        stageUpdatedAt: row.stage_updated_at,
      })
    }
  }

  return result
}
