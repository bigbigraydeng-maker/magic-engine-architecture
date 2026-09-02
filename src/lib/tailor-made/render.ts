import path from 'node:path';
import type { TailorMadeItinerary } from './types';
import { normaliseItinerary } from './normalise';
import { injectData, loadTemplate } from './template-html';

/**
 * 把行程数据注入 HTML 模板。
 *
 * 模板是唯一的版面来源（templates/tailor-made-itinerary/itinerary-template.html），
 * 后台预览和最终 PDF 用的是同一个文件 —— 所见即所得，不存在两套样式跑偏的问题。
 *
 * 载入与注入的机制与画册共用，见 ./template-html。
 */

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'templates',
  'tailor-made-itinerary',
  'itinerary-template.html'
);

export async function renderItineraryHtml(data: TailorMadeItinerary): Promise<string> {
  const template = await loadTemplate(TEMPLATE_PATH, '行程单');
  // 归一化放在渲染入口，预览和导出走的是同一条路 —— 放在别处就会出现
  // 「预览好好的，导出来是空的」这种最难查的差异。见 normalise.ts
  return injectData(template, normaliseItinerary(data));
}
