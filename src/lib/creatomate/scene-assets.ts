// 场景素材准备（spec §4.3a）——不是新生成逻辑，是把 render-pipeline.ts/broll-clip.ts
// 已有的无状态函数按新顺序编排一次，喂给 Creatomate 当 modifications 的数据源。
// Creatomate 只取代 render-assemble.ts 的 ffmpeg 拼接，不取代这一层。
//
// 唯一新增的判断：用 classifyRenderMode()（PR #1373，此前零调用方）决定每个镜头
// 走 i2v 还是真实像素——这一步本身也花钱（gpt-image 出图 + 视判断结果决定要不要
// 追加 i2v + 配音），是跟 Creatomate 提交独立的一笔外部花费，调用方必须按 spec §4.4
// 的规则把这一步也包进不可重试的 step。
import { planScenes, type Scene } from '@/lib/factory/scene-plan'
import { classifyRenderMode } from '@/lib/factory/shot-guards'
import { imageToClip } from '@/lib/factory/broll-clip'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { generateVoiceover } from '@/lib/audio/minimax-voice'

export interface PreparedScene {
  index: number
  captionText: string
  visualUrl: string
  visualType: 'image' | 'video'
  voUrl: string
  costUsd: number
}

/** 复用 render-pipeline.ts 同款读法（clients.factory_config.render.voice_id），刻意不 import
 *  render-pipeline.ts 本身——那个文件保持不动、不被这条新路径依赖（spec §4.1 的边界）。 */
function resolveVoiceId(factoryConfig: unknown): string {
  const v = (factoryConfig as { render?: { voice_id?: string } } | null)?.render?.voice_id
  if (!v || typeof v !== 'string') {
    throw new Error('该客户未配置配音声音（clients.factory_config.render.voice_id）')
  }
  return v
}

async function prepareOneScene(
  clientId: string,
  jobId: string,
  voiceId: string,
  scene: Scene,
): Promise<PreparedScene> {
  const decision = classifyRenderMode(scene.imagePrompt)
  const folder = `render/${jobId}`

  const [visual, vo] = await Promise.all([
    (async (): Promise<{ url: string; type: 'image' | 'video'; costUsd: number }> => {
      const { b64 } = await generateImage({ prompt: scene.imagePrompt, aspect_ratio: '9:16' })
      const img = await uploadFromBase64({ base64: b64, clientId, assetType: 'image', folder })

      if (decision.mode === 'real_pixel') {
        return { url: img.storage_url, type: 'image', costUsd: 0 }
      }
      const clip = await imageToClip({
        clientId,
        imageUrl: img.storage_url,
        motionPrompt: scene.motionPrompt,
        folder,
      })
      return { url: clip.clipUrl, type: 'video', costUsd: clip.costUsd }
    })(),
    generateVoiceover({ clientId, text: scene.voText, voiceId, folder }),
  ])

  return {
    index: scene.index,
    captionText: scene.captionText,
    visualUrl: visual.url,
    visualType: visual.type,
    voUrl: vo.audioUrl,
    costUsd: visual.costUsd + (vo.costUsd ?? 0),
  }
}

/** 分镜 → 逐镜出画面（按 classifyRenderMode 判断走 i2v 还是真实像素）+ 配音。段间串行，
 *  控成本/并发（对齐 render-pipeline.ts 现有节奏，不是新规矩）。 */
export async function prepareSceneAssets(params: {
  clientId: string
  jobId: string
  title: string
  script: string
  factoryConfig: unknown
}): Promise<PreparedScene[]> {
  const { clientId, jobId, title, script, factoryConfig } = params
  const voiceId = resolveVoiceId(factoryConfig)
  const { scenes } = await planScenes({ clientId, title, script })

  const prepared: PreparedScene[] = []
  for (const scene of scenes) {
    prepared.push(await prepareOneScene(clientId, jobId, voiceId, scene))
  }
  return prepared
}
