import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readView } from '@/lib/web-intelligence/service'
import { summarizeTourLandscape } from '@/lib/web-intelligence/tour-landscape'

type Context = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  let stage: 'read_view' | 'prepare_prompt' | 'llm' | 'validate' = 'read_view'
  try {
    const view = await readView(id, access.role === 'admin')
    stage = 'prepare_prompt'
    const clientProducts = view.operating.client_products.map(product => ({ name: product.name, destination: product.destination, route: product.route, duration_days: product.duration_days, price: product.price, departure_window: product.departure_window, includes: product.includes, positioning: product.positioning }))
    const competitorProducts = view.operating.tour_catalog.map(item => ({ domain: item.domain, source_url: item.source_url, observed_at: item.observed_at, name: item.record.name, route: item.record.route, duration_days: item.record.durationDays, price: item.record.price, departure_window: item.record.departureWindow, includes: item.record.includes, positioning: item.record.positioning }))
    stage = 'llm'
    const result = await summarizeTourLandscape({ client_name: view.operating.client_name, client_products: clientProducts, competitor_products: competitorProducts })
    stage = 'validate'
    return NextResponse.json(result)
  } catch (error) {
    // Keep the response human-readable without exposing provider errors or
    // credentials; the stage is enough to diagnose the production failure.
    console.error('[wi-tour-landscape]', { client_id: id, stage, error: error instanceof Error ? error.message : 'unknown_error' })
    const message = stage === 'read_view'
      ? '客户和竞品资料暂时无法读取，请稍后重试。'
      : stage === 'llm'
        ? '竞品总览分析服务暂时不可用，请稍后重试。'
        : '竞品总览暂时无法完成，请稍后重试。'
    return NextResponse.json({ error: message, code: `tour_landscape_${stage}` }, { status: 502 })
  }
}
