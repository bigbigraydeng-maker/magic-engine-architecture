/**
 * Admin Billing API
 * GET /api/admin/billing/datasources?month=YYYY-MM
 *
 * Returns cost summary for all clients' DataForSEO usage
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBillingByMonth, getCostsByService, getAvailableMonths } from '@/lib/billing/usage-tracker'

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )

    const { searchParams } = new URL(req.url)
    const month = searchParams.get('month')

    if (!month) {
      // Return available months if no month specified
      const months = await getAvailableMonths(supabase)
      return NextResponse.json({
        availableMonths: months,
        message: 'No month specified. Available months returned.',
      })
    }

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: 'Invalid month format. Use YYYY-MM.' },
        { status: 400 }
      )
    }

    // Get billing data for the month
    const billingData = await getBillingByMonth(month, supabase)
    const costsByService = await getCostsByService(month, supabase)

    // Calculate totals
    const totalCost = Object.values(costsByService).reduce((sum, cost) => sum + cost, 0)
    const totalApiCalls = billingData.reduce((sum, log) => sum + log.api_calls, 0)

    return NextResponse.json({
      month,
      totalCost: Number(totalCost.toFixed(2)),
      totalApiCalls,
      costsByService: Object.entries(costsByService).reduce(
        (acc, [service, cost]) => ({
          ...acc,
          [service]: Number(cost.toFixed(2)),
        }),
        {}
      ),
      byClient: billingData.map((log) => ({
        clientId: log.client_id,
        service: log.service,
        apiCalls: log.api_calls,
        costUsd: Number(log.cost_usd),
      })),
    })
  } catch (error) {
    console.error('Billing API error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch billing data',
      },
      { status: 500 }
    )
  }
}
