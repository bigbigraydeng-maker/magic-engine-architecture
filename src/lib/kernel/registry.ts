/**
 * Typed Action Registry —— 平台级动作定义。
 *
 * 🔴 **在代码里，不在数据库里。** 三条理由（ADR-002 采纳）：
 *    ① 版本控制：契约变更走 PR，看得见谁改的、为什么改
 *    ② agent 运行时改不了：模型可以**提出**一个动作，但改不了动作的风险等级
 *    ③ 幂等规则 / 重试策略 / 验证方法漏写会**编译失败**，不是运行时才发现
 *
 * 🔴 未知动作 = deny。不是「先跑跑看」，也不是静默跳过 ——
 *    必须落一条 authorization_decisions 的 deny 记录，否则
 *    「AI 提了个我们没实现的动作」这件事没人看得见。
 */

import type { ActionDefinition, ActionKey } from './types'

/**
 * `seo.build_publish_package` —— Kernel v1 的 safe capability。
 *
 * 做什么：把一篇已经写好的 blog 草稿，连同它的 meta / schema / GEO 块 /
 * 上下文快照，固化成一个 versioned production package，**停在内部态**。
 *
 * 为什么选它做 v1（ADR-004 要求「真实执行但无客户外部副作用」）：
 *   · `production_packages` 表已经带 6 个来源 FK + generation_context_snapshot
 *     —— Kernel 的第一条 lineage 不需要新建关系，只需要接上
 *   · 验证是真的：回读 + content hash 比对 + 必填断言 + FK 可解析性断言，
 *     任何一条失败都是真失败（不像「断言 status 变了」那种同义反复）
 *   · 回滚干净：未发布的 package 没有下游消费者
 *
 * 🔴 `sideEffect: 'internal_write'` 是这个动作的红线。它一旦被改成
 *    `outward`，授权层与 Gateway 会各拒一次 —— 因为它的
 *    `outwardAuthorization` 是 `null`，而对外动作没有逐动作声明就不放行。
 */
const SEO_BUILD_PUBLISH_PACKAGE: ActionDefinition<'seo.build_publish_package'> = {
  actionKey: 'seo.build_publish_package',
  version: 1,
  title: '把过了初审的博客草稿固化成一个可发布包（不发布）',

  // 🔴 `content_hash` 必须由提交方在提交时算好（见 capabilities 的
  //    prepareBuildPublishPackageInput）。它是幂等键的一半，而幂等键的唯一约束
  //    建在 action_runs 上 —— 执行中才产生的值当不了幂等键。
  inputSchema: {
    type: 'object',
    required: ['blog_post_id', 'content_hash'],
    properties: {
      blog_post_id: { type: 'string' },
      content_hash: { type: 'string' },
      note: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['package_id', 'content_hash'],
    properties: {
      package_id: { type: 'string' },
      content_hash: { type: 'string' },
      title: { type: 'string' },
      word_count: { type: 'number' },
    },
    additionalProperties: true,
  },

  capability: 'seo.publish_package_builder',
  risk: 'low',
  // 🔴 内部写。不碰客户网站、不碰商家页、不碰社媒、不花钱。
  sideEffect: 'internal_write',
  reversible: true,

  // 不是对外动作，所以不需要对外许可。**保持 null 就是保持「不放行对外」。**
  outwardAuthorization: null,

  // 同一篇稿子 + 同样的正文 → 同一把键 → 只会有一个 package。
  // 稿子改了 content_hash 就变，那是**另一件事**，该有另一个 package。
  idempotency: { keyFields: ['blog_post_id', 'content_hash'], scope: 'client' },

  // 纯内部组装，不调 LLM、不调外部 API
  costModel: { kind: 'fixed', estimate: () => 0 },

  // 🔴 根本不调外部 provider —— 所以「重试会不会重复收费」这个问题不成立。
  //    将来任何真调外部 API 的动作，必须逐个确认之后如实填 supported / unsupported。
  providerIdempotency: 'not_applicable',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 500 },

  // 🔴 验证不是可选项。没有它，「写入成功」就会被当成「事情做成了」。
  verification: { method: 'package_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  // 域阶段住在 step_key —— 不往 run 的 status 枚举里加值
  steps: ['build', 'persist', 'verify'],

  allowedPurposes: ['growth'],
}

/**
 * `ads.meta_boost_sandbox_reel` —— Kernel v1 的第一条 outward 动作
 * （ME2 广告中枢 v1，Build Control 木桶原则裁决）。
 *
 * ── 动作边界：只到「建成 PAUSED + 回读验证通过」，不含激活 ──────────────────
 * 🔴 这不是偷懒省了一步，是 Kernel v1 结构性要求的：`outward-authorization.ts`
 *    明文规定 `reversible !== true` 的对外动作**一律不放行**（"填 rollback
 *    不能替代 reversible：撤回路径写得再清楚，也改不了它自称撤不回来这个
 *    事实"）。真钱一旦花出去就撤不回来 —— 如果这个动作的范围包含"激活"，
 *    那么诚实地说它就是不可逆的，会被 outwardBlockReason 直接拒绝注册。
 *
 *    解法不是找借口声明 reversible:true（那是 Codex 复审 BLOCKER #5 点名
 *    的不诚实做法），而是把动作边界划在真正可逆的地方：guard（预留额度）→
 *    publish_paused（建成暂停态，$0 花费，可随时删掉）→ gate（回读验证）→
 *    link（记录归因，纯内部记账）。到这里为止，一切都能无痕撤销。
 *
 *    「激活」是一个**不属于这个 Kernel 动作**的独立操作 —— 跟 Build Control
 *    "M7 真实 Meta 写入继续冻结，另等 go Meta paused dry-run；真钱激活仍需
 *    再次独立 go" 的两道闸完全对应：本动作对应第一道闸（paused dry-run），
 *    激活是第二道闸，走独立的、不经过 Kernel 自动化策略引擎的人工确认
 *    （见 M6 的 approve/activate 两个不同的 API 路由）。
 *
 * ── 为什么 costModel 全 0 ────────────────────────────────────────────────
 * 这个动作从设计上就不花钱 —— 不是估算出来的 0，是**结构性**的 0：
 * 它做的每一件事（预留额度记录、建暂停广告、回读、记归因）都不产生 Meta
 * 账单。真花钱的那一步（激活）不在这个动作的步骤列表里。
 */
const ADS_META_BOOST_SANDBOX_REEL: ActionDefinition<'ads.meta_boost_sandbox_reel'> = {
  actionKey: 'ads.meta_boost_sandbox_reel',
  version: 1,
  title: '把一条 CTS 已发的帖子在 ME sandbox 建成暂停态广告（不激活）',

  inputSchema: {
    type: 'object',
    required: ['object_story_id', 'draft', 'draft_summary_hash', 'reservation_amount_nzd'],
    properties: {
      object_story_id: { type: 'string' },
      // 完整 AdDraft 形状；结构校验交给 validateDraft（capability 层），
      // 注册表的 JsonSchemaLike 不支持嵌套 schema，这里只做"是个对象"的粗校验。
      draft: { type: 'object' },
      draft_summary_hash: { type: 'string' },
      reservation_amount_nzd: { type: 'number' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['campaign_id', 'ad_set_id', 'creative_id', 'ad_id'],
    properties: {
      campaign_id: { type: 'string' },
      ad_set_id: { type: 'string' },
      creative_id: { type: 'string' },
      ad_id: { type: 'string' },
      deterministic_tag: { type: 'string' },
    },
    additionalProperties: true,
  },

  capability: 'ads.meta_boost_sandbox_publisher',
  risk: 'medium',
  // 🔴 建的对象真实存在于 Meta 后台（哪怕暂停），是真外部写，不是 internal_write。
  sideEffect: 'outward',
  // 诚实：到这个动作结束时（PAUSED + 已验证），什么都没花，可以无痕撤销。
  reversible: true,

  outwardAuthorization: {
    declaredIn: 'docs/adr/2026-08-20-me-ads-hub-v1-reversibility-recovery-contract.md',
    requiresHumanApproval: true,
    rollback: 'provider_native', // 删掉/保持暂停的 Meta 对象即撤回，零花费
  },

  // object_story_id + draft 摘要 → 同一条草案不会被重复建
  idempotency: { keyFields: ['object_story_id', 'draft_summary_hash'], scope: 'client' },

  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: { guard: 0, publish_paused: 0, gate: 0, link: 0 },
  },

  // 对外动作一定碰外部服务（Meta），Meta 的对象创建接口不认幂等键 ——
  // 重试可能建出重复的 campaign/adset/ad，所以一律不自动重试（fail closed）。
  providerIdempotency: 'unsupported',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },

  verification: { method: 'meta_ad_boost_readback', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  steps: ['guard', 'publish_paused', 'gate', 'link'],

  allowedPurposes: ['growth'],
}

const DEFINITIONS: Readonly<Record<ActionKey, ActionDefinition>> = {
  'seo.build_publish_package': SEO_BUILD_PUBLISH_PACKAGE,
  'ads.meta_boost_sandbox_reel': ADS_META_BOOST_SANDBOX_REEL,
}

export interface ActionRegistry {
  /** 认识这个 key 吗。认不出的一律 deny。 */
  has(actionKey: string): actionKey is ActionKey
  /** 拿定义。**认不出返回 null，绝不抛「大概是这个」的猜测。** */
  get(actionKey: string): ActionDefinition | null
  /** 全部已注册的 key —— 用来反向注入 agent prompt，把生成端也收成封闭词汇表。 */
  keys(): readonly ActionKey[]
}

export const ACTION_REGISTRY: ActionRegistry = {
  has(actionKey: string): actionKey is ActionKey {
    return Object.prototype.hasOwnProperty.call(DEFINITIONS, actionKey)
  },
  get(actionKey: string): ActionDefinition | null {
    return ACTION_REGISTRY.has(actionKey) ? DEFINITIONS[actionKey] : null
  },
  keys(): readonly ActionKey[] {
    return Object.keys(DEFINITIONS) as ActionKey[]
  },
}

export const ACTION_KEYS = Object.keys(DEFINITIONS) as readonly ActionKey[]

/**
 * 输入是否符合定义的 input_schema。
 *
 * 刻意只做**结构**校验（必填 + 类型 + 多余字段），不做业务校验 ——
 * 业务校验属于 capability，塞进这里会让注册表悄悄变成业务逻辑的存放地。
 */
export function validateAgainstSchema(
  schema: ActionDefinition['inputSchema'],
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: '输入必须是一个对象' }
  }
  const obj = value as Record<string, unknown>

  for (const key of schema.required ?? []) {
    if (obj[key] === undefined || obj[key] === null) {
      return { ok: false, reason: `缺少必填字段 ${key}` }
    }
  }

  for (const [key, spec] of Object.entries(schema.properties)) {
    const v = obj[key]
    if (v === undefined || v === null) continue
    const actual = Array.isArray(v) ? 'array' : typeof v
    if (actual !== spec.type) {
      return { ok: false, reason: `字段 ${key} 应该是 ${spec.type}，实际是 ${actual}` }
    }
  }

  if (schema.additionalProperties === false) {
    const extra = Object.keys(obj).filter((k) => !(k in schema.properties))
    if (extra.length > 0) {
      return { ok: false, reason: `多了没定义的字段：${extra.join('、')}` }
    }
  }

  return { ok: true }
}
