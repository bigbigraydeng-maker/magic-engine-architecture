/**
 * OpenSRS 域名 API（XCP）传输层。
 *
 * 🔴 **这一层只做只读查询。**
 *    注册 / 续费 / 转入这类**花钱且不可逆**的动作一律不在这里出现——
 *    它们必须做成 capability，经 `lib/kernel/gateway.ts` 授权后执行，
 *    否则任何一段代码 import 了这个文件就等于拿到了直接扣款的能力。
 *
 * 🔴 **默认走测试环境（horizon）。** 要打生产必须显式设 `OPENSRS_ENV=live`。
 *    反过来（默认 live、要测试才切）意味着一次配置疏忽就是真实扣款，
 *    这个方向的错误不可接受。
 */
import { buildXcpEnvelope, type XcpRequest } from './xcp/envelope'
import { parseXcpEnvelope, toXcpReply } from './xcp/parse'
import { signXcpPayload } from './xcp/signature'
import type { XcpAssoc, XcpReply } from './xcp/types'

const ENDPOINTS = {
  test: 'https://horizon.opensrs.net:55443',
  live: 'https://rr-n1-tor.opensrs.net:55443',
} as const

export type OpenSrsEnv = keyof typeof ENDPOINTS

interface OpenSrsCredentials {
  username: string
  apiKey: string
  env: OpenSrsEnv
}

/** 只有显式 `OPENSRS_ENV=live` 才算生产，其余一切取值（含拼错）都落回测试环境。 */
export function resolveOpenSrsEnv(raw: string | undefined): OpenSrsEnv {
  return raw === 'live' ? 'live' : 'test'
}

/** 在调用处读 env，不在模块顶层——顶层读会把配置烤进构建产物。 */
function readCredentials(): OpenSrsCredentials {
  const username = process.env.OPENSRS_RESELLER_USERNAME
  const apiKey = process.env.OPENSRS_API_KEY
  if (!username || !apiKey) {
    throw new Error('OpenSRS credentials are not configured (OPENSRS_RESELLER_USERNAME / OPENSRS_API_KEY)')
  }
  return { username, apiKey, env: resolveOpenSrsEnv(process.env.OPENSRS_ENV) }
}

export class OpenSrsError extends Error {
  constructor(
    message: string,
    readonly responseCode: string,
    readonly reply?: XcpReply,
  ) {
    super(message)
    this.name = 'OpenSrsError'
  }
}

/**
 * 发一条 XCP 命令并返回整理过的回包。
 *
 * 报错信息里只允许出现 action / object / 响应码 —— **绝不带凭证、绝不带请求正文**
 * （正文里有客户资料，日志会被翻）。
 */
export async function callXcp(req: XcpRequest, timeoutMs = 30_000): Promise<XcpReply> {
  const { username, apiKey, env } = readCredentials()
  const xml = buildXcpEnvelope(req)

  const res = await fetch(ENDPOINTS[env], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-Username': username,
      'X-Signature': signXcpPayload(xml, apiKey),
    },
    body: xml,
    signal: AbortSignal.timeout(timeoutMs),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new OpenSrsError(`OpenSRS ${req.action} ${req.object} HTTP ${res.status}`, String(res.status))
  }

  const reply = toXcpReply(parseXcpEnvelope(text))
  if (!reply.isSuccess) {
    throw new OpenSrsError(
      `OpenSRS ${req.action} ${req.object} failed: ${reply.responseText}`,
      reply.responseCode,
      reply,
    )
  }
  return reply
}

export interface DomainAvailability {
  domain: string
  available: boolean
  /** OpenSRS 原样返回的状态串（available / taken / invalid …），留着给调用方细分。 */
  status: string
}

/**
 * 查一个域名能不能注册。**只读、不花钱**，是账号到位后第一个该验的命令。
 */
export async function lookupDomain(domain: string): Promise<DomainAvailability> {
  const reply = await callXcp({
    action: 'LOOKUP',
    object: 'DOMAIN',
    attributes: { domain } satisfies XcpAssoc,
  })
  const status = typeof reply.attributes.status === 'string' ? reply.attributes.status : ''
  return { domain, available: status === 'available', status }
}
