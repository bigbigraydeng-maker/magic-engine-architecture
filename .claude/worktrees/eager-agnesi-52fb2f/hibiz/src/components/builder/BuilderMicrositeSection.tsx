import {
  Content,
  fetchOneEntry,
  getBuilderSearchParams,
} from "@builder.io/sdk-react-nextjs";
import { BuilderDevPlaceholder } from "./BuilderDevPlaceholder";

function defaultModel(): string {
  const m = process.env.NEXT_PUBLIC_BUILDER_MODEL?.trim();
  return m && m.length > 0 ? m : "page";
}

/** Next.js `searchParams` may include `undefined`; Builder expects `string | string[]`. */
function normalizeSearchParams(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

interface BuilderMicrositeSectionProps {
  /** Targeting path in Builder (e.g. `/site/my-slug`). */
  urlPath: string;
  /** Next.js `searchParams` — forwarded for visual editor preview. */
  searchParams: Record<string, string | string[] | undefined>;
}

/**
 * Optional Builder.io visual section for public microsites.
 * Requires `NEXT_PUBLIC_BUILDER_API_KEY` and content targeted at `urlPath` in Builder.
 */
export async function BuilderMicrositeSection({ urlPath, searchParams }: BuilderMicrositeSectionProps) {
  const apiKey = process.env.NEXT_PUBLIC_BUILDER_API_KEY?.trim();
  const isDev = process.env.NODE_ENV === "development";

  if (!apiKey) {
    return isDev ? <BuilderDevPlaceholder urlPath={urlPath} variant="no_api_key" /> : null;
  }

  const model = defaultModel();

  let content: Awaited<ReturnType<typeof fetchOneEntry>>;
  try {
    content = await fetchOneEntry({
      model,
      apiKey,
      userAttributes: { urlPath },
      options: getBuilderSearchParams(normalizeSearchParams(searchParams)),
    });
  } catch {
    return isDev ? <BuilderDevPlaceholder urlPath={urlPath} variant="no_content" /> : null;
  }

  if (!content) {
    return isDev ? <BuilderDevPlaceholder urlPath={urlPath} variant="no_content" /> : null;
  }

  return (
    <div className="builder-microsite-section" data-builder-url-path={urlPath}>
      <Content content={content} model={model} apiKey={apiKey} customComponents={[]} />
    </div>
  );
}
