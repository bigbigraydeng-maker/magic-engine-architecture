/**
 * 控制台 smoke:渲染不炸 + 三条「必须让 PM 看见」的信息真的出现在屏幕上。
 * 不做 E2E,只锁「presenter 说了但组件忘了渲染」这一类漏。
 */

import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

// vitest 配置未开 automatic JSX runtime —— 显式挂到全局(与仓库其它组件测试同法)
;(globalThis as unknown as { React: typeof React }).React = React
import { buildProductMapSnapshot, MANUAL_FACTS_SNAPSHOT } from '@/lib/product-map'
import { buildPresentation } from '@/lib/product-map/presenter'
import type { LoadOutcome, PresenterInput } from '@/lib/product-map/presenter'
import ProductMapClient from '../ProductMapClient'

function present(overrides: Partial<PresenterInput> = {}) {
  return buildPresentation({
    snapshot: buildProductMapSnapshot(MANUAL_FACTS_SNAPSHOT),
    loadOutcome: 'ok' as LoadOutcome,
    latestRun: null,
    lastFullRunAt: null,
    prFacts: [],
    issueFacts: [],
    unclassified: [],
    oldestObservedAt: null,
    now: new Date('2026-08-15T12:00:00Z'),
    ...overrides,
  })
}

describe('ProductMapClient', () => {
  it('渲染不炸,标题与「不含客户业绩」声明在', () => {
    render(<ProductMapClient data={present()} />)
    expect(screen.getByText('ME2 产品地图')).toBeDefined()
    expect(screen.getByText(/不含客户业绩数据/)).toBeDefined()
  }, 30_000)

  it('默认落在「等你拍板」,且决策文案上屏', () => {
    render(<ProductMapClient data={present()} />)
    expect(screen.getByText(/现在就等你一句话/)).toBeDefined()
    expect(screen.getByText(/条件到了会来找你/)).toBeDefined()
  }, 30_000)

  it('未 provision 时横幅明说「同步还没开通」,不显示成一切正常', () => {
    render(<ProductMapClient data={present({ loadOutcome: 'not_provisioned' })} />)
    expect(screen.getByText(/同步还没开通/)).toBeDefined()
  }, 30_000)

  it('同步没覆盖到的 PR 会在横幅上露头(进度可能被低估)', () => {
    const data = present({
      prFacts: [{ number: 863, state: 'merged', isDraft: false, unresolvedThreads: 0, title: 'x' }],
    })
    render(<ProductMapClient data={data} />)
    expect(screen.getByText(/进度可能被低估/)).toBeDefined()
  }, 30_000)
})
