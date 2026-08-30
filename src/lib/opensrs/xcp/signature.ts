/**
 * XCP 请求签名。
 *
 * OpenSRS 用的是**双重 MD5**：
 *
 *     signature = MD5( MD5(xml + api_key) + api_key )
 *
 * MD5 在这里不是我们的选择，是 OpenSRS 协议规定的传输层签名，
 * 不承担抗碰撞责任（真正的身份凭证是 api_key 本身 + 生产环境的 IP 白名单）。
 * 别因为"MD5 不安全"就自作主张换成 SHA——换了对方直接拒绝。
 */
import { createHash } from 'crypto'

function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex')
}

/**
 * 算出 `X-Signature` 头的值。
 *
 * @param xml     完整的请求信封，必须与真正 POST 出去的字节**逐字节一致**——
 *                签名覆盖的是原文，事后再改一个空格就会验签失败。
 * @param apiKey  reseller API key。**绝不允许出现在任何日志 / 报错信息里。**
 */
export function signXcpPayload(xml: string, apiKey: string): string {
  if (!apiKey) throw new Error('OpenSRS API key is missing')
  return md5(md5(xml + apiKey) + apiKey)
}
