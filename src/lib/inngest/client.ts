/**
 * Magic Engine 2.0 · 主应用（云端 web app）的 Inngest 客户端（Issue #1346）
 *
 * 🔴 **为什么要有这个文件**：主应用此前只有「发事件」的半边（`src/lib/workflows/inngest-event.ts`
 *    的 `sendInngestEvent`），没有「接收 + 执行」的半边 —— 事件发出去没有云端函数会跑。
 *    本客户端 + `/api/inngest` serve 端点补上接收半边。执行侧运行在 Render 的 web 服务里，
 *    7×24 在线，不依赖任何一台本机开机。
 *
 * 🔴 **app id 必须与本机内容工厂 worker 区分开**：`scripts/factory-worker` 用
 *    `id: 'magic-engine-cts-workflow'`（Inngest Connect，跑在 PM 的 Mac 上）。本应用用
 *    `magic-engine-web`。两个是同一 Inngest 账户下的不同 app，函数各自注册；若 app id 撞、
 *    或函数 id 撞，事件会在两边之间被错误路由（子牙复审必改项）。云端函数 id 一律 `cloud-` 前缀。
 */

import { Inngest } from 'inngest'

/** 云端应用标识 —— 与本机 worker（magic-engine-cts-workflow）刻意不同。 */
export const INNGEST_APP_ID = 'magic-engine-web'

/** 云端注册函数的 id 命名空间前缀。所有本应用注册的函数 id 必须以此开头（有测试断言）。 */
export const CLOUD_FN_PREFIX = 'cloud-'

/**
 * 单例客户端。`eventKey` 从环境读取；缺失时 SDK 在真正发事件时才报错，
 * 注册/接收（serve）不需要 eventKey，只需要 signing key（在 serve 端点里校验）。
 */
export const inngest = new Inngest({ id: INNGEST_APP_ID })
