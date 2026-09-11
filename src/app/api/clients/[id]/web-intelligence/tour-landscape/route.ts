import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readView } from '@/lib/web-intelligence/service'
import { summarizeTourLandscape } from '@/lib/web-intelligence/tour-landscape'

type Context = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const view = await readView(id, access.role === 'admin')
    const clientProducts = view.operating.matches.map(match => ({ name: match.client_product, duration_days: match.client_duration_days, price: match.client_price }))
    const competitorProducts = view.operating.tour_catalog.map(item => ({ domain: item.domain, source_url: item.source_url, observed_at: item.observed_at, name: item.record.name, route: item.record.route, duration_days: item.record.durationDays, price: item.record.price, departure_window: item.record.departureWindow, includes: item.record.includes, positioning: item.record.positioning }))
    const result = await summarizeTourLandscape({ client_name: view.operating.client_name, client_products: clientProducts, competitor_products: competitorProducts })
    return NextResponse.json(result)
  } catch { return NextResponse.json({ error: '暂时无法生成竞品总览，请稍后重试。' }, { status: 502 }) }
}
