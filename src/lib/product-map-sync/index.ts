/** ME2 Product Map GitHub 只读同步层 —— facade。 */

export * from './types'
export type { GithubReadProvider } from './provider'
export { GithubRestProvider } from './github-rest-provider'
export { SupabaseSyncStore } from './store'
export type { ProductMapSyncStore, DeliveryClaim, SummaryWrite, ProgressSnapshotWrite } from './store'
export { runFullSync, runTargetedSync } from './runner'
export type { SyncRunResult } from './runner'
export { rowsToExternalFacts } from './facts-adapter'
export type { SyncedFacts } from './facts-adapter'
export { extractComponentMarkers, isUnclassified } from './marker'
export { NullSummaryGenerator, AnthropicSummaryGenerator, containsForbiddenStatusWord } from './summary-generator'
export type { SummaryGenerator } from './summary-generator'
