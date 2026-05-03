interface BuilderDevPlaceholderProps {
  urlPath: string;
  variant?: "no_api_key" | "no_content";
}

/** Shown in development when Builder is enabled but content cannot be rendered. */
export function BuilderDevPlaceholder({ urlPath, variant = "no_api_key" }: BuilderDevPlaceholderProps) {
  const hint =
    variant === "no_content"
      ? "已配置 API Key，但该 urlPath 在 Builder 中尚无已发布内容。"
      : "未配置 NEXT_PUBLIC_BUILDER_API_KEY，或本地未加载 Builder 内容。";

  return (
    <div
      className="border-b border-dashed border-amber-400 bg-amber-50 px-4 py-8 text-center"
      data-builder-url-path={urlPath}
    >
      <p className="text-sm font-semibold text-amber-950">Builder.io 区块（开发预览）</p>
      <p className="mt-2 text-xs text-amber-900/90">{hint}</p>
      <p className="mt-2 font-mono text-xs text-amber-800">urlPath = {urlPath}</p>
      <p className="mt-3 text-xs text-amber-900/75">
        在 Builder 控制台创建模型「page」（或 NEXT_PUBLIC_BUILDER_MODEL），Targeting 使用上述 urlPath。
      </p>
    </div>
  );
}
