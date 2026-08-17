/**
 * 控制台 smoke:渲染不炸 + 三条「必须让 PM 看见」的信息真的出现在屏幕上。
 * 不做 E2E,只锁「presenter 说了但组件忘了渲染」这一类漏。
 */

import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

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
    progressSnapshots: [],
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
      prFacts: [{ number: 863, state: 'merged', isDraft: false, unresolvedThreads: 0, title: 'x', humanSummary: null, observedAt: '2026-08-15T09:00:00Z' }],
    })
    render(<ProductMapClient data={data} />)
    expect(screen.getByText(/进度可能被低估/)).toBeDefined()
  }, 30_000)

  it('切到「谁垫着谁」:导览强调不是时间表 + 孤立件单列', () => {
    render(<ProductMapClient data={present()} />)
    fireEvent.click(screen.getByText('谁垫着谁'))
    expect(screen.getByText(/谁垫在谁下面/)).toBeDefined()
    expect(screen.getByText(/这些暂时没登记依赖关系/)).toBeDefined()
  }, 30_000)

  it('切到「查一件事」:同步没开通说「要等同步」,不是查无结果', () => {
    render(<ProductMapClient data={present()} />)
    fireEvent.click(screen.getByText('查一件事'))
    expect(screen.getByText(/检索要等同步开通/)).toBeDefined()
  }, 30_000)

  it('切到「查一件事」:有同步时 PR 标题 + 业务人话名上屏,且不漏 id', () => {
    const data = present({
      prFacts: [{ number: 863, state: 'merged', isDraft: false, unresolvedThreads: 0, title: '内核 PR 真标题', humanSummary: null, observedAt: '2026-08-15T09:00:00Z' }],
    })
    const { container } = render(<ProductMapClient data={data} />)
    fireEvent.click(screen.getByText('查一件事'))
    expect(screen.getByText('内核 PR 真标题')).toBeDefined()
    expect(container.textContent).toContain('执行内核') // 业务人话名
    expect(container.textContent).not.toContain('platform.execution-kernel') // 内部 id 绝不上屏
  }, 30_000)

  it('顶部摘要条:拆分数字 + 分母不暗示固定目标(板桥二轮设计审必改 3)', () => {
    const { container } = render(<ProductMapClient data={present()} />)
    expect(container.textContent).toContain('个真在生产里跑')
    expect(container.textContent).toContain('个建好了但还没接上线')
    expect(container.textContent).toContain('不是固定目标')
    expect(container.textContent).toContain('不是功能完整度')
  }, 30_000)

  it('查一件事:摘要视觉降权,原标题依然可见(板桥二轮设计审必改 2)', () => {
    const data = present({
      prFacts: [
        {
          number: 863,
          state: 'merged',
          isDraft: false,
          unresolvedThreads: 0,
          title: '技术黑话标题',
          humanSummary: '给登录页加了个记住密码的选项',
          observedAt: '2026-08-15T09:00:00Z',
        },
      ],
    })
    render(<ProductMapClient data={data} />)
    fireEvent.click(screen.getByText('查一件事'))
    expect(screen.getByText('给登录页加了个记住密码的选项')).toBeDefined()
    expect(screen.getByText(/AI 翻的,可能有出入/)).toBeDefined()
    expect(screen.getByText(/原标题:技术黑话标题/)).toBeDefined()
  }, 30_000)

  it('最近进展:不足 3 天数据时显式说明,不画假趋势线(板桥二轮设计审)', () => {
    render(<ProductMapClient data={present()} />)
    fireEvent.click(screen.getByText('最近进展'))
    expect(screen.getByText(/至少攒够 3 天才会画线/)).toBeDefined()
  }, 30_000)

  it('最近进展:合并与关闭用不同措辞,关闭不写「完成」(板桥二轮设计审必改 6)', () => {
    const data = present({
      prFacts: [
        {
          number: 863,
          state: 'merged',
          isDraft: false,
          unresolvedThreads: 0,
          title: 'x',
          humanSummary: null,
          observedAt: '2026-08-15T09:00:00Z',
        },
      ],
      issueFacts: [{ number: 859, state: 'closed', title: 'y', humanSummary: null, observedAt: '2026-08-15T09:00:00Z' }],
    })
    render(<ProductMapClient data={data} />)
    fireEvent.click(screen.getByText('最近进展'))
    expect(screen.getByText('合并了')).toBeDefined()
    expect(screen.getByText(/关掉了/)).toBeDefined()
    expect(screen.getByText(/不一定是做完/)).toBeDefined()
  }, 30_000)

  it('接下来要做什么:明说不是日历,且按依赖顺序排列(PM 二轮反馈)', () => {
    const { container } = render(<ProductMapClient data={present()} />)
    fireEvent.click(screen.getByText('接下来要做什么'))
    expect(screen.getByText(/系统里没有真实排期数据/)).toBeDefined()
    const text = container.textContent ?? ''
    // 执行内核是地基,必须排在依赖它的"动作名字对表"前面
    expect(text.indexOf('执行内核')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('执行内核')).toBeLessThan(text.indexOf('动作名字对表'))
  }, 30_000)

  it('接下来要做什么:等你拍板的项带明显标记(注意 tab 按钮自己也叫这个名字,必须 >1 次才算真有徽章)', () => {
    render(<ProductMapClient data={present()} />)
    fireEvent.click(screen.getByText('接下来要做什么'))
    expect(screen.getAllByText('等你拍板').length).toBeGreaterThan(1)
  }, 30_000)
})
