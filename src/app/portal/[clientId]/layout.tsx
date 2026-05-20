import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import PortalNav from './_components/PortalNav'

interface Props {
  children: React.ReactNode
  params: { clientId: string }
}

export default async function PortalLayout({ children, params }: Props) {
  const headerStore = headers()
  const allowedClientId = headerStore.get('x-allowed-client-id')

  // Double-check: middleware already enforces this, but belt-and-suspenders
  if (!allowedClientId || allowedClientId !== params.clientId) {
    redirect('/unauthorized')
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('id', params.clientId)
    .single()

  if (!client) redirect('/unauthorized')

  return (
    <div className="min-h-screen bg-gray-50">
      <PortalNav clientId={params.clientId} clientName={client.name} />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  )
}
