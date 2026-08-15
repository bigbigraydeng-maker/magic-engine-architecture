/**
 * `ME2-Component-ID:` 机器标记解析 + 未分类判定。纯函数,零 IO。
 *
 * 🔴 真实世界形状(魏征设计审阻塞项 2):
 * - GitHub API 返回的 body 换行是 \r\n —— 不归一化,行首匹配一条都中不了,
 *   而且提取出的 id 会带 \r 查不到登记册,全部静默滚进未分类;
 * - code fence 里的示例标记(教程型 issue)不算数,解析时跳过 fenced block。
 *
 * 关联规则(WP 第六节,确定性):只认 ①登记册显式关联 ②本标记。
 * 禁止标题相似度/目录名模糊匹配 —— 变异探针盯着「匹配放宽成子串」。
 */

const MARKER_PATTERN = /^ME2-Component-ID:\s*([a-z0-9-]+\.[a-z0-9-]+)\s*$/

/** 从 issue/PR body 提取组件标记(可多条;顺序保留;不校验存在性,那是调用方的事)。 */
export function extractComponentMarkers(body: string | null | undefined): string[] {
  if (!body) return []
  const markers: string[] = []
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    // trim() 是 \r\n 的唯一闸:GitHub API body 按 \n 切完行尾还挂着 \r,
    // 不 trim 的话行首匹配一条都中不了。不再叠加预归一化 —— 两道闸互相遮蔽,
    // 变异探针就探不出哪道真的在干活(shadowed-gates 教训)。
    const m = MARKER_PATTERN.exec(line.trim())
    if (m) markers.push(m[1])
  }
  return markers
}

/**
 * 未分类判定:既不被登记册显式关联,也没有指向真实组件的标记。
 * 标记指向不存在的组件 id 一样算未分类(不猜,不自动分类)。
 */
export function isUnclassified(input: {
  kind: 'pr' | 'issue'
  number: number
  body: string | null | undefined
  registryComponentIds: ReadonlySet<string>
  linkedPrNumbers: ReadonlySet<number>
  linkedIssueNumbers: ReadonlySet<number>
}): boolean {
  const linked =
    input.kind === 'pr'
      ? input.linkedPrNumbers.has(input.number)
      : input.linkedIssueNumbers.has(input.number)
  if (linked) return false
  const markers = extractComponentMarkers(input.body)
  return !markers.some((id) => input.registryComponentIds.has(id))
}
