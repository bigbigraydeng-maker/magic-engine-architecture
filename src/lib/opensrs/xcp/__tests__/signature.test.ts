import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { signXcpPayload } from '../signature'

const FAKE_KEY = 'FAKE_TEST_KEY_NOT_A_SECRET'
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')

describe('signXcpPayload', () => {
  it('是 MD5(MD5(xml + key) + key) —— 顺序错了对方就验签失败', () => {
    const xml = '<OPS_envelope>test</OPS_envelope>'
    expect(signXcpPayload(xml, FAKE_KEY)).toBe(md5(md5(xml + FAKE_KEY) + FAKE_KEY))
  })

  it('回归锚点：实现被改动时这条先红', () => {
    // ⚠️ 这个值锁的是"实现没被意外改坏"，**不能**证明协议对——
    // 协议是否被 OpenSRS 接受，只有拿真账号打一次 horizon 才知道。
    expect(signXcpPayload('<OPS_envelope>test</OPS_envelope>', FAKE_KEY)).toBe(
      '0c126c9352349d38c444a57cceff4fff',
    )
  })

  it('正文差一个字节，签名就完全不同', () => {
    const a = signXcpPayload('<OPS_envelope>a</OPS_envelope>', FAKE_KEY)
    const b = signXcpPayload('<OPS_envelope>a </OPS_envelope>', FAKE_KEY)
    expect(a).not.toBe(b)
  })

  it('换 key 就换签名', () => {
    const xml = '<OPS_envelope>test</OPS_envelope>'
    expect(signXcpPayload(xml, FAKE_KEY)).not.toBe(signXcpPayload(xml, `${FAKE_KEY}2`))
  })

  it('UTF-8 多字节正文按字节而不是按字符哈希', () => {
    const xml = '<OPS_envelope>中文</OPS_envelope>'
    expect(signXcpPayload(xml, FAKE_KEY)).toBe(md5(md5(xml + FAKE_KEY) + FAKE_KEY))
  })

  it('缺 key 直接抛，而不是算出一个注定被拒的签名', () => {
    expect(() => signXcpPayload('<x/>', '')).toThrow(/API key/i)
  })
})
