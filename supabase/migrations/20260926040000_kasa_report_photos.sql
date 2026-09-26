-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — up to 3 photos per report
--
-- The first photo stays reports.photo_path, created with the report as
-- before. Up to 2 more are attached right after, by the same person, within
-- 30 minutes, through kasa_add_report_photo — and each goes through exactly
-- the checks the first photo does (kasa_private.check_photo: live upload by
-- this person, not reused, Vision scan; photo_meta_verdict: live camera
-- token). A face or an AI-edit marker on an extra photo sends the report
-- back to moderator review, as it would for the first.
--
-- Extra photos count as "in use" (photo_in_use), so the orphan cleanup keeps them and they
-- can't be reused on another report. kasa_report_photos(id)
-- returns them only for reports visible in kasa_public_reports.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

do $$
declare v_type text := (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                        where a.attrelid = 'public.reports'::regclass and a.attname = 'id');
begin
  execute format($t$
    create table if not exists kasa_private.report_photos (
      report_id  %1$s not null references public.reports(id) on delete cascade,
      position   smallint not null check (position between 2 and 3),
      photo_path text not null unique,
      photo_url  text not null,
      created_at timestamptz not null default now(),
      primary key (report_id, position)
    )$t$, v_type);
end $$;
alter table kasa_private.report_photos enable row level security;
revoke all on kasa_private.report_photos from public, anon, authenticated;

create or replace function kasa_private.photo_in_use(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.photo_path = p_path)
      or exists (select 1 from kasa_private.report_photos rp where rp.photo_path = p_path)
      or exists (select 1 from kasa_private.claims c where c.photo_path = p_path)
      or exists (select 1 from kasa_private.votes v where v.photo_path = p_path)
      or (to_regclass('public.school_audits') is not null
          and exists (select 1 from public.school_audits a where a.photo_path = p_path))
$$;

create or replace function public.kasa_add_report_photo(p_report_id text, p_photo_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  r      public.reports;
  v_n    integer;
  v_chk  kasa_private.photo_checks;
  v_meta jsonb;
  v_url  text;
begin
  select * into r from public.reports where id::text = p_report_id and user_id = me.user_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.created_at < now() - interval '30 minutes' then
    perform kasa_private.fail('KASA_TOO_LATE', 'Extra photos can only be added right after reporting.');
  end if;
  select count(*) into v_n from kasa_private.report_photos where report_id = r.id;
  if v_n >= 2 then perform kasa_private.fail('KASA_TOO_MANY_PHOTOS', 'A report can have up to 3 photos.'); end if;

  v_chk := kasa_private.check_photo(p_photo_path, 'reports', me.user_id, r.created_at - interval '30 minutes', r.lat, r.lng);
  v_meta := kasa_private.photo_meta_verdict(p_photo_path, false, r.lat, r.lng, null);
  if kasa_private.cfg_bool('require_live_report_photo') and coalesce(v_meta ->> 'capture', 'unknown') <> 'live' then
    perform kasa_private.fail('KASA_PHOTO_NOT_LIVE', 'Take the photo with the camera in the app.');
  end if;
  v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;

  insert into kasa_private.report_photos (report_id, position, photo_path, photo_url)
  values (r.id, v_n + 2, p_photo_path, v_url);

  if (coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> 'ai_edited')::boolean, false))
     and r.moderation_status = 'approved' then
    update public.reports set moderation_status = 'review' where id = r.id;
  end if;
  return jsonb_build_object('position', v_n + 2, 'photo_url', v_url);
end $$;

revoke all on function public.kasa_add_report_photo(text, text) from public, anon;
grant execute on function public.kasa_add_report_photo(text, text) to authenticated;

-- Extra photos of one report, only if the report itself is public. A function, not a view:
-- a view would depend on kasa_public_reports, which older migrations drop and recreate.
drop view if exists public.kasa_public_report_photos;
create or replace function public.kasa_report_photos(p_report_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.kasa_public_reports v where v.id::text = p_report_id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('position', rp.position, 'photo_url', rp.photo_url) order by rp.position)
                   from kasa_private.report_photos rp where rp.report_id::text = p_report_id), '[]'::jsonb);
end $$;
revoke all on function public.kasa_report_photos(text) from public;
grant execute on function public.kasa_report_photos(text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
