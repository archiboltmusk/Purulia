-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — shrink photos of long-fixed problems
--
-- Photos of a problem resolved more than shrink_after_days ago (default 90)
-- are re-saved smaller (longest side shrink_max_px, JPEG quality ~60) by the
-- kasa-photo-shrink Edge Function, in place, so every link keeps working.
-- The before/after record stays; only the resolution drops. Fingerprints
-- used for reuse checks were taken from the originals and are kept.
-- Runs nightly; the function only touches photos the database hands out.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('shrink_after_days', '90',   'Photos of problems resolved this many days ago are re-saved smaller (0 = never)'),
  ('shrink_max_px',     '1024', 'Longest side, in pixels, of a shrunk photo')
on conflict (key) do nothing;

create table if not exists kasa_private.photo_shrinks (
  photo_path   text primary key,
  claimed_at   timestamptz not null default now(),
  done_at      timestamptz,
  bytes_before integer,
  bytes_after  integer,
  error        text
);
alter table kasa_private.photo_shrinks enable row level security;
revoke all on kasa_private.photo_shrinks from public, anon, authenticated;

-- Every photo belonging to a report resolved long enough ago.
create or replace function kasa_private.shrinkable_photos() returns table (photo_path text)
language sql stable security definer set search_path = '' as $$
  with old as (
    select r.id, r.photo_path from public.reports r
    where r.status = 'resolved' and kasa_private.cfg_num('shrink_after_days') > 0
      and r.resolved_at < now() - make_interval(days => kasa_private.cfg_num('shrink_after_days')::integer))
  select o.photo_path from old o where o.photo_path is not null
  union select rp.photo_path from kasa_private.report_photos rp join old o on o.id = rp.report_id
  union select c.photo_path from kasa_private.claims c join old o on o.id = c.report_id
  union select v.photo_path from kasa_private.votes v join kasa_private.claims c on c.id = v.claim_id
                             join old o on o.id = c.report_id where v.photo_path is not null
$$;

create or replace function public.kasa_shrink_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_paths jsonb;
begin
  with pick as (
    select p.photo_path from kasa_private.shrinkable_photos() p
    left join kasa_private.photo_shrinks s on s.photo_path = p.photo_path
    where s.photo_path is null
       or (s.done_at is null and s.claimed_at < now() - interval '30 minutes' and coalesce(s.error, '') not like 'final:%')
    limit greatest(1, least(coalesce(p_limit, 20), 50))),
  ins as (
    insert into kasa_private.photo_shrinks (photo_path) select photo_path from pick
    on conflict (photo_path) do update set claimed_at = now(), error = null
    returning photo_path)
  select coalesce(jsonb_agg(photo_path), '[]'::jsonb) into v_paths from ins;
  return jsonb_build_object('paths', v_paths, 'max_px', kasa_private.cfg_num('shrink_max_px'));
end $$;

-- p_error starting with "final:" (e.g. not a JPEG) is never retried.
create or replace function public.kasa_shrink_done(p_path text, p_before integer, p_after integer, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update kasa_private.photo_shrinks
  set done_at = case when p_error is null then now() end, bytes_before = p_before, bytes_after = p_after,
      error = left(p_error, 300)
  where photo_path = p_path
$$;

revoke all on function kasa_private.shrinkable_photos() from public, anon, authenticated;
revoke all on function public.kasa_shrink_claim(integer) from public, anon, authenticated;
revoke all on function public.kasa_shrink_done(text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.kasa_shrink_claim(integer), public.kasa_shrink_done(text, integer, integer, text) to service_role;

-- Nightly at 02:40 IST (21:10 UTC).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('kasa-photo-shrink') where exists (select 1 from cron.job where jobname = 'kasa-photo-shrink');
    perform cron.schedule('kasa-photo-shrink', '10 21 * * *', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-photo-shrink', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        120000)
    $job$);
  end if;
exception when others then
  raise notice 'kasa: photo shrink scheduling skipped (%)', sqlerrm;
end $$;

commit;

notify pgrst, 'reload schema';
