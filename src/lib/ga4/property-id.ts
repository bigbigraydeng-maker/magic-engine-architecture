/**
 * Canonical GA4 property ID handling — single source of truth for the
 * bare-digits vs `properties/…` resource-name split.
 *
 * Root cause this fixes (2026-08-18, #1052 GA4 connector diagnosis): the
 * codebase had two independent, inconsistent ideas of what a "property ID"
 * looks like — `setGa4Property()` demanded a `properties/…`-prefixed string
 * while the historical connectors for CTS/Oztop store bare digits
 * (`"532503727"`), written through the generic `/connectors/[anchor]/connect`
 * endpoint back before this picker flow existed. `fetchGa4Snapshot` already
 * tolerated both — only the write path didn't. Storage is now standardised
 * on bare digits (matches the existing historical rows, needs no migration);
 * `toGa4ResourceName()` is the one place that assembles the `properties/…`
 * form for outgoing Google API calls.
 */

export type Ga4PropertyIdResult =
  | { ok: true; propertyId: string }
  | { ok: false }

/** Accepts `"550203806"` or `"properties/550203806"` → canonical bare digits. */
export function normalizeGa4PropertyId(input: string): Ga4PropertyIdResult {
  const trimmed = input.trim()
  const bare = trimmed.startsWith('properties/') ? trimmed.slice('properties/'.length) : trimmed
  if (!/^\d+$/.test(bare)) return { ok: false }
  return { ok: true, propertyId: bare }
}

/** Bare digits → the `properties/…` resource name Google's APIs expect. */
export function toGa4ResourceName(propertyId: string): string {
  return propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`
}
