/** 与 module_visibility、微调面板对齐的稳定键（同骨架同序号一致）。 */
export function skeletonModuleVisibilityKey(skeletonId: string, moduleIndex: number): string {
  return `${skeletonId}:${moduleIndex}`;
}
