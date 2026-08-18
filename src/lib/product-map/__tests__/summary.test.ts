/**
 * 老板摘要（按业务线收成一行卡片）的测试。
 *
 * 覆盖两轮设计复审挑出的具体缺口：
 * - 子牙：operating 但同时有组件被卡住的组合，文案不能自相矛盾
 * - 魏征：老系统在跑但新体系没接完时，不能被读成「这条线没在干活」；
 *   needsYourCall 不能只靠 roadmap（会漏掉没有 nextMilestone 的决策）；
 *   小样本线不能显得跟大样本线一样有把握
 */
import { describe, it, expect } from 'vitest'
import { buildLaneSummaries, type LaneComponentInput, type LaneSummaryInput } from '../summary'

function component(over: Partial<LaneComponentInput> & { name: string }): LaneComponentInput {
  return { bucket: 'operating', isBlocked: false, isLegacy: false, ...over }
}

function input(over: Partial<LaneSummaryInput>): LaneSummaryInput {
  return { lanes: [], roadmap: [], decisionsNow: [], ...over }
}

describe('buildLaneSummaries — 状态灯判定', () => {
  it('全部 operating → 绿灯，文案说「全部在跑」', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'AI 可见度', components: [component({ name: 'a' }), component({ name: 'b' })] }],
    }))
    expect(s.statusTone).toBe('operating')
    expect(s.statusLabel).toBe('全部在跑')
    expect(s.operatingCount).toBe(2)
    expect(s.totalCount).toBe(2)
  })

  it('部分 operating、部分还在建 → 仍是绿灯，但文案说清楚还有没上线的', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'SEO',
        components: [component({ name: 'a' }), component({ name: 'b', bucket: 'building' })],
      }],
    }))
    expect(s.statusTone).toBe('operating')
    expect(s.statusLabel).toBe('有在跑的，其余还在建')
    expect(s.operatingCount).toBe(1)
    expect(s.totalCount).toBe(2)
  })

  it('零 operating、有 built_not_live → 黄灯', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: '广告',
        components: [component({ name: 'a', bucket: 'built_not_live' }), component({ name: 'b', bucket: 'building' })],
      }],
    }))
    expect(s.statusTone).toBe('built_not_live')
  })

  it('全部还在建 → 灰灯', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: '社媒', components: [component({ name: 'a', bucket: 'building' })] }],
    }))
    expect(s.statusTone).toBe('building')
  })

  it('🔴 子牙必改项：bucket 是 operating 的组件同时 isBlocked=true（上游卡住继承下来的）→ 红灯优先，但 operatingCount 如实保留，不能让人以为「卡住」等于「全部没在跑」', () => {
    // presenter.ts 里 bucket 和 isBlocked 是两条正交轴（子牙复审指出）：
    // 一个组件可以「运营状态是在跑的」同时「因为上游没做完而被标记卡住」。
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'AI 可见度',
        components: [
          component({ name: 'a' }),
          component({ name: 'b' }),
          component({ name: 'c' }),
          component({ name: 'd' }),
          component({ name: 'e', isBlocked: true }), // 依然是 bucket:'operating'，但被上游卡住
        ],
      }],
    }))
    expect(s.statusTone).toBe('blocked')
    // decisionsNow 是空的 —— 这是技术卡点，不是等 PM 拍板（见下面 Codex 复审那一组）
    expect(s.statusLabel).toBe('卡住了，我们在处理')
    // 卡住不代表没在跑 —— 5 个组件全部 bucket='operating'（含那个被卡住的），
    // 分数和卡住数分开存，UI 层各自展示，不挤成一句话自相矛盾
    expect(s.operatingCount).toBe(5)
    expect(s.totalCount).toBe(5)
    expect(s.blockedCount).toBe(1)
  })
})

describe('buildLaneSummaries — 「其余那些」按实际 bucket 说（Codex 复审 P2）', () => {
  it('剩余全是「建好了但没通电」→ 不能降级说成「还在建」', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'SEO',
        components: [component({ name: 'a' }), component({ name: 'b', bucket: 'built_not_live' })],
      }],
    }))
    expect(s.statusLabel).toBe('有在跑的，其余建好了但没通电')
  })

  it('剩余「建好没通电」和「还在建」混着 → 两种都说到，不吞掉任何一种', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'SEO',
        components: [
          component({ name: 'a' }),
          component({ name: 'b', bucket: 'built_not_live' }),
          component({ name: 'c', bucket: 'building' }),
        ],
      }],
    }))
    expect(s.statusLabel).toBe('有在跑的，其余有的建好了但没通电、有的还在建')
  })

  it('零在跑、「建好没通电」和「还在建」混着 → 黄灯，文案同样两种都说到', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: '广告',
        components: [
          component({ name: 'a', bucket: 'built_not_live' }),
          component({ name: 'b', bucket: 'building' }),
        ],
      }],
    }))
    expect(s.statusTone).toBe('built_not_live')
    expect(s.statusLabel).toBe('有的建好了但没通电、有的还在建')
  })

  it('零在跑、全部「建好没通电」→ 文案保持原样', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: '广告', components: [component({ name: 'a', bucket: 'built_not_live' })] }],
    }))
    expect(s.statusLabel).toBe('建好了但没通电')
  })
})

describe('buildLaneSummaries — 卡点分「等你拍板」和「技术卡点」（Codex 复审 P2）', () => {
  it('卡住 + 这条线确实有等 PM 拍板的事 → 才说「等你决定」', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'geo', components: [component({ name: '审批界面', isBlocked: true })] }],
      decisionsNow: [{ componentName: '审批界面' }],
    }))
    expect(s.statusTone).toBe('blocked')
    expect(s.needsYourCall).toBe(true)
    expect(s.statusLabel).toBe('卡住等你决定')
  })

  it('卡住但没有任何等拍板的事（代码/数据/上游依赖卡点）→ 不能上抛给老板', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'geo', components: [component({ name: '抓取管道', bucket: 'building', isBlocked: true })] }],
      decisionsNow: [],
    }))
    expect(s.statusTone).toBe('blocked')
    expect(s.needsYourCall).toBe(false)
    expect(s.statusLabel).toBe('卡住了，我们在处理')
    expect(s.statusLabel).not.toContain('你')
  })

  it('🔴 卡住的是 A（技术卡点），同线另一个没卡住的 B 在等拍板 → 不能把 A 的卡点栽成「等你决定」', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'geo',
        components: [
          component({ name: 'A 抓取管道', bucket: 'building', isBlocked: true }),
          component({ name: 'B 审批界面' }),
        ],
      }],
      decisionsNow: [{ componentName: 'B 审批界面' }],
    }))
    expect(s.statusTone).toBe('blocked')
    expect(s.statusLabel).toBe('卡住了，我们在处理')
    // 「这条线另有事等你拍板」照旧由独立字段表达，不跟卡点因果混在一句话里
    expect(s.needsYourCall).toBe(true)
  })

  it('卡住的组件属于别的线、本线没决策 → 本线文案也不能说「等你决定」', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'geo', components: [component({ name: 'a', isBlocked: true })] }],
      decisionsNow: [{ componentName: '别的线的组件' }],
    }))
    expect(s.statusLabel).toBe('卡住了，我们在处理')
  })
})

describe('buildLaneSummaries — 老系统在跑的提示（魏征二审发现）', () => {
  it('唯一在跑的是老系统、新体系还没接完 → 带上提示，不能让「1/7」被读成没在干活', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'shared',
        components: [
          component({ name: 'legacy-meta', isLegacy: true }),
          ...Array.from({ length: 6 }, (_, i) => component({ name: `new-${i}`, bucket: 'building' })),
        ],
      }],
    }))
    expect(s.statusTone).toBe('operating')
    expect(s.legacyOperatingNote).toContain('老系统')
  })

  it('全部 operating 且全部是老系统 → 分数本身已经是满分，不需要额外提示', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'ads', components: [component({ name: 'a', isLegacy: true }), component({ name: 'b', isLegacy: true })] }],
    }))
    expect(s.legacyOperatingNote).toBeNull()
  })

  it('在跑的组件里有新体系也有老系统混着 → 不算「唯一靠老系统撑着」，不提示', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'geo',
        components: [
          component({ name: 'legacy', isLegacy: true }),
          component({ name: 'new-native' }),
          component({ name: 'still-building', bucket: 'building' }),
        ],
      }],
    }))
    expect(s.legacyOperatingNote).toBeNull()
  })
})

describe('buildLaneSummaries — 老系统提示里的「新体系余项」也按实际 bucket 说（Codex 复审第二轮）', () => {
  it('新体系余项已建好只差通电 → 不能说成「还在建」', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'AI 可见度',
        components: [
          component({ name: '行业品牌别名登记册', isLegacy: true }),
          component({ name: '测量结果存档', bucket: 'built_not_live' }),
        ],
      }],
    }))
    expect(s.legacyOperatingNote).toBe('在跑的是老系统，新体系建好了但没通电——分数低不代表这条线没在干活')
  })

  it('新体系余项两种状态混着 → 两种都说到', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{
        laneLabel: 'AI 可见度',
        components: [
          component({ name: 'legacy', isLegacy: true }),
          component({ name: '存档', bucket: 'built_not_live' }),
          component({ name: '抓取', bucket: 'building' }),
        ],
      }],
    }))
    expect(s.legacyOperatingNote).toBe('在跑的是老系统，新体系有的建好了但没通电、有的还在建——分数低不代表这条线没在干活')
  })
})

describe('buildLaneSummaries — needsYourCall 直接核对 decisionsNow（魏征二审发现的缺口）', () => {
  it('组件名出现在 decisionsNow 里 → true，即使这个组件没有 nextMilestone/不在 roadmap 里', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'geo', components: [component({ name: '审批界面' })] }],
      roadmap: [], // 故意留空 —— 证明不依赖 roadmap 也能判出来
      decisionsNow: [{ componentName: '审批界面' }],
    }))
    expect(s.needsYourCall).toBe(true)
  })

  it('decisionsNow 里的名字不属于这条线 → false，不跨线误报', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'geo', components: [component({ name: 'a' })] }],
      decisionsNow: [{ componentName: '别的线的组件' }],
    }))
    expect(s.needsYourCall).toBe(false)
  })
})

describe('buildLaneSummaries — 下一步 + 小样本标注', () => {
  it('nextStepLabel 取这条线在 roadmap 里排第一的那条（roadmap 输入顺序即优先级，本文件不重排）', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'geo', components: [component({ name: 'a' })] }],
      roadmap: [
        { laneLabel: 'geo', nextMilestoneLabel: '真客户身上跑过' },
        { laneLabel: 'geo', nextMilestoneLabel: '第二步（不该被选中）' },
      ],
    }))
    expect(s.nextStepLabel).toBe('真客户身上跑过')
  })

  it('这条线在 roadmap 里没有任何条目 → null，不是空字符串', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'geo', components: [component({ name: 'a' })] }],
    }))
    expect(s.nextStepLabel).toBeNull()
  })

  it('组件数 ≤ 2 → smallSample=true，UI 据此加「样本小」的标注', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'ads', components: [component({ name: 'a' }), component({ name: 'b' })] }],
    }))
    expect(s.smallSample).toBe(true)
  })

  it('组件数 3 → smallSample=false', () => {
    const [s] = buildLaneSummaries(input({
      lanes: [{ laneLabel: 'ads', components: [component({ name: 'a' }), component({ name: 'b' }), component({ name: 'c' })] }],
    }))
    expect(s.smallSample).toBe(false)
  })
})

describe('buildLaneSummaries — 多条线独立处理', () => {
  it('每条线各自算各自的，顺序沿用输入顺序', () => {
    const result = buildLaneSummaries(input({
      lanes: [
        { laneLabel: '共用', components: [component({ name: 'a' })] },
        { laneLabel: 'AI 可见度', components: [component({ name: 'b', bucket: 'building' })] },
      ],
    }))
    expect(result.map((r) => r.laneLabel)).toEqual(['共用', 'AI 可见度'])
    expect(result[0].statusTone).toBe('operating')
    expect(result[1].statusTone).toBe('building')
  })

  it('空 lanes 输入 → 空数组，不报错', () => {
    expect(buildLaneSummaries(input({}))).toEqual([])
  })
})
