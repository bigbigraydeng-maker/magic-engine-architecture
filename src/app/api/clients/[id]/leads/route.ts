/**
 * POST /api/clients/[id]/cms/wordpress/... — wait, that's the page-rewriter.
 *
 * This is /api/clients/[id]/leads — the public lead-capture endpoint that
 * Stage-2 client landing pages POST to (the Oztop /quote/ LP is the first
 * consumer, see docs/mockups/oztop-quote-lp.html).
 *
 * Security model
 * --------------
 *   - PUBLIC, NO AUTH. Submitted from anonymous browsers on the client's
 *     own domain (oztopbuildingsupplies.com.au, etc).
 *   - CORS: allow the client's own domain (from clients.domain) and nothing
 *     else. Preflight handled by OPTIONS.
 *   - Honeypot field `company_hp` — bot submissions get 200 OK so the bot
 *     never learns the trap exists, but nothing is written to the DB.
 *   - Per-(client_id, IP) rate limit: 5 leads / 60 s. Hot prospects hitting
 *     refresh-spam are tolerated; bot floods get 429'd.
 *   - sanitizeLead enforces every field; UNTRUSTED INPUT is the default
 *     posture.
 *   - Service-role Supabase client (RLS bypassed at insert; the table is
 *     fronted by this route alone).
 *
 * Response shape
 * --------------
 *   200 OK            { success: true,  lead_id: string }
 *   200 OK (honeypot) { success: true,  lead_id: null   }   ← bot wears the trap
 *   400 Bad Request   { success: false, error,  code: 'INVALID_INPUT' }
 *   404 Not Found     { success: false, error,  code: 'CLIENT_NOT_FOUND' }
 *   429 Too Many      { success: false, error,  code: 'RATE_LIMITED' }
 *   500 Internal      { success: false, error,  code: 'INTERNAL' }
 *
 * Phase 12.R · lead-capture (Stage 2)
 */

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { sanitizeLead, extractClientIp, type RawLeadInput, type CleanLead } from '@/lib/leads/sanitize'
import { mirrorWebFormLead } from '@/lib/crm/web-form-lead'
import { meMailFrom } from '@/lib/email/sender'

interface RouteContext {
  params: { id: string }
}

const RATE_LIMIT_PER_MIN = 5
const RATE_WINDOW_SEC    = 60

// ─── CORS helpers ─────────────────────────────────────────────────────────────

interface ClientLeadContext {
  origins: string[]
  name: string | null
  notifyEmails: string[]
}

/**
 * Look up the client's primary domain (for the Origin allowlist), display
 * name, and lead-notification recipients in one query.
 * Returns an empty origins array if the client doesn't exist — the caller
 * treats an empty allowlist as "no client" and refuses to set any CORS
 * headers.
 */
async function resolveClientContext(clientId: string): Promise<ClientLeadContext> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('domain, name, leads_config')
    .eq('id', clientId)
    .maybeSingle()
  if (!data || typeof data.domain !== 'string') return { origins: [], name: null, notifyEmails: [] }
  const host = data.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
  // Allow both apex and www subdomain — covers the most common pair without
  // opening the door to arbitrary subdomains.
  const origins = host ? [`https://${host}`, `https://www.${host}`] : []
  const cfg = (data.leads_config ?? {}) as Record<string, unknown>
  const notifyEmails = Array.isArray(cfg.notify_emails)
    ? cfg.notify_emails.filter((e): e is string => typeof e === 'string' && e.length > 0)
    : []
  return { origins, name: typeof data.name === 'string' ? data.name : null, notifyEmails }
}

function corsHeaders(allowOrigin: string | null): Record<string, string> {
  if (!allowOrigin) {
    return {
      Vary: 'Origin',
    }
  }
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '600',
    Vary:                           'Origin',
  }
}

function chooseAllowOrigin(reqOrigin: string | null, allowList: string[]): string | null {
  if (!reqOrigin) return null
  // Normalise BOTH sides and ECHO the normalised value — keeping the raw
  // (possibly attacker-cased) string in the response header is a footgun for
  // any future code that compares headers to the allowlist.
  const norm = reqOrigin.toLowerCase()
  return allowList.includes(norm) ? norm : null
}

function shape(body: Record<string, unknown>, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json(body, {
    status:  init.status ?? 200,
    headers: init.headers,
  })
}

// ─── OPTIONS (CORS preflight) ─────────────────────────────────────────────────

export async function OPTIONS(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const reqOrigin = req.headers.get('origin')
  const { origins: allowList } = await resolveClientContext(params.id)
  const allow     = chooseAllowOrigin(reqOrigin, allowList)
  return new NextResponse(null, { status: 204, headers: corsHeaders(allow) })
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    return await handlePost(req, ctx)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[leads POST]', ctx.params.id, msg)
    return shape(
      { success: false, error: 'Internal error processing lead submission', code: 'INTERNAL' },
      { status: 500 },
    )
  }
}

async function handlePost(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const clientId  = params.id
  const reqOrigin = req.headers.get('origin')
  const { origins: allowList, name: clientName, notifyEmails } = await resolveClientContext(clientId)
  if (allowList.length === 0) {
    return shape(
      { success: false, error: 'Client not found', code: 'CLIENT_NOT_FOUND' },
      { status: 404 },
    )
  }
  const allow = chooseAllowOrigin(reqOrigin, allowList)
  const headers = corsHeaders(allow)

  // Parse body
  let raw: RawLeadInput
  try {
    raw = await req.json() as RawLeadInput
  } catch {
    return shape(
      { success: false, error: 'Invalid JSON body', code: 'INVALID_INPUT' },
      { status: 400, headers },
    )
  }

  // We need a stable rate-limit key BEFORE doing anything that touches the
  // DB. Reject sources we cannot key — otherwise every XFF-less request gets
  // bucketed under the literal 'unknown' and a single attacker on a quirky
  // path can exhaust the bucket and starve real users (魏征 P0.3).
  const clientIp = extractClientIp(req.headers)
  if (clientIp === 'unknown') {
    return shape(
      {
        success: false,
        error:   'Source IP could not be determined — please submit through the live LP, not a server-side relay.',
        code:    'INVALID_INPUT',
      },
      { status: 400, headers },
    )
  }

  // Rate limit per (client_id, client_ip) over the last RATE_WINDOW_SEC.
  // Honeypot submissions ALSO consume the bucket so attackers can't use
  // honeypot field as a way to burst the endpoint (魏征 P0.2).
  const since = new Date(Date.now() - RATE_WINDOW_SEC * 1000).toISOString()
  const { count: recent, error: rateErr } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('client_ip', clientIp)
    .gte('created_at', since)

  if (rateErr) {
    // Fail OPEN — we'd rather accept a possible-spam lead than lose a real one.
    console.error('[leads POST] rate-limit count failed, failing open:', rateErr)
  } else if ((recent ?? 0) >= RATE_LIMIT_PER_MIN) {
    return shape(
      {
        success: false,
        error:   `Too many submissions — try again in a minute, or call the showroom.`,
        code:    'RATE_LIMITED',
      },
      { status: 429, headers },
    )
  }

  // Sanitize AFTER the rate-limit check so a bot-flood payload still gets
  // counted toward its IP's quota. (Sanitize is cheap; the order matters only
  // for the rate-limit guarantee.)
  const clean = sanitizeLead(raw)

  // Honeypot — quietly succeed, no DB insert. The bucket was already debited
  // by the rate-limit check above, so a determined spammer cannot use the
  // honeypot field as a way to bypass throttling.
  if (!clean.ok && clean.code === 'HONEYPOT') {
    return shape({ success: true, lead_id: null }, { headers })
  }
  if (!clean.ok) {
    return shape(
      { success: false, error: clean.reason, code: clean.code },
      { status: 400, headers },
    )
  }

  // Insert. Service-role bypasses RLS; no end-user identity to forward.
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('leads')
    .insert({
      client_id:    clientId,
      name:         clean.lead.name,
      phone:        clean.lead.phone,
      email:        clean.lead.email,
      project_type: clean.lead.project_type,
      suburb:       clean.lead.suburb,
      timeline:     clean.lead.timeline,
      message:      clean.lead.message,
      source_url:   clean.lead.source_url,
      referrer:     clean.lead.referrer,
      utm_source:   clean.lead.utm_source,
      utm_medium:   clean.lead.utm_medium,
      utm_campaign: clean.lead.utm_campaign,
      submitted_at: clean.lead.submitted_at,
      client_ip:    clientIp,
      user_agent:   req.headers.get('user-agent')?.slice(0, 500) ?? null,
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    console.error('[leads POST] insert failed:', insErr)
    return shape(
      { success: false, error: 'Could not save your enquiry — please call us.', code: 'INTERNAL' },
      { status: 500, headers },
    )
  }

  // Mirror into the unified CRM (contacts + a web_form touchpoint carrying the
  // utm attribution). Without this bridge a buyer who clicked an ad, landed on
  // the LP and filled the form simply does not exist in the CRM — the "which ad
  // produced a deal" chain breaks right here.
  //
  // Awaited but never allowed to fail the request: the lead row is already saved,
  // and a punter who sees "submission failed" walks away. mirrorWebFormLead()
  // swallows its own errors by contract; the try/catch is belt-and-braces.
  try {
    await mirrorWebFormLead({
      clientId,
      leadId:      inserted.id as string,
      name:        clean.lead.name,
      phone:       clean.lead.phone,
      email:       clean.lead.email,
      message:     clean.lead.message,
      sourceUrl:   clean.lead.source_url,
      utmSource:   clean.lead.utm_source,
      utmMedium:   clean.lead.utm_medium,
      utmCampaign: clean.lead.utm_campaign,
      submittedAt: clean.lead.submitted_at,
    })
  } catch (err) {
    console.error('[leads POST] CRM mirror failed (lead saved, response unaffected):', err)
  }

  // Best-effort email straight to the client's own inbox (leads_config.notify_emails).
  // The lead is already saved in the CRM either way — this is purely so the client
  // hears about it without having to log into the ME dashboard. Never allowed to
  // fail the request.
  if (notifyEmails.length > 0) {
    try {
      await notifyLeadEmail(clientName ?? 'Your website', notifyEmails, clean.lead)
    } catch (err) {
      console.error('[leads POST] notify email failed (lead saved, response unaffected):', err)
    }
  }

  return shape({ success: true, lead_id: inserted.id }, { headers })
}

// ─── Client notification email ────────────────────────────────────────────────

async function notifyLeadEmail(clientName: string, to: string[], lead: CleanLead): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const resend = new Resend(apiKey)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const row = (label: string, value: string | null) =>
    value
      ? `<tr><td style="padding:8px 12px;background:#f8fafc;font-weight:600;vertical-align:top;width:90px;color:#475569">${esc(label)}</td><td style="padding:8px 12px;border-left:3px solid #e2e8f0;white-space:pre-wrap">${esc(value)}</td></tr>`
      : ''
  // Resend is a JSON API (not raw SMTP text), so classic header injection via
  // \r\n in the subject shouldn't actually work — stripping it anyway removes
  // the question entirely, since lead.name is untrusted user input.
  const safeName = lead.name.replace(/[\r\n]/g, ' ')
  await resend.emails.send({
    from: meMailFrom(`${clientName} Website`),
    to,
    ...(lead.email ? { replyTo: lead.email } : {}),
    subject: `New enquiry from your website — ${safeName}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a">${esc(lead.name)} sent an enquiry through your website</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('Name', lead.name)}
        ${row('Phone', lead.phone)}
        ${row('Email', lead.email)}
        ${row('Message', lead.message)}
      </table>
      <p style="margin-top:16px;font-size:12px;color:#94a3b8">Reply to this email to reach them directly.</p>
    </div>`,
  })
}
