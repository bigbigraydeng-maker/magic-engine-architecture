/**
 * 解析 XCP 回包。
 *
 * 为什么手写而不是装个 XML 库：XCP 的回包只用到 `dt_assoc` / `dt_array` /
 * `item` 三种结构，形状极窄；为这点结构引入一个新依赖，按 CLAUDE.md 算"大任务"，
 * 不值当。代价是这个文件必须被测透——它错了，上面所有解读都是错的。
 */
import type { XcpArray, XcpAssoc, XcpReply, XcpValue } from './types'

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function unescapeXml(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

type Frame =
  | { kind: 'assoc'; value: XcpAssoc }
  | { kind: 'array'; value: XcpArray }
  | { kind: 'item'; key: string; text: string; child: XcpValue | null }

const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g

function readKey(attrs: string): string {
  const m = /\bkey\s*=\s*"([^"]*)"/.exec(attrs)
  return m ? unescapeXml(m[1]) : ''
}

/** 把一个 frame 收进它的父节点。栈空时说明这是根。 */
function attach(stack: Frame[], key: string, value: XcpValue): XcpAssoc | null {
  const parent = stack[stack.length - 1]
  if (!parent) return typeof value === 'object' && !Array.isArray(value) ? value : null
  if (parent.kind === 'item') parent.child = value
  else if (parent.kind === 'assoc') parent.value[key] = value
  else if (parent.kind === 'array') {
    const idx = Number(key)
    if (Number.isInteger(idx) && idx >= 0) parent.value[idx] = value
    else parent.value.push(value)
  }
  return null
}

/** 解析整个信封，返回 `data_block` 里那张顶层键值表。 */
export function parseXcpEnvelope(xml: string): XcpAssoc {
  const stack: Frame[] = []
  let root: XcpAssoc | null = null
  let cursor = 0

  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(xml); m !== null; m = TAG_RE.exec(xml)) {
    const [full, closing, name, attrs, selfClosing] = m

    const text = xml.slice(cursor, m.index)
    const top = stack[stack.length - 1]
    if (text && top?.kind === 'item') top.text += text
    cursor = m.index + full.length

    const isOpen = closing !== '/'
    if (isOpen) {
      if (name === 'dt_assoc') stack.push({ kind: 'assoc', value: {} })
      else if (name === 'dt_array') stack.push({ kind: 'array', value: [] })
      else if (name === 'item') stack.push({ kind: 'item', key: readKey(attrs), text: '', child: null })
      else continue
      // `<item key="x"/>` —— 开完立刻关，值为空串。
      if (selfClosing === '/') {
        const frame = stack.pop()
        if (frame?.kind === 'item') attach(stack, frame.key, '')
        else if (frame) root = attach(stack, '', frame.value) ?? root
      }
      continue
    }

    if (name !== 'dt_assoc' && name !== 'dt_array' && name !== 'item') continue
    const frame = stack.pop()
    if (!frame) continue
    if (frame.kind === 'item') {
      attach(stack, frame.key, frame.child ?? unescapeXml(frame.text).trim())
    } else {
      root = attach(stack, '', frame.value) ?? root
    }
  }

  if (!root) throw new Error('OpenSRS reply is not a valid XCP envelope')
  return root
}

function asAssoc(value: XcpValue | undefined): XcpAssoc {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asString(value: XcpValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/** 把顶层回包整理成通用字段。`is_success` 在 XCP 里是 "1"/"0" 而不是 boolean。 */
export function toXcpReply(root: XcpAssoc): XcpReply {
  return {
    isSuccess: asString(root.is_success) === '1',
    responseCode: asString(root.response_code),
    responseText: asString(root.response_text),
    attributes: asAssoc(root.attributes),
    raw: root,
  }
}
