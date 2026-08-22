/**
 * Shared identifiers for the weekly "ME product progress → LinkedIn" pipeline.
 *
 * Piggybacks on the existing Magic Lab Class client record rather than a new
 * client/table — that record is already the vehicle for 大瑞's personal-IP
 * content (short video on TikTok/RedNote), and this reuses the same
 * content_posts → Publer publish pipeline, just a different platform + source tag.
 */

export const LINKEDIN_PROGRESS_CLIENT_ID = '377468af-b103-45f0-984a-b353febb56a1'

/** Distinct source tag so this never gets swept into the "系列课" course lane. */
export const LINKEDIN_PROGRESS_SOURCE = 'ME产品动态·LinkedIn'

export const LINKEDIN_PROGRESS_PLATFORM = 'linkedin'

// Two distinct job names (not one shared one) — each render.yaml cron service
// must be independently trackable in cron_run_logs, otherwise the Monday and
// Thursday services can go dark independently while looking healthy (whichever
// one is still linked to the shared cron-secret env group keeps writing runs
// under the shared name, masking the other one's silent 401s).
export const CRON_JOB_NAME_MON = 'linkedin-progress-post-mon'
export const CRON_JOB_NAME_THU = 'linkedin-progress-post-thu'
