import { supabaseAdmin } from '@/lib/supabase'

const DASHBOARD_ROOT = '/dashboard'
const PROSPECT_ROOT = '/prospect'
const PORTAL_ROOT = '/portal'

function clientHomePath(clientId: string): string {
  return `/dashboard/clients/${clientId}`
}

export function normalizeSelfServeTarget(clientId: string, requestedPath: string): string {
  const clientHome = clientHomePath(clientId)

  if (!requestedPath || requestedPath === DASHBOARD_ROOT || requestedPath === PROSPECT_ROOT || requestedPath === PORTAL_ROOT) {
    return clientHome
  }

  if (requestedPath.startsWith('/portal/')) {
    const suffix = requestedPath.replace(/^\/portal\/[^/]+/, '')
    return `${clientHome}${suffix || ''}`
  }

  return requestedPath
}

function buildBriefPath(clientId: string, nextPath: string, welcome: boolean): string {
  const params = new URLSearchParams()
  const clientHome = clientHomePath(clientId)

  if (nextPath !== clientHome) {
    params.set('next', nextPath)
  }

  if (welcome) {
    params.set('welcome', '1')
  }

  const query = params.toString()
  return `/dashboard/clients/${clientId}/brief${query ? `?${query}` : ''}`
}

export async function resolveSelfServeLanding(
  clientId: string,
  requestedPath: string,
  welcome = false,
): Promise<string> {
  const nextPath = normalizeSelfServeTarget(clientId, requestedPath)
  const { data } = await supabaseAdmin
    .from('clients')
    .select('brief_completed_at')
    .eq('id', clientId)
    .maybeSingle()

  if (!data?.brief_completed_at) {
    return buildBriefPath(clientId, nextPath, welcome)
  }

  if (welcome && nextPath === clientHomePath(clientId)) {
    return `${nextPath}?welcome=1`
  }

  return nextPath
}
