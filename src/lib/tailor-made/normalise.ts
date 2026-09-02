import type { TailorMadeItinerary } from './types';

/**
 * 渲染前把数据补齐成模板认得的形状。
 *
 * 来由（CTS-2026-0025 实际发生）：一份已经发出去的行程单上，
 * 「Costs to allow for」两行只有标题没有金额，「TRAVELLING」那一格整个空白。
 *
 * 两处都不是手滑，是**字段形状对不上**：
 *   - 抽取端写的是 { label, amount, currency, note }，模板取的是 o.value
 *   - client.travellers 存的是 "5"，而 facts 里的 Travelling 是另一个字段，没人填
 *
 * 而模板对缺字段的反应是 `esc(undefined)` → 空字符串 —— **不报错、不留痕**。
 * 一份 8 页的文件，顾问不可能逐格核对，所以这种错会一路走到客户手里。
 *
 * 这里只做「同一个意思、换个形状」的翻译，绝不凭空造内容：
 * 补不出来的就让它空着，由 audit.ts 喊出来给顾问看。
 */

/** "NZD 650 · Per person"；金额缺失就返回空串，让 audit 去报 */
function moneyLine(entry: Record<string, unknown>): string {
  const amount = entry.amount;
  const currency = typeof entry.currency === 'string' && entry.currency ? entry.currency : 'NZD';
  const note = typeof entry.note === 'string' ? entry.note.trim() : '';

  const money =
    typeof amount === 'number' && Number.isFinite(amount)
      ? `${currency} ${amount.toLocaleString('en-NZ')}`
      : '';

  if (money && note) return `${money} · ${note}`;
  return money || note;
}

/** 只有数字时补成 "5 passengers"；已经有单位的原样保留 */
function travellersLabel(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  return /^\d+$/.test(value) ? `${value} passenger${value === '1' ? '' : 's'}` : value;
}

export function normaliseItinerary(input: TailorMadeItinerary): TailorMadeItinerary {
  const it = structuredClone(input);

  // 1) 可选费用：两种字段形状都认
  if (Array.isArray(it.pricing?.optional)) {
    it.pricing.optional = it.pricing.optional.map((line) => {
      const entry = line as unknown as Record<string, unknown>;
      const existing = typeof entry.value === 'string' ? entry.value.trim() : '';
      return { label: String(entry.label ?? ''), value: existing || moneyLine(entry) };
    });
  }

  // 2) Travelling 那一格：facts 里没填就用 client.travellers 补
  const travellers = travellersLabel(it.client?.travellers ?? '');
  if (travellers) {
    if (it.client) it.client.travellers = travellers;
    const fact = it.trip?.facts?.find((f) => f.label.trim().toLowerCase() === 'travelling');
    if (fact && !fact.value.trim()) fact.value = travellers;
  }

  return it;
}
