/**
 * Purge specific URLs from Cloudflare's edge cache for one customer site.
 *
 * Zone id + origin come from the registry (client_site_platforms). The
 * ambient Cloudflare token is CLOUDFLARE_MGMT_TOKEN — that one is shared
 * across every customer site ME manages, so it stays as an env var.
 *
 * Cloudflare accepts up to 30 URLs per request; we chunk by 25.
 */

export interface CloudflarePurgeResult {
  readonly ok: boolean
  readonly purged: readonly string[]
  readonly errors: readonly string[]
}

const CHUNK = 25

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface CloudflarePurgeParams {
  paths: readonly string[]
  origin: string
  zoneId: string
  token?: string
  fetcher?: typeof fetch
}

export async function purgeCloudflarePaths(
  params: CloudflarePurgeParams,
): Promise<CloudflarePurgeResult> {
  const { paths, origin, zoneId } = params
  const token = params.token ?? process.env.CLOUDFLARE_MGMT_TOKEN
  const fetcher = params.fetcher ?? fetch

  if (!token) {
    return {
      ok: false,
      purged: [],
      errors: ['CLOUDFLARE_MGMT_TOKEN missing'],
    }
  }
  if (!zoneId) {
    return { ok: false, purged: [], errors: ['zoneId missing'] }
  }
  if (paths.length === 0) {
    return { ok: true, purged: [], errors: [] }
  }

  const urls = paths.map((p) => `${origin}${p.startsWith('/') ? '' : '/'}${p}`)
  const errors: string[] = []
  const purged: string[] = []

  for (const group of chunk(urls, CHUNK)) {
    try {
      const res = await fetcher(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: group }),
        },
      )
      if (!res.ok) {
        errors.push(`HTTP ${res.status} for chunk of ${group.length}`)
        continue
      }
      const body = (await res.json().catch(() => null)) as {
        success?: boolean
        errors?: unknown
      } | null
      if (body?.success === true) {
        purged.push(...group)
      } else {
        errors.push(`CF API returned success=false: ${JSON.stringify(body?.errors ?? body)}`)
      }
    } catch (e) {
      errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { ok: errors.length === 0, purged, errors }
}
