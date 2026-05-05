/**
 * GET /api/clients/[id]/site-audit/debug
 *
 * Temporary diagnostic endpoint — test URL discovery from the server.
 * REMOVE after debugging is complete.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { discoverSitemapUrls } from '@/lib/site-audit/crawler'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const clientId = params.id

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, domain')
    .eq('id', clientId)
    .single()

  if (!client?.domain) {
    return NextResponse.json({ error: 'No domain configured' }, { status: 400 })
  }

  const start = Date.now()
  const steps: { step: string; result: unknown; ms: number }[] = []

  // Test each discovery step manually
  const origin = client.domain.startsWith('http') ? client.domain : `https://${client.domain}`

  // Step 1: robots.txt
  let robotsText = ''
  try {
    const t0 = Date.now()
    const r = await fetch(`${origin}/robots.txt`)
    robotsText = await r.text()
    steps.push({ step: 'robots.txt', result: { status: r.status, length: robotsText.length, snippet: robotsText.substring(0, 200) }, ms: Date.now() - t0 })
  } catch (e) {
    steps.push({ step: 'robots.txt', result: { error: String(e) }, ms: Date.now() - start })
  }

  // Step 2: sitemap.xml
  try {
    const t0 = Date.now()
    const r = await fetch(`${origin}/sitemap.xml`)
    const xml = await r.text()
    const locCount = (xml.match(/<loc>/g) || []).length
    steps.push({ step: 'sitemap.xml', result: { status: r.status, locCount, xmlSnippet: xml.substring(0, 200) }, ms: Date.now() - t0 })
  } catch (e) {
    steps.push({ step: 'sitemap.xml', result: { error: String(e) }, ms: Date.now() - start })
  }

  // Step 3: full discoverSitemapUrls
  try {
    const t0 = Date.now()
    const urls = await discoverSitemapUrls(client.domain)
    steps.push({ step: 'discoverSitemapUrls', result: { count: urls.length, first5: urls.slice(0, 5) }, ms: Date.now() - t0 })
  } catch (e) {
    steps.push({ step: 'discoverSitemapUrls', result: { error: String(e) }, ms: Date.now() - start })
  }

  return NextResponse.json({
    domain: client.domain,
    origin,
    totalMs: Date.now() - start,
    steps,
  })
}
