/**
 * WhatsApp Cloud API webhook — receives inbound customer messages in real time.
 *
 * Unlike Messenger (pulled hourly via `messenger-sync-hourly`, because the
 * Graph API supports listing a Page's conversations), WhatsApp's Cloud API has
 * no equivalent "list recent messages" endpoint — Meta only pushes messages to
 * a webhook URL. So this route, not a cron job, is how inbound WhatsApp
 * messages reach `conversations` / `conversation_messages`.
 *
 * GET  — Meta's one-time subscription handshake (`hub.challenge`).
 * POST — the actual message payload. Signature-verified with `META_APP_SECRET`
 *        (the same app secret already used to gate the Voice Agent's WhatsApp
 *        provider mode in `lib/voice/config.ts` — one Meta app, one secret).
 *
 * Routing an inbound message to a client_id goes through
 * `clients.whatsapp_phone_number_id` (20260902000001 migration) — never a
 * hardcoded client_id in this file. See that migration's comment for why.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET — subscription verification handshake.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  const verifyToken = process.env.META_VERIFY_TOKEN
  if (!verifyToken) {
    return NextResponse.json({ error: 'Server misconfiguration: META_VERIFY_TOKEN not set' }, { status: 500 })
  }

  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    // Meta expects the raw challenge string back, not JSON.
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

// ---------------------------------------------------------------------------
// Signature verification — same shape as any webhook that must prove the
// payload actually came from Meta, not from anyone who found the URL.
// ---------------------------------------------------------------------------
function isValidSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  // timingSafeEqual throws on length mismatch instead of returning false —
  // guard first so a malformed header can't crash the route into a 500 that
  // an attacker could use to fingerprint valid-length signatures.
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(provided, 'hex')
  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

// ---------------------------------------------------------------------------
// Official Cloud API webhook payload shape (documented, stable — not modeled
// from CTS-specific data since none exists yet; this is Meta's public
// contract, same class of source as the Messenger Graph API shapes already
// relied on elsewhere in this codebase).
// ---------------------------------------------------------------------------
interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string }
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
        messages?: Array<{
          id?: string
          from?: string
          timestamp?: string
          type?: string
          text?: { body?: string }
        }>
      }
    }>
  }>
}

async function resolveClientId(phoneNumberId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

async function upsertConversation(
  clientId: string,
  waId: string,
  participantName: string | undefined,
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('client_id', clientId)
    .eq('channel', 'whatsapp')
    .eq('participant_psid', waId)
    .maybeSingle()

  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      client_id: clientId,
      channel: 'whatsapp',
      conversation_id: waId, // WhatsApp has no separate thread id — the wa_id IS the thread key.
      participant_psid: waId,
      participant_name: participantName ?? null,
      last_message_from: 'customer',
    })
    .select('id')
    .single()

  if (error || !created) throw new Error(error?.message ?? 'failed to create conversation')
  return created.id as string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: META_APP_SECRET not set' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  if (!isValidSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: WhatsAppWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Meta requires a fast 200 regardless of what's inside, or it will retry
  // aggressively and eventually stop delivering. Failures below are logged,
  // not surfaced as a non-200 — this route must never become the reason a
  // customer's message silently never arrives because of an unrelated bug.
  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value
        const phoneNumberId = value?.metadata?.phone_number_id
        const messages = value?.messages ?? []
        if (!phoneNumberId || messages.length === 0) continue

        const clientId = await resolveClientId(phoneNumberId)
        if (!clientId) {
          console.error(
            `[webhooks/whatsapp] no client mapped to phone_number_id=${phoneNumberId} — message dropped`,
          )
          continue
        }

        const contactName = value?.contacts?.[0]?.profile?.name

        for (const msg of messages) {
          if (!msg.from || !msg.id) continue
          const conversationId = await upsertConversation(clientId, msg.from, contactName)

          // Idempotent on (conversation_id, message_id) — matches the unique
          // constraint carried over from messenger_messages, so Meta's retry
          // deliveries (guaranteed at-least-once) never duplicate a row.
          await supabaseAdmin.from('conversation_messages').upsert(
            {
              conversation_id: conversationId,
              message_id: msg.id,
              direction: 'inbound',
              sender_id: msg.from,
              sender_name: contactName ?? null,
              body: msg.type === 'text' ? msg.text?.body ?? null : `[${msg.type ?? 'unsupported'} message]`,
              sent_at: msg.timestamp
                ? new Date(Number(msg.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
            },
            { onConflict: 'conversation_id,message_id' },
          )

          await supabaseAdmin
            .from('conversations')
            .update({ last_message_at: new Date().toISOString(), last_message_from: 'customer' })
            .eq('id', conversationId)
        }
      }
    }
  } catch (err) {
    console.error('[webhooks/whatsapp] failed to process payload:', err)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
