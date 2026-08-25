import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature, INDUSTRY_FEATURE_NOTICE } from '@/lib/clients/industry-guard'
import { listGroupTours, GROUP_TOUR_STATUS_LABEL, type GroupTourSummary, type GroupTourStatus } from '@/lib/group-tours/store'
import NewTourButton from './_components/NewTourButton'

export const dynamic = 'force-dynamic'

export default async function GroupToursListPage({ params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return <Notice title="无权访问" body={access.error} />
  }

  // 行业闸：导航已经藏了入口，这里挡直接敲网址的情况。
  if (!(await clientHasIndustryFeature(params.id, 'group_tours'))) {
    const notice = INDUSTRY_FEATURE_NOTICE.group_tours
    return <Notice title={notice.title} body={notice.body} />
  }

  let items: GroupTourSummary[] = []
  let error: string | null = null
  try {
    items = await listGroupTours(params.id)
  } catch (err) {
    error = err instanceof Error ? err.message : '读取失败'
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/clients/${params.id}`}
            className="text-xs font-bold text-me-charcoal/45 hover:text-me-ochre"
          >
            ← 返回工作台
          </Link>
          <h1 className="mt-1 font-display text-2xl font-black text-me-charcoal">团管理</h1>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            上传团资料 → AI 解析 → 人工确认 → 提交发布申请到官网
          </p>
        </div>
        <NewTourButton clientId={params.id} />
      </div>

      {error && (
        <Notice
          title="读取团列表失败"
          body={error}
          hint="若提示表不存在，需先执行 supabase/migrations/20260824000001_group_tours.sql"
        />
      )}

      {!error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/10 bg-white p-10 text-center">
          <p className="font-black text-me-charcoal">还没有团</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">点右上角「新增团」开始第一个。</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 bg-me-ivory text-left text-[10px] font-black uppercase tracking-[.12em] text-me-charcoal/45">
              <tr>
                <th className="px-4 py-3">团名</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">最近修改</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-black/5 last:border-0 hover:bg-me-ivory/60">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/clients/${params.id}/tours/${item.id}`}
                      className="font-black text-me-charcoal hover:text-me-ochre"
                    >
                      {item.title || '未命名团'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-me-charcoal/70">{item.slug || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusChip status={item.status} prUrl={item.pr_url} />
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-me-charcoal/45">{formatWhen(item.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Notice({ title, body, hint }: { title: string; body: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
      <p className="text-sm font-black text-[#C2453A]">{title}</p>
      <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{body}</p>
      {hint && <p className="mt-2 text-xs font-semibold text-me-charcoal/45">{hint}</p>}
    </div>
  )
}

/** 板桥意见1：状态文案不能是原始枚举值，要说人话，pr_open 尤其要说清楚"还没真上线"。 */
function StatusChip({ status, prUrl }: { status: GroupTourStatus; prUrl: string | null }) {
  const tone: Record<GroupTourStatus, string> = {
    draft: 'bg-me-ivory text-me-charcoal/60 border-black/10',
    review: 'bg-[#C88A2E]/12 text-[#C88A2E] border-[#C88A2E]/30',
    ready: 'bg-[#3E6E8C]/12 text-[#3E6E8C] border-[#3E6E8C]/30',
    pr_open: 'bg-[#C88A2E]/12 text-[#C88A2E] border-[#C88A2E]/30',
    published: 'bg-[#5C8A4A]/12 text-[#5C8A4A] border-[#5C8A4A]/30',
    archived: 'bg-me-ivory text-me-charcoal/35 border-black/5',
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={`inline-block w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${tone[status]}`}>
        {GROUP_TOUR_STATUS_LABEL[status]}
      </span>
      {status === 'pr_open' && prUrl && (
        <a href={prUrl} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-me-ochre underline">
          还没真上线，去 GitHub 合并 →
        </a>
      )}
    </span>
  )
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
