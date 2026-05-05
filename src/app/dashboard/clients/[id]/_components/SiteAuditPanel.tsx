'use client';

import { useMemo } from 'react';
import { CrawlButton } from '../site-audit/_components/CrawlButton';
import { ProgressCard } from '../site-audit/_components/ProgressCard';

interface SiteAuditPanelProps {
  clientId: string;
}

/**
 * SiteAuditPanel
 *
 * 整合 Site Audit 功能：
 * - CrawlButton: 启动网站爬虫任务
 * - ProgressCard: 实时显示爬虫进度
 */
export function SiteAuditPanel({ clientId }: SiteAuditPanelProps) {
  const key = useMemo(() => `site-audit-${clientId}`, [clientId]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Site Audit</h2>
            <p className="text-xs text-gray-500 mt-1">
              爬取网站内容、分析页面结构、检测地理位置标记。新客户接入时必须执行。
            </p>
          </div>
          <div className="flex-shrink-0">
            <CrawlButton clientId={clientId} />
          </div>
        </div>
      </div>

      {/* Progress */}
      <ProgressCard key={key} clientId={clientId} />

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <p className="text-xs text-indigo-900">
          <strong>❓ Site Audit 用于什么？</strong>
          <br />
          获取网站内容清单、页面主题分类、地理位置标记状态，为后续的内容生成、GEO 优化、SEO 分析提供基础数据。
          爬虫通常需要 5-30 分钟（取决于网站规模），完成后可用于生成策略驱动的内容。
        </p>
      </div>
    </div>
  );
}
