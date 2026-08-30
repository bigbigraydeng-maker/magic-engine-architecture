import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET } from '@/lib/anthropic/client'
import { isBrochureCard, type TailorMadeBrochure } from './brochure-types'

/**
 * 用一句大白话改画册。
 *
 * 顾问说「北京那段写长一点」「所有介绍都别用感叹句」「上海的标题换成外滩」，
 * 系统就照做 —— 比在十几个输入框之间来回找快得多。
 *
 * ⚠️ 关键设计：模型**不重写整份画册**，只返回一组「改哪个字段、改成什么」。
 *
 * 让模型吐回整份 JSON 看起来更简单，但它会安静地丢东西 —— 少一个城市、
 * 少几张卡片、把顾问刚填的图片 URL 抹掉。而画册有十几页，顾问不可能每次
 * 都逐页核对。返回定点修改，则任何没被点名的内容都原样保留，
 * 出错的最坏情况是「改得不对」，而不是「丢了一页」。
 *
 * 字段路径也不用模型给的字符串去动态取值 —— 那等于让模型任意写内存。
 * 路径先在代码里解析成受限的结构，认不出来的直接丢弃。
 */

const SYSTEM_PROMPT = `You edit a travel picture book (brochure) that a consultant will send to a paying customer.

You receive the brochure's current text fields, each with a stable id, plus one instruction from the consultant. Return ONLY a JSON object, no markdown fence:

{ "edits": [ { "id": "<field id>", "value": "<new text>" } ], "note": "one short sentence in Chinese for the consultant" }

## Rules

- Only include fields you actually changed. Unchanged fields must not appear.
- Use ONLY the ids given to you. Never invent an id.
- ALWAYS write in English, whatever language the instruction is in. This document
  goes to the end customer, who reads English.

## What you MAY write

描述性内容 — what a place is, why it is worth seeing, what the traveller will
experience there. This is public knowledge, a wrong claim is visible to the
reader, and it commits the agency to nothing.

## What you MUST NOT add — these are promises to a paying customer

- Times, durations, "morning/afternoon" unless the source already says so
- Prices, what is included or excluded
- Hotel names, meals, restaurants
- Flight numbers, train numbers, transfer arrangements
- Guarantees ("you will definitely see…", "the best…")

Rewriting existing text is fine. Inventing commitments is not. If the instruction
asks for something you must not write (e.g. "add the hotel names"), leave those
fields alone and say so in "note".

## Style

- Calm and specific. No "breathtaking", "must-see", "unforgettable".
- Keep every place named in the source, in the same order. Do not add new places.`

/** 可被改写的字段。id 形如 `city.3.hero.body` —— 解析在代码里做，不用模型给的路径取值。 */
type FieldRef =
  | { kind: 'overview.intro' }
  | { kind: 'overview.note.title' }
  | { kind: 'overview.note.body' }
  | { kind: 'closing.body' }
  | { kind: 'cover.title' }
  | { kind: 'city.hero.title'; city: number }
  | { kind: 'city.hero.body'; city: number }
  | { kind: 'city.block.title'; city: number; block: number }
  | { kind: 'city.block.body'; city: number; block: number }

function parseId(id: string): FieldRef | null {
  if (id === 'overview.intro') return { kind: 'overview.intro' }
  if (id === 'overview.note.title') return { kind: 'overview.note.title' }
  if (id === 'overview.note.body') return { kind: 'overview.note.body' }
  if (id === 'closing.body') return { kind: 'closing.body' }
  if (id === 'cover.title') return { kind: 'cover.title' }

  let m = /^city\.(\d+)\.hero\.(title|body)$/.exec(id)
  if (m) return { kind: m[2] === 'title' ? 'city.hero.title' : 'city.hero.body', city: Number(m[1]) }

  m = /^city\.(\d+)\.block\.(\d+)\.(title|body)$/.exec(id)
  if (m) {
    return {
      kind: m[3] === 'title' ? 'city.block.title' : 'city.block.body',
      city: Number(m[1]),
      block: Number(m[2]),
    }
  }
  return null
}

/** 列出当前所有可改字段，连同内容一起给模型看 */
export function listFields(brochure: TailorMadeBrochure): { id: string; label: string; value: string }[] {
  const out: { id: string; label: string; value: string }[] = [
    { id: 'cover.title', label: '封面大标题', value: brochure.cover.title },
    { id: 'overview.intro', label: '总览开篇', value: brochure.overview.intro },
    { id: 'overview.note.title', label: '总览提示框标题', value: brochure.overview.note.title },
    { id: 'overview.note.body', label: '总览提示框正文', value: brochure.overview.note.body },
    { id: 'closing.body', label: '结尾正文', value: brochure.closing.body },
  ]

  brochure.cities.forEach((city, ci) => {
    out.push({ id: `city.${ci}.hero.title`, label: `${city.name} 大图标题`, value: city.hero.title })
    out.push({ id: `city.${ci}.hero.body`, label: `${city.name} 大图介绍`, value: city.hero.body })
    city.blocks.forEach((block, bi) => {
      out.push({ id: `city.${ci}.block.${bi}.title`, label: `${city.name} 卡片${bi + 1} 标题`, value: block.title })
      out.push({ id: `city.${ci}.block.${bi}.body`, label: `${city.name} 卡片${bi + 1} 正文`, value: block.body })
    })
  })
  return out
}

/** 把一条修改落到画册上。认不出的 id 或越界的下标一律忽略。 */
function applyEdit(draft: TailorMadeBrochure, id: string, value: string): boolean {
  const ref = parseId(id)
  if (!ref) return false

  switch (ref.kind) {
    case 'cover.title': draft.cover.title = value; return true
    case 'overview.intro': draft.overview.intro = value; return true
    case 'overview.note.title': draft.overview.note.title = value; return true
    case 'overview.note.body': draft.overview.note.body = value; return true
    case 'closing.body': draft.closing.body = value; return true
    default: break
  }

  const city = draft.cities[ref.city]
  if (!city) return false

  if (ref.kind === 'city.hero.title') { city.hero.title = value; return true }
  if (ref.kind === 'city.hero.body') { city.hero.body = value; return true }

  const block = city.blocks[ref.block]
  if (!block) return false
  if (ref.kind === 'city.block.title') { block.title = value; return true }
  if (ref.kind === 'city.block.body') {
    block.body = value
    return true
  }
  return false
}

export interface BrochureAssistResult {
  brochure: TailorMadeBrochure
  /** 改了哪些字段，给顾问看的标签 */
  changed: string[]
  note: string
}

export async function assistBrochure(params: {
  brochure: TailorMadeBrochure
  instruction: string
}): Promise<BrochureAssistResult> {
  const { brochure, instruction } = params
  if (!instruction.trim()) throw new Error('先说要改什么')

  const fields = listFields(brochure).filter((f) => f.label && (f.value.trim() || true))
  const labels = new Map(fields.map((f) => [f.id, f.label]))

  const userContent = `## 画册现有内容

${fields.map((f) => `[${f.id}] ${f.label}\n${f.value || '(空)'}`).join('\n\n')}

## 顾问的要求

${instruction.trim()}`

  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL_SONNET,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  }

  let response: Anthropic.Message
  try {
    response = await getAnthropicClient().messages.create(body)
  } catch (sdkErr) {
    // 与 expand-day 同样的兜底：0.32.1 SDK 在 Node 24 上偶发 premature close
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw sdkErr
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    response = (await res.json()) as Anthropic.Message
  }

  // 被 max_tokens 截断的回复是**半份**修改。半份修改照样能解析出前几条，
  // 悄悄用掉比报错糟糕得多 —— 顾问以为改完了，其实只改了一半。
  if (response.stop_reason === 'max_tokens') {
    throw new Error('这次要改的内容太多，分两次说（比如先改北京，再改上海）')
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  let raw = (textBlock?.text ?? '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()
  if (!raw.startsWith('{')) {
    const a = raw.indexOf('{')
    const b = raw.lastIndexOf('}')
    if (a === -1 || b <= a) throw new Error('改写结果无法读取，请重试')
    raw = raw.slice(a, b + 1)
  }

  let parsed: { edits?: { id?: string; value?: string }[]; note?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('改写结果无法读取，请重试')
  }

  const draft = structuredClone(brochure)
  const changed: string[] = []
  for (const edit of parsed.edits ?? []) {
    if (typeof edit?.id !== 'string' || typeof edit?.value !== 'string') continue
    if (applyEdit(draft, edit.id, edit.value)) changed.push(labels.get(edit.id) ?? edit.id)
  }

  if (changed.length === 0) {
    throw new Error(parsed.note?.trim() || '这次没改动任何内容，换个说法试试')
  }

  return {
    brochure: draft,
    changed,
    note: (parsed.note ?? '').trim() || '已改，请核对后再发客户。',
  }
}
