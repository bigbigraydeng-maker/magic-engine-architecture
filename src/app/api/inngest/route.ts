/**
 * Magic Engine 2.0 · Inngest 接收端点（Issue #1346）—— 主应用「执行半边」的入口。
 *
 * 🔴 **对外 endpoint，必须 fail-closed 校验签名**：Inngest 云端回调本端点来执行函数。
 *    `serve` 在提供 `signingKey` 且非 dev 模式时，会对每个入站请求校验 Inngest 签名，
 *    拒掉未签名 / 伪造签名的请求。缺 signing key 时（生产环境）应当拒绝启动，而不是裸奔。
 *
 * 🔴 注册的函数 id 一律 `cloud-` 前缀（`CLOUD_FN_PREFIX`），与本机 worker 命名空间隔离。
 */

import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { probePing } from '@/lib/inngest/functions/probe'

/** 本应用注册到 Inngest 的全部云端函数。新增函数在此登记。 */
export const cloudFunctions = [probePing]

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: cloudFunctions,
  // 🔴 显式传 signing key：生产环境据此校验入站签名（fail-closed）。
  signingKey: process.env.INNGEST_SIGNING_KEY,
})
