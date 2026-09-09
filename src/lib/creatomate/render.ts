// 提交渲染 / 查询状态。Spec §4.4：submitRender 是付费步骤，调用方必须包在不可重试
// 的 Inngest step 里（retries:0）——这个函数本身不做幂等判断，幂等判断是调用方
// （job 行有没有 creatomate_render_id）的责任，不是这个连接器的责任。
import { creatomateFetch } from './client'
import type { CreateRenderParams, CreatomateRender, CreatomateRenderStatus, CreatomateTemplateContract } from './types'

/**
 * 坑#2（spec §5）：音频元素缺 duration 会把全片时长撑爆。连接器不认识具体客户的模板
 * 结构，只按 factory_config 声明的 audioKeys 校验——这些 key 若出现在 modifications
 * 里，必须同时给 `${key}.duration`（Creatomate 的 dot-path 属性覆盖写法），否则拒绝提交。
 *
 * ⚠️ dot-path 属性名（`.duration`）官方文档没有逐字确认，是按 Creatomate 通用的
 * element.property 覆盖约定推断的——上线前必须走一次真实渲染验证（spec §5 渲染验证铁律），
 * 不能只信这段代码编译通过。
 */
export function assertAudioDurationsProvided(
  modifications: Record<string, string>,
  contract: CreatomateTemplateContract,
): void {
  for (const key of contract.audioKeys ?? []) {
    if (!(key in modifications)) continue
    const durationKey = `${key}.duration`
    if (!(durationKey in modifications)) {
      throw new Error(
        `音频元素「${key}」缺少 duration（${durationKey}）——不给会把整片时长撑成这段音乐的长度（已知坑，见 spec §5 坑#2）`,
      )
    }
  }
}

export async function submitRender(
  params: CreateRenderParams,
  contract: CreatomateTemplateContract,
): Promise<{ renderId: string }> {
  assertAudioDurationsProvided(params.modifications, contract)

  const body = await creatomateFetch('/renders', {
    method: 'POST',
    body: {
      template_id: params.templateId,
      modifications: params.modifications,
      ...(params.webhookUrl ? { webhook_url: params.webhookUrl } : {}),
    },
  })

  const render = parseRender(body)
  return { renderId: render.id }
}

export async function getRender(renderId: string): Promise<CreatomateRender> {
  const body = await creatomateFetch(`/renders/${encodeURIComponent(renderId)}`, { method: 'GET' })
  return parseRender(body)
}

const VALID_STATUSES: readonly CreatomateRenderStatus[] = [
  'planned', 'waiting', 'transcribing', 'rendering', 'succeeded', 'failed', 'cancelled',
]

function parseRender(body: unknown): CreatomateRender {
  // POST 提交时官方响应是单个对象；不排除未来返回数组包裹，两种都兜住。
  const raw = Array.isArray(body) ? body[0] : body
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Creatomate 响应不是预期的 render 对象形状')
  }
  const r = raw as Record<string, unknown>
  const id = r.id
  const status = r.status
  if (typeof id !== 'string' || typeof status !== 'string' || !VALID_STATUSES.includes(status as CreatomateRenderStatus)) {
    throw new Error(`Creatomate 响应缺少合法的 id/status 字段：${JSON.stringify(r).slice(0, 200)}`)
  }
  return {
    id,
    status: status as CreatomateRenderStatus,
    url: typeof r.url === 'string' ? r.url : undefined,
    errorMessage: typeof r.error_message === 'string' ? r.error_message : undefined,
  }
}
