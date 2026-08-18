/**
 * GeoComposerAdapter — in_house FlywheelAdapter for the GEO flywheel.
 *
 * execute() writes a row to flywheel_actions and returns it (unchanged).
 *
 * 🔴 pullMetrics() previously read ai-tracker (system B) `ai_visibility_snapshots`
 * and wrote `flywheel_metrics.geo.query.mention_rate`. ai-tracker is
 * decommissioned (spec 2026-08-19-ai-tracker-decommission-v1.md, 组 K), so this
 * feed is SEVERED: nothing writes `geo.query.mention_rate` anymore. That is the
 * attribution bullseye — every 诸葛亮 AI-visibility action's expected_metric
 * points at that key, so those actions can no longer be attributed until M1
 * re-supplies the feed. This is tracked as an explicit outage + visible alarm,
 * NOT left silent — see ROADMAP P31.X.4 ("GEO 飞轮指标 feed 已断") and
 * docs/specs/2026-08-19-ai-tracker-decommission-v1.md §9.1.
 *
 * Auto-registers itself to the adapter registry on import.
 */

import { supabaseAdmin } from '../../supabase'
import { isValidGeoActionType } from '../vocabulary'
import { registerAdapter } from './registry'
import type {
  ExecuteActionInput,
  FlywheelActionRow,
  FlywheelAdapter,
  FlywheelMetricRow,
} from './types'

export class GeoComposerAdapter implements FlywheelAdapter {
  readonly flywheel = 'geo' as const

  async execute(input: ExecuteActionInput): Promise<FlywheelActionRow> {
    if (input.executionMode !== 'in_house') {
      throw new Error(
        `GeoComposerAdapter only handles in_house actions. ` +
          `Received executionMode="${input.executionMode}".`
      )
    }

    if (!isValidGeoActionType(input.actionType)) {
      throw new Error(
        `Unknown GEO action_type: "${input.actionType}". ` +
          `Valid values are defined in GEO_ACTION_TYPE (vocabulary.ts).`
      )
    }

    const { data, error } = await supabaseAdmin
      .from('flywheel_actions')
      .insert({
        client_id: input.clientId,
        execution_item_id: input.executionItemId ?? null,
        flywheel: 'geo',
        action_type: input.actionType,
        execution_mode: 'in_house',
        vendor: input.vendor ?? null,
        payload: input.payload ?? null,
        expected_metric:        input.expectedMetric        ?? null,
        expected_delta:         input.expectedDelta         ?? null,
        production_package_id:  input.productionPackageId   ?? null,
      })
      .select()
      .single()

    if (error) {
      throw new Error(`GeoComposerAdapter.execute DB error: ${error.message}`)
    }

    return {
      id: data.id,
      clientId: data.client_id,
      executionItemId: data.execution_item_id ?? undefined,
      flywheel: 'geo',
      actionType: data.action_type,
      executionMode: data.execution_mode,
      vendor: data.vendor ?? undefined,
      payload: data.payload ?? undefined,
      expectedMetric:       data.expected_metric          ?? undefined,
      expectedDelta:        data.expected_delta            ?? undefined,
      executedAt:           data.executed_at,
      productionPackageId:  data.production_package_id    ?? undefined,
    }
  }

  /**
   * SEVERED (组 K). The GEO metric feed was sourced from ai-tracker
   * `ai_visibility_snapshots`, now decommissioned. Returns [] — no
   * `geo.query.mention_rate` / `geo.engine.coverage` / `geo.query.avg_rank`
   * rows are written. Re-supplying this feed from M1 (geo_*) is P31.X.4; the
   * outage is registered in ROADMAP + surfaced as a visible alarm rather than
   * being left silent (spec §9.1). `_since` kept for interface compatibility.
   */
  async pullMetrics(_clientId: string, _since?: Date): Promise<FlywheelMetricRow[]> {
    return []
  }
}

registerAdapter(new GeoComposerAdapter())
