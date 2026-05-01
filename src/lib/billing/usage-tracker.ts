/**
 * DataForSEO usage and cost tracking
 * Monitors API calls and calculates costs for billing
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

interface UsageLog {
  client_id: string
  service: 'DataForSEO' | 'Semrush' | 'Publer'
  api_calls: number
  cost_usd: number
  month: string // YYYY-MM format
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Log API usage and cost for a service
 */
export async function logServiceUsage(
  clientId: string,
  service: 'DataForSEO' | 'Semrush' | 'Publer',
  apiCalls: number,
  costUsd: number,
  supabase: SupabaseClient<any>
): Promise<void> {
  const month = getCurrentMonth()

  const { error } = await supabase
    .from('datasource_usage_logs')
    .upsert(
      {
        client_id: clientId,
        service,
        api_calls: apiCalls,
        cost_usd: costUsd,
        month,
      },
      {
        onConflict: 'client_id,service,month',
      }
    )

  if (error) {
    console.error(`Failed to log ${service} usage:`, error)
  }
}

/**
 * Get billing summary for a specific month
 */
export async function getBillingByMonth(
  month: string,
  supabase: SupabaseClient<any>
) {
  const { data, error } = await supabase
    .from('datasource_usage_logs')
    .select('*')
    .eq('month', month)
    .order('cost_usd', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch billing data: ${error.message}`)
  }

  return data || []
}

/**
 * Get billing summary for a specific client and month
 */
export async function getClientBillingByMonth(
  clientId: string,
  month: string,
  supabase: SupabaseClient<any>
) {
  const { data, error } = await supabase
    .from('datasource_usage_logs')
    .select('*')
    .eq('client_id', clientId)
    .eq('month', month)

  if (error) {
    throw new Error(`Failed to fetch client billing data: ${error.message}`)
  }

  return data || []
}

/**
 * Calculate total costs by service for a month
 */
export async function getCostsByService(
  month: string,
  supabase: SupabaseClient<any>
): Promise<Record<string, number>> {
  const data = await getBillingByMonth(month, supabase)

  const costs: Record<string, number> = {}
  for (const log of data) {
    if (!costs[log.service]) {
      costs[log.service] = 0
    }
    costs[log.service] += log.cost_usd
  }

  return costs
}

/**
 * Get all unique months with usage data
 */
export async function getAvailableMonths(
  supabase: SupabaseClient<any>
): Promise<string[]> {
  const { data, error } = await supabase
    .from('datasource_usage_logs')
    .select('month')
    .distinct()
    .order('month', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch available months: ${error.message}`)
  }

  return (data || []).map((row: any) => row.month)
}
