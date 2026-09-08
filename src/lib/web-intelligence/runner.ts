import { createHash } from 'node:crypto'
import { startWebsiteCapture, getWebsiteCapture } from '@/lib/apify/website'
import { abortRun } from '@/lib/apify/client'
import { supabaseAdmin as db } from '@/lib/supabase'
import { allowedClient, type CaptureRequest, type Run } from './contracts'
import { assertEligibleTarget, validatePublicTarget } from './targets'
import { claim, readRun, updateRun, reserve, settle, loadInterpretationInput, updateSignal } from './store'
import { interpretChange, validateInterpretation, interpretationPrompt, MODEL_SONNET, PROMPT_VERSION } from './interpret'

export async function authorize(req: CaptureRequest): Promise<Run> {
  if (!allowedClient(req.client_id)) throw new Error('client_not_in_rollout')
  await assertEligibleTarget(req.client_id, req.domain, req.url)
  await validatePublicTarget(req.url)
  return reserve(req)
}
export async function startCapture(run: Run): Promise<string | null> {
  const current = await readRun(run.id, run.client_id)
  if (current.provider_run_id) return current.provider_run_id
  if (!allowedClient(run.client_id)) throw new Error('client_not_in_rollout')
  await assertEligibleTarget(run.client_id, run.domain, run.url)
  const permission = await claimPaid(run, 'capture_claimed')
  if (permission === 'disabled') return null
  if (permission === 'unknown') {
    await updateRun(run.id, run.client_id, { status: 'reconciliation', error_code: 'capture_start_unknown' })
    return null
  }
  try {
    const started = await startWebsiteCapture({ url: run.url, build: run.actor_build, maxChargeUsd: run.capture_limit_usd })
    if (!started.id) throw new Error('provider_receipt_missing')
    await updateRun(run.id, run.client_id, { provider_run_id: started.id, provider_dataset_id: started.defaultDatasetId, provider_status: started.status })
    return started.id
  } catch {
    await updateRun(run.id, run.client_id, { status: 'reconciliation', error_code: 'capture_start_unknown' })
    return null
  }
}
export function normaliseContent(text: string): string {
  return text.replace(/\r\n/g, '\n').split('\n').map(line => line.trim().replace(/[\t ]+/g, ' ')).filter(Boolean).join('\n')
}
function knownCost(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
export async function collectCapture(run: Run, providerId: string): Promise<'pending' | 'captured' | 'failed'> {
  const capture = await getWebsiteCapture(providerId, run.url)
  await updateRun(run.id, run.client_id, { provider_status: capture.run.status, provider_dataset_id: capture.run.defaultDatasetId })
  if (capture.status === 'pending') return 'pending'
  await updateRun(run.id, run.client_id, { capture_cost_usd: knownCost(capture.run.usageTotalUsd) })
  if (capture.status !== 'complete' || !capture.page) {
    await updateRun(run.id, run.client_id, { status: 'failed', interpretation_cost_usd: 0, error_code: 'capture_invalid' })
    await settle(run.id, run.client_id)
    return 'failed'
  }
  const content = normaliseContent(capture.page.text)
  if (content.length < 100 || content.length > 200000) throw new Error('capture_content_limit')
  const saved = await db.rpc('web_intelligence_record_snapshot', { p_id: run.id, p_client_id: run.client_id, p_url: capture.page.url, p_title: capture.page.title, p_content: content, p_hash: createHash('sha256').update(content).digest('hex') })
  if (saved.error) throw new Error('snapshot_write_failed')
  return 'captured'
}
export async function stopUnfinishedCapture(run: Run, providerId: string): Promise<void> {
  await abortRun(providerId)
  await updateRun(run.id, run.client_id, { status: 'reconciliation', error_code: 'capture_deadline_pending_cost' })
}
export async function understand(run: Run): Promise<void> {
  const input = await loadInterpretationInput(run)
  if (!input.signal) {
    await updateRun(run.id, run.client_id, { interpretation_cost_usd: 0 })
    return
  }
  if (input.signal.interpretation_status === 'complete') return
  // Validate bounded input before claiming a paid attempt.
  interpretationPrompt(input.signal, input.evidence, input.context)
  const permission = await claimPaid(run, 'interpretation_claimed')
  if (permission === 'disabled') return
  if (permission === 'unknown') {
    await updateRun(run.id, run.client_id, { status: 'reconciliation', error_code: 'interpretation_attempt_unknown' })
    return
  }
  await invokeInterpretation(run, input)
}
async function invokeInterpretation(run: Run, input: Awaited<ReturnType<typeof loadInterpretationInput>>): Promise<void> {
  const signal = input.signal!
  let failureCode = 'interpretation_failed'
  try {
    const result = await interpretChange(signal, input.evidence, input.context)
    await updateRun(run.id, run.client_id, { interpretation_cost_usd: knownCost(result.cost_usd) })
    failureCode = 'interpretation_truncated'
    if (result.stop_reason === 'max_tokens') throw new Error(failureCode)
    failureCode = 'interpretation_invalid_result'
    const interpretation = validateInterpretation(result.text, signal)
    failureCode = 'interpretation_persist_failed'
    await updateSignal(signal.id, run.client_id, { interpretation_status: 'complete', classification: interpretation.classification, interpretation: { ...interpretation, input_tokens: result.input_tokens, output_tokens: result.output_tokens }, recommended_action: interpretation.recommended_action, model: MODEL_SONNET, prompt_version: PROMPT_VERSION })
  } catch {
    await updateSignal(signal.id, run.client_id, { interpretation_status: 'failed' })
    await updateRun(run.id, run.client_id, { status: 'failed', error_code: failureCode })
  }
}
async function claimPaid(run: Run, stage: 'capture_claimed' | 'interpretation_claimed'): Promise<'claimed' | 'unknown' | 'disabled'> {
  try {
    if (!await claim(run.id, run.client_id, stage)) return 'unknown'
    // Only this newly claimed attempt is known to have made no provider call yet.
    if (!allowedClient(run.client_id)) throw new Error('execution_disabled')
    return 'claimed'
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'execution_disabled') throw error
    await updateRun(run.id, run.client_id, {
      status: 'failed', error_code: 'execution_disabled', interpretation_cost_usd: 0,
      ...(stage === 'capture_claimed' ? { capture_cost_usd: 0 } : {}),
    })
    await settle(run.id, run.client_id)
    return 'disabled'
  }
}
export { settle }
