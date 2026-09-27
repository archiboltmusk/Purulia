-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — residents share a school's official report card
--
-- Anyone can send a picture of a school's UDISE+ report card (a screenshot
-- from kys.udiseplus.gov.in, or a photo of the card the school displays)
-- together with the figures they read off it. Nothing is public until a
-- moderator has compared the figures with the picture and approved them;
-- approval writes them to schools.official with a link to the picture, so
-- the schools page can show the school's own record next to residents'
-- checks.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('report_cards_per_day', '15', 'School report cards one person can send per day')
on conflict (key) do nothing;

create table if not exists kasa_private.school_report_cards (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null,
  udise_code  text not null references public.schools(udise_code) on delete cascade,
  year        text not null check (year ~ '^20[0-9]{2}-[0-9]{2}$'),
  figures     jsonb not null,
  photo_path  text not null,
  photo_url   text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  note        text
);
create index if not exists kasa_report_cards_status_idx on kasa_private.school_report_cards (status, created_at);
create index if not exists kasa_report_cards_user_idx on kasa_private.school_report_cards (user_id, created_at desc);
alter table kasa_private.school_report_cards enable row level security;

-- A report card's picture counts as used, so it can't be reused as evidence elsewhere.
create or replace function kasa_private.photo_in_use(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.photo_path = p_path)
      or exists (select 1 from kasa_private.report_photos rp where rp.photo_path = p_path)
      or exists (select 1 from kasa_private.claims c where c.photo_path = p_path)
      or exists (select 1 from kasa_private.votes v where v.photo_path = p_path)
      or (to_regclass('public.school_audits') is not null
          and exists (select 1 from public.school_audits a where a.photo_path = p_path))
      or exists (select 1 from kasa_private.school_report_cards rc where rc.photo_path = p_path)
$$;

-- Only the figures a report card carries, each checked for type and range.
create or replace function kasa_private.clean_card_figures(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k   text;
  out jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  foreach k in array array['enrolment', 'teachers', 'classrooms'] loop
    if jsonb_typeof(p -> k) = 'number' and (p ->> k)::numeric between 0 and 5000 and (p ->> k)::numeric = floor((p ->> k)::numeric) then
      out := out || jsonb_build_object(k, (p ->> k)::integer);
    end if;
  end loop;
  foreach k in array array['drinking_water', 'girls_toilet', 'boys_toilet', 'electricity', 'boundary_wall',
                           'handwash', 'library', 'playground', 'ramp'] loop
    if jsonb_typeof(p -> k) = 'boolean' then out := out || jsonb_build_object(k, (p ->> k)::boolean); end if;
  end loop;
  return out;
end $$;

create or replace function public.kasa_submit_report_card(p_udise_code text, p_year text, p_figures jsonb, p_photo_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me  kasa_private.profiles := kasa_private.me();
  f   jsonb := kasa_private.clean_card_figures(p_figures);
  v_id uuid;
begin
  if not exists (select 1 from public.schools where udise_code = p_udise_code) then
    perform kasa_private.fail('KASA_NOT_FOUND', 'Choose a school from the list.');
  end if;
  if p_year is null or p_year !~ '^20[0-9]{2}-[0-9]{2}$' then
    perform kasa_private.fail('KASA_BAD_YEAR', 'Choose the year printed on the report card.');
  end if;
  if f = '{}'::jsonb then
    perform kasa_private.fail('KASA_CARD_EMPTY', 'Enter at least one figure from the report card.');
  end if;
  if (select count(*) from kasa_private.school_report_cards
      where user_id = me.user_id and created_at > now() - interval '1 day') >= kasa_private.cfg_num('report_cards_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have sent a lot of report cards today. Try again tomorrow.');
  end if;
  -- Same ownership, freshness and reuse rules as any photo; no location rule (a screenshot has none).
  perform kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, null, null);

  insert into kasa_private.school_report_cards (user_id, udise_code, year, figures, photo_path, photo_url)
  values (me.user_id, p_udise_code, p_year, f, p_photo_path,
          (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

create or replace function public.kasa_admin_report_card_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'created_at', c.created_at, 'udise_code', c.udise_code, 'school_name', s.name, 'block_name', s.block_name,
      'year', c.year, 'figures', c.figures, 'photo_url', c.photo_url,
      'current', s.official, 'current_year', s.official_year) order by c.created_at)
    from kasa_private.school_report_cards c join public.schools s on s.udise_code = c.udise_code
    where c.status = 'pending'
  ), '[]'::jsonb);
end $$;

-- Approving writes the figures to the school's official record (unless a newer
-- year is already there) with a link to the picture they were read from.
create or replace function public.kasa_admin_moderate_report_card(p_id text, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c kasa_private.school_report_cards;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Approve or reject.'); end if;
  update kasa_private.school_report_cards
  set status = case p_action when 'approve' then 'approved' else 'rejected' end, reviewed_at = now(), note = left(p_note, 500)
  where id::text = p_id and status = 'pending' returning * into c;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That report card is not waiting any more.'); end if;
  if p_action = 'approve' then
    update public.schools
    set official = c.figures || jsonb_build_object('source', 'report_card', 'source_url', c.photo_url),
        official_year = c.year, updated_at = now()
    where udise_code = c.udise_code and (official_year is null or official_year <= c.year);
  end if;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

revoke all on function kasa_private.clean_card_figures(jsonb) from public, anon, authenticated;
revoke all on function public.kasa_submit_report_card(text, text, jsonb, text) from public, anon;
grant execute on function public.kasa_submit_report_card(text, text, jsonb, text) to authenticated;
revoke all on function public.kasa_admin_report_card_queue() from public, anon;
grant execute on function public.kasa_admin_report_card_queue() to authenticated;
revoke all on function public.kasa_admin_moderate_report_card(text, text, text) from public, anon;
grant execute on function public.kasa_admin_moderate_report_card(text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
