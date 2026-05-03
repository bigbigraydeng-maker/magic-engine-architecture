'use client';

import type { GeoCheck } from '@/lib/blog/html-builder';

interface Props {
  checks: GeoCheck[];
}

/**
 * GEO + quality checklist panel for the blog viewer.
 * Shows pass/fail for each signal check with detail text.
 */
export function GeoChecklist({ checks }: Props) {
  const passed = checks.filter(c => c.pass).length;
  const total  = checks.length;
  const allGood = passed === total;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Quality Checklist</h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          allGood ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {passed}/{total} passed
        </span>
      </div>
      <div className="divide-y divide-gray-50">
        {checks.map(check => (
          <div key={check.key} className="px-5 py-3 flex items-start gap-3">
            <span className={`flex-shrink-0 mt-0.5 text-base ${check.pass ? 'text-green-500' : 'text-amber-500'}`}>
              {check.pass ? '✅' : '⚠️'}
            </span>
            <div className="min-w-0">
              <p className={`text-xs font-medium ${check.pass ? 'text-gray-700' : 'text-gray-900'}`}>
                {check.label}
              </p>
              {check.detail && (
                <p className="text-xs text-gray-400 mt-0.5">{check.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
