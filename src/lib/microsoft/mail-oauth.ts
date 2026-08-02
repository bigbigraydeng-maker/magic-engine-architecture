/**
 * 连接客户自己的邮箱 —— 授权那一半。
 *
 * 为什么存在（2026-08-02）：ME 的四条获客管道里，邮件是唯一一条**正在往外漏**
 * 的 —— 客人发到 CTS 的 info@ 的邮件，系统里一个字都看不到（库里那 20 条是人手
 * 敲进去的，7/29 之后就停了）。接进来的第一步是拿到那个邮箱的授权。
 *
 * ## 为什么用「本人登录」而不是「管理员给整个公司授权」
 *
 * Microsoft 有两条路：
 *  · 应用权限 + 租户管理员同意 —— 一次授权能读**全公司**每一个邮箱，然后再用
 *    一条访问策略把范围收回到 info@。权力先给满再收，而且必须找到租户管理员。
 *  · 委托权限（这里选的）—— 能进 info@ 的那个人自己点一次同意，拿到的令牌
 *    **只能碰他自己能碰的邮箱**。范围由 Microsoft 的账号体系保证，不靠我们
 *    额外配一条策略不出错。
 *
 * 对客户老板来说，第二条也是唯一说得清楚的一句话：「用你收 info@ 的那个账号
 * 登录一下」。第一条要解释什么是租户管理员、什么是应用权限 —— 按铁律 3，
 * 一个需要解释的人工步骤等于没做好。
 *
 * ## 权限只要三个
 *  · Mail.Read      —— 读进来的信（这次要做的）
 *  · Mail.Send      —— 以后从 CRM 里回信（现在不用，但一起要掉，省得让客户
 *                      再点第二次同意；Microsoft 只给「本次要过」的权限）
 *  · offline_access —— 换取刷新令牌。漏掉它，一小时后就断，且断得很安静
 *
 * 不要 Mail.ReadWrite：读信不需要改客户的邮箱，多要的每一分权限都是以后
 * 出事时说不清楚的地方。
 */

import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

/**
 * 授权要的权限。**顺序和内容必须跟刷新令牌时传的一致** —— Microsoft 只给
 * 「本次请求要了的」权限发新令牌，两处对不上就会悄悄降权，读信时才 403。
 */
export const MICROSOFT_MAIL_SCOPES = [
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
] as const

/**
 * `common` 而不是具体的 tenant id —— 客户可能是 Outlook.com 个人账号，也可能是
 * 公司的 Microsoft 365，写死任一种都会把另一种挡在门外。
 */
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'

export const MICROSOFT_AUTH_URL  = `${AUTHORITY}/authorize`
export const MICROSOFT_TOKEN_URL = `${AUTHORITY}/token`

/** 防 CSRF 的一次性随机数存在这个 cookie 里，回调时必须对得上。 */
export const MICROSOFT_STATE_COOKIE = 'ms_mail_oauth_state'

export const MICROSOFT_MAIL_PROVIDER = PLATFORM_PROVIDERS.MICROSOFT_MAIL

/** 授权完跳回哪里。放这里是为了 start 和 callback 两边永远同一个值 —— 两边写得不一样，Microsoft 会拒掉。 */
export function microsoftRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'
  return `${base.replace(/\/$/, '')}/api/auth/microsoft/mail/callback`
}

export interface MicrosoftTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}

export type ExchangeResult =
  | { ok: true; tokens: MicrosoftTokenResponse }
  | { ok: false; error: string }

/**
 * 拿授权码换令牌。永不抛异常 —— 回调页面必须能对着人说一句话，
 * 而不是把一个堆栈丢在浏览器里。
 */
export async function exchangeCodeForTokens(code: string): Promise<ExchangeResult> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET 没有配置' }
  }

  try {
    const res = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: microsoftRedirectUri(),
        scope: MICROSOFT_MAIL_SCOPES.join(' '),
      }).toString(),
    })

    const data = (await res.json()) as Partial<MicrosoftTokenResponse> & {
      error?: string
      error_description?: string
    }

    if (!res.ok || !data.access_token) {
      return { ok: false, error: data.error_description ?? data.error ?? `HTTP ${res.status}` }
    }
    // 没有刷新令牌就等于没连上：令牌一小时后过期，而且是安静地过期。
    // 宁可当场失败让人重点一次，也不要一小时后同步无声停摆。
    if (!data.refresh_token) {
      return { ok: false, error: '没拿到刷新令牌 —— 授权时缺了 offline_access' }
    }

    return {
      ok: true,
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in ?? 3600,
        scope: data.scope ?? MICROSOFT_MAIL_SCOPES.join(' '),
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '换取令牌失败' }
  }
}

/**
 * 问 Microsoft：刚才登录的到底是哪个邮箱。
 *
 * 必须问，不能让人手填：连错邮箱是这条管道最贵的错误 —— 会把另一个部门
 * （甚至老板私人）的邮件抓进客户的 CRM。这里拿到的地址会显示在设置页上，
 * 让人当场看见自己连的是哪一个。
 */
export async function fetchMailboxAddress(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { mail?: string | null; userPrincipalName?: string | null }
    return data.mail ?? data.userPrincipalName ?? null
  } catch {
    return null
  }
}
