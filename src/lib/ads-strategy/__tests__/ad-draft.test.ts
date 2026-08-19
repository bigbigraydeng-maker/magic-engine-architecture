import { describe, it, expect } from 'vitest'
import {
  validateDraft,
  metaTripletFor,
  describeDraft,
  MAX_AUTO_DAILY_BUDGET,
  type AdDraft,
} from '../ad-draft'

function leadDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'lead_form',
    clientId: 'c1',
    campaignName: 'Kiteroa 留资',
    adSetName: 'North Shore 买家',
    dailyBudget: 30,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page1',
    leadFormId: 'form1',
    creatives: [
      { name: 'EN', primaryText: 'Brand new four bedroom home', headline: 'Book a viewing', imageHash: 'h1' },
    ],
    ...over,
  }
}

describe('validateDraft — 拦住 ME 自己就能判的错', () => {
  it('齐全的留资草案没问题', () => {
    expect(validateDraft(leadDraft())).toEqual([])
  })

  it('留资广告没挂表单 → 拦（不然它收不到任何联系方式）', () => {
    const p = validateDraft(leadDraft({ leadFormId: undefined }))
    expect(p.map((x) => x.field)).toContain('leadFormId')
  })

  it('没说投给哪里 → 拦（投给全世界不是一个决定）', () => {
    const p = validateDraft(leadDraft({ geoCountries: [] }))
    expect(p.map((x) => x.field)).toContain('geoCountries')
  })

  it('没说跑几天 → 拦（不设终点的广告没人记得关）', () => {
    const p = validateDraft(leadDraft({ durationDays: 0 }))
    expect(p.map((x) => x.field)).toContain('durationDays')
  })

  it(`每天超过 $${MAX_AUTO_DAILY_BUDGET} → 拦`, () => {
    const p = validateDraft(leadDraft({ dailyBudget: MAX_AUTO_DAILY_BUDGET + 1 }))
    expect(p.map((x) => x.field)).toContain('dailyBudget')
  })

  it(`刚好 $${MAX_AUTO_DAILY_BUDGET} 放行 —— 边界不能反着来`, () => {
    expect(validateDraft(leadDraft({ dailyBudget: MAX_AUTO_DAILY_BUDGET }))).toEqual([])
  })

  it('视频广告没给视频 → 拦', () => {
    const p = validateDraft(
      leadDraft({
        kind: 'video_thruplay',
        leadFormId: undefined,
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y' }],
      }),
    )
    expect(p.map((x) => x.field)).toContain('creatives[0].videoId')
  })

  it('视频广告不需要表单', () => {
    const p = validateDraft(
      leadDraft({
        kind: 'video_thruplay',
        leadFormId: undefined,
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }],
      }),
    )
    expect(p).toEqual([])
  })

  it('正文空白（只有空格）也算空', () => {
    const p = validateDraft(
      leadDraft({ creatives: [{ name: 'E', primaryText: '   ', headline: 'h', imageHash: 'h1' }] }),
    )
    expect(p.map((x) => x.field)).toContain('creatives[0].primaryText')
  })

  it('年龄下限 18 岁以下 → 拦', () => {
    expect(validateDraft(leadDraft({ ageMin: 16 })).map((x) => x.field)).toContain('ageMin')
  })
})

describe('metaTripletFor — 三件套写死，配错就是「名字叫留资、实际买曝光」', () => {
  it('留资 → OUTCOME_LEADS / LEAD_GENERATION，落点在广告里不是私信', () => {
    const t = metaTripletFor('lead_form')
    expect(t.objective).toBe('OUTCOME_LEADS')
    expect(t.optimizationGoal).toBe('LEAD_GENERATION')
    expect(t.destinationType).toBe('ON_AD')
  })

  it('养受众 → THRUPLAY，落点 ON_VIDEO（少了它 Meta 不给按完播优化）', () => {
    const t = metaTripletFor('video_thruplay')
    expect(t.optimizationGoal).toBe('THRUPLAY')
    expect(t.destinationType).toBe('ON_VIDEO')
  })

  it('两种草案的落点都不是私信 —— 私信那条线已经不走了', () => {
    for (const k of ['lead_form', 'video_thruplay'] as const) {
      expect(['MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT']).not.toContain(
        metaTripletFor(k).destinationType,
      )
    }
  })
})

describe('describeDraft — 审批页第一行必须说清花多少', () => {
  it('算的是总花费上限，不是每天', () => {
    expect(describeDraft(leadDraft({ dailyBudget: 30, durationDays: 7 }))).toContain('$210')
  })

  it('留资和养受众说的是两件事', () => {
    expect(describeDraft(leadDraft())).toContain('联系方式')
    expect(
      describeDraft(
        leadDraft({
          kind: 'video_thruplay',
          creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v' }],
        }),
      ),
    ).toContain('受众')
  })
})

// ── boost_existing_post（ME2 广告中枢 v1，2026-08-20 feat/me-ads-hub-v1）─────────
// 这一段是 Codex 复审 BLOCKER #1 的应对：现有 publisher 只支持"从素材新建广告"
// 不支持"boost 已发帖"。扩了第三种 DraftKind 后必须至少覆盖：validateDraft 挡下
// 缺 objectStoryId / 缺 destinationUrl / advantageAudience 不显式关的错，
// metaTripletFor 走 TRAFFIC/LINK_CLICKS。

function boostDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'boost_existing_post',
    clientId: 'c-cts',
    campaignName: 'ME-Sandbox-2026-08-20-reel-abc',
    // R2 修复：CTS Reel 发在 Facebook 主页，v1 只投 Facebook 版位
    // （不是 R1 之前那个 'NZ 55+ Facebook+IG' 名字 —— 那个组名本身就在暗示
    // 一个 Meta 官方文档不支持的跨平台组合，见 publisherPlatforms 校验）
    adSetName: 'NZ 55+ Facebook Reel',
    dailyBudget: 20,
    durationDays: 5,
    geoCountries: ['NZ'],
    ageMin: 55,
    ageMax: 65,
    pageId: '1234567890',
    creatives: [],  // boost 复用原帖 creative，不给数组
    objectStoryId: '1234567890_9876543210',
    publisherPlatforms: ['facebook'],
    advantageAudience: 0,
    destinationUrl: 'https://www.ctstours.co.nz/china-tours',
    ...over,
  }
}

describe('validateDraft — boost_existing_post 专属校验', () => {
  it('齐全的 boost 草案没问题', () => {
    expect(validateDraft(boostDraft())).toEqual([])
  })

  it('缺 objectStoryId → 拦（少了这个就不是"投已有帖"是新建广告）', () => {
    const p = validateDraft(boostDraft({ objectStoryId: undefined }))
    expect(p.map((x) => x.field)).toContain('objectStoryId')
  })

  it('objectStoryId 格式不对 → 拦（必须 pageId_postId）', () => {
    const p = validateDraft(boostDraft({ objectStoryId: 'not_a_valid_id' }))
    expect(p.map((x) => x.field)).toContain('objectStoryId')
  })

  it('缺 destinationUrl → 拦（点广告没地方跳）', () => {
    const p = validateDraft(boostDraft({ destinationUrl: undefined }))
    expect(p.map((x) => x.field)).toContain('destinationUrl')
  })

  it('advantageAudience 不显式关 → 拦（否则会反锁 ageMin ≤ 25）', () => {
    // Meta 默认打开 advantage_audience 会让 ageMin 55 失效
    const p = validateDraft(boostDraft({ advantageAudience: 1 }))
    expect(p.map((x) => x.field)).toContain('advantageAudience')
  })

  it('advantageAudience 不填 → 拦（跟传 1 一样，必须显式给 0）', () => {
    const p = validateDraft(boostDraft({ advantageAudience: undefined }))
    expect(p.map((x) => x.field)).toContain('advantageAudience')
  })

  it('boost 类型 creatives 数组为空是允许的（reuse 原帖 creative）', () => {
    // 关键差异：其他 kind 空 creatives 会挡下，boost 不挡
    const p = validateDraft(boostDraft({ creatives: [] }))
    expect(p.map((x) => x.field)).not.toContain('creatives')
  })

  // R2 新增（2026-08-20，R1 复核 BLOCKER）：Meta 官方文档确认 Facebook Reel boost
  // 和 Instagram Reel boost 是两套独立系统（各自的 publisher_platforms + 落位值不同），
  // 没有文档记载的跨平台同投路径。Day 1 那版没拦跨平台组合，这里补上。
  it('publisherPlatforms 不给 → 拦（不给等于让 Meta 自动选，没人能预判）', () => {
    const p = validateDraft(boostDraft({ publisherPlatforms: undefined }))
    expect(p.map((x) => x.field)).toContain('publisherPlatforms')
  })

  it('publisherPlatforms 给空数组 → 拦', () => {
    const p = validateDraft(boostDraft({ publisherPlatforms: [] }))
    expect(p.map((x) => x.field)).toContain('publisherPlatforms')
  })

  it('publisherPlatforms 同时给 facebook+instagram → 拦（Meta 没有跨平台同投这条路）', () => {
    const p = validateDraft(boostDraft({ publisherPlatforms: ['facebook', 'instagram'] }))
    expect(p.map((x) => x.field)).toContain('publisherPlatforms')
  })

  it('publisherPlatforms 给不认识的平台 → 拦', () => {
    const p = validateDraft(boostDraft({ publisherPlatforms: ['tiktok'] }))
    expect(p.map((x) => x.field)).toContain('publisherPlatforms')
  })

  it('publisherPlatforms 只给 facebook 一个 → 放行', () => {
    const p = validateDraft(boostDraft({ publisherPlatforms: ['facebook'] }))
    expect(p.map((x) => x.field)).not.toContain('publisherPlatforms')
  })

  it('publisherPlatforms 只给 instagram 一个 → 放行', () => {
    const p = validateDraft(boostDraft({ publisherPlatforms: ['instagram'] }))
    expect(p.map((x) => x.field)).not.toContain('publisherPlatforms')
  })
})

describe('metaTripletFor — boost_existing_post 走 TRAFFIC/LINK_CLICKS', () => {
  it('返 OUTCOME_TRAFFIC / LINK_CLICKS / WEBSITE', () => {
    const t = metaTripletFor('boost_existing_post')
    expect(t.objective).toBe('OUTCOME_TRAFFIC')
    expect(t.optimizationGoal).toBe('LINK_CLICKS')
    expect(t.destinationType).toBe('WEBSITE')
  })

  it('落点不是私信 —— 广告中枢 v1 不走私信', () => {
    expect(['MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT']).not.toContain(
      metaTripletFor('boost_existing_post').destinationType,
    )
  })
})

describe('describeDraft — boost_existing_post 说清是"推已发帖"', () => {
  it('提到"已发的帖子"和"点赞/评论"（保留社交证明）', () => {
    const s = describeDraft(boostDraft())
    expect(s).toMatch(/已发|发的帖|点赞|评论/)
  })
})
