// Creatomate credit 计费公式的唯一实现处（spec §3.4/§7）。禁止别处重算——魏征在复审里
// 抓出 v1 把官方文档自己没取整的示例数字（37.3）原样抄进了容量测算，这里统一用 Math.ceil。
//
// 来源：creatomate.com/llms/credits.md（2026-09-09 实测抓取）
//   视频 = ⌈width × height × frame_rate × duration(秒) ÷ 100,000,000⌉
//   图片 = 固定 1 credit
//
// Essential 档 $54/月 = 2,000 credits/月（PM 2026-09-09 确认已订阅）。
const ESSENTIAL_MONTHLY_USD = 54
const ESSENTIAL_MONTHLY_CREDITS = 2000
export const USD_PER_CREDIT = ESSENTIAL_MONTHLY_USD / ESSENTIAL_MONTHLY_CREDITS

export function creditsForVideo(width: number, height: number, frameRate: number, durationSec: number): number {
  return Math.ceil((width * height * frameRate * durationSec) / 100_000_000)
}

export function creditsForImage(): number {
  return 1
}

export function creditsToUsd(credits: number): number {
  return credits * USD_PER_CREDIT
}
