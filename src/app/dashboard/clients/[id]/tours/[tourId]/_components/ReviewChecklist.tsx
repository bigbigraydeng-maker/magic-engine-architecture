/**
 * 三种"待确认"提示，语义不同、处理动作也不同，不合并成一种——但每一条都
 * 直接给出"你该做什么"，不能只摆技术字段名让 FDE 自己猜（板桥意见2）。
 */
export default function ReviewChecklist({
  missingFields,
  clientClaimsToVerify,
  confidenceNotes,
}: {
  missingFields: string[]
  clientClaimsToVerify: Array<{ claim: string; issue: string }>
  confidenceNotes: string[]
}) {
  const hasAny = missingFields.length > 0 || clientClaimsToVerify.length > 0 || confidenceNotes.length > 0
  if (!hasAny) return null

  return (
    <section className="rounded-xl border border-[#C88A2E]/30 bg-[#C88A2E]/6 p-5">
      <h2 className="mb-3 font-black text-me-charcoal">解析结果需要你看一眼</h2>

      {missingFields.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-wide text-[#C2453A]">缺信息 —— 请手工填写</p>
          <ul className="mt-1 space-y-1">
            {missingFields.map((f, i) => (
              <li key={i} className="text-sm font-semibold text-me-charcoal/80">
                缺：{f}，请在下面表单里手工填写
              </li>
            ))}
          </ul>
        </div>
      )}

      {clientClaimsToVerify.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-wide text-[#C2453A]">宣传材料和行程不一致 —— 请确认哪个对</p>
          <ul className="mt-1 space-y-1">
            {clientClaimsToVerify.map((c, i) => (
              <li key={i} className="text-sm font-semibold text-me-charcoal/80">
                宣传材料说「{c.claim}」，但 {c.issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confidenceNotes.length > 0 && (
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-[#C88A2E]">AI 没把握的地方 —— 建议核对原文件</p>
          <ul className="mt-1 space-y-1">
            {confidenceNotes.map((n, i) => (
              <li key={i} className="text-sm font-semibold text-me-charcoal/80">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
