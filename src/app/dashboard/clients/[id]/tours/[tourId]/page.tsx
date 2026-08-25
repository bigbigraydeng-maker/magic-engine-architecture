import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature, INDUSTRY_FEATURE_NOTICE } from '@/lib/clients/industry-guard'
import { getGroupTour } from '@/lib/group-tours/store'
import TourEditor from './_components/TourEditor'

export const dynamic = 'force-dynamic'

export default async function GroupTourDetailPage({ params }: { params: { id: string; tourId: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return <Notice title="无权访问" body={access.error} />
  }

  if (!(await clientHasIndustryFeature(params.id, 'group_tours'))) {
    const notice = INDUSTRY_FEATURE_NOTICE.group_tours
    return <Notice title={notice.title} body={notice.body} />
  }

  const tour = await getGroupTour(params.id, params.tourId).catch(() => null)
  if (!tour) notFound()

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">
      <Link
        href={`/dashboard/clients/${params.id}/tours`}
        className="text-xs font-bold text-me-charcoal/45 hover:text-me-ochre"
      >
        ← 返回团列表
      </Link>
      <TourEditor clientId={params.id} initialTour={tour} />
    </div>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
      <p className="text-sm font-black text-[#C2453A]">{title}</p>
      <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{body}</p>
    </div>
  )
}
