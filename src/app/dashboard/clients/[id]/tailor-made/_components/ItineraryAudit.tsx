'use client';

import { useMemo, useState } from 'react';
import { auditItinerary, auditSummary, type AuditFinding } from '@/lib/tailor-made/audit';
import type { TailorMadeItinerary } from '@/lib/tailor-made/types';

/**
 * 空字段体检面板。
 *
 * 存在的理由是一次真实事故：CTS-2026-0025 发出去的行程单上，价格旁边的
 * 「Costs to allow for」只有名目没有金额，第 2 页的 TRAVELLING 整格空白。
 * 模板遇到缺字段是渲染成空字符串 —— 不报错、不留痕，人眼在 8 页里发现不了。
 *
 * 所以这块面板只干一件事：把**本该有内容却空着**的格子摆到顾问眼前。
 * 不评价文案好坏 —— 系统一旦开始挑写作毛病，顾问就学会了整块无视它。
 */
export default function ItineraryAudit({ payload }: { payload: TailorMadeItinerary }) {
  const findings = useMemo(() => auditItinerary(payload), [payload]);
  const [open, setOpen] = useState(false);

  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-[#5C8A4A]/25 bg-[#5C8A4A]/6 px-4 py-2.5 text-xs font-bold text-[#5C8A4A]">
        ✓ 没有空字段，可以发
      </div>
    );
  }

  const blockers = findings.filter((f) => f.level === 'blocker');
  const warns = findings.filter((f) => f.level === 'warn');
  const tone = blockers.length > 0 ? '#C2453A' : '#B8860B';

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: `${tone}40` }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-xs font-black" style={{ color: tone }}>
          {blockers.length > 0 ? '⚠ ' : '· '}
          {auditSummary(findings)}
        </span>
        <span className="text-[11px] font-bold text-me-charcoal/40">{open ? '收起' : '看看是哪些'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-black/5 px-4 py-3">
          {blockers.length > 0 && <Group title="该补上再发客户" tone="#C2453A" items={blockers} />}
          {warns.length > 0 && <Group title="建议补" tone="#B8860B" items={warns} />}
          <p className="text-[11px] leading-relaxed text-me-charcoal/45">
            这里只看「空不空」，不评价文案。空着不一定是错 —— 最后一天不写住宿就很正常，
            按需要忽略即可。
          </p>
        </div>
      )}
    </div>
  );
}

function Group({ title, tone, items }: { title: string; tone: string; items: AuditFinding[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-black" style={{ color: tone }}>
        {title}（{items.length}）
      </div>
      <ul className="space-y-1">
        {items.map((f, i) => (
          <li key={i} className="text-[11px] leading-relaxed">
            <span className="font-bold text-me-charcoal">{f.where}</span>
            <span className="text-me-charcoal/55"> —— {f.what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
