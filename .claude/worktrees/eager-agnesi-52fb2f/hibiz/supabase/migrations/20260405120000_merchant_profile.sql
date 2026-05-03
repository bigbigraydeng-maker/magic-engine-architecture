-- Merchant-facing contact + property promo (poster inputs). Stored on microsites so public published pages can read it via view.

alter table public.microsites
add column if not exists merchant_profile jsonb default null;

comment on column public.microsites.merchant_profile is 'v1: contact (phone, email, address) + property_promo (headline, details, image_url, trademe_url). No listing feed — manual promo only.';

drop view if exists public.microsites_published;

create view public.microsites_published with (security_invoker = true) as
select
  id,
  project_id,
  slug,
  published_model,
  seo,
  published_at,
  merchant_profile
from
  public.microsites
where
  published_at is not null
  and published_model is not null;

comment on view public.microsites_published is 'Safe columns for public rendering; includes merchant_profile for contact/poster data.';

grant select on public.microsites_published to anon, authenticated;
