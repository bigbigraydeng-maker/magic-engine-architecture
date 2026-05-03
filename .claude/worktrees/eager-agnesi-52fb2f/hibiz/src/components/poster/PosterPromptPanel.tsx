import Link from "next/link";
import { POSTER_TEMPLATES, type PosterTemplateId } from "@/data/poster-templates";

interface PosterPromptPanelProps {
  templateId: PosterTemplateId;
  /** 基于本次 TradeMe 导入内容拼好的提示词草稿，供复制到外部 LLM 微调 */
  listingDerivedPrompt?: string | null;
  /** 项目页「房源推广」链接，便于用户粘贴文案后回去保存 */
  projectEditHref?: string;
}

export function PosterPromptPanel({ templateId, listingDerivedPrompt, projectEditHref }: PosterPromptPanelProps) {
  const meta = POSTER_TEMPLATES.find((t) => t.id === templateId) ?? POSTER_TEMPLATES[0];

  return (
    <div className="poster-no-print mt-8 max-w-2xl rounded-xl border border-stone-200 bg-stone-50/90 p-5 text-sm text-stone-800">
      <h3 className="font-display text-base font-semibold text-stone-900">配套提示词 · {meta.title}</h3>
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-950">
        <p className="font-semibold text-amber-950">重要：这里的文字不会自动生效</p>
        <p className="mt-1 text-amber-900/95">
          下方片段仅供你<strong>复制到 ChatGPT 等外部工具</strong>生成文案；HiBiz 当前<strong>不会</strong>在后台替你调用
          AI，也<strong>不会</strong>把 JSON 自动写进海报。海报上显示的内容来自：TradeMe
          导入结果 + 你在项目页「Business details / 房源推广」里保存的标题、地址、摘要等字段。
        </p>
        {projectEditHref ? (
          <p className="mt-2">
            <Link href={projectEditHref} className="font-medium text-emerald-900 underline hover:text-emerald-950">
              去项目页编辑并保存房源推广字段 →
            </Link>
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-stone-600">{meta.designNote}</p>

      <details className="mt-4 group">
        <summary className="cursor-pointer font-medium text-emerald-900 hover:underline">给商家的文案要点</summary>
        <p className="mt-2 rounded-lg border border-stone-200 bg-white p-3 text-sm leading-relaxed text-stone-700">
          {meta.merchantCopyGuide}
        </p>
      </details>

      <details className="mt-3 group">
        <summary className="cursor-pointer font-medium text-emerald-900 hover:underline">给 LLM 的提示片段（整段复制）</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-white p-3 font-mono text-xs text-stone-800">
          {meta.llmPromptSnippet}
        </pre>
      </details>

      {listingDerivedPrompt?.trim() ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer font-medium text-emerald-900 hover:underline">基于本次 TradeMe 链接的提示词建议</summary>
          <p className="mt-2 text-xs text-stone-600">
            由系统根据已抓取的标题/描述拼接的<strong>草稿提示</strong>，复制到外部 LLM 后，请把生成的主标题/要点<strong>手动填回</strong>项目页的
            Headline、Property details 或海报摘要；此处同样不会自动写入数据库。
          </p>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-100 bg-white p-3 font-mono text-xs text-stone-800">
            {listingDerivedPrompt.trim()}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
