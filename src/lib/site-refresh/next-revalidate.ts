/**
 * Ask a customer site's Next.js app to blow specific paths out of its
 * Full Route Cache. Calls the /api/revalidate endpoint that lives in
 * the customer's repo (one per site), gated by a Bearer token that must
 * match the site's REVALIDATE_SECRET env var.
 *
 * The secret is per-site, held in the registry (client_site_platforms).
 * It is NEVER read from process.env here — that keeps the ME app free
 * of one-env-per-customer sprawl.
 */

export interface NextRevalidateResult {
  readonly ok: boolean
  readonly revalidated: readonly string[]
  readonly errors: readonly string[]
}

export interface RevalidateParams {
  paths: readonly string[]
  origin: string
  secret: string
  fetcher?: typeof fetch
}

export async function revalidateSitePaths(
  params: RevalidateParams,
): Promise<NextRevalidateResult> {
  const { paths, origin, secret } = params
  const fetcher = params.fetcher ?? fetch

  if (!secret) {
    return {
      ok: false,
      revalidated: [],
      errors: ['revalidate secret missing'],
    }
  }
  if (paths.length === 0) {
    return { ok: true, revalidated: [], errors: [] }
  }

  const revalidated: string[] = []
  const errors: string[] = []

  for (const p of paths) {
    try {
      const res = await fetcher(
        `${origin}/api/revalidate?path=${encodeURIComponent(p)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}` },
        },
      )
      if (!res.ok) {
        errors.push(`HTTP ${res.status} for ${p}`)
        continue
      }
      revalidated.push(p)
    } catch (e) {
      errors.push(`fetch failed for ${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { ok: errors.length === 0, revalidated, errors }
}
