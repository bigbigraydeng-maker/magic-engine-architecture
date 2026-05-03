import type {
  ListingsContent,
  OpenHomeContent,
  ServicesContent,
  TestimonialsContent,
} from "@/types/render-model";

export function ListingsModuleSection({ content }: { content: ListingsContent }) {
  return (
    <section className="border-y border-stone-200 px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <h2 className="font-display text-2xl font-semibold text-stone-900">{content.heading}</h2>
        {content.items.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">暂无房源，可在项目设置中添加。</p>
        ) : (
          <ul className="mt-8 grid gap-6 sm:grid-cols-2">
            {content.items.map((item) => (
              <li
                key={item.id}
                className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-stone-300/90 hover:shadow-md"
              >
                <div className="aspect-[4/3] bg-stone-100">
                  {item.images[0] ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.images[0]}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-stone-400">No image</div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-display text-lg font-semibold text-stone-900">{item.name}</h3>
                  <p className="mt-1 text-sm text-stone-600">{item.address}</p>
                  {item.price_hint ? <p className="mt-2 text-sm font-medium text-emerald-900">{item.price_hint}</p> : null}
                  {item.description ? <p className="mt-2 line-clamp-4 text-sm text-stone-600">{item.description}</p> : null}
                  {item.trademe_url ? (
                    <a
                      href={item.trademe_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-sm font-medium text-emerald-800 underline"
                    >
                      查看 TradeMe
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function TestimonialsModuleSection({ content }: { content: TestimonialsContent }) {
  return (
    <section className="px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-2xl font-semibold text-stone-900">{content.heading}</h2>
        <ul className="mt-8 space-y-6">
          {content.items.map((item, i) => (
            <li key={i} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-stone-700">&ldquo;{item.quote}&rdquo;</p>
              <p className="mt-3 text-sm font-medium text-stone-900">
                {item.author}
                {item.role ? <span className="font-normal text-stone-500"> · {item.role}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function OpenHomeModuleSection({ content }: { content: OpenHomeContent }) {
  return (
    <section className="px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-2xl font-semibold text-stone-900">{content.heading}</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-stone-700">
          {content.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        {content.cta_label ? (
          <p className="mt-6 inline-block rounded-full bg-emerald-800 px-5 py-2 text-sm font-semibold text-white">
            {content.cta_label}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function ServicesModuleSection({ content }: { content: ServicesContent }) {
  return (
    <section className="border-y border-stone-200 bg-stone-100/50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-2xl font-semibold text-stone-900">{content.heading}</h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-3">
          {content.items.map((item, i) => (
            <li key={i} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <h3 className="font-medium text-stone-900">{item.title}</h3>
              <p className="mt-2 text-sm text-stone-600">{item.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
