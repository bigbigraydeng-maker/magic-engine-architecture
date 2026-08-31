import { headers } from 'next/headers'
import { redirect, permanentRedirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import PortalNav from './_components/PortalNav'

interface Props {
  children: React.ReactNode
  params: { clientId: string }
}

export default async function PortalLayout({ children, params }: Props) {
  const headerStore = headers()
  const allowedClientId = headerStore.get('x-allowed-client-id')
  const tier = headerStore.get('x-user-tier')

  // Default P29.B.1 behaviour: portal routes were unified into dashboard,
  // so every visitor is 308ed into /dashboard/clients/<id>. The exception
  // — added because portal-tier is the ONLY tier the dashboard middleware
  // rejects, and unconditionally redirecting them here dead-ends them at
  // /unauthorized — is a portal-tier visitor whose middleware already
  // scoped them to exactly this clientId. In that (and only that) case,
  // render the existing portal workspace instead. Both, dashboard, fde,
  // client, direct hits without headers, and any mismatched clientId all
  // still take the pre-existing dashboard permanentRedirect path.
  const isPortalTierOnExactClient =
    tier === 'portal_only' && allowedClientId === params.clientId
  if (!isPortalTierOnExactClient) {
    permanentRedirect(`/dashboard/clients/${params.clientId}`)
  }

  // Defence-in-depth: if middleware somehow did not scope the request
  // (a direct hit that bypassed the matcher, a misconfigured deploy),
  // fail closed instead of rendering a portal for whichever client_id
  // the URL says. Membership missing / wrong / unknown / query-failed
  // never reaches here as portal_only because middleware only emits
  // that tier for a valid portal row on this exact clientId.
  if (!allowedClientId || allowedClientId !== params.clientId) {
    redirect('/unauthorized')
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('id', params.clientId)
    .single()

  const clientName = client?.name
  if (!clientName) redirect('/unauthorized')

  return (
    <div className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <PortalNav clientId={params.clientId} clientName={clientName} />
      <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:py-8">
        {children}
      </main>
    </div>
  )
}
