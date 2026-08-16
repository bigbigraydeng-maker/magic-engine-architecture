/**
 * 「今天该关注谁」—— 只读决策清单（CI-WP01 · 执行锚点 #1009）。
 *
 * 产品方向来源：#999 Customer Intelligence。执行与验收在 #1009。
 * 这是该方向下的第一个、也是唯一一个切片：**presenter 层**。
 * 它不算分、不建人、不建事件、不落任何库，只做一件事 ——
 * 把 `/api/clients/[id]/crm/today` 已经算好的桶，拍平成一条「谁 · 为什么 · 下一步」
 * 的决策清单。
 *
 * 为什么是纯函数、不掺任何取数：
 *  · 排序、DNC 排除、推迟、终端阶段抑制、当天冻结、失败触达、CTS 专属推断 ——
 *    这些语义**全部**已经在 today 路由 + lib/crm/day-list + segments 里钉死了。
 *    这里再写一套等于第二份判据，两边一漂移就开始说假话（worklist-groups 那次
 *    33 人消失的事故就是两处判据对不上）。所以这里**只消费**，一个字都不重判。
 *  · 纯函数 = 能被单测直接钉住「拍平顺序 / 已处理留在原位 / 下一步映射 / 缺证据
 *    走 defer」，页面组件测不了这些。
 *
 * 硬边界（见 #1009 CI-WP01 执行 Issue）：只读、无副作用、不猜。缺失或互相冲突的
 * 证据一律显示「先不急 / 待补」，绝不编一个「现在就打」出来。
 */

import type { Segment } from './segments'
import type { WorklistLayer } from './worklist-groups'

/** today 路由回来的联系人子集 —— 只列 presenter 真正读的字段。 */
export interface FocusPersonInput {
  contactId: string
  name: string
  /** 为什么是他（why now）。已处理的人这里已是 handledWhy（today 路由算好的）。 */
  reason: string
  suggestedChannel: 'phone' | 'sms' | 'email' | 'messenger' | 'none'
  /** 库里有号但打不通 —— 跟「压根没留电话」是两句不同的话，下一步也不同。 */
  phoneUnusable?: boolean
  phone: string | null
  dueAt: string | null
  lastTouchAt: string | null
  /** 上次是谁跟的。不知道就是 null，页面不假装。 */
  lastBy?: string | null
  /** 今天已经有人动过他了 —— 清单里留在原位置变灰，不上移不下沉。 */
  doneToday?: boolean
  /** 今天是怎么处理的（今天联系过了 / 标了：他说不买了…）。没处理就是 null。 */
  handledWhy?: string | null
  segment: Segment
  stageLabel?: string | null
  /** 终端客户还是同行。只做标记，不参与排序 —— 判据跟散客完全一样。 */
  kind?: string
}

/** today 路由回来的一个桶子集。 */
export interface FocusBucketInput {
  layer: WorklistLayer
  people: FocusPersonInput[]
}

/** today 路由回来的整份 payload 子集。 */
export interface FocusPayloadInput {
  buckets: FocusBucketInput[]
}

/**
 * 下一步建议。三态，绝不含糊：
 *  · `act`  —— 有明确渠道，给一句能照着做的话。
 *  · `done` —— 今天已经处理过了，不用再动。
 *  · `defer`—— 没有可用证据 / 联系不上，**明说待补，不猜一个动作**。
 */
export interface NextStep {
  kind: 'act' | 'done' | 'defer'
  text: string
}

export interface FocusRow {
  contactId: string
  /** 谁。 */
  name: string
  /** 为什么是他（why now）。 */
  whyNow: string
  /** 推荐的下一步。 */
  nextStep: NextStep
  /** 到期时间（约好的回电点）。没有就是 null。 */
  dueAt: string | null
  /** 最近一次触点时间。没有就是 null。 */
  lastTouchAt: string | null
  /** 上次谁跟的。不知道就是 null。 */
  lastBy: string | null
  /** 今天是否已处理 —— 留在原位置变灰。 */
  doneToday: boolean
  /** 他现在处在这一层：客人在等你 / 还没搭上话。 */
  layer: WorklistLayer
  segment: Segment
  stageLabel: string | null
  /** 终端客户还是同行（只做标记）。 */
  kind: string | null
}

/**
 * 决策清单只收「今天轮到人做的两层」。
 *
 *  · `waiting`（客人在等你）排在最前 —— 客人真的开过口，今天必须有人回。
 *  · `acted`（还没搭上话）次之 —— 新进来的、打过一次没接上的。
 *
 * **`queued` 不进清单**：那是「交给系统盯着」的库存，不是今天的活；把它铺进
 * 「今天该关注谁」等于每天早上给人看一座山（worklist-groups 里写透了这件事）。
 * offList（成交 / 拒绝 / 号坏 / 推迟）更不进 —— 那些是结论性状态，不是今天的关注对象。
 */
const LAYER_ORDER: WorklistLayer[] = ['waiting', 'acted']

/**
 * 一个人的下一步。渠道→动作的映射**跟看板 ReachAction（page.tsx）语义等价**：
 * 同样消费 segments 已经降级好的 `suggestedChannel` + `phoneUnusable`，同样的
 * 「打电话 / 打不通换渠道 / 私信 / 邮件」分支顺序。两处一旦分叉，同一个人在两页
 * 会被建议做两件不同的事。
 *
 * ⚠️ 但**不是逐字照抄，而是有意更严**，别照字面把守卫删掉去「对齐」：
 *  · phone 分支多一道 `!phoneUnusable`（看板靠 segments 已把坏号降级、不显式挡）——
 *    真实数据上二者等价（坏号的 suggestedChannel 不会是 phone），但万一那个前提被
 *    破坏，这里也绝不会把一个已知打不通的号建议去拨（正是看板注释自己怕的事）。
 *  · 多一个 `done` 首分支和末尾 `defer`：看板缺渠道时 `return null`（什么都不显示），
 *    决策清单必须给一句话，所以缺证据显式落「待补」。
 *
 * 缺证据的收口在最后那个 `defer`：today 路由已经把「他实际能被联系到什么」
 * 解成 suggestedChannel，解不出来就是 `none`（没有可用渠道）。这里不再自作主张
 * 补一个动作 —— 缺证据显示待补，是 CI-WP01 的硬边界。
 */
export function recommendedNextStep(p: FocusPersonInput): NextStep {
  // 今天已经动过他了 —— 不用再建议动作，说清楚是怎么处理的即可。
  if (p.doneToday === true) {
    return { kind: 'done', text: p.handledWhy?.trim() || '今天已经处理过了' }
  }

  const ch = p.suggestedChannel

  // 有号能打 —— 最直接。号码在库、打不通的那种走下一分支，不落这里。
  if ((ch === 'phone' || ch === 'sms') && p.phone && !p.phoneUnusable) {
    return { kind: 'act', text: `打电话：${p.phone}` }
  }

  // 号在库里、但那个号打不通 —— 不能说成「没留电话」。换个渠道回，顺手要个新号。
  //
  // 🔴 只能用**真实存在**的 suggestedChannel。原先这里 `ch==='messenger' ? … : '发邮件'`
  //    把所有非私信情形（含 `none`、和「渠道说 phone 但号已死」这种自相矛盾的输入）
  //    一律兜成「发邮件」—— 凭空建议一个可能根本不存在的邮箱渠道，正是 CI-WP01
  //    最不能犯的「无证据建议」。没有别的可用渠道就 defer，去补个能用的联系方式。
  if (p.phoneUnusable === true) {
    if (ch === 'messenger') {
      return { kind: 'act', text: '这个号打不通 —— 先在 Messenger 回他，顺便问他要个新号' }
    }
    if (ch === 'email') {
      return { kind: 'act', text: '这个号打不通 —— 先发邮件，顺便问他要个新号' }
    }
    return { kind: 'defer', text: '这个号打不通，又没有别的可用联系方式 —— 先补个能用的号/联系方式再跟' }
  }

  if (ch === 'messenger') {
    return { kind: 'act', text: '在 Messenger 回他（没留电话）' }
  }

  if (ch === 'email') {
    return { kind: 'act', text: '发邮件（没留电话）' }
  }

  // 没有任何可用渠道，或想打电话却连号码都没有 —— 明说待补，不猜。
  return { kind: 'defer', text: '先不急 —— 暂时联系不上，等补到联系方式再跟' }
}

/**
 * payload 是不是一份「结构对得上」的 today 响应。
 *
 * 🔴 页面靠它把**数据异常**和**真的没人**分开 —— 二者绝不能长成同一个画面。
 *    上游若回了个 200 但结构不对（没有 buckets、buckets 不是数组、某个桶缺 people/
 *    layer），拍平出来会是空清单，若照「今天没人」渲染，就是拿一次读取失败冒充
 *    「今天过关」（failure-as-success）。这里判死结构，页面据此进「数据异常」态。
 */
export function isFocusPayloadShaped(data: unknown): data is FocusPayloadInput {
  if (!data || typeof data !== 'object') return false
  const buckets = (data as { buckets?: unknown }).buckets
  if (!Array.isArray(buckets)) return false
  return buckets.every(
    (b) =>
      !!b &&
      typeof b === 'object' &&
      typeof (b as { layer?: unknown }).layer === 'string' &&
      Array.isArray((b as { people?: unknown }).people),
  )
}

/**
 * 把 today payload 拍平成决策清单。
 *
 * 顺序完全沿用 today 路由给的：桶按 WORKLIST_GROUPS 排、桶内按 day-list 排好，
 * 这里只按层优先级把桶归拢，**不重排任何人** —— 当天名单要稳定，已处理的要留在
 * 原位置，靠的就是「不动它给的顺序」。
 *
 * 同行（kind==='trade'）在这里**整个排除**（PO 2026-08-17 裁定：只展示终端客户 /
 * 真实机会，且不加筛选按钮）。判据用 today API 已经算好的 `kind`，presenter 不自己
 * 判同行；`undefined` 当终端客户处理（跟看板 `k ?? 'retail'` 同口径）。
 */
export function buildFocusList(payload: FocusPayloadInput): FocusRow[] {
  const rows: FocusRow[] = []
  // 兜底：presenter 永不抛错（结构异常由 isFocusPayloadShaped 在页面侧拦成「数据异常」，
  // 不走到这里）。即便真喂进一个没有 buckets 的对象，也只回空数组、不 `for...of undefined`。
  const buckets = payload.buckets ?? []
  for (const layer of LAYER_ORDER) {
    for (const bucket of buckets) {
      if (bucket.layer !== layer) continue
      for (const p of bucket.people) {
        // 同行不进决策清单（PO 裁定）。
        if (p.kind === 'trade') continue
        rows.push({
          contactId: p.contactId,
          name: p.name,
          whyNow: p.reason,
          nextStep: recommendedNextStep(p),
          dueAt: p.dueAt,
          lastTouchAt: p.lastTouchAt,
          lastBy: p.lastBy ?? null,
          doneToday: p.doneToday === true,
          layer: bucket.layer,
          segment: p.segment,
          stageLabel: p.stageLabel ?? null,
          kind: p.kind ?? null,
        })
      }
    }
  }
  return rows
}

/** 清单顶上那条一眼看懂的小结：几个要关注、还剩几个没动、今天动过几个。 */
export interface FocusSummary {
  total: number
  done: number
  left: number
}

export function focusSummary(rows: FocusRow[]): FocusSummary {
  const done = rows.filter((r) => r.doneToday).length
  return { total: rows.length, done, left: rows.length - done }
}
