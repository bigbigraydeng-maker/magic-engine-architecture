import { callClaudeWithDocs } from '@/lib/anthropic/client'
import { detectKind, docxToText, plainToText, type SourceKind } from '@/lib/tailor-made/read-source'

/**
 * 文件 → 纯文本，复用 tailor-made 已验证的三条路径（不重写 docx/plain 逻辑）：
 *   docx → JSZip 解 zip 取正文，保住表格单元格边界
 *   pdf  → 先转 base64 喂 Claude 转写成保结构的纯文本，再进抽取链
 *   text → 原样
 *
 * 团资料常见十几天的行程 + 价格表 + 备注，跟 tailor-made 的行程单是同一类
 * 文档形状，没有理由另写一套解析逻辑。
 */

export { detectKind }
export type { SourceKind }

/** PDF 走文档通道：先让 Claude 转成保结构的纯文本，再进抽取链（同 tailor-made import route 的用法）*/
async function pdfToText(base64: string, filename: string): Promise<string> {
  const res = await callClaudeWithDocs({
    systemPrompt:
      'Transcribe this tour itinerary document to plain text. Preserve the day-by-day structure, ' +
      'each day on its own lines, keeping dates, routes, descriptions, hotels, pricing and inclusion ' +
      'sections. Do not summarise, do not omit, do not add. Output text only.',
    userMessage: '把这份团资料文件转成保留结构的纯文本。',
    docs: [{ type: 'pdf', content: base64, filename }],
    maxOutputTokens: 8096,
  })
  return res.text.trim()
}

/** 把上传文件读成纯文本，供 extractGroupTour 使用。 */
export async function fileToText(file: File): Promise<string> {
  const kind = detectKind(file.name, file.type)
  if (!kind) {
    throw new Error('只支持 Word（.docx）、PDF 和纯文本。老式 .doc 请先另存为 .docx 或 PDF。')
  }

  const buf = await file.arrayBuffer()
  if (kind === 'docx') return docxToText(buf)
  if (kind === 'pdf') return pdfToText(Buffer.from(buf).toString('base64'), file.name)
  return plainToText(buf)
}
