-- ════════════════════════════════════════════════════════════════════
-- PURULIA KASA — Hostel sites: cited or owner-supplied
--
-- A site's floor list is either cited to a document (source_kind 'cited') or was
-- supplied by the owner without a document yet (source_kind 'owner_supplied').
-- Owner-supplied sites are shown as Unverified, with a link to help verify them.
-- Nothing else changes: checks, verification and exports are the same.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

begin;

alter table kasa_private.hostel_sites add column if not exists source_kind text not null default 'cited';
do $$ begin
  alter table kasa_private.hostel_sites add constraint hostel_sites_source_kind_check
    check (source_kind in ('cited', 'owner_supplied'));
exception when duplicate_object then null; end $$;

drop function if exists public.kasa_admin_hostel_add_site(text, text, text, text, text[]);
create or replace function public.kasa_admin_hostel_add_site(p_name text, p_place text, p_district text,
                                                             p_source_url text, p_floors text[],
                                                             p_source_kind text default 'cited') returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_f  text;
  v_i  integer := 0;
begin
  if not kasa_private.is_admin() then raise exception 'Moderators only.'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_place), '') = '' or coalesce(trim(p_source_url), '') = '' then
    raise exception 'Name, place and a source link are needed.';
  end if;
  if p_source_kind not in ('cited', 'owner_supplied') then raise exception 'Unknown source kind.'; end if;
  if p_floors is null or cardinality(p_floors) = 0 then raise exception 'List at least one floor.'; end if;
  insert into kasa_private.hostel_sites (name, place, district, source_url, source_kind)
  values (trim(p_name), trim(p_place), nullif(trim(p_district), ''), trim(p_source_url), p_source_kind)
  returning id into v_id;
  foreach v_f in array p_floors loop
    v_i := v_i + 1;
    insert into kasa_private.hostel_floors (site_id, label, ord) values (v_id, trim(v_f), v_i);
  end loop;
  return v_id;
end $$;
revoke all on function public.kasa_admin_hostel_add_site(text, text, text, text, text[], text) from public, anon;
grant execute on function public.kasa_admin_hostel_add_site(text, text, text, text, text[], text) to authenticated;

create or replace function public.kasa_hostel_sites() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'place', s.place, 'district', s.district, 'source_url', s.source_url,
           'source_kind', s.source_kind,
           'floors', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label) order by f.ord), '[]'::jsonb)
                      from kasa_private.hostel_floors f where f.site_id = s.id))
         order by s.name), '[]'::jsonb)
  from kasa_private.hostel_sites s where s.active
$$;
revoke all on function public.kasa_hostel_sites() from public;
grant execute on function public.kasa_hostel_sites() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
