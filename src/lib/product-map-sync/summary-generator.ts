/**
 * issue/PR 标题 → 人话摘要,给非技术 PM 看的检索页用。
 *
 * 🔴 铁律(魏征设计审必改 4):只准复述标题字面在说什么,禁止推断完成状态。
 *    这条 PR 是不是真的合了、这个 issue 是不是真的解决了,已经有专门的结构化字段
 *    (state / is_draft / mergeable_state)表达 —— 摘要如果自己编一套平行的状态描述,
 *    用户会更信自然语言而不信旁边的徽章,这正是"用流畅语言掩盖没依没据的判断"。
 *    prompt 里明令禁止 + 生成后过一道关键词黑名单双重把关,不是可选项。
 */

export interface SummaryGenerator {
  /** 返回 null = 生成失败/超时/被拒绝,调用方留 human_summary 为 null,下一轮自然重试。 */
  summarize(kind: 'pr' | 'issue', title: string): Promise<string | null>
}

/** 未配置大模型时的降级实现 —— 摘要功能整体跳过,不是报错(sync 主流程不受影响)。 */
export class NullSummaryGenerator implements SummaryGenerator {
  async summarize(_kind: 'pr' | 'issue', _title: string): Promise<string | null> {
    return null
  }
}

/**
 * 状态词黑名单 —— 摘要文本命中任意一个就整条拒绝,不写入(算 summariesRejected,
 * 不算 summariesFailed:这不是调用失败,是护栏生效)。
 */
const FORBIDDEN_STATUS_WORDS = [
  '已完成',
  '已修复',
  '已上线',
  '已解决',
  '已合并',
  '搞定',
  '完成了',
  '修复了',
  '上线了',
  '解决了',
  '合并了',
  'done',
  'completed',
  'fixed',
  'resolved',
  'merged',
  'shipped',
] as const

export function containsForbiddenStatusWord(summary: string): boolean {
  const lower = summary.toLowerCase()
  return FORBIDDEN_STATUS_WORDS.some((w) => lower.includes(w.toLowerCase()))
}

const CALL_TIMEOUT_MS = 10_000
const MAX_OUTPUT_TOKENS = 120
/** 标题级短文本任务,不需要 Sonnet 的推理档位 —— 子牙设计审建议改用更便宜更快的档位。 */
const MODEL = 'claude-haiku-4-5-20251001'

export class AnthropicSummaryGenerator implements SummaryGenerator {
  constructor(private readonly apiKey: string) {}

  async summarize(kind: 'pr' | 'issue', title: string): Promise<string | null> {
    const kindLabel = kind === 'pr' ? '一个 GitHub Pull Request(代码改动提案)' : '一个 GitHub Issue(问题/任务记录)'
    const prompt =
      `下面是${kindLabel}的标题,把它翻译成一句面向非技术人员的大白话(不超过 30 个字),` +
      `只能复述这个标题字面上在说什么改动 / 什么问题。\n` +
      `严格禁止:判断这件事有没有做完、有没有修好、有没有合并上线 —— 不要用` +
      `"已完成/已修复/已上线/已解决/已合并/搞定"这类词,状态由系统另外的标记显示,不需要你判断。\n` +
      `标题:${title}\n\n只回这一句话,不要加任何解释、引号或前缀。`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
    try {
      // handler 内部初始化(仓库铁律 7),不在模块顶层建 SDK 客户端
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: this.apiKey, maxRetries: 0 })
      const message = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal },
      )
      const block = message.content.find((b) => b.type === 'text')
      const text = block && block.type === 'text' ? block.text.trim() : ''
      if (!text) return null
      return text
    } catch {
      // 网络/限流/超时/SDK 异常 —— 一律留 null,不 throw(调用方逐条处理,下一轮自然重试)
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
