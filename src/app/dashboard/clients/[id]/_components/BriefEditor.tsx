'use client';

import { useState } from 'react';
import type { MasterBrief, BrandVoice, TargetAudience, ContentPillar, PlatformConfig, VIColors } from '@/types/magic-engine';

interface Props {
  brief: MasterBrief;
  briefId: string;
  clientId: string;
  onUpdated: (b: MasterBrief) => void;
  onActivate: () => void;
}

type Section = 'basics' | 'voice' | 'audience' | 'content' | 'keywords' | 'vi' | 'narratives';

export function BriefEditor({ brief, briefId, clientId, onUpdated, onActivate }: Props) {
  const [open, setOpen] = useState<Section>('basics');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [activating, setActivating] = useState(false);

  const toggle = (s: Section) => setOpen(prev => (prev === s ? 'basics' : s));

  const patch = async (fields: Partial<MasterBrief>) => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/clients/${clientId}/brief/${briefId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUpdated(json.brief);
      setSaveMsg('Saved ✓');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (err) {
      setSaveMsg(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/brief/${briefId}/activate`, { method: 'POST' });
      if (res.ok) onActivate();
    } finally {
      setActivating(false);
    }
  };

  const isActive = brief.status === 'active';

  return (
    <div className="space-y-1">
      {/* Status bar */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {isActive ? 'Active' : 'Draft'}
          </span>
          <span className="text-xs text-gray-400">v{brief.version}</span>
          {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
        </div>
        <div className="flex gap-2">
          {!isActive && (
            <button
              onClick={handleActivate}
              disabled={activating}
              className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg disabled:opacity-50"
            >
              {activating ? 'Activating…' : '▶ Activate'}
            </button>
          )}
        </div>
      </div>

      {/* Brand Basics */}
      <Accordion label="Brand Basics" section="basics" open={open} toggle={toggle}>
        <Field label="Brand Name">
          <TextInput value={brief.brand_name ?? ''} onSave={v => patch({ brand_name: v })} saving={saving} />
        </Field>
        <Field label="Core Proposition">
          <TextArea value={brief.core_proposition ?? ''} onSave={v => patch({ core_proposition: v })} saving={saving} rows={3} />
        </Field>
      </Accordion>

      {/* Brand Voice */}
      <Accordion label="Brand Voice" section="voice" open={open} toggle={toggle}>
        <JsonField
          label="Voice Settings"
          value={brief.brand_voice}
          onSave={v => patch({ brand_voice: v as BrandVoice })}
          saving={saving}
          hint='tone_keywords, avoid_keywords, formality, emoji_usage'
        />
      </Accordion>

      {/* Target Audience */}
      <Accordion label="Target Audience" section="audience" open={open} toggle={toggle}>
        <JsonField
          label="Audience Profile"
          value={brief.target_audience}
          onSave={v => patch({ target_audience: v as TargetAudience })}
          saving={saving}
          hint='age_range, location, interests, pain_points, platforms'
        />
      </Accordion>

      {/* Content Strategy */}
      <Accordion label="Content Pillars & Platforms" section="content" open={open} toggle={toggle}>
        <JsonField
          label="Content Pillars"
          value={brief.content_pillars}
          onSave={v => patch({ content_pillars: v as ContentPillar[] })}
          saving={saving}
          hint='Array of {id, name, description, post_ratio, content_types}'
        />
        <JsonField
          label="Platform Strategy"
          value={brief.platform_strategy}
          onSave={v => patch({ platform_strategy: v as Record<string, PlatformConfig> })}
          saving={saving}
          hint='{instagram: {enabled, post_frequency, primary_content_type}, …}'
        />
      </Accordion>

      {/* Keywords & Competition */}
      <Accordion label="Keywords & Competitors" section="keywords" open={open} toggle={toggle}>
        <Field label="Keyword Seeds (one per line)">
          <TextArea
            value={(brief.keyword_seeds ?? []).join('\n')}
            onSave={v => patch({ keyword_seeds: v.split('\n').map(s => s.trim()).filter(Boolean) })}
            saving={saving}
            rows={5}
          />
        </Field>
        <Field label="Competitor Domains (one per line)">
          <TextArea
            value={(brief.competitor_domains ?? []).join('\n')}
            onSave={v => patch({ competitor_domains: v.split('\n').map(s => s.trim()).filter(Boolean) })}
            saving={saving}
            rows={4}
          />
        </Field>
      </Accordion>

      {/* Visual Identity */}
      <Accordion label="Visual Identity" section="vi" open={open} toggle={toggle}>
        <JsonField
          label="Brand Colors"
          value={brief.vi_colors}
          onSave={v => patch({ vi_colors: v as VIColors })}
          saving={saving}
          hint='{primary, secondary, accent, background} — hex values'
        />
        <Field label="Style Keywords (one per line)">
          <TextArea
            value={(brief.vi_style_keywords ?? []).join('\n')}
            onSave={v => patch({ vi_style_keywords: v.split('\n').map(s => s.trim()).filter(Boolean) })}
            saving={saving}
            rows={3}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Visual DOs (one per line)">
            <TextArea
              value={(brief.vi_dos ?? []).join('\n')}
              onSave={v => patch({ vi_dos: v.split('\n').map(s => s.trim()).filter(Boolean) })}
              saving={saving}
              rows={4}
            />
          </Field>
          <Field label="Visual DON'Ts (one per line)">
            <TextArea
              value={(brief.vi_donts ?? []).join('\n')}
              onSave={v => patch({ vi_donts: v.split('\n').map(s => s.trim()).filter(Boolean) })}
              saving={saving}
              rows={4}
            />
          </Field>
        </div>
      </Accordion>

      {/* Narratives */}
      <Accordion label="Brand Narratives" section="narratives" open={open} toggle={toggle}>
        <Field label="Brand Story (Markdown)">
          <TextArea value={brief.brand_story_md ?? ''} onSave={v => patch({ brand_story_md: v })} saving={saving} rows={6} mono />
        </Field>
        <Field label="Style Guide (Markdown)">
          <TextArea value={brief.style_guide_md ?? ''} onSave={v => patch({ style_guide_md: v })} saving={saving} rows={6} mono />
        </Field>
        <Field label="Competitive Notes (Markdown)">
          <TextArea value={brief.competitive_notes_md ?? ''} onSave={v => patch({ competitive_notes_md: v })} saving={saving} rows={5} mono />
        </Field>
      </Accordion>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Accordion({ label, section, open, toggle, children }: {
  label: string; section: Section; open: Section; toggle: (s: Section) => void; children: React.ReactNode;
}) {
  const isOpen = open === section;
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => toggle(section)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span>{label}</span>
        <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && <div className="px-4 pb-4 space-y-3 border-t border-gray-50">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pt-3">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value: initial, onSave, saving }: { value: string; onSave: (v: string) => void; saving: boolean }) {
  const [val, setVal] = useState(initial);
  return (
    <div className="flex gap-2">
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <SaveButton onClick={() => onSave(val)} saving={saving} />
    </div>
  );
}

function TextArea({ value: initial, onSave, saving, rows = 4, mono = false }: {
  value: string; onSave: (v: string) => void; saving: boolean; rows?: number; mono?: boolean;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={val}
        onChange={e => setVal(e.target.value)}
        rows={rows}
        className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${mono ? 'font-mono text-xs' : ''}`}
      />
      <div className="flex justify-end">
        <SaveButton onClick={() => onSave(val)} saving={saving} />
      </div>
    </div>
  );
}

function JsonField({ label, value: initial, onSave, saving, hint }: {
  label: string; value: unknown; onSave: (v: unknown) => void; saving: boolean; hint?: string;
}) {
  const [val, setVal] = useState(JSON.stringify(initial ?? {}, null, 2));
  const [parseError, setParseError] = useState('');

  const handleSave = () => {
    try {
      const parsed = JSON.parse(val);
      setParseError('');
      onSave(parsed);
    } catch {
      setParseError('Invalid JSON');
    }
  };

  return (
    <Field label={label}>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      <textarea
        value={val}
        onChange={e => { setVal(e.target.value); setParseError(''); }}
        rows={6}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />
      {parseError && <p className="text-xs text-red-500">{parseError}</p>}
      <div className="flex justify-end mt-1">
        <SaveButton onClick={handleSave} saving={saving} />
      </div>
    </Field>
  );
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="text-xs bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  );
}
