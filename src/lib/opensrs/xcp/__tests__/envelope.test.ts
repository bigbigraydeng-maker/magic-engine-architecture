import { describe, expect, it } from 'vitest'
import { buildXcpEnvelope, escapeXml } from '../envelope'

describe('escapeXml', () => {
  it('转义 XML 的五个特殊字符', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })

  it('先转 & 再转其他，不产生双重转义', () => {
    expect(escapeXml('&lt;')).toBe('&amp;lt;')
  })
})

describe('buildXcpEnvelope', () => {
  it('顶层带上 protocol / action / object', () => {
    const xml = buildXcpEnvelope({ action: 'LOOKUP', object: 'DOMAIN' })
    expect(xml).toContain('<item key="protocol">XCP</item>')
    expect(xml).toContain('<item key="action">LOOKUP</item>')
    expect(xml).toContain('<item key="object">DOMAIN</item>')
  })

  it('带 DOCTYPE 和 version 头', () => {
    const xml = buildXcpEnvelope({ action: 'LOOKUP', object: 'DOMAIN' })
    expect(xml).toContain(`<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>`)
    expect(xml).toContain('<header><version>0.9</version></header>')
  })

  it('attributes 渲染成嵌套 dt_assoc', () => {
    const xml = buildXcpEnvelope({
      action: 'LOOKUP',
      object: 'DOMAIN',
      attributes: { domain: 'example.co.nz' },
    })
    expect(xml).toContain(
      '<item key="attributes"><dt_assoc><item key="domain">example.co.nz</item></dt_assoc></item>',
    )
  })

  it('数组渲染成 dt_array，下标当 key', () => {
    const xml = buildXcpEnvelope({
      action: 'NAME_SUGGEST',
      object: 'DOMAIN',
      attributes: { tlds: ['.com', '.nz'] },
    })
    expect(xml).toContain(
      '<dt_array><item key="0">.com</item><item key="1">.nz</item></dt_array>',
    )
  })

  it('值里的特殊字符被转义', () => {
    const xml = buildXcpEnvelope({
      action: 'LOOKUP',
      object: 'DOMAIN',
      attributes: { note: 'a & b <c>' },
    })
    expect(xml).toContain('<item key="note">a &amp; b &lt;c&gt;</item>')
  })

  it('extra 落在顶层而不是 attributes 里', () => {
    const xml = buildXcpEnvelope({
      action: 'LOOKUP',
      object: 'DOMAIN',
      attributes: { domain: 'example.com' },
      extra: { registrant_ip: '203.0.113.7' },
    })
    // 只看 attributes 块**之前**那一段：extra 必须出现在这里，才叫"在顶层"。
    const beforeAttributes = xml.slice(
      xml.indexOf('<data_block>'),
      xml.indexOf('<item key="attributes"'),
    )
    expect(beforeAttributes).toContain('<item key="registrant_ip">203.0.113.7</item>')
  })

  it('同样的入参永远产出同样的字节 —— 否则签名会间歇性对不上', () => {
    const make = () =>
      buildXcpEnvelope({
        action: 'LOOKUP',
        object: 'DOMAIN',
        attributes: { domain: 'example.com', nested: { a: '1', b: ['x', 'y'] } },
      })
    expect(make()).toBe(make())
  })

  it('没有 attributes 时不渲染空的 attributes 块', () => {
    expect(buildXcpEnvelope({ action: 'GET_BALANCE', object: 'BALANCE' })).not.toContain(
      'key="attributes"',
    )
  })
})
