/**
 * ⚠️ 已知的临时止血方案，不是客户配置层的正式入口。⚠️
 *
 * 背景（2026-09-13）：`brief.ts` 的系统提示词曾经把 CTS Tours New Zealand 的具体商业
 * 事实（25 年历史、免签政策、支持电话）写死成对所有客户通用的规则，结果物流客户 New
 * Asian Logistics 的私信摘要也被套上了这套 CTS 身份和事实（详见 2026-09-13 事故记录）。
 * 这次修复把身份本身改成从 `clients.name` 动态读取（不再写死任何客户），但 CTS 这几条
 * "draft_reply 可以引用的真实商业事实" 目前没有别处可读——真正的解法是客户知识库项目
 * （见 docs/history 里 project-client-knowledge-base-capability 那次拍板），本文件只是
 * 在knowledge base 上线前，让 CTS 的摘要质量不因为这次改动而倒退。
 *
 * 硬性限制（子牙 2026-09-13 设计复审要求）：
 *   1. 只允许 CTS 这一行存在于此文件。新增第二个客户前，必须先跑一遍
 *      `.claude/skills/me-platform-tier-gate/` 判层级——如果批复通过，说明客户知识库
 *      项目已经可以承接这类事实，本文件本身就该被替换掉，而不是继续往里加行。
 *   2. 这里只允许放"draft_reply 可以引用的、狭义的商业事实"，不允许放行业打法、
 *      话术模板、竞品信息——那些属于 Industry Playbook，不属于这张表。
 */

/** CTS Tours New Zealand 在 clients 表里的固定 ID（本仓库多处既有代码同样直接写死这个值）。 */
const CTS_TOURS_NZ_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

export interface ClientBriefFacts {
  /** draft_reply 可以陈述为真的事实。除此以外的具体事实一律不许模型断言。 */
  facts: string[]
  /** 已知容易被模型说错的点：错误说法 + 应该怎么说。 */
  neverClaim: { wrong: string; insteadSay: string }[]
  supportPhone?: string
  supportEmail?: string
}

export const CLIENT_BRIEF_FACTS: Readonly<Record<string, ClientBriefFacts>> = {
  [CTS_TOURS_NZ_CLIENT_ID]: {
    facts: [
      'This business has operated in New Zealand for 25 years.',
      'New Zealand passport holders can enter China visa-free for up to 30 days, until 31 December 2026. Do not state any other figure.',
    ],
    neverClaim: [
      {
        wrong: '"since 1928", "in Auckland since 1928", or "New Zealand\'s oldest"',
        insteadSay:
          '1928 belongs to the China Travel Service group in China, not this New Zealand business — never state it as this company\'s own founding year.',
      },
    ],
    supportPhone: '0800 287 888',
    supportEmail: 'info@ctstours.co.nz',
  },
}
