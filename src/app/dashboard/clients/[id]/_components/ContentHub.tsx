'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CampaignPanel } from './CampaignPanel'
import { ReelsStudio } from './ReelsStudio'

type ContentTab = 'campaigns' | 'reels' | 'visuals' | 'marketplace'

interface Props {
  clientId: string
}

const TABS: { id: ContentTab; label: string }[] = [
  { id: 'campaigns',    label: '🎯 推广活动' },
  { id: 'reels',        label: '🎬 Reels' },
  { id: 'visuals',      label: '🖼️ 图片' },
  { id: 'marketplace',  label: '🛒 Marketplace' },
]

// Shortcut links to key client sub-pages (shown above tabs)
function ClientShortcuts({ clientId }: { clientId: string }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <Link
        href={`/dashboard/clients/${clientId}/diagnostic`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
      >
        🩺 诊断报告
      </Link>
      <Link
        href={`/dashboard/clients/${clientId}/site-audit/pages`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
      >
        🔍 网站审计
      </Link>
      <Link
        href={`/dashboard/clients/${clientId}/strategy`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
      >
        📋 策略建议
      </Link>
    </div>
  )
}

export function ContentHub({ clientId }: Props) {
  const [active, setActive] = useState<ContentTab>('campaigns')

  return (
    <div className="space-y-0">
      {/* Quick navigation shortcuts */}
      <ClientShortcuts clientId={clientId} />

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              active === tab.id
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'campaigns' && <CampaignPanel clientId={clientId} />}

      {active === 'reels' && <ReelsStudio clientId={clientId} />}

      {active === 'visuals' && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center space-y-4">
          <p className="text-5xl">🖼️</p>
          <h3 className="text-lg font-semibold text-gray-900">Image Studio</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            生成和管理客户的社媒图片素材。在 Visual Studio 中操作。
          </p>
          <Link
            href={`/dashboard/visuals?client=${clientId}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            打开 Visual Studio ↗
          </Link>
        </div>
      )}

      {active === 'marketplace' && (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-12 text-center space-y-3">
          <p className="text-5xl">🛒</p>
          <h3 className="text-lg font-semibold text-gray-700">FB Marketplace 内容</h3>
          <p className="text-sm text-gray-400 max-w-xs mx-auto leading-relaxed">
            根据 Master Brief 自动生成产品图片和描述文案，团队手动复制发布到 Facebook Marketplace。
          </p>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
            🔜 即将推出
          </span>
        </div>
      )}
    </div>
  )
}
