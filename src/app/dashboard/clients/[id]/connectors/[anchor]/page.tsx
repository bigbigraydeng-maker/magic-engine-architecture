'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

// ─── Connector config per anchor ─────────────────────────────────────────────

interface ConnectorMeta {
  name: string
  emoji: string
  description: string
  /** Fields the user fills in before connecting. Empty = just a "Connect" button. */
  fields: Array<{ key: string; label: string; placeholder: string; required: boolean }>
  /** Anchors that trigger advanced discovery on connect. */
  triggersAdvanced: boolean
  advancedHint: string
  /** Override for the submit button label (default: "确认连接 →") */
  buttonLabel?: string
  /** Override for the success message title (default: "✓ Connector 已连接") */
  successLabel?: string
  /** Override for the success sub-message when no advanced job triggered */
  savedLabel?: string
}

const CONNECTOR_META: Record<string, ConnectorMeta> = {
  'meta-ads': {
    name: 'Facebook 主页',
    emoji: '📊',
    description: '添加客户的 Facebook 主页 URL 后，张骞将自动抓取公开可见的粉丝数、互动率，以及 Meta 广告库中的投放记录（无需 API token，仅读取公开数据）。',
    fields: [
      {
        key: 'page_url',
        label: 'Facebook 主页 URL',
        placeholder: 'https://www.facebook.com/yourbrand',
        required: true,
      },
    ],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台自动补跑 Facebook 数据，通常 2–5 分钟完成。',
    buttonLabel: '添加 Facebook 主页 →',
    successLabel: '✓ Facebook 主页已添加',
    savedLabel: '主页已添加。如果还没有基础发现报告，请先运行张骞发现，高级发现将自动补跑。',
  },
  gbp: {
    name: 'Google 商业档案 (GBP)',
    emoji: '📍',
    description: '标记 GBP 已授权后，张骞将补跑更详细的本地评价分析（评分分布、差评样本、回复率）。',
    fields: [
      {
        key: 'place_id',
        label: 'Google Place ID（可选）',
        placeholder: 'ChIJxxxxxxxxxxxxxxxxxx',
        required: false,
      },
    ],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台自动补跑高级发现，通常 1–3 分钟完成。',
  },
  gsc: {
    name: 'Google Search Console',
    emoji: '🔎',
    description: '接入 GSC 后，张骞将拉取真实 query、展示量、点击率、平均排名，替代 SEMrush 关键词估算。\n\n前提：客户需在 GSC 后台（Settings → Users & Permissions）将 magic-engine 服务账号加为验证用户（Restricted 权限即可）。服务账号邮箱请联系管理员确认。',
    fields: [
      {
        key: 'site_url',
        label: 'GSC Property URL',
        placeholder: 'https://example.com.au/',
        required: true,
      },
    ],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台自动拉取过去 28 天的真实搜索数据（query / 展示量 / 点击率 / 排名），通常 1–2 分钟完成。',
    buttonLabel: '连接 Google Search Console →',
    successLabel: '✓ Google Search Console 已连接',
  },
  'google-ads': {
    name: 'Google 广告',
    emoji: '🔵',
    description: '通过 Google Ads 透明度中心（公开数据）扫描品牌当前的 Google 广告投放情况，包括活跃广告数量、创意格式及投放地区。无需提供任何 API 凭证或广告账户授权。',
    fields: [],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台扫描 Google 广告透明度中心，通常 2–5 分钟完成。',
    buttonLabel: '开启 Google 广告扫描 →',
    successLabel: '✓ Google 广告扫描已启用',
  },
  ga4: {
    name: 'Google Analytics 4',
    emoji: '📈',
    description: '通过 GA4 Data API 接入，飞轮归因数据将直接来自真实 GA4，不再依赖估算。',
    fields: [
      {
        key: 'property_id',
        label: 'GA4 Property ID',
        placeholder: '123456789',
        required: false,
      },
    ],
    triggersAdvanced: false,
    advancedHint: '',
  },
  reviews: {
    name: '第三方评价平台',
    emoji: '⭐',
    description: '当前张骞通过 Jina/Apify 抓取公开数据，无需额外授权。此处可标记为已确认配置。',
    fields: [],
    triggersAdvanced: false,
    advancedHint: '',
  },
  publer: {
    name: 'Publer 发布器',
    emoji: '🚀',
    description: 'Magic Engine 自有 Publer workspace 已连接。客户社媒账号需在 Publer 后台单独授权。',
    fields: [],
    triggersAdvanced: false,
    advancedHint: '',
  },
  social: {
    name: '客户社媒账号',
    emoji: '📱',
    description: '客户社媒账号通过 Publer 授权后，在此标记为已连接。',
    fields: [],
    triggersAdvanced: false,
    advancedHint: '',
  },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConnectorDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = params.id as string
  const anchor = params.anchor as string

  const meta = CONNECTOR_META[anchor]

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    advancedJobId?: string | null
    error?: string
  } | null>(null)

  if (!meta) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-sm">未知的 Connector：{anchor}</p>
          <Link
            href={`/dashboard/clients/${clientId}/connectors`}
            className="mt-3 inline-block text-xs text-indigo-600 hover:underline"
          >
            ← 返回 Connectors
          </Link>
        </div>
      </div>
    )
  }

  const handleConnect = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/connectors/${anchor}/connect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            config: meta.fields.length > 0 ? fieldValues : null,
          }),
        },
      )
      const data = await res.json() as { success: boolean; advanced_job_id?: string | null; error?: string }
      if (data.success) {
        setResult({ ok: true, advancedJobId: data.advanced_job_id })
      } else {
        setResult({ ok: false, error: data.error ?? '保存失败' })
      }
    } catch {
      setResult({ ok: false, error: '网络错误，请重试' })
    } finally {
      setSaving(false)
    }
  }

  const missingRequired = meta.fields
    .filter(f => f.required && !fieldValues[f.key]?.trim())
    .length > 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href={`/dashboard/clients/${clientId}/connectors`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ← 返回
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            {meta.emoji} {meta.name}
          </h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        {/* Description */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-700 leading-relaxed">{meta.description}</p>
        </div>

        {/* Form fields */}
        {meta.fields.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">配置信息</h2>
            {meta.fields.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {f.label}
                  {f.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  placeholder={f.placeholder}
                  value={fieldValues[f.key] ?? ''}
                  onChange={e =>
                    setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            ))}
          </div>
        )}

        {/* Advanced discovery hint */}
        {meta.triggersAdvanced && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <p className="text-xs text-indigo-800">
              <strong>高级发现将自动触发</strong> — {meta.advancedHint}
            </p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className={`rounded-xl border px-4 py-3 ${
              result.ok
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
            }`}
          >
            {result.ok ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-green-800">{meta.successLabel ?? '✓ 已保存'}</p>
                {result.advancedJobId ? (
                  <p className="text-xs text-green-700">
                    张骞正在后台补跑数据（Job ID: {result.advancedJobId}），通常 2–5 分钟完成后自动写入发现报告。
                  </p>
                ) : meta.triggersAdvanced ? (
                  <p className="text-xs text-green-700">
                    {meta.savedLabel ?? '已保存。如果还没有基础发现报告，请先运行张骞发现，高级发现将自动补跑。'}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-red-700">{result.error}</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        {!result?.ok && (
          <button
            onClick={void handleConnect}
            disabled={saving || missingRequired}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '正在保存…' : (meta.buttonLabel ?? '确认连接 →')}
          </button>
        )}

        {result?.ok && (
          <button
            onClick={() => router.push(`/dashboard/clients/${clientId}/connectors`)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← 返回 Connectors
          </button>
        )}
      </div>
    </div>
  )
}
