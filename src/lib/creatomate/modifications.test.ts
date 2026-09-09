import { describe, it, expect } from 'vitest'
import { buildModifications } from './modifications'
import type { PreparedScene } from './scene-assets'
import type { CreatomateTemplateContract } from './types'

function scene(overrides: Partial<PreparedScene> = {}): PreparedScene {
  return {
    index: 0,
    captionText: '标题字',
    visualUrl: 'https://cdn.example.com/clip.mp4',
    visualType: 'video',
    voUrl: 'https://cdn.example.com/vo.mp3',
    costUsd: 0.3,
    ...overrides,
  }
}

describe('buildModifications', () => {
  it('按 sceneFieldMap 把镜头结果映射成 Creatomate modifications', () => {
    const contract: CreatomateTemplateContract = {
      templateId: 'tmpl-1',
      sceneFieldMap: [
        { visual: 'Video-1', caption: 'Caption-1', voice: 'Voice-1' },
        { visual: 'Video-2', caption: 'Caption-2' },
      ],
    }
    const scenes = [
      scene({ index: 0, visualUrl: 'https://cdn/a.mp4', captionText: 'A', voUrl: 'https://cdn/a.mp3' }),
      scene({ index: 1, visualUrl: 'https://cdn/b.mp4', captionText: 'B' }),
    ]

    const mods = buildModifications(scenes, contract)

    expect(mods).toEqual({
      'Video-1': 'https://cdn/a.mp4',
      'Caption-1': 'A',
      'Voice-1': 'https://cdn/a.mp3',
      'Video-2': 'https://cdn/b.mp4',
      'Caption-2': 'B',
    })
  })

  it('镜头槽位未声明 caption/voice 时不写入这两个 key（不是写空字符串）', () => {
    const contract: CreatomateTemplateContract = {
      templateId: 'tmpl-1',
      sceneFieldMap: [{ visual: 'Video-1' }],
    }
    const mods = buildModifications([scene()], contract)
    expect(mods).toEqual({ 'Video-1': scene().visualUrl })
    expect(mods).not.toHaveProperty('Caption-1')
  })

  it('分镜数超过模板槽位数 → 拒绝，不静默丢弃多出来的镜头', () => {
    const contract: CreatomateTemplateContract = {
      templateId: 'tmpl-1',
      sceneFieldMap: [{ visual: 'Video-1' }],
    }
    const scenes = [scene({ index: 0 }), scene({ index: 1 })]
    expect(() => buildModifications(scenes, contract)).toThrow(/2 段.*1 个/)
  })
})
