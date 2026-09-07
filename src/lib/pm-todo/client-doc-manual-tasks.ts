/**
 * One-off client ops requests written into a client plan doc under
 * docs/clients/<client>/ (e.g. "明早 09:00 前扫一眼 xx") — only writing it
 * into the doc is not dispatch (CLAUDE.md 铁律 3 下半: 管道不许断头).
 *
 * This file is deliberately kept separate from the generic loader in
 * manual-items.ts, mirroring platform-candidate-reviews.ts: the loader
 * (`pushClientDocManualTaskItems`) is shared platform code, this array is
 * per-client configuration data. Adding a new client's one-off task means
 * appending here, not editing the shared loader path.
 */
export interface ClientDocManualTask {
  clientId: string
  clientName: string
  what: string
  how: string
  href: string
  /** ISO instant，过了这个时间点不再下发。 */
  expiresAt: string
}

export const CLIENT_DOC_MANUAL_TASKS: ClientDocManualTask[] = [
  {
    // 见 docs/clients/cts/2026-09-07-golden-china-surge-plan.md「已知数据缺口」
    clientId: 'c0000000-0000-0000-0000-000000000000',
    clientName: 'CTS Tours NZ',
    what: 'Golden China 冲量方案的视频素材改造清单只从广告账户 Media Library 反查得到——纯自然发帖(没投过广告)的爆款不在这个库里,清单可能漏掉真正的高热素材',
    how: '手机登录 facebook.com/CTSToursNZ/videos 扫一眼,找有没有观看数 >10k 的自然视频不在改造清单的 5 条里;有就发给顾问窗口补进去,没有就回一句「没有」',
    href: 'https://www.facebook.com/CTSToursNZ/videos',
    // render.yaml 的 pm-daily-todo 每个工作日只在 19:00 UTC(08:00 NZDT)发一次;
    // 原定 2026-09-08T09:00 NZDT 只比那次运行晚 1 小时,PR review/merge/部署
    // 只要晚一点就整条错过、且当天 20:00 UTC 后连看板也不再生成(Codex P2)。
    // 往后放到 09-11,保证即便合并/部署拖两天,工作日 digest 也至少跑到它一次。
    expiresAt: '2026-09-11T09:00:00+13:00',
  },
]
