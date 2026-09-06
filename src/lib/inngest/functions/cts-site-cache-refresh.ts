/**
 * Customer site cache-refresh & verify (fired by /api/webhooks/chinatravel-push
 * and — as new customer sites come online — sibling webhook receivers).
 *
 * Configuration comes from the client_site_platforms Supabase table
 * plus a per-repo URL inventory in @/lib/site-refresh/paths. There are
 * NO customer-specific environment variables in the ME app: adding a
 * new customer site is an INSERT plus wiring their inventory.
 *
 * Flow:
 *   1. Look up the platform record for the repo that fired the push.
 *   2. Wait ~3 min for the site's Render (or equivalent) build to finish.
 *   3. POST /api/revalidate on the site for each affected path.
 *   4. Purge the same paths in Cloudflare (per-site zone_id).
 *   5. Fetch each path once with a cache-buster; smoke-check response.
 *   6. Emit outcome event.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { planSiteRefresh, pathsFromPlan, getInventoryForRepo } from '@/lib/site-refresh/paths'
import { revalidateSitePaths } from '@/lib/site-refresh/next-revalidate'
import { purgeCloudflarePaths } from '@/lib/site-refresh/cf-purge'
import { verifyCtsPaths } from '@/lib/site-refresh/verify'
import { getSitePlatformByRepo } from '@/lib/site-refresh/registry'

export const CTS_SITE_DATA_UPDATED_EVENT = 'cts_site.data.updated'
export const CTS_SITE_DEPLOY_VERIFIED_EVENT = 'cts_site.deploy.verified'
export const CTS_SITE_DEPLOY_FAILED_EVENT = 'cts_site.deploy.failed'

export interface CtsSiteDataUpdatedPayload {
  commit_sha: string
  ref: string
  github_repo: string
  changed_files: string[]
  triggered_at_ms: number
}

export const ctsSiteCacheRefresh = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}cts-site-cache-refresh`,
    name: 'Customer site: refresh Next.js + Cloudflare cache, verify',
    retries: 2,
  },
  { event: CTS_SITE_DATA_UPDATED_EVENT },
  async ({ event, step }) => {
    const data = event.data as Partial<CtsSiteDataUpdatedPayload>
    const changedFiles = Array.isArray(data.changed_files) ? data.changed_files : []
    const commitSha = typeof data.commit_sha === 'string' ? data.commit_sha : ''
    const githubRepo = typeof data.github_repo === 'string' ? data.github_repo : ''

    if (!githubRepo) {
      return { ok: false, skipped: 'missing_github_repo', commit_sha: commitSha }
    }

    const plan = planSiteRefresh(changedFiles)
    if (!plan.hasSiteChange) {
      return {
        ok: true,
        skipped: 'no_site_change',
        commit_sha: commitSha,
        reasons: plan.reasons,
      }
    }

    const inventory = getInventoryForRepo(githubRepo)
    if (!inventory) {
      return {
        ok: false,
        skipped: 'no_inventory_for_repo',
        commit_sha: commitSha,
        github_repo: githubRepo,
      }
    }

    // Config is data, not env — read the site's platform row.
    const platform = await step.run('load-platform-config', async () =>
      getSitePlatformByRepo(githubRepo),
    )
    if (!platform) {
      return {
        ok: false,
        skipped: 'no_platform_row_for_repo',
        commit_sha: commitSha,
        github_repo: githubRepo,
      }
    }

    const paths = pathsFromPlan(plan, inventory)

    await step.sleep('wait-for-render-build', '3m')

    const revalidate = await step.run('revalidate-nextjs', async () =>
      revalidateSitePaths({
        paths,
        origin: platform.origin_url,
        secret: platform.revalidate_secret,
      }),
    )

    const purge = await step.run('purge-cloudflare', async () =>
      purgeCloudflarePaths({
        paths,
        origin: platform.origin_url,
        zoneId: platform.cloudflare_zone_id,
      }),
    )

    await step.sleep('post-purge-settle', '20s')

    const verify = await step.run('verify-paths', async () =>
      verifyCtsPaths(paths, { origin: platform.origin_url }),
    )

    const ok = revalidate.ok && purge.ok && verify.ok
    await step.sendEvent('emit-outcome', {
      name: ok ? CTS_SITE_DEPLOY_VERIFIED_EVENT : CTS_SITE_DEPLOY_FAILED_EVENT,
      data: {
        commit_sha: commitSha,
        github_repo: githubRepo,
        client_id: platform.client_id,
        paths,
        revalidate,
        purge,
        verify,
        plan_reasons: plan.reasons,
        triggered_at_ms: data.triggered_at_ms ?? null,
      },
    })

    return {
      ok,
      commit_sha: commitSha,
      github_repo: githubRepo,
      client_id: platform.client_id,
      paths,
      revalidate_ok: revalidate.ok,
      purge_ok: purge.ok,
      verify_ok: verify.ok,
    }
  },
)
