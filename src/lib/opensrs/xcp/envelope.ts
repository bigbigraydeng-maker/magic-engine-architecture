/**
 * 构造 XCP 请求信封。
 *
 * 生成必须是**确定性**的：签名覆盖的是最终字节，同样的入参必须永远产出
 * 同样的字符串，否则会出现"本地算的签名和实际发出去的正文对不上"这类
 * 极难查的间歇性 403。JS 对象保持插入顺序，所以 key 顺序天然稳定。
 */
import type { XcpAssoc, XcpValue } from './types'

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => XML_ESCAPES[c])
}

function renderValue(value: XcpValue): string {
  if (typeof value === 'string') return escapeXml(value)
  if (Array.isArray(value)) {
    const items = value
      .map((v, i) => `<item key="${i}">${renderValue(v)}</item>`)
      .join('')
    return `<dt_array>${items}</dt_array>`
  }
  const items = Object.entries(value)
    .map(([k, v]) => `<item key="${escapeXml(k)}">${renderValue(v)}</item>`)
    .join('')
  return `<dt_assoc>${items}</dt_assoc>`
}

export interface XcpRequest {
  /** 例如 `LOOKUP` / `GET_PRICE`。 */
  action: string
  /** 例如 `DOMAIN` / `BALANCE`。 */
  object: string
  attributes?: XcpAssoc
  /** 顶层的其他字段（如 `registrant_ip`），少数命令要用。 */
  extra?: XcpAssoc
}

/** 把一条命令渲染成完整的 `OPS_envelope` 文本。 */
export function buildXcpEnvelope(req: XcpRequest): string {
  const top: XcpAssoc = {
    protocol: 'XCP',
    action: req.action,
    object: req.object,
    ...(req.extra ?? {}),
  }
  if (req.attributes) top.attributes = req.attributes

  return (
    `<?xml version='1.0' encoding='UTF-8' standalone='no' ?>` +
    `<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>` +
    `<OPS_envelope>` +
    `<header><version>0.9</version></header>` +
    `<body><data_block>${renderValue(top)}</data_block></body>` +
    `</OPS_envelope>`
  )
}
