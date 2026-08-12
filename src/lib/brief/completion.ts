import { supabaseAdmin } from '@/lib/supabase'

interface CacheEntry {
  result: boolean
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry>()

/**
 * Returns true if the client has completed their onboarding brief.
 * Result is cached in-process for 5 minutes per clientId.
 *
 * 魏征 2026-08-11 复审（PR6）：`brief_completed_at` 只在 5 步向导 Step 1
 * 保存生意档案时才会置位。向导 Step 5「Finish setup」不要求前面任何一步
 * 真的填过——这是设计上明确支持的路径（"sort it on the visit"）。一个
 * 跳过 Step 1 直接点完成的客户，`onboarding_completed_at` 有了，
 * `brief_completed_at` 却永远是 null：他会在看完"你已经全部搞定"的完成页
 * 之后，立刻在自己的工作台首页撞上这个函数背后的锁——被指回这个项目正要
 * 退役的旧单页表单，绕一圈回到起点。两个字段现在都算"这个客户不用再被
 * brief 卡住了"，缺一个都会造成这个死循环。
 */
export async function isBriefComplete(clientId: string): Promise<boolean> {
  const now = Date.now()
  const hit = cache.get(clientId)
  if (hit && hit.expiresAt > now) {
    return hit.result
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('brief_completed_at, onboarding_completed_at')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) {
    return false
  }

  const result = data.brief_completed_at !== null || data.onboarding_completed_at !== null
  cache.set(clientId, { result, expiresAt: now + CACHE_TTL_MS })

  return result
}

/** Clears the in-process cache for a specific client (e.g. after brief submission). */
export function invalidateBriefCache(clientId: string): void {
  cache.delete(clientId)
}
