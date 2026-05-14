/**
 * 鲁班 Lǔ Bān — 工具层（P8.12.S3.1）
 *
 * buildLubanTools(ctx) 返回 Anthropic 工具定义 + handler 映射，注入 callClaudeWithTools。
 * 首个工具 add_work_log：鲁班自主把对话结论写进 execution_logs
 * （等价于前端「存为工作记录」按钮，但由鲁班主动触发，FDE 不用手动点）。
 *
 * 后续 connector/skill（generate_content / check_local_compliance 等）在此扩展。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import type { ExecutionLogKind } from '@/types/diagnostic'

export interface LubanToolContext {
  supabase: SupabaseClient
  itemId: string
  clientId: string
}

export interface LubanToolset {
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
}

// add_work_log 可写的日志类型 — 与 /execution/[itemId]/log route 的 ALLOWED_KINDS 保持一致
// （status_change / adjustment 由系统写，不开放给鲁班）
const ADD_WORK_LOG_KINDS: ExecutionLogKind[] = ['note', 'blocker', 'ai_assist']

const ADD_WORK_LOG_TOOL: Anthropic.Tool = {
  name: 'add_work_log',
  description:
    '把一条工作记录写入当前执行项的工作日志。当你和 FDE 达成一个明确结论、产出可落地的草稿、或 FDE 报告了一个卡点时，主动调用它沉淀下来——不用等 FDE 开口。content 用中文，简洁记录「做了什么 / 结论是什么 / 卡点是什么」。',
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: {
        type: 'string',
        enum: ['note', 'blocker', 'ai_assist'],
        description: 'note=进度记录或结论；blocker=FDE 报告的卡点；ai_assist=你产出的可用草稿。',
      },
      content: {
        type: 'string',
        description: '工作记录正文，中文，简洁。',
      },
    },
    required: ['kind', 'content'],
  },
}

function isAddWorkLogInput(input: unknown): input is { kind: string; content: string } {
  if (typeof input !== 'object' || input === null) return false
  const o = input as Record<string, unknown>
  return typeof o.kind === 'string' && typeof o.content === 'string'
}

/**
 * 构建鲁班工具集 — handler 闭包捕获 supabase / itemId / clientId。
 */
export function buildLubanTools(ctx: LubanToolContext): LubanToolset {
  return {
    tools: [ADD_WORK_LOG_TOOL],
    handlers: {
      add_work_log: async (input: unknown): Promise<string> => {
        if (!isAddWorkLogInput(input)) {
          return 'add_work_log 调用失败：需要 { kind: string, content: string }。'
        }
        const kind: ExecutionLogKind = ADD_WORK_LOG_KINDS.includes(input.kind as ExecutionLogKind)
          ? (input.kind as ExecutionLogKind)
          : 'note'
        const content = input.content.trim()
        if (!content) {
          return 'add_work_log 调用失败：content 不能为空。'
        }

        const { error } = await ctx.supabase
          .from('execution_logs')
          .insert({
            execution_item_id: ctx.itemId,
            client_id:         ctx.clientId,
            author:            'luban',
            kind,
            content,
            meta:              null,
          })

        if (error) {
          return `add_work_log 写入失败：${error.message}`
        }
        const preview = content.length > 40 ? `${content.slice(0, 40)}…` : content
        return `已写入工作日志（类型：${kind}）：${preview}`
      },
    },
  }
}
