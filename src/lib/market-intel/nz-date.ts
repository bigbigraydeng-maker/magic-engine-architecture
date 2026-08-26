/**
 * `digest_date` 必须是 NZ 本地日历日期，不是原始 UTC 日期——2026-08-20 设计审
 * 子牙指出：cron 在 18:00 UTC 跑（≈ 次日 06:00 NZST），如果直接拿 UTC 日期存，
 * 邮件里的"今天"会跟 PM 体感的日期错一天。
 */
export function nzDateString(date: Date): string {
  // en-CA 的短日期格式恰好是 YYYY-MM-DD，比手动拼 Intl.DateTimeFormatPart 简单。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
