import { describe, it, expect } from 'vitest'
import { CreatomateRenderRequestedSchema, CreatomateRenderWebhookReceivedSchema } from './events'

describe('CreatomateRenderRequestedSchema', () => {
  it('接受合法 payload', () => {
    const r = CreatomateRenderRequestedSchema.safeParse({
      job_id: 'c0000000-0000-0000-0000-000000000000',
      client_id: 'c0000000-0000-0000-0000-000000000000',
      post_id: 'c0000000-0000-0000-0000-000000000001',
    })
    expect(r.success).toBe(true)
  })

  it('拒绝缺字段的 payload', () => {
    expect(CreatomateRenderRequestedSchema.safeParse({ job_id: 'x' }).success).toBe(false)
  })
})

describe('CreatomateRenderWebhookReceivedSchema', () => {
  it('只接受 job_id + render_id，不接受夹带 status/url（红线：不给下游误信的机会）', () => {
    const r = CreatomateRenderWebhookReceivedSchema.safeParse({
      job_id: 'c0000000-0000-0000-0000-000000000000',
      render_id: 'r1',
      status: 'succeeded', // 多余字段——zod 默认 strip，不应该出现在解析结果里
      url: 'https://evil.example.com/fake.mp4',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toEqual({ job_id: 'c0000000-0000-0000-0000-000000000000', render_id: 'r1' })
      expect(r.data).not.toHaveProperty('status')
      expect(r.data).not.toHaveProperty('url')
    }
  })
})
