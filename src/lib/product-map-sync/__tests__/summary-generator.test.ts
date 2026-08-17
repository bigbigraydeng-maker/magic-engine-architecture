/**
 * 摘要幻觉护栏(魏征设计审必改 4):状态词黑名单必须按值锁,不是「有没有函数」。
 */

import { describe, expect, it } from 'vitest'
import { containsForbiddenStatusWord, NullSummaryGenerator } from '../summary-generator'

describe('containsForbiddenStatusWord', () => {
  it('命中中文状态词', () => {
    expect(containsForbiddenStatusWord('这个功能已经完成了')).toBe(true)
    expect(containsForbiddenStatusWord('把这个 bug 修复了')).toBe(true)
    expect(containsForbiddenStatusWord('代码已合并到主分支')).toBe(true)
    expect(containsForbiddenStatusWord('问题已解决')).toBe(true)
  })

  it('命中英文状态词(大小写不敏感)', () => {
    expect(containsForbiddenStatusWord('This feature is DONE')).toBe(true)
    expect(containsForbiddenStatusWord('Bug fixed in this PR')).toBe(true)
    expect(containsForbiddenStatusWord('Already merged')).toBe(true)
  })

  it('只复述标题内容、不含状态判断 → 不命中', () => {
    expect(containsForbiddenStatusWord('给登录页面加一个记住密码的选项')).toBe(false)
    expect(containsForbiddenStatusWord('调整依赖图里箭头的方向')).toBe(false)
    expect(containsForbiddenStatusWord('Add a retry button to the upload flow')).toBe(false)
  })

  it('词根命中即拒绝,不要求整句匹配(宁可误杀不放过幻觉)', () => {
    expect(containsForbiddenStatusWord('这条已经修复了一半,剩下的还在处理')).toBe(true)
  })
})

describe('NullSummaryGenerator', () => {
  it('永远返回 null —— 未接大模型时的确定性降级', async () => {
    const g = new NullSummaryGenerator()
    expect(await g.summarize('pr', '随便什么标题')).toBeNull()
    expect(await g.summarize('issue', '')).toBeNull()
  })
})
