"use client";

import { useMemo, useState } from "react";

interface DraftListing {
  id: string;
  name: string;
  address: string;
  description: string;
  images: string[];
  bedrooms: string;
  bathrooms: string;
  price_hint: string;
  trademe_url: string;
}

function emptyDraft(): DraftListing {
  return {
    id: "",
    name: "",
    address: "",
    description: "",
    images: [],
    bedrooms: "",
    bathrooms: "",
    price_hint: "",
    trademe_url: "",
  };
}

export function PropertyListingEditor() {
  const [listings, setListings] = useState<DraftListing[]>([]);
  const [draft, setDraft] = useState<DraftListing>(emptyDraft);
  const [expanded, setExpanded] = useState(false);

  const json = useMemo(() => {
    const payload = listings.map((l, sort_order) => ({
      id: l.id || undefined,
      name: l.name,
      address: l.address,
      description: l.description,
      images: l.images,
      bedrooms: l.bedrooms ? Number(l.bedrooms) : undefined,
      bathrooms: l.bathrooms ? Number(l.bathrooms) : undefined,
      price_hint: l.price_hint || undefined,
      trademe_url: l.trademe_url || undefined,
      sort_order,
    }));
    return JSON.stringify(payload);
  }, [listings]);

  function addListing() {
    if (!draft.name.trim() || !draft.address.trim()) {
      return;
    }
    const images = draft.images
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 12);
    setListings((prev) => [
      ...prev,
      {
        ...draft,
        images,
      },
    ]);
    setDraft(emptyDraft());
    setExpanded(false);
  }

  function removeAt(i: number) {
    if (!confirm("删除该房源？")) {
      return;
    }
    setListings((prev) => prev.filter((_, idx) => idx !== i));
  }

  function move(i: number, dir: -1 | 1) {
    setListings((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const t = next[i];
      next[i] = next[j];
      next[j] = t;
      return next;
    });
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h3 className="font-medium text-stone-900">手动房源</h3>
      <p className="mt-1 text-xs text-stone-500">图片请填写已上传的 HTTPS URL（可与项目页 TradeMe 导入配合）。</p>
      <input type="hidden" name="property_listings_json" value={json} readOnly />

      <ul className="mt-4 space-y-3">
        {listings.map((l, i) => (
          <li key={i} className="flex flex-wrap items-start gap-3 rounded-xl border border-stone-100 bg-stone-50/80 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-stone-900">{l.name}</p>
              <p className="text-stone-600">{l.address}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" className="rounded border border-stone-200 px-2 py-1 text-xs" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="rounded border border-stone-200 px-2 py-1 text-xs" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="rounded border border-red-200 px-2 py-1 text-xs text-red-800" onClick={() => removeAt(i)}>
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-4 text-sm font-medium text-emerald-800 underline"
      >
        {expanded ? "收起表单" : "+ 新增房源"}
      </button>

      {expanded ? (
        <div className="mt-4 space-y-3 rounded-xl border border-dashed border-stone-300 p-4">
          <label className="block text-sm">
            名称 *
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm">
            地址 *
            <input
              value={draft.address}
              onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm">
            介绍
            <textarea
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm">
            图片 URL（每行一个）
            <textarea
              value={draft.images.join("\n")}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  images: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean),
                }))
              }
              rows={3}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs"
              placeholder="https://..."
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              卧室
              <input
                value={draft.bedrooms}
                onChange={(e) => setDraft((d) => ({ ...d, bedrooms: e.target.value }))}
                className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-sm">
              浴室
              <input
                value={draft.bathrooms}
                onChange={(e) => setDraft((d) => ({ ...d, bathrooms: e.target.value }))}
                className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            价格提示
            <input
              value={draft.price_hint}
              onChange={(e) => setDraft((d) => ({ ...d, price_hint: e.target.value }))}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm">
            TradeMe 链接
            <input
              value={draft.trademe_url}
              onChange={(e) => setDraft((d) => ({ ...d, trademe_url: e.target.value }))}
              type="url"
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            />
          </label>
          <button type="button" onClick={addListing} className="rounded-lg bg-emerald-800 px-4 py-2 text-sm text-white">
            加入列表
          </button>
        </div>
      ) : null}
    </div>
  );
}
