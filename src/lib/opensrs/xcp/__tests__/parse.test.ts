import { describe, expect, it } from 'vitest'
import { buildXcpEnvelope } from '../envelope'
import { parseXcpEnvelope, toXcpReply, unescapeXml } from '../parse'

/** 一个 LOOKUP DOMAIN 的典型回包（结构照 OpenSRS XCP 文档）。 */
const LOOKUP_REPLY = `<?xml version='1.0' encoding='UTF-8' standalone='no' ?>
<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>
<OPS_envelope>
 <header><version>0.9</version></header>
 <body>
  <data_block>
   <dt_assoc>
    <item key="protocol">XCP</item>
    <item key="action">REPLY</item>
    <item key="object">DOMAIN</item>
    <item key="is_success">1</item>
    <item key="response_code">210</item>
    <item key="response_text">Domain available</item>
    <item key="attributes">
     <dt_assoc>
      <item key="status">available</item>
     </dt_assoc>
    </item>
   </dt_assoc>
  </data_block>
 </body>
</OPS_envelope>`

describe('unescapeXml', () => {
  it('还原命名实体', () => {
    expect(unescapeXml('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(`a & b <c> "d" 'e'`)
  })

  it('还原十进制与十六进制数字实体', () => {
    expect(unescapeXml('&#65;&#x42;')).toBe('AB')
  })

  it('不认识的实体原样留着，不吞字符', () => {
    expect(unescapeXml('&nosuch;')).toBe('&nosuch;')
  })
})

describe('parseXcpEnvelope', () => {
  it('解析真实回包的顶层字段', () => {
    const root = parseXcpEnvelope(LOOKUP_REPLY)
    expect(root.protocol).toBe('XCP')
    expect(root.is_success).toBe('1')
    expect(root.response_code).toBe('210')
    expect(root.response_text).toBe('Domain available')
  })

  it('解析嵌套的 attributes', () => {
    const root = parseXcpEnvelope(LOOKUP_REPLY)
    expect(root.attributes).toEqual({ status: 'available' })
  })

  it('忽略 header / version 这些非数据标签', () => {
    expect(parseXcpEnvelope(LOOKUP_REPLY)).not.toHaveProperty('version')
  })

  it('解析 dt_array 并保持顺序', () => {
    const xml = `<OPS_envelope><body><data_block><dt_assoc>
      <item key="tlds"><dt_array>
        <item key="0">.com</item><item key="1">.net</item><item key="2">.nz</item>
      </dt_array></item>
    </dt_assoc></data_block></body></OPS_envelope>`
    expect(parseXcpEnvelope(xml).tlds).toEqual(['.com', '.net', '.nz'])
  })

  it('数组下标乱序时按 key 归位，不按出现次序', () => {
    const xml = `<OPS_envelope><body><data_block><dt_assoc>
      <item key="x"><dt_array>
        <item key="1">second</item><item key="0">first</item>
      </dt_array></item>
    </dt_assoc></data_block></body></OPS_envelope>`
    expect(parseXcpEnvelope(xml).x).toEqual(['first', 'second'])
  })

  it('解析数组里套键值表', () => {
    const xml = `<OPS_envelope><body><data_block><dt_assoc>
      <item key="domains"><dt_array>
        <item key="0"><dt_assoc><item key="name">a.com</item></dt_assoc></item>
        <item key="1"><dt_assoc><item key="name">b.com</item></dt_assoc></item>
      </dt_array></item>
    </dt_assoc></data_block></body></OPS_envelope>`
    expect(parseXcpEnvelope(xml).domains).toEqual([{ name: 'a.com' }, { name: 'b.com' }])
  })

  it('自闭合 item 解析成空串', () => {
    const xml = `<OPS_envelope><body><data_block><dt_assoc>
      <item key="a"/><item key="b">x</item>
    </dt_assoc></data_block></body></OPS_envelope>`
    expect(parseXcpEnvelope(xml)).toEqual({ a: '', b: 'x' })
  })

  it('值里的实体被还原', () => {
    const xml = `<OPS_envelope><body><data_block><dt_assoc>
      <item key="text">Tom &amp; Jerry &lt;3</item>
    </dt_assoc></data_block></body></OPS_envelope>`
    expect(parseXcpEnvelope(xml).text).toBe('Tom & Jerry <3')
  })

  it('不是 XCP 信封就抛错，而不是悄悄返回空表', () => {
    expect(() => parseXcpEnvelope('<html><body>502 Bad Gateway</body></html>')).toThrow(/XCP/i)
  })

  it('build 出去再 parse 回来，结构原样还原', () => {
    const attributes = {
      domain: 'example.co.nz',
      note: 'a & b <c>',
      nested: { deep: 'v', list: ['1', '2'] },
    }
    const parsed = parseXcpEnvelope(buildXcpEnvelope({ action: 'LOOKUP', object: 'DOMAIN', attributes }))
    expect(parsed).toEqual({ protocol: 'XCP', action: 'LOOKUP', object: 'DOMAIN', attributes })
  })
})

describe('toXcpReply', () => {
  it('把 "1" 翻成 true', () => {
    expect(toXcpReply(parseXcpEnvelope(LOOKUP_REPLY)).isSuccess).toBe(true)
  })

  it('把 "0" 翻成 false —— 不是"非空即真"', () => {
    const xml = LOOKUP_REPLY.replace('key="is_success">1<', 'key="is_success">0<')
    expect(toXcpReply(parseXcpEnvelope(xml)).isSuccess).toBe(false)
  })

  it('attributes 缺席时给空表而不是 undefined', () => {
    const xml = `<OPS_envelope><body><data_block><dt_assoc>
      <item key="is_success">1</item>
    </dt_assoc></data_block></body></OPS_envelope>`
    expect(toXcpReply(parseXcpEnvelope(xml)).attributes).toEqual({})
  })

  it('raw 里留着完整回包供兜底', () => {
    expect(toXcpReply(parseXcpEnvelope(LOOKUP_REPLY)).raw.object).toBe('DOMAIN')
  })
})
