/**
 * 海报视觉模板 + 配套文案提示词（仅作复制到外部 LLM 的参考；不会自动调用 AI 或写库）
 */

export type PosterTemplateId = "coastal_editorial" | "grid_gallery" | "minimal_luxury";

export interface PosterTemplateMeta {
  id: PosterTemplateId;
  title: string;
  /** 一句话设计说明 */
  designNote: string;
  /** 给商家的中文提示词：如何写 headline / details */
  merchantCopyGuide: string;
  /** 给外部 LLM 的参考片段（需用户自行复制；生成后须回项目页手动粘贴保存） */
  llmPromptSnippet: string;
}

export const POSTER_TEMPLATE_DEFAULT: PosterTemplateId = "coastal_editorial";

export const POSTER_TEMPLATES: PosterTemplateMeta[] = [
  {
    id: "coastal_editorial",
    title: "海岸编辑风（深绿 + 大标题）",
    designNote: "顶部品牌条 + 渐变绿底标题区 + 主图 + 正文，适合 open home / 单套推广",
    merchantCopyGuide:
      "标题写清区域 + 房型 + 一句卖点（如「Mount Eden 三居 · 本周日开放」）。详情写时间、亮点、看房方式，避免与 TradeMe 重复堆砌参数。",
    llmPromptSnippet: `你是新西兰房产中介营销文案助手。根据下列事实生成一句中文主标题（≤18字）、一段英文副标题（≤120字符）、3条英文要点（每条≤80字符），语气专业可信、符合 NZ English：
- 区域与房型：
- 开放日或预约方式：
- TradeMe 链接中的关键数字（若已知）：
输出 JSON：{"headline_zh","subtitle_en","bullets_en":[]}

（生成后请把 headline_zh 等复制到 HiBiz 项目页「房源推广」的 Headline / 摘要里保存；本工具不会自动写入。）`,
  },
  {
    id: "grid_gallery",
    title: "多图画廊（自动宫格）",
    designNote: "TradeMe/手动多张图时自动 2×2 或拼图排列，标题压底，适合「多图吸睛」",
    merchantCopyGuide:
      "先点「从 TradeMe 抓取图片」拉取相册；主图 URL 会排在第一位。标题简短有力，详情可写「更多照片见 TradeMe」。",
    llmPromptSnippet: `你是房产海报文案助手。用户会提供多张房源图与一条 TradeMe 链接。请写：1）英文大标题 ≤12 词；2）两行中文辅助说明（开放日+联系方式引导）；3）一句合规免责声明（非广告投资建议）。`,
  },
  {
    id: "minimal_luxury",
    title: "极简轻奢（留白 + 细线）",
    designNote: "大量留白、细边框、小字号品牌，适合高端 appraisal / 私密看房",
    merchantCopyGuide:
      "标题用品牌或个人名 + 服务类型即可。详情用短句分行，避免感叹号堆叠。",
    llmPromptSnippet: `用极简风格写 NZ 房产顾问海报文案：主标题（英文，≤8词）、副标题（中英文各一行）、底部小字 privacy 提示。避免夸张承诺，提及 licensed 若适用。`,
  },
];

export function normalizePosterTemplateId(raw: string | undefined | null): PosterTemplateId {
  const ids = new Set(POSTER_TEMPLATES.map((t) => t.id));
  if (raw && ids.has(raw as PosterTemplateId)) {
    return raw as PosterTemplateId;
  }
  return POSTER_TEMPLATE_DEFAULT;
}
