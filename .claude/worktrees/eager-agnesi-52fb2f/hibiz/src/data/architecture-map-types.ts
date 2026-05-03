/**
 * 架构图类型与工具（供 architecture-map 与各 layer 文件使用）
 */

export interface ArchFile {
  path: string;
  description: string;
  imports: string[];
  importedBy: string[];
  isNew?: boolean;
}

export interface ArchGroup {
  name: string;
  description: string;
  files: ArchFile[];
}

export interface ArchLayer {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  icon: string;
  basePath: string;
  groups: ArchGroup[];
}

export function countFilesInLayer(layer: ArchLayer): number {
  return layer.groups.reduce((acc, g) => acc + g.files.length, 0);
}
