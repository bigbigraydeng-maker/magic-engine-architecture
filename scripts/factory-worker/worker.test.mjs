// #1218 回归测试 — resolveCopy() 本地 angle 兜底不许把非-hook 段全填成同一句品牌线
// (CTS work order 7c2809e1 实测:8 段字幕,hook 之后 7 段全复读同一句 tagline)。
// 只测纯函数,不跑 main() 主循环(worker.mjs 入口已加 import.meta.url 守卫)。

import { describe, expect, it } from 'vitest'
import { buildClaimBody, buildSrt, claimMatchesTarget, resolveCopy } from './worker.mjs'

const ROLES = ['hook', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle', 'cta']
const WO = {
  angle: 'Expertise & Heritage Stories',
  brief: { segments: ROLES.map((role) => ({ role })) },
}

describe('buildClaimBody — 可选单客户 claim', () => {
  it('配置目标客户 → claim 请求带 client_id', () => {
    expect(buildClaimBody('mac-1', 'client-1')).toEqual({ worker_id: 'mac-1', client_id: 'client-1' })
  })

  it('未配置目标客户 → 仍显式发送空值,由服务端 fail-closed', () => {
    expect(buildClaimBody('mac-1', '')).toEqual({ worker_id: 'mac-1', client_id: '' })
  })

  it('只接受目标客户响应', () => {
    expect(claimMatchesTarget({ client_id: 'client-1' }, 'client-1')).toBe(true)
    expect(claimMatchesTarget({ client_id: 'client-2' }, 'client-1')).toBe(false)
    expect(claimMatchesTarget({}, 'client-1')).toBe(false)
  })
})

describe('resolveCopy — #1218 angle 兜底不许满屏复读', () => {
  it('brief.copy 缺失 → 只在 hook 带一次 angle,所有非-hook 段留空', () => {
    const copy = resolveCopy(WO)
    expect(copy.segments).toHaveLength(8)
    expect(copy.segments[0]).toEqual({ role: 'hook', title_sub: WO.angle }) // hook 允许
    for (let i = 1; i < 8; i++) {
      expect(copy.segments[i]).toEqual({ role: ROLES[i] }) // middle×6 + cta 全部留空
    }
  })

  it('brief.copy.segments 已存在(后端生成成功)→ 原样返回,不套本地兜底', () => {
    const backendCopy = {
      segments: [
        { role: 'hook', title_main: 'CTS TOURS', title_sub: 'Expertise & Heritage Stories' },
        { role: 'middle', caption: 'Small group, big stories' },
      ],
      endcard: { cta: 'Enquire now', offer: [], url: 'ctstours.co.nz' },
    }
    const wo = { angle: 'x', brief: { segments: [{ role: 'hook' }, { role: 'middle' }], copy: backendCopy } }
    const copy = resolveCopy(wo)
    expect(copy).toBe(backendCopy)
  })
})

describe('buildSrt — 空 caption 的段落不许在字幕里复读兜底文案', () => {
  it('#1218 修复后:8 段里只有 hook 有字幕,所有 middle + cta 不出字幕行', () => {
    const copy = resolveCopy(WO)
    const segments = ROLES.map(() => ({ duration_hint_s: 2 }))
    const srt = buildSrt(segments, copy)
    const blocks = srt.trim().split('\n\n').filter(Boolean)
    expect(blocks).toHaveLength(1) // 只有 hook 段产出字幕
    expect(srt).toContain(WO.angle)
    // 品牌线只允许作为 hook 出现 1 次,不得落入 middle/cta
    const occurrences = srt.split(WO.angle).length - 1
    expect(occurrences).toBe(1)
  })

  it('修复前的旧行为(对照组):angle 塞满每个非-hook 段 → 会复读 7 次,证明测试确实在盯这个问题', () => {
    const buggyCopy = {
      segments: ROLES.map((role, i) => ({
        role,
        ...(i === 0 ? { title_sub: WO.angle } : { caption: WO.angle }),
      })),
    }
    const segments = ROLES.map(() => ({ duration_hint_s: 2 }))
    const srt = buildSrt(segments, buggyCopy)
    const occurrences = srt.split(WO.angle).length - 1
    expect(occurrences).toBe(8) // 旧 bug:8 段全复读同一句
  })
})
