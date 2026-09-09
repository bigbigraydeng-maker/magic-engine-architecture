import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertAudioDurationsProvided, submitRender, getRender } from './render'
import type { CreatomateTemplateContract } from './types'

const mockCreatomateFetch = vi.fn()
vi.mock('./client', () => ({ creatomateFetch: (...args: unknown[]) => mockCreatomateFetch(...args) }))

beforeEach(() => mockCreatomateFetch.mockReset())

// 坑#2（spec §5）：官方文档没写的静默失败——audio 元素不给 duration 会把全片
// 时长撑成那首歌的长度。这是唯一进代码的坑，其余 4 个是模板设计阶段的事。
describe('assertAudioDurationsProvided', () => {
  const contract: CreatomateTemplateContract = {
    templateId: 'tmpl-1',
    sceneFieldMap: [],
    audioKeys: ['Music-1'],
  }

  it('声明的音频 key 出现在 modifications 里但没给 duration → 拒绝', () => {
    expect(() =>
      assertAudioDurationsProvided({ 'Music-1': 'https://cdn/song.mp3' }, contract),
    ).toThrow(/Music-1.*duration/)
  })

  it('给了 duration 就放行', () => {
    expect(() =>
      assertAudioDurationsProvided(
        { 'Music-1': 'https://cdn/song.mp3', 'Music-1.duration': '30' },
        contract,
      ),
    ).not.toThrow()
  })

  it('这次渲染压根没碰这个音频 key（没在 modifications 里）→ 不校验，不误伤', () => {
    expect(() => assertAudioDurationsProvided({}, contract)).not.toThrow()
  })

  it('模板没声明 audioKeys → 什么都不查', () => {
    const noAudio: CreatomateTemplateContract = { templateId: 'tmpl-1', sceneFieldMap: [] }
    expect(() => assertAudioDurationsProvided({ 'Music-1': 'x' }, noAudio)).not.toThrow()
  })
})

describe('submitRender / getRender — 解析真实 render 对象形状', () => {
  const contract: CreatomateTemplateContract = { templateId: 'tmpl-1', sceneFieldMap: [] }

  it('submitRender 校验通过后提交，从响应体解出 renderId', async () => {
    mockCreatomateFetch.mockResolvedValueOnce({ id: 'render-abc', status: 'planned' })
    const { renderId } = await submitRender({ templateId: 'tmpl-1', modifications: {} }, contract)
    expect(renderId).toBe('render-abc')
    expect(mockCreatomateFetch).toHaveBeenCalledWith('/renders', {
      method: 'POST',
      body: { template_id: 'tmpl-1', modifications: {} },
    })
  })

  it('submitRender 音频坑校验失败时压根不发请求', async () => {
    const withAudio: CreatomateTemplateContract = { templateId: 'tmpl-1', sceneFieldMap: [], audioKeys: ['Music-1'] }
    await expect(
      submitRender({ templateId: 'tmpl-1', modifications: { 'Music-1': 'x' } }, withAudio),
    ).rejects.toThrow(/duration/)
    expect(mockCreatomateFetch).not.toHaveBeenCalled()
  })

  it('getRender 解析 succeeded 状态 + url', async () => {
    mockCreatomateFetch.mockResolvedValueOnce({ id: 'render-abc', status: 'succeeded', url: 'https://cdn.creatomate.com/x.mp4' })
    const r = await getRender('render-abc')
    expect(r).toEqual({ id: 'render-abc', status: 'succeeded', url: 'https://cdn.creatomate.com/x.mp4', errorMessage: undefined })
  })

  it('响应缺 id/status 或 status 不在合法枚举里 → 明确报错，不悄悄当成某个默认状态', async () => {
    mockCreatomateFetch.mockResolvedValueOnce({ status: 'succeeded' }) // 缺 id
    await expect(getRender('render-x')).rejects.toThrow(/render 对象形状|id\/status/)

    mockCreatomateFetch.mockResolvedValueOnce({ id: 'render-x', status: 'not_a_real_status' })
    await expect(getRender('render-x')).rejects.toThrow(/id\/status/)
  })
})
