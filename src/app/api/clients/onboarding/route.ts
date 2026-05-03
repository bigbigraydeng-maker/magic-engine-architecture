import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

interface OnboardingRequest {
  step: 1 | 2 | 3
  client_id?: string
  name?: string
  domain?: string
  target_market?: 'au' | 'nz' | 'other'
  airtable_base_id?: string
  airtable_content_table_id?: string
  semrush_db?: string
  monthly_quota?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as OnboardingRequest

    // Step 1: Create new client
    if (body.step === 1) {
      const { name, domain, target_market } = body

      if (!name || !name.trim()) {
        return NextResponse.json(
          { error: 'Customer name is required' },
          { status: 400 }
        )
      }

      const semrushDb =
        target_market === 'nz'
          ? 'nz'
          : target_market === 'other'
            ? 'au'
            : 'au'

      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert({
          name: name.trim(),
          domain: domain?.trim() || null,
          semrush_db: semrushDb,
          monthly_quota: 1000,
          plan_tier: 'starter',
        })
        .select('id')
        .single()

      if (error) throw error

      return NextResponse.json(
        {
          client_id: data.id,
          step: 1,
          message: 'Client created successfully',
        },
        { status: 201 }
      )
    }

    // Step 2: Connect Airtable workspace
    if (body.step === 2) {
      const { client_id, airtable_base_id, airtable_content_table_id } = body

      if (!client_id) {
        return NextResponse.json(
          { error: 'client_id is required' },
          { status: 400 }
        )
      }

      if (!airtable_base_id || !airtable_base_id.trim()) {
        return NextResponse.json(
          { error: 'Airtable Base ID is required' },
          { status: 400 }
        )
      }

      // Verify client exists
      const { data: existingClient, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', client_id)
        .single()

      if (clientError || !existingClient) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }

      // Update client with Airtable config
      const { error: updateError } = await supabaseAdmin
        .from('clients')
        .update({
          airtable_base_id: airtable_base_id.trim(),
          airtable_content_table_id: airtable_content_table_id?.trim() || null,
        })
        .eq('id', client_id)

      if (updateError) throw updateError

      return NextResponse.json(
        {
          client_id,
          step: 2,
          status: 'verified',
          message: 'Airtable workspace connected',
        },
        { status: 200 }
      )
    }

    // Step 3: Configure keywords and quota
    if (body.step === 3) {
      const { client_id, semrush_db, monthly_quota } = body

      if (!client_id) {
        return NextResponse.json(
          { error: 'client_id is required' },
          { status: 400 }
        )
      }

      if (!semrush_db || !['au', 'nz', 'us', 'gb', 'ca'].includes(semrush_db)) {
        return NextResponse.json(
          { error: 'Invalid semrush_db value' },
          { status: 400 }
        )
      }

      if (!monthly_quota || monthly_quota < 100 || monthly_quota > 10000) {
        return NextResponse.json(
          { error: 'Monthly quota must be between 100 and 10,000' },
          { status: 400 }
        )
      }

      // Verify client exists
      const { data: existingClient, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', client_id)
        .single()

      if (clientError || !existingClient) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }

      // Update client with keyword config
      const { error: updateError } = await supabaseAdmin
        .from('clients')
        .update({
          semrush_db,
          monthly_quota,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq('id', client_id)

      if (updateError) throw updateError

      return NextResponse.json(
        {
          client_id,
          step: 3,
          status: 'complete',
          message: 'Onboarding completed successfully',
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { error: 'Invalid step value' },
      { status: 400 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Onboarding API Error]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
