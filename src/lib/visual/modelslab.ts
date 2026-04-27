// ModelsLab Image Generation Client
// $29/月无限量，支持 Flux 等 10,000+ 模型

const MODELSLAB_BASE = 'https://modelslab.com/api/v6'
const API_KEY = process.env.MODELSLAB_API_KEY!

export interface ImageGenerationResult {
  image_url: string
  provider_id: string
  cost_usd: number
}

export async function generateImage(params: {
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
}): Promise<ImageGenerationResult> {
  const {
    prompt,
    negative_prompt = 'blurry, low quality, watermark, text overlay',
    width = 1024,
    height = 1024,
  } = params

  const res = await fetch(`${MODELSLAB_BASE}/realtime/text2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: API_KEY,
      prompt,
      negative_prompt,
      width: String(width),
      height: String(height),
      samples: '1',
      safety_checker: false,
      enhance_prompt: true,
    }),
  })

  if (!res.ok) throw new Error(`ModelsLab error: ${res.status}`)

  const data = await res.json()

  if (data.status === 'error') {
    throw new Error(`ModelsLab generation failed: ${data.message}`)
  }

  const imageUrl = data.output?.[0] || data.proxy_links?.[0]
  if (!imageUrl) throw new Error('No image URL in ModelsLab response')

  return {
    image_url: imageUrl,
    provider_id: data.id || String(Date.now()),
    cost_usd: 0.002,
  }
}

export async function generateSocialImages(visualBrief: string): Promise<{
  square: ImageGenerationResult
  portrait: ImageGenerationResult
  landscape: ImageGenerationResult
}> {
  const prompt = `${visualBrief}, professional photography, vibrant colors, social media optimized`

  const [square, portrait, landscape] = await Promise.all([
    generateImage({ prompt, width: 1024, height: 1024 }),
    generateImage({ prompt, width: 576, height: 1024 }),
    generateImage({ prompt, width: 1024, height: 576 }),
  ])

  return { square, portrait, landscape }
}
