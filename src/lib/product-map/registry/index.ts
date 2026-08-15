/**
 * 登记册总装 —— 各泳道文件合并、深冻结后导出。
 *
 * 🔴 漏 import 一个泳道文件,总数断言可能仍然过 —— 所以 registry.test 按泳道
 *    分别断言最小组件数,漏一个泳道立刻红。
 *
 * 🔴 泳道文件逼近 800 行时的拆法（先写在这,免得到时候拍脑袋）：
 *    按 componentType 再切一刀,如 shared-platform.ts / shared-adapters.ts,
 *    本文件仍是唯一总装点。
 */

import type { ProductMapComponent } from '../types'
import { ADS_COMPONENTS } from './ads'
import { GEO_COMPONENTS } from './geo'
import { SEO_COMPONENTS } from './seo'
import { SHARED_COMPONENTS } from './shared'
import { SOCIAL_COMPONENTS } from './social'

/** Object.freeze 是浅冻结,证据数组内层照样可变 —— 这里递归冻到底。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

export const PRODUCT_MAP_COMPONENTS: readonly ProductMapComponent[] = deepFreeze([
  ...SHARED_COMPONENTS,
  ...GEO_COMPONENTS,
  ...SEO_COMPONENTS,
  ...SOCIAL_COMPONENTS,
  ...ADS_COMPONENTS,
])
