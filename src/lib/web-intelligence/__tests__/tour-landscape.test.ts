import { describe, expect, it } from 'vitest'
import { tourLandscapePrompt, validateTourLandscape } from '../tour-landscape'

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
})
