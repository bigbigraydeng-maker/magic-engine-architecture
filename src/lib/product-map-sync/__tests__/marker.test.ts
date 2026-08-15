/** 标记解析:真实 GitHub body 形状(\r\n)是一等公民,不是边角。 */

import { describe, expect, it } from 'vitest'
import { extractComponentMarkers, isUnclassified } from '../marker'

describe('extractComponentMarkers', () => {
  it("GitHub API 的 \\r\\n body 必须解析得出来(生产 100% 是这个形状)", () => {
    const body = 'Some intro\r\nME2-Component-ID: platform.execution-kernel\r\nmore text\r\n'
    expect(extractComponentMarkers(body)).toEqual(['platform.execution-kernel'])
  })

  it('\\n body 同样解析', () => {
    expect(extractComponentMarkers('x\nME2-Component-ID: module.geo-visibility\n')).toEqual([
      'module.geo-visibility',
    ])
  })

  it('code fence 里的示例标记不算数(教程型 issue 防误挂)', () => {
    const body = '教程:\r\n```\r\nME2-Component-ID: platform.fake-example\r\n```\r\n正文没有标记'
    expect(extractComponentMarkers(body)).toEqual([])
  })

  it('fence 外的标记照常提取,fence 内的跳过', () => {
    const body = 'ME2-Component-ID: adapter.meta\n```md\nME2-Component-ID: adapter.publer\n```\n'
    expect(extractComponentMarkers(body)).toEqual(['adapter.meta'])
  })

  it('格式不合 id 契约的行不提取(不猜)', () => {
    expect(extractComponentMarkers('ME2-Component-ID: NotKebab\n')).toEqual([])
    expect(extractComponentMarkers('见 ME2-Component-ID: platform.x 这样写\n')).toEqual([])
  })

  it('空/null body 返回空', () => {
    expect(extractComponentMarkers(null)).toEqual([])
    expect(extractComponentMarkers('')).toEqual([])
  })
})

describe('isUnclassified(确定性关联,不许模糊匹配)', () => {
  const base = {
    registryComponentIds: new Set(['platform.execution-kernel']),
    linkedPrNumbers: new Set([100]),
    linkedIssueNumbers: new Set([200]),
  }

  it('登记册显式关联的 PR 不算未分类', () => {
    expect(isUnclassified({ ...base, kind: 'pr', number: 100, body: '' })).toBe(false)
  })

  it('带合法标记的算已分类', () => {
    expect(
      isUnclassified({
        ...base,
        kind: 'pr',
        number: 999,
        body: 'ME2-Component-ID: platform.execution-kernel\r\n',
      }),
    ).toBe(false)
  })

  it('标记指向不存在的组件 → 仍是未分类(不自动替它分类)', () => {
    expect(
      isUnclassified({ ...base, kind: 'pr', number: 999, body: 'ME2-Component-ID: platform.ghost\n' }),
    ).toBe(true)
  })

  it('无关联无标记 → 未分类', () => {
    expect(isUnclassified({ ...base, kind: 'issue', number: 999, body: 'random' })).toBe(true)
  })
})
