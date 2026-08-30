import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET } from '@/lib/anthropic/client'
import type { TailorMadeItinerary } from './types'

/**
 * 用一句大白话改行程单。
 *
 * 「第 5 天写详细一点」「所有描述都短一些」「把西安那两天写得更适合带小孩」——
 * 比在十几天的输入框之间来回找快得多。画册那边已经有，行程单是顾问的主战场，
 * 更该有。
 *
 * ⚠️ 与画册版共享两条关键设计，原因见 brochure-assist.ts：
 *
 *  1. 模型**不重写整份行程**，只返回「改哪个字段、改成什么」。让它吐回整份
 *     JSON 会安静地丢天数、丢航班、抹掉顾问填的酒店，而 15 天的东西顾问不可能
 *     每次逐条核对。
 *  2. 字段路径不拿模型给的字符串动态取值，先在代码里解析成受限结构。
 *
 * ⚠️ 比画册更严的一条：**可改字段只有散文**。
 *
 *  行程单里有酒店名、车次、餐食、价格 —— 这些是对付费客户的承诺，写错了
 *  客人拿着它去值机、去入住。所以它们根本不进可改清单：模型点名也改不动，
 *  不是靠 prompt 里叮嘱它别碰。能改的只有「介绍性文字」这一类。
 */

const SYSTEM_PROMPT = `You edit the prose of a tailor-made travel itinerary that a consultant will send to a paying customer.

You receive the itinerary's editable text fields, each with a stable id, plus one instruction from the consultant. Return ONLY a JSON object, no markdown fence:

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

Rewriting existing description is fine. Inventing commitments is not. Hotel,
meal, transport and price fields are not in your list at all — if the instruction
asks you to change one, say so in "note" and change nothing.

## Style

- Calm and specific. No "breathtaking", "must-see", "unforgettable".
- Keep every place named in the source, in the same order. Do not add new places.`

/** 可被改写的字段。散文以外的一律不在此列 —— 见文件头注。 */
type FieldRef =
  | { kind: 'trip.summary' }
  | { kind: 'trip.highlight'; index: number }
  | { kind: 'day.body'; index: number }
  | { kind: 'nextStep.body'; index: number }
  | { kind: 'note'; index: number }

function parseId(id: string): FieldRef | null {
  if (id === 'trip.summary') return { kind: 'trip.summary' }

  let m = /^trip\.highlight\.(\d+)$/.exec(id)
  if (m) return { kind: 'trip.highlight', index: Number(m[1]) }

  m = /^day\.(\d+)\.body$/.exec(id)
  if (m) return { kind: 'day.body', index: Number(m[1]) }

  m = /^nextStep\.(\d+)\.body$/.exec(id)
  if (m) return { kind: 'nextStep.body', index: Number(m[1]) }

  m = /^note\.(\d+)$/.exec(id)
  if (m) return { kind: 'note', index: Number(m[1]) }

  return null
}

/** 列出当前所有可改字段，连同内容一起给模型看 */
export function listFields(it: TailorMadeItinerary): { id: string; label: string; value: string }[] {
  const out: { id: string; label: string; value: string }[] = [
    { id: 'trip.summary', label: '行程概述', value: it.trip?.summary ?? '' },
  ]

  it.trip?.highlights?.forEach((text, i) => {
    out.push({ id: `trip.highlight.${i}`, label: `行程亮点 ${i + 1}`, value: text })
  })

  it.days?.forEach((day, i) => {
    out.push({
      id: `day.${i}.body`,
      // 标签带上城市/路线，模型才知道「西安那两天」指的是哪几条
      label: `第 ${day.day || i + 1} 天正文（${day.route || '未填路线'}）`,
      value: day.body ?? '',
    })
  })

  it.nextSteps?.forEach((step, i) => {
    out.push({ id: `nextStep.${i}.body`, label: `下一步 ${i + 1}：${step.title}`, value: step.body })
  })

  it.notes?.forEach((text, i) => {
    out.push({ id: `note.${i}`, label: `条款提示 ${i + 1}`, value: text })
  })

  return out
}

/** 把一条修改落到行程单上。认不出的 id 或越界的下标一律忽略。 */
function applyEdit(draft: TailorMadeItinerary, id: string, value: string): boolean {
  const ref = parseId(id)
  if (!ref) return false

  switch (ref.kind) {
    case 'trip.summary':
      draft.trip.summary = value
      return true
    case 'trip.highlight': {
      if (!draft.trip.highlights?.[ref.index]) return false
      draft.trip.highlights[ref.index] = value
      return true
    }
    case 'day.body': {
      const day = draft.days?.[ref.index]
      if (!day) return false
      day.body = value
      return true
    }
    case 'nextStep.body': {
      const step = draft.nextSteps?.[ref.index]
      if (!step) return false
      step.body = value
      return true
    }
    case 'note': {
      if (draft.notes?.[ref.index] === undefined) return false
      draft.notes[ref.index] = value
      return true
    }
    default:
      return false
  }
}

export interface ItineraryAssistResult {
  payload: TailorMadeItinerary
  /** 改了哪些字段，给顾问看的标签 */
  changed: string[]
  note: string
}

export async function assistItinerary(params: {
  payload: TailorMadeItinerary
  instruction: string
}): Promise<ItineraryAssistResult> {
  const { payload, instruction } = params
  if (!instruction.trim()) throw new Error('先说要改什么')

  const fields = listFields(payload)
  const labels = new Map(fields.map((f) => [f.id, f.label]))

  const userContent = `## 行程单现有内容

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
    // 与 expand-day / brochure-assist 同样的兜底：0.32.1 SDK 在 Node 24 上偶发 premature close
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

  // 被 max_tokens 截断的回复是**半份**修改，照样能解析出前几条。
  // 悄悄用掉比报错糟糕得多 —— 顾问以为改完了，其实只改了一半。
  if (response.stop_reason === 'max_tokens') {
    throw new Error('这次要改的内容太多，分两次说（比如先改北京那几天，再改西安）')
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

  const draft = structuredClone(payload)
  const changed: string[] = []
  for (const edit of parsed.edits ?? []) {
    if (typeof edit?.id !== 'string' || typeof edit?.value !== 'string') continue
    if (applyEdit(draft, edit.id, edit.value)) changed.push(labels.get(edit.id) ?? edit.id)
  }

  // 一条都没改不是错误：顾问可能问的是个问题，或者要求的是模型不该写的东西
  // （改酒店、改价格）。抛异常会让界面渲染成红色报错，看着像系统崩了。
  if (changed.length === 0) {
    return {
      payload,
      changed: [],
      note: (parsed.note ?? '').trim() || '这次没有改动任何内容 —— 酒店、餐食、车次、价格这些要自己改。',
    }
  }

  return {
    payload: draft,
    changed,
    note: (parsed.note ?? '').trim() || '已改，请核对后再发客户。',
  }
}
