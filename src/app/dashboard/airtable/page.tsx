'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Client {
  id: string
  name: string
  airtable_embed_social?: string
  airtable_embed_keywords?: string
  airtable_embed_seo?: string
}

type Tab = 'social' | 'keywords' | 'seo'

const TABS: { key: Tab; label: string; emoji: string; field: keyof Client }[] = [
  { key: 'social',    label: 'Social Calendar', emoji: '📅', field: 'airtable_embed_social' },
  { key: 'keywords',  label: 'Keywords',        emoji: '🔑', field: 'airtable_embed_keywords' },
  { key: 'seo',       label: 'SEO Strategy',    emoji: '📈', field: 'airtable_embed_seo' },
]

export default function AirtablePage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('social')
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(d => {
        const list: Client[] = d.clients ?? []
        setClients(list)
        if (list.length) setSelectedId(list[0].id)
      })
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`/api/clients/${selectedId}`)
      .then(r => r.json())
      .then(d => setClient(d.client ?? null))
      .finally(() => setLoading(false))
  }, [selectedId])

  const currentTab = TABS.find(t => t.key === activeTab)!
  const embedUrl = client ? (client[currentTab.field] as string | undefined) : undefined

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 flex-shrink-0 flex-wrap">
        <h1 className="text-sm font-semibold text-gray-700 mr-1">Airtable Views</h1>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="text-sm border border-gray-200 rounded px-2 py-1 bg-white text-gray-900"
        >
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Tabs */}
        <div className="flex gap-1 ml-2">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.emoji} {tab.label}
            </button>
          ))}
        </div>

        {selectedId && (
          <Link
            href={`/dashboard/clients/${selectedId}`}
            className="ml-auto text-xs text-gray-400 hover:text-indigo-500"
          >
            ⚙ Configure embed URLs
          </Link>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {!selectedId ? (
          <Empty message="Select a client to view their Airtable" />
        ) : loading ? (
          <Empty message="Loading…" />
        ) : embedUrl ? (
          <iframe
            src={embedUrl}
            className="w-full h-full border-0"
            allowFullScreen
            title={`${client?.name} – ${currentTab.label}`}
          />
        ) : (
          <NoEmbed clientId={selectedId} tab={currentTab} />
        )}
      </div>
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      {message}
    </div>
  )
}

function NoEmbed({
  clientId,
  tab,
}: {
  clientId: string
  tab: { label: string; emoji: string; field: string }
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
      <div className="text-4xl">{tab.emoji}</div>
      <p className="text-gray-600 font-medium">{tab.label} embed not configured</p>
      <p className="text-sm text-gray-400 max-w-sm">
        在 Airtable 中打开对应视图 → Share → Embed this view，复制 embed URL，粘贴到客户设置中。
      </p>
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-500 font-mono max-w-sm text-left">
        字段名：<span className="text-indigo-600">{tab.field}</span>
        <br />
        格式：https://airtable.com/embed/shr…
      </div>
      <Link
        href={`/dashboard/clients/${clientId}`}
        className="text-sm px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600"
      >
        → Go to Client Settings
      </Link>
    </div>
  )
}
