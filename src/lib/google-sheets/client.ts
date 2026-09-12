/**
 * Google Sheets 只读连接器（L3）——「给一个表格 ID + 范围，读回一格一格的字符串」。
 *
 * 不认识任何客户语义：不知道哪一列是电话、哪一列是阶段。那些判断属于调用方
 * （例如 `src/lib/conversions/cts-crm-sheet-sync.ts`），不该下沉到这里。
 *
 * 鉴权复用 GA4/GSC 已在用的同一个服务账号（`GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`），
 * 不新开一条 OAuth 授权流程 —— 表格只需要在 Google Sheets 里把这个服务账号的
 * `client_email` 加成查看者即可，不需要人再点一次登录。
 */

import { loadServiceAccount, mintServiceAccountToken } from '@/lib/google-oauth/service-account'

export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

export class GoogleSheetsError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleSheetsError'
  }
}

export class GoogleSheetsNotConfiguredError extends Error {
  constructor() {
    super('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS 未配置或格式不对，读不了 Google Sheets')
    this.name = 'GoogleSheetsNotConfiguredError'
  }
}

/**
 * 读一个 A1 范围（如 `'CRM管理!A2:S'`），返回原始的行×列字符串矩阵。
 * 空单元格是 `''`，短行不会补齐到统一长度（跟 Sheets API 原样行为一致，
 * 调用方自己按下标取值时要防越界）。
 */
export async function readSheetValues(
  spreadsheetId: string,
  range: string,
  deps: { fetcher?: typeof fetch } = {},
): Promise<string[][]> {
  const fetcher = deps.fetcher ?? fetch
  const creds = loadServiceAccount()
  if (!creds) throw new GoogleSheetsNotConfiguredError()

  const token = await mintServiceAccountToken(creds, SHEETS_READONLY_SCOPE, { fetcher })

  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(res.status, `Sheets API 读取失败 (${res.status}): ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as { values?: unknown[][] }
  const values = json.values ?? []
  return values.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))
}
