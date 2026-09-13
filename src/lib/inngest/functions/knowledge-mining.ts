/**
 * Client knowledge base — mining trigger (design §3.2/§9.14-E.3).
 *
 * v1 is manually triggered per client (design §4: "萃取工作流：只接
 * Messenger 对话、手动触发、首个试点客户") — there is no cron here. A step
 * 4 admin action (the FDE review page) sends this event; this function has
 * no opinion about who is allowed to trigger it, that's the sender's job.
 *
 * Runs as its own Inngest function (not inline in an API route) because it
 * makes an unbounded-in-time series of external LLM calls and writes —
 * exactly the "跨步骤异步接力 + 外部副作用" case CLAUDE.md's Inngest rule
 * covers, and because a request handler has a much shorter timeout than a
 * mining pass over months of conversation history could need.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { runKnowledgeMining, MiningBudget } from '@/lib/knowledge/mining'

export const KNOWLEDGE_MINING_REQUESTED_EVENT = 'knowledge.mining.requested'

/**
 * Conservative, fixed v1 default — there is no per-client override surface
 * yet (that belongs with the review UI in a later step, not invented here
 * ahead of any real need). Chosen to keep a single run cheap even against a
 * client with a long conversation history: at $0.02-ish per call (see
 * `estimateWorstCaseExtractionCostUsd`), 200 calls is roughly $4, under the
 * $5 spend cap with headroom for actual costs running a bit above estimate.
 */
export const DEFAULT_MINING_BUDGET: MiningBudget = {
  maxMessages: 2000,
  maxModelCalls: 200,
  maxSpendUsd: 5,
}

export const knowledgeMiningRequested = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}knowledge-mining-requested`,
    // A setup failure (bad budget, can't read messages) is not transient —
    // it fails the same way again. An Inngest-level retry would re-run the
    // whole pass from scratch and re-spend LLM budget on messages already
    // extracted in the failed attempt (runKnowledgeMining's own internal
    // failure handling already records a receipt without throwing for
    // anything mid-loop, so what reaches Inngest is only the non-retryable
    // kind). Zero retries here, not the framework default.
    retries: 0,
    concurrency: { limit: 1, key: 'event.data.client_id' },
  },
  { event: KNOWLEDGE_MINING_REQUESTED_EVENT },
  async ({ event, step }) => {
    const clientId = event.data.client_id as string
    if (!clientId) throw new Error('knowledge.mining.requested event missing client_id')

    const receipt = await step.run('run-mining', () => runKnowledgeMining(clientId, DEFAULT_MINING_BUDGET))
    return { client_id: clientId, ...receipt, no_execute: true }
  },
)
