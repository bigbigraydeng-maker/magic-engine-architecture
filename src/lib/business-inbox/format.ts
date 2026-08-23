/**
 * 收件箱时间显示 —— 用**看的人自己浏览器**的本地时区，不焊死某一个城市。
 *
 * 商务收件箱是给客户看的共享页面，客户可能在任何时区。以前焊死 Pacific/Auckland
 * 会让一个悉尼或伦敦的客户看到错位的时间。这里不传 `timeZone`，
 * `toLocaleString` 就用运行时（浏览器）的本地时区 —— 这是 Web 运行时已有的能力，
 * 不需要新表、不需要时区配置 UI、也不猜国家/州。
 */
export function formatWhen(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
