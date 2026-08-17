/**
 * Magic Engine 2.0 · 台账落库适配器（Issue #930 · WP —— store adapter）
 *
 * ⚠️ 本模块只被将来单独授权的 `go 写入` 调用方 import，没有任何 route / cron / UI 接它。
 *    它实现 `canonical-inventory` 的 `CanonicalInventoryStore`，被 `activateReviewedPlan()`
 *    通过 `createActivationDeps({ store })` 注入。
 */

export {
  ClientSitePagesInventoryStore,
  InventoryStoreError,
  createInventoryStore,
  CRAWL_STATUS_CRAWLED,
  TABLE_SITE_PAGES,
  type InventoryStoreOptions,
} from './store'
