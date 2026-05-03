-- Allow anonymous lead submission rate checks without exposing row contents (RLS blocks SELECT for anon).

create or replace function public.check_lead_rate_limit (p_form_id uuid, p_ip_hash text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hour_count int;
  ip_recent int;
begin
  if p_form_id is null or p_ip_hash is null or length(p_ip_hash) < 8 then
    return false;
  end if;

  /* Only count submissions for forms that are active on a published microsite (same rule as insert policy). */
  if not exists (
    select
      1
    from
      public.forms f
      inner join public.microsites m on m.project_id = f.project_id
    where
      f.id = p_form_id
      and f.status = 'active'
      and m.published_at is not null
      and m.published_model is not null
  ) then
    return false;
  end if;

  select
    count(*)::int into hour_count
  from
    public.submissions s
  where
    s.form_id = p_form_id
    and s.created_at > now() - interval '1 hour';

  if hour_count >= 80 then
    return false;
  end if;

  select
    count(*)::int into ip_recent
  from
    public.submissions s
  where
    s.form_id = p_form_id
    and s.created_at > now() - interval '10 minutes'
    and coalesce(s.meta ->> 'ip_hash', '') = p_ip_hash;

  if ip_recent >= 10 then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.check_lead_rate_limit is 'Returns true if a new public lead may be inserted (caps per form / per IP hash).';

revoke all on function public.check_lead_rate_limit (uuid, text) from public;

grant execute on function public.check_lead_rate_limit (uuid, text) to anon, authenticated;
