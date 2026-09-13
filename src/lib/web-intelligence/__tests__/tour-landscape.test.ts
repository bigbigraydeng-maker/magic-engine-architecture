import { describe, expect, it } from 'vitest'
import { ensureActionableTourLandscape, tourLandscapePrompt, validateTourLandscape } from '../tour-landscape'

describe('tour landscape summary', () => {
  it('validates bounded summary output', () => {
    const result = validateTourLandscape({ headline: '价格带分层明显', market_summary: '竞品覆盖多个城市和不同天数。', client_opportunities: ['突出短途产品'], client_risks: ['价格带竞争'], recommended_focus: ['补齐日期'], unknowns: ['余位'], confidence: 1.4 })
    expect(result.confidence).toBe(1)
    expect(result.client_opportunities).toEqual(['突出短途产品'])
  })

  it('asks the model for a portfolio view rather than one-to-one matching', () => {
    expect(tourLandscapePrompt({ client_name: 'Example', client_products: [], competitor_products: [] })).toContain('而不是逐团横向配对')
  })

  it('bounds injected client memory so it cannot overwhelm the analysis prompt', () => {
    const prompt = tourLandscapePrompt({ client_name: 'Example', client_products: [], competitor_products: [], memory_context: 'x'.repeat(10000) })
    expect(prompt).not.toContain('x'.repeat(5001))
    expect(prompt).toContain('x'.repeat(5000))
  })

  it('fills missing action sections without replacing a concrete AI market summary', () => {
    const landscape = ensureActionableTourLandscape(validateTourLandscape({
      headline: '中长线产品存在价格重叠',
      market_summary: 'China Uncovered 为21天、NZD 10,480；CTS Signature覆盖17-27天和NZD 7,999-10,899。',
      client_opportunities: [], client_risks: [], recommended_focus: [], unknowns: [], confidence: 0.7,
    }), {
      client_name: 'CTS',
      market_scope: ['china'],
      client_products: [{ name: 'Signature', destination: 'China', route: 'Beijing Shanghai', duration_days: 21, price: 'NZD 10480', departure_window: '2027', includes: 'Flights hotels', positioning: 'premium', audience: 'NZ travellers' }],
      competitor_products: [{ domain: 'wendy.example', source_url: 'https://wendy.example/china', observed_at: '2026-09-12', records: [] }],
    })
    expect(landscape.market_summary).toContain('China Uncovered')
    expect(landscape.client_opportunities.length).toBeGreaterThan(0)
    expect(landscape.client_risks.length).toBeGreaterThan(0)
    expect(landscape.recommended_focus.length).toBeGreaterThan(0)
    expect(landscape.unknowns.length).toBeGreaterThan(0)
  })
})
