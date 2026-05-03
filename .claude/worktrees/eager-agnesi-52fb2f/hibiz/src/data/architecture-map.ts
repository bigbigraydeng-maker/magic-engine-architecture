/**
 * 手动维护的架构分层与简化依赖（供 /progress/architecture 展示，非静态分析结果）
 *
 * 层数据拆分到 architecture-map-layer-*.ts（单文件 <400 行）
 */

import type { ArchLayer } from "./architecture-map-types";
import { COMPONENTS_LAYER } from "./architecture-map-layer-components";
import { DATA_LAYER, TYPES_LAYER } from "./architecture-map-layer-types-data";
import { LIB_LAYER } from "./architecture-map-layer-lib";
import { PAGES_LAYER } from "./architecture-map-layer-pages";

export type { ArchFile, ArchGroup, ArchLayer } from "./architecture-map-types";
export { countFilesInLayer } from "./architecture-map-types";

export const ARCHITECTURE_LAYERS: ArchLayer[] = [
  PAGES_LAYER,
  COMPONENTS_LAYER,
  LIB_LAYER,
  TYPES_LAYER,
  DATA_LAYER,
];
