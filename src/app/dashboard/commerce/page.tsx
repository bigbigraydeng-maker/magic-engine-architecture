/**
 * 选品工作台 —— 自营电商选品的内部工具（拉数据 · 选品 · 算利润）。
 *
 * 🔴 页面级也挡一道：只放行**全局 admin**，与 `/api/commerce/scan` 的 guardGlobalAdmin
 *    一致。非 admin / 受限 admin 直接跳回 dashboard，连页面都看不到。
 *    （API 那道才是真闸；这道是别让非 admin 看到点不动的按钮。）
 */

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserPermissions } from '@/lib/auth/whitelist'
import CommerceWorkbench from './_components/CommerceWorkbench'

export const metadata = { title: '选品工作台 · Magic Engine' }

export default async function CommercePage() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const perms = user?.email ? getUserPermissions(user.email) : null
  if (!perms || perms.role !== 'admin' || perms.allowedClientId) {
    redirect('/dashboard')
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">选品工作台</h1>
        <p className="mt-1 text-sm text-slate-500">
          输入种子词 → 拉数据（TikTok 爆品 · 中国货源 · 澳新搜索 · 本地价）→ 五道闸判定 → 算利润。
          结果不落库，关页面即清空。
        </p>
      </header>
      <CommerceWorkbench />
    </div>
  )
}
