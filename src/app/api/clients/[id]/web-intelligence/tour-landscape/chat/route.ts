import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readView } from '@/lib/web-intelligence/service'
import { chatAboutTourLandscape, type TourLandscape } from '@/lib/web-intelligence/tour-landscape'

type Context = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  let body: { question?: unknown; history?: unknown; landscape?: unknown }
  try { body = await req.json() as typeof body } catch { return NextResponse.json({ error: '请输入问题。' }, { status: 400 }) }
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: '请输入问题。' }, { status: 400 })
  const history = Array.isArray(body.history)
    ? body.history.filter((item): item is { role: 'user' | 'assistant'; content: string } => {
      const value = item as { role?: unknown; content?: unknown }
      return (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string'
    }).slice(-10)
    : []
  try {
    const view = await readView(id, access.role === 'admin')
    const clientProducts = view.operating.client_products.map(product => ({ name: product.name, destination: product.destination, route: product.route, duration_days: product.duration_days, price: product.price, departure_window: product.departure_window, includes: product.includes, positioning: product.positioning }))
    const competitorProducts = view.operating.tour_catalog.map(item => ({ domain: item.domain, source_url: item.source_url, observed_at: item.observed_at, name: item.record.name, route: item.record.route, duration_days: item.record.durationDays, price: item.record.price, departure_window: item.record.departureWindow, includes: item.record.includes, positioning: item.record.positioning }))
    const result = await chatAboutTourLandscape({ client_name: view.operating.client_name, client_products: clientProducts, competitor_products: competitorProducts, landscape: body.landscape && typeof body.landscape === 'object' ? body.landscape as TourLandscape : null, history, question })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[wi-tour-landscape-chat]', { client_id: id, error: error instanceof Error ? error.message : 'unknown_error' })
    return NextResponse.json({ error: '对话分析暂时不可用，请稍后重试。' }, { status: 502 })
  }
}
