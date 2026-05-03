export interface TradeMeListingData {
  title: string;
  description: string;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price_hint: string | null;
  images: string[];
  agent_name: string | null;
  agent_company: string | null;
  /** 中介电话（若页面上有） */
  agent_phone: string | null;
  /** 中介头像图（https，多为站内小头像 URL） */
  agent_photo_url: string | null;
}

function coerceString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function coerceNullableString(v: unknown): string | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function coerceNullablePositiveInt(v: unknown): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  return null;
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim().length > 0) {
      out.push(item.trim());
    }
  }
  return out;
}

/**
 * 将 LLM / JSON 根对象校验并规范为 TradeMeListingData；缺失字段使用安全默认值。
 */
export function parseTradeMeListingData(raw: unknown): TradeMeListingData {
  if (!raw || typeof raw !== "object") {
    return {
      title: "",
      description: "",
      address: null,
      bedrooms: null,
      bathrooms: null,
      price_hint: null,
      images: [],
      agent_name: null,
      agent_company: null,
      agent_phone: null,
      agent_photo_url: null,
    };
  }

  const o = raw as Record<string, unknown>;

  return {
    title: coerceString(o.title, ""),
    description: coerceString(o.description, ""),
    address: coerceNullableString(o.address),
    bedrooms: coerceNullablePositiveInt(o.bedrooms),
    bathrooms: coerceNullablePositiveInt(o.bathrooms),
    price_hint: coerceNullableString(o.price_hint),
    images: coerceStringArray(o.images),
    agent_name: coerceNullableString(o.agent_name),
    agent_company: coerceNullableString(o.agent_company),
    agent_phone: coerceNullableString(o.agent_phone),
    agent_photo_url: coerceNullableString(o.agent_photo_url),
  };
}
