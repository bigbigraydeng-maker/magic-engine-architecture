/**
 * 团（Group Tour）平台通用数据形状。
 *
 * 字段命名故意不照抄 CTS 自己网站 `Tour` 接口的拼写——这是存储层，
 * 发布时才在 publisher.ts 里做一次映射，换一个字段名不同的旅游客户
 * 也不用改这一层。发布目标（CTS `src/lib/data/tours.ts` 的 `Tour`）
 * 见该仓库，不在这里 import（跨仓库）。
 */

export interface GroupTourDay {
  day: number
  title: string
  description: string
  meals: Array<'Breakfast' | 'Lunch' | 'Dinner'>
  accommodation: string | null
}

/** 一个团期 = 出发日期 + （可选的）该团期专属价格。 */
export interface GroupTourDeparture {
  date: string
  price: string | null
}

export interface GroupTourClaim {
  claim: string
  issue: string
}

export interface GroupTourBlogAngle {
  title: string
  angle: string
}

/** 草稿态的完整团数据，存进 group_tours.payload。 */
export interface GroupTourPayload {
  /** CTS 专属的目的地分类（决定发布 URL 是 /tours/china/... 还是 /tours/japan/...）。 */
  destination: 'china' | 'japan' | 'vietnam' | null
  name: string
  title: string
  shortDescription: string
  duration: string
  price: string | null
  singleSupplement: string | null
  departures: GroupTourDeparture[]
  tourCities: string[]
  highlights: string[]
  sellingPoints: string[]
  itinerary: GroupTourDay[]
  inclusions: string[]
  exclusions: string[]
  heroImage: string | null
  gallery: string[]
  metaTitle: string
  metaDescription: string
  /** CTS 专属的团型分类；v1 只服务 CTS，放在 payload 里而不是抽出去做成平台配置。 */
  suggestedTier: 'signature' | 'discovery' | 'stopover' | null
  tierReasoning: string
  suggestedSlug: string
}

export const EMPTY_GROUP_TOUR_PAYLOAD: GroupTourPayload = {
  destination: null,
  name: '',
  title: '',
  shortDescription: '',
  duration: '',
  price: null,
  singleSupplement: null,
  departures: [],
  tourCities: [],
  highlights: [],
  sellingPoints: [],
  itinerary: [],
  inclusions: [],
  exclusions: [],
  heroImage: null,
  gallery: [],
  metaTitle: '',
  metaDescription: '',
  suggestedTier: null,
  tierReasoning: '',
  suggestedSlug: '',
}
