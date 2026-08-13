/**
 * K-WP01A —— capability tier 闸。
 *
 * 🔴 **这道闸单独直测，不靠前一道闸遮着。**
 *
 *    线上 `requirePaidClientAccess` 已经把 `self_serve` / `portal_only` 挡在门外，
 *    所以「self_serve 批不了东西」这件事，光靠走一遍接口是**测不出来**的 ——
 *    红的会是前一道闸，而这一道就算整个删掉也照样全绿。
 *    那正是遮蔽闸的温床：哪天前面那道放宽了，这里就是唯一一道，
 *    而它从来没有被验证过。
 *
 *    所以下面直接对着 `canAuthorizeAction` 逐档过一遍。
 */

import { describe, it, expect } from 'vitest'
import type { ActionRun } from '@/lib/kernel/types'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { ApprovalError } from '../errors'
import { canAuthorizeAction, assertActorMayAuthorize } from '../service'

const ALL_REQUIRED_TIERS = ['admin', 'paid_client', 'self_serve', 'portal_only'] as const

function fakeRun(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: 'run-1',
    client_id: 'client-a',
    action_key: 'seo.build_publish_package',
    action_version: 1,
    status: 'pending_approval',
    ...overrides,
  } as ActionRun
}

describe('canAuthorizeAction · 冻结判定', () => {
  it('admin 能授权任何门槛的动作', () => {
    for (const required of ALL_REQUIRED_TIERS) {
      expect(canAuthorizeAction('admin', required), `admin → ${required}`).toBe(true)
    }
  })

  it('paid_client 能授权门槛不是 admin 的动作', () => {
    expect(canAuthorizeAction('paid_client', 'paid_client')).toBe(true)
    expect(canAuthorizeAction('paid_client', 'self_serve')).toBe(true)
    expect(canAuthorizeAction('paid_client', 'portal_only')).toBe(true)
  })

  it('🔴 paid_client 授权不了门槛为 admin 的动作', () => {
    expect(canAuthorizeAction('paid_client', 'admin')).toBe(false)
  })

  it('🔴 self_serve 一律不许授权（连门槛最低的都不行）', () => {
    for (const required of ALL_REQUIRED_TIERS) {
      expect(canAuthorizeAction('self_serve', required), `self_serve → ${required}`).toBe(false)
    }
  })

  it('🔴 portal_only 一律不许授权', () => {
    for (const required of ALL_REQUIRED_TIERS) {
      expect(canAuthorizeAction('portal_only', required), `portal_only → ${required}`).toBe(false)
    }
  })

  it('🔴 认不出的档次 fail closed —— 加一个新档次忘了分类，默认是「不许」', () => {
    for (const unknown of ['', 'superuser', 'ADMIN', 'admin ', 'fde', 'both', 'client']) {
      expect(canAuthorizeAction(unknown, 'paid_client'), `未知档次「${unknown}」`).toBe(false)
    }
  })
})

describe('assertActorMayAuthorize', () => {
  it('付费客户可以授权注册表里门槛为 paid_client 的动作', () => {
    expect(ACTION_REGISTRY.get('seo.build_publish_package')!.requiredCapabilityTier).toBe(
      'paid_client',
    )
    expect(() => assertActorMayAuthorize(fakeRun(), 'paid_client')).not.toThrow()
    expect(() => assertActorMayAuthorize(fakeRun(), 'admin')).not.toThrow()
  })

  it('🔴 self_serve / portal_only 拿到 403 forbidden_tier', () => {
    for (const tier of ['self_serve', 'portal_only'] as const) {
      const err = (() => {
        try {
          assertActorMayAuthorize(fakeRun(), tier)
          return null
        } catch (e) {
          return e
        }
      })()
      expect(err, `${tier} 必须被拒`).toBeInstanceOf(ApprovalError)
      expect((err as ApprovalError).code).toBe('forbidden_tier')
      expect((err as ApprovalError).status).toBe(403)
    }
  })

  it('🔴 契约升过版 → 旧请求不许拿新版的规则来批（fail closed）', () => {
    // 🔴 注册表只存**当前**这一版。旧 run 按 action_key 是查得到定义的 ——
    //    查到的是新版。真实后果有两层：
    //      · 权限：requiredCapabilityTier 按新版判。旧版要 admin、新版降成
    //        paid_client 的话，一条本该只有内部人能批的旧动作就对付费客户开了；
    //      · 展示：把新版标题 / 风险 / 副作用贴在一条旧请求上。
    //    Kernel 的 preflight 早就在判这一条，审批路径没理由更松。
    const current = ACTION_REGISTRY.get('seo.build_publish_package')!
    const oldVersionRun = fakeRun({ action_version: current.version + 1 })

    for (const tier of ['admin', 'paid_client'] as const) {
      const err = (() => {
        try {
          assertActorMayAuthorize(oldVersionRun, tier)
          return null
        } catch (e) {
          return e
        }
      })()
      expect(err, `${tier} 也不许批一条版本对不上的请求`).toBeInstanceOf(ApprovalError)
      expect((err as ApprovalError).code).toBe('forbidden_tier')
      expect((err as ApprovalError).detail.reason).toBe('unknown_action_version')
    }
  })

  it('✅ 版本对得上时照常放行（判据不是把所有人都拦掉）', () => {
    const current = ACTION_REGISTRY.get('seo.build_publish_package')!
    expect(() =>
      assertActorMayAuthorize(fakeRun({ action_version: current.version }), 'paid_client'),
    ).not.toThrow()
  })

  it('🔴 注册表认不出这个动作 → 谁也批不了（fail closed，不是「先批了再说」）', () => {
    const err = (() => {
      try {
        assertActorMayAuthorize(fakeRun({ action_key: 'geo.rewrite_the_whole_site' }), 'admin')
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('forbidden_tier')
    expect((err as ApprovalError).detail.reason).toBe('unknown_action')
  })
})
