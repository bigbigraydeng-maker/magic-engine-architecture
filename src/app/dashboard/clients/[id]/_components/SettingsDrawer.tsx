'use client'

import { useEffect } from 'react'
import { BriefPanel } from './BriefPanel'
import { CmsPanel } from './CmsPanel'
import { UsersPanel } from './UsersPanel'

export type SettingsTab = 'brief' | 'client-info' | 'cms' | 'users'

interface Client {
  id: string
  name: string
  domain?: string
  created_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  clientId: string
  client: Client
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'brief',       label: '✨ Master Brief' },
  { id: 'client-info', label: '👤 客户信息' },
  { id: 'cms',         label: '🔗 网站连接' },
  { id: 'users',       label: '🔑 用户权限' },
]

export function SettingsDrawer({ open, onClose, clientId, client, activeTab, onTabChange }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 h-full w-[700px] max-w-[92vw] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">⚙️</span>
            <h2 className="text-sm font-semibold text-gray-900">设置 — {client.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex border-b border-gray-200 px-6 flex-shrink-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`px-3 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'brief' && (
            <BriefPanel clientId={clientId} />
          )}

          {activeTab === 'cms' && (
            <CmsPanel clientId={clientId} />
          )}

          {activeTab === 'users' && (
            <UsersPanel clientId={clientId} />
          )}

          {activeTab === 'client-info' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-xl divide-y divide-gray-200">
                {[
                  { label: '客户名称', value: client.name },
                  {
                    label: '网站域名',
                    value: client.domain
                      ? <a href={`https://${client.domain}`} target="_blank" rel="noreferrer"
                          className="text-indigo-600 hover:underline">{client.domain}</a>
                      : <span className="text-gray-400">未设置</span>,
                  },
                  {
                    label: '创建时间',
                    value: new Date(client.created_at).toLocaleDateString('zh-CN'),
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-medium text-gray-900">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
