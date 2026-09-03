/**
 * 这些用例的取材原则：**全部来自 2026-09-03 那次真实事故的原文片段**，
 * 不自编"看起来像那么回事"的假样本。
 *
 * 每条规则都成对测试：给坏样本必须拦住（否则闸门形同虚设），
 * 给好样本必须放行（否则闸门会被绕过或关掉）。
 */

import { describe, it, expect } from 'vitest'
import {
  runPrepublishCheck,
  checkScaleConversion,
  checkUnpairedCjkScale,
  checkSelfCertifyingClaims,
  checkFieldworkArtifacts,
  checkSearchMetricReceipts,
  checkOrphanSources,
  checkHeadlineFiguresTiered,
  stripHtml,
} from '../prepublish-check'

describe('checkScaleConversion — 中英数量级换算', () => {
  it('拦住事故原样：A$82.6 billion 被写成「82.6 亿」（差 10 倍）', () => {
    // 这是 2026-09-03 修正版里我自己引入的错，Australia Post 线上零售总额。
    const bad = 'Australia Post 2026 年度报告：2025 年澳洲线上零售总额 A$82.6 亿（A$82.6 b），同比 +14%。'
    const findings = checkScaleConversion(bad)
    expect(findings).toHaveLength(1)
    expect(findings[0].rule).toBe('scale-conversion-mismatch')
    expect(findings[0].severity).toBe('block')
    // 报错信息必须直接给出正确写法，而不是只说"不一致"——
    // 被拦住的那一刻最需要的是"那到底该写多少"。
    expect(findings[0].message).toContain('小了 10.0 倍')
    expect(findings[0].message).toContain('应为 826亿')
  })

  it('放行修正后的写法：A$826 亿（A$82.6 b）', () => {
    const good = '2025 年澳洲线上零售总额 A$826 亿（A$82.6 b），同比 +14%。'
    expect(checkScaleConversion(good)).toHaveLength(0)
  })

  it('拦住第二处事故原样：A$120.0 b 写成「120 亿」（应为 1,200 亿）', () => {
    const bad = 'ABS 数据：澳洲自中国进口 A$120.0 亿（A$120.0 b · 2024–25 财年）。'
    const findings = checkScaleConversion(bad)
    expect(findings[0].rule).toBe('scale-conversion-mismatch')
  })

  it('放行修正后的写法：A$1,200 亿（A$120.0 b）', () => {
    const good = '澳洲自中国进口 A$1,200 亿（A$120.0 b · 2024–25 财年）。'
    expect(checkScaleConversion(good)).toHaveLength(0)
  })

  it('million ↔ 万 同样校验：3.5 million 写成「3.5 万」应被拦', () => {
    const bad = '入境外国人 3.5 万人次（3.5 million）'
    expect(checkScaleConversion(bad).length).toBeGreaterThan(0)
  })

  it('million ↔ 万 正确换算放行：350 万（3.5 million）', () => {
    expect(checkScaleConversion('入境外国人 350 万人次（3.5 million）')).toHaveLength(0)
  })

  it('容忍四舍五入：1,302 亿 vs 130.2 b 精确相等，不误报', () => {
    expect(checkScaleConversion('自华进口 A$1,302 亿（A$130.2 b）')).toHaveLength(0)
  })
})

describe('checkUnpairedCjkScale — 只写中文数量级不给原始口径', () => {
  it('对孤立的「A$82.6 亿」给出 warn', () => {
    const findings = checkUnpairedCjkScale('线上零售总额 A$82.6 亿，同比 +14%。')
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
  })

  it('成对出现时不再重复告警（已由换算规则覆盖）', () => {
    expect(checkUnpairedCjkScale('线上零售总额 A$826 亿（A$82.6 b）')).toHaveLength(0)
  })
})

describe('checkSelfCertifyingClaims — 自证清白式表述', () => {
  it('拦住事故原样：「所有数字均可反向溯源」', () => {
    // Vol.01 页脚原句，也是全案最大的信誉风险点。
    const bad = '本报告研究框架、数据来源与结论均可独立验证。所有数字均可反向溯源。'
    const findings = checkSelfCertifyingClaims(bad)
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.every((f) => f.severity === 'block')).toBe(true)
  })

  it('拦住事故原样：「未采购任何付费数据订阅」', () => {
    const bad = '本报告未采购任何付费数据订阅，全部基于公开可查数据源的二次加工。'
    expect(checkSelfCertifyingClaims(bad).length).toBeGreaterThanOrEqual(1)
  })

  it('放行逐条标注的写法', () => {
    const good = '本节数字标注为「已核实」的附一手来源链接；标注为「推算」的为本院综合判断。'
    expect(checkSelfCertifyingClaims(good)).toHaveLength(0)
  })
})

describe('checkFieldworkArtifacts — 声称做过调研必须有产物', () => {
  // Vol.02 §06 声称"抽样约 40 家、审计时间 2026 年 8 月"，该审计从未执行。
  const claimed = '样本量约 40 家，审计时间：2026 年 8 月，全部匿名化处理。'

  it('无产物时拦住，且多处命中只报一条（避免刷屏让人想关掉闸）', () => {
    const findings = checkFieldworkArtifacts(claimed, [])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('block')
    // 命中的两处（样本量、审计时间）都要在信息里列出来，便于定位
    expect(findings[0].message).toContain('命中 2 处')
  })

  it('登记了产物后放行', () => {
    expect(checkFieldworkArtifacts(claimed, ['docs/research/au-freight-audit-2026-08.csv'])).toHaveLength(0)
  })

  it('没有调研声称时不误报', () => {
    expect(checkFieldworkArtifacts('本节为公开数据的二次整理。', [])).toHaveLength(0)
  })
})

describe('checkSearchMetricReceipts — 铁律 8', () => {
  // Vol.02 §05 那张 10 行关键词表，搜索量与 CPC 一次都没拉过。
  const claimed = 'freight forwarder china to australia 月搜索量 2,900，CPC A$11–18。'

  it('无 receipt 时拦住，多处命中合并成一条', () => {
    const findings = checkSearchMetricReceipts(claimed, [])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('block')
    expect(findings[0].message).toContain('铁律 8')
    // remediation 是单一动作，信息里必须直接说清楚下一步跑什么
    expect(findings[0].message).toContain('src/lib/dataforseo/search-volume.ts')
  })

  it('有 receipt 后放行', () => {
    expect(checkSearchMetricReceipts(claimed, ['receipts/dataforseo-2026-09-03.json'])).toHaveLength(0)
  })
})

describe('checkOrphanSources — 装饰性引用', () => {
  it('拦住只在来源清单露面、正文无数字挂靠的来源', () => {
    // 事故原样：来源清单列了 NAB Online Retail Sales Index，正文一个 NAB 数字都没有。
    const text = '正文引用了 Australia Post 的 24% 渗透率。来源：Australia Post eCommerce Report、NAB Online Retail Sales Index。'
    const findings = checkOrphanSources(text, ['Australia Post', 'NAB Online Retail Sales Index'])
    expect(findings).toHaveLength(1)
    expect(findings[0].excerpt).toBe('NAB Online Retail Sales Index')
  })

  it('正文多处引用的来源不报', () => {
    const text = 'ABS 数据显示占比 26%。另据 ABS 的 BEC 分类，消费品占 28.6%。来源：ABS。'
    expect(checkOrphanSources(text, ['ABS'])).toHaveLength(0)
  })
})

describe('checkHeadlineFiguresTiered — 头条数字必须标口径', () => {
  it('拦住没有口径标注的 KPI', () => {
    const html = '<div class="kpi"><div class="label">自华进口</div><div class="kpi-value">A$1,200 亿</div></div>'
    const findings = checkHeadlineFiguresTiered(html)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('block')
  })

  it('带「已核实」标注的 KPI 放行', () => {
    const html =
      '<div class="kpi"><div class="kpi-value">A$1,200 亿</div><div class="foot">ABS <span class="chip">已核实</span></div></div>'
    expect(checkHeadlineFiguresTiered(html)).toHaveLength(0)
  })

  it('带「推算」标注的 KPI 也放行', () => {
    const html = '<div class="kpi"><div class="kpi-value">106,636</div><div class="foot">IBISWorld · 推算</div></div>'
    expect(checkHeadlineFiguresTiered(html)).toHaveLength(0)
  })
})

describe('stripHtml', () => {
  it('剥掉标签后跨标签的数字对仍可被匹配到', () => {
    // 真实模板里 `A$826<span class="unit">亿</span>` 是跨标签的，
    // 不先剥标签就匹配不到，换算规则会静默失效。
    const html = '<div class="kpi-value">A$826<span class="unit">亿</span></div><div class="foot">A$82.6 b</div>'
    const text = stripHtml(html)
    expect(checkScaleConversion(text)).toHaveLength(0)
    expect(text).toContain('826')
    expect(text).toContain('亿')
  })

  it('剥掉 style / script 内容，避免 CSS 里的数字被当成正文数字', () => {
    const html = '<style>.a{width:82.6px}</style><p>正文</p>'
    expect(stripHtml(html)).not.toContain('82.6')
  })
})

describe('runPrepublishCheck — 端到端', () => {
  it('事故版文档：多条 blocking，passed=false', () => {
    const badDoc = `
      <div class="kpi"><div class="kpi-value">A$82.6 亿（A$82.6 b）</div></div>
      <p>样本量约 40 家，审计时间：2026 年 8 月。</p>
      <p>月搜索量 2,900，CPC A$11–18。</p>
      <p>所有数字均可反向溯源。</p>
    `
    const report = runPrepublishCheck({ source: badDoc })
    expect(report.passed).toBe(false)
    const rules = new Set(report.blocking.map((f) => f.rule))
    expect(rules.has('scale-conversion-mismatch')).toBe(true)
    expect(rules.has('fieldwork-without-artifact')).toBe(true)
    expect(rules.has('search-metric-without-receipt')).toBe(true)
    expect(rules.has('self-certifying-claim')).toBe(true)
    expect(rules.has('untiered-headline-figure')).toBe(true)
  })

  it('合规文档：无 blocking，passed=true', () => {
    const goodDoc = `
      <div class="kpi">
        <div class="kpi-value">A$1,200 亿（A$120.0 b）</div>
        <div class="foot">ABS <span class="chip">已核实</span></div>
      </div>
      <p>本节数字标注为「已核实」的附一手来源链接。</p>
    `
    const report = runPrepublishCheck({ source: goodDoc })
    expect(report.blocking).toHaveLength(0)
    expect(report.passed).toBe(true)
  })

  it('numberCount 复用 grounding.ts 的抽取器，不重复实现', () => {
    const report = runPrepublishCheck({ source: '<p>占比 26%，样本 40 家，金额 1200 亿。</p>' })
    expect(report.numberCount).toBeGreaterThan(0)
  })
})
