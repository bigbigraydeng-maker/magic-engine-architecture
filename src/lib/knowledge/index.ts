/**
 * Client Knowledge Base — public surface.
 *
 * Step 1/6 (Issue #1643): `detectSensitivity` / `resolveSensitivity`.
 * Step 2/6 (Issue #1644, this module): tables + read entry point + entitlement gate.
 */

export * from './sensitivity'
export * from './types'
export * from './fingerprint'
export * from './errors'
export { getKnowledgeEntitlement, KNOWLEDGE_READ_ACTION_KEY } from './entitlement'
export type { GetKnowledgeEntitlementDeps } from './entitlement'
export { getClientKnowledge } from './read'
export type { GetClientKnowledgeDeps } from './read'
