/**
 * Anthropic Claude client — per CLAUDE.md, do NOT initialise at module top level.
 * Use getAnthropicClient() inside request handlers only.
 *
 * PDF support requires client.beta.messages.create() + betas: ['pdfs-2024-09-25']
 * (SDK v0.32.x — DocumentBlockParam is not in the stable API yet)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Beta } from '@anthropic-ai/sdk/resources/beta/beta'

export const MODEL_SONNET = 'claude-sonnet-4-5-20250929'

// Pricing per million tokens (Sonnet 4.5)
const PRICE_INPUT_PER_M = 3.0    // $3 / MTok
const PRICE_OUTPUT_PER_M = 15.0  // $15 / MTok

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }
  return new Anthropic({ apiKey })
}

export interface ClaudeDocInput {
  type: 'pdf' | 'text'
  /** Base64 for PDF, plain string for text */
  content: string
  filename?: string
}

export interface ClaudeCallResult {
  text: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

/**
 * Call Claude with optional documents (PDFs or text blobs) and a user message.
 * Uses the beta messages API when PDFs are present (required for PDF support in SDK v0.32.x).
 */
export async function callClaudeWithDocs(params: {
  systemPrompt: string
  userMessage: string
  docs?: ClaudeDocInput[]
  maxOutputTokens?: number
}): Promise<ClaudeCallResult> {
  const { systemPrompt, userMessage, docs = [], maxOutputTokens = 8096 } = params

  const client = getAnthropicClient()
  const hasPdfs = docs.some(d => d.type === 'pdf')

  // Build content array — docs first, then user message
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = []

  for (const doc of docs) {
    if (doc.type === 'pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: doc.content,
        },
      } as Anthropic.Beta.Messages.BetaBase64PDFBlock)
    } else {
      content.push({
        type: 'text',
        text: doc.content,
      } as Anthropic.Beta.Messages.BetaTextBlockParam)
    }
  }

  content.push({
    type: 'text',
    text: userMessage,
  } as Anthropic.Beta.Messages.BetaTextBlockParam)

  let text: string
  let inputTok: number
  let outputTok: number

  if (hasPdfs) {
    // Beta API required for PDF document support
    const message = await client.beta.messages.create({
      model: MODEL_SONNET,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
      betas: ['pdfs-2024-09-25'],
    })
    text = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
    inputTok = message.usage.input_tokens
    outputTok = message.usage.output_tokens
  } else {
    // Use stable API when no PDFs (avoids invalid empty anthropic-beta header)
    const stableContent: Anthropic.MessageParam['content'] = content.map(b => ({
      type: 'text',
      text: (b as Anthropic.Beta.Messages.BetaTextBlockParam).text ?? '',
    }))
    const message = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: stableContent }],
    })
    text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
    inputTok = message.usage.input_tokens
    outputTok = message.usage.output_tokens
  }

  const costUsd = (inputTok / 1_000_000) * PRICE_INPUT_PER_M
    + (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

  return { text, input_tokens: inputTok, output_tokens: outputTok, cost_usd: costUsd }
}

/**
 * Call Claude for a multi-turn conversation (used in brief refinement).
 */
export async function callClaudeChat(params: {
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxOutputTokens?: number
}): Promise<ClaudeCallResult> {
  const { systemPrompt, messages, maxOutputTokens = 4096 } = params

  const client = getAnthropicClient()

  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: maxOutputTokens,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  })

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  const inputTok = message.usage.input_tokens
  const outputTok = message.usage.output_tokens
  const costUsd = (inputTok / 1_000_000) * PRICE_INPUT_PER_M
    + (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

  return { text, input_tokens: inputTok, output_tokens: outputTok, cost_usd: costUsd }
}

/**
 * Parse a Claude response that should be JSON.
 * Robust extraction: finds the outermost { } block regardless of surrounding text.
 * Also sanitizes literal control characters (newlines, tabs) inside JSON string values,
 * which Claude sometimes emits — especially for non-English responses.
 */
export function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim()

  // Find the outermost JSON object
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in Claude response. Preview: ${trimmed.slice(0, 300)}`)
  }

  const raw = trimmed.slice(start, end + 1)

  // Try direct parse first (fast path)
  try {
    return JSON.parse(raw) as T
  } catch {
    // Sanitize literal control characters inside string values
    // Claude sometimes emits real \n / \t instead of \\n / \\t in JSON strings
    const sanitized = sanitizeJsonControlChars(raw)
    return JSON.parse(sanitized) as T
  }
}

/**
 * Walk the raw JSON text character by character.
 * Inside string values, replace literal control characters with proper escape sequences.
 * Ignores already-escaped sequences (e.g. \\n stays \\n).
 */
function sanitizeJsonControlChars(str: string): string {
  let inString = false
  let escaped = false
  let result = ''

  for (const char of str) {
    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      result += char
      continue
    }
    if (char === '"') {
      inString = !inString
      result += char
      continue
    }
    if (inString) {
      if (char === '\n') { result += '\\n'; continue }
      if (char === '\r') { result += '\\r'; continue }
      if (char === '\t') { result += '\\t'; continue }
    }
    result += char
  }

  return result
}
