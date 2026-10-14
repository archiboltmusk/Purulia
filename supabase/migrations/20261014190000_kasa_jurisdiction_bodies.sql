-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — who answers for a spot.
--
-- 1. kasa_jurisdictions_at also names the bodies the map already knows from
--    its own outlines (kasa_private.areas): the municipality of a mapped
--    ward or town; outside towns, the gram panchayat, the panchayat samiti
--    of the block and the zilla parishad of the district (WB Panchayat Act
--    1973). Each comes with the source of its outline or of the law. Rows in
--    kasa_private.jurisdictions (PWD, NHAI, ...) still come first.
-- 2. kasa_private.block_key gets a fixed search_path (Supabase advisor).
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter function kasa_private.block_key(text) set search_path = '';

-- ── 1. Bodies from the map's own outlines ────────────────────────────────
create or replace function public.kasa_jurisdictions_at(p_lat double precision, p_lng double precision) returns jsonb
language sql stable security definer set search_path = '' as $$
  with hit as (
    select a.id, a.kind, a.name from kasa_private.areas a
    where a.kind in ('ward', 'town', 'place_ward', 'gp', 'block', 'district')
      and p_lat between a.min_lat and a.max_lat and p_lng between a.min_lng and a.max_lng
      and kasa_private.in_polygons(p_lat, p_lng, a.polygons)
  ), town as (
    select exists (select 1 from hit where kind in ('ward', 'town', 'place_ward')) as yes
  ), act as (
    select 'https://prsindia.org/files/bills_acts/acts_states/west-bengal/1973/ActNo-41of1973-WB.pdf'::text as url
  ), listed as (
    select 1 as rank, j.id, j.body, j.body_type, j.department, j.lgd_code, j.source_url, j.note
    from kasa_private.jurisdictions j
    left join kasa_private.areas a on a.id = j.area_id
    where case when j.outline is not null then
            p_lat between j.min_lat and j.max_lat and p_lng between j.min_lng and j.max_lng
            and kasa_private.distance_to_geojson_m(p_lat, p_lng, j.outline) = 0
          else
            p_lat between a.min_lat and a.max_lat and p_lng between a.min_lng and a.max_lng
            and kasa_private.in_polygons(p_lat, p_lng, a.polygons)
          end
  ), derived as (
    select 2, null::bigint, 'Purulia Municipality', 'municipality', null::text, null::text,
           'https://purulia.gov.in/block-municipality/', 'Ward outline: Purulia municipality ward map'
    from hit where kind = 'ward' and id like 'ward:purulia-%'
    union all
    select 2, null, h.name, 'municipality', null, null,
           'https://github.com/yashveeeeeeer/india-geodata', 'Town outline: Survey of India, via india-geodata'
    from hit h where h.kind = 'town'
    union all
    select 2, null, p.body, p.body_type, null, p.lgd_code,
           coalesce(substring(p.source from 'https?://[^] )]+'), 'https://github.com/yashveeeeeeer/india-geodata'),
           'Ward outline: ' || h.name
    from hit h join kasa_private.places p on p.slug = split_part(h.id, ':', 2)
    where h.kind = 'place_ward'
    union all
    select 3, null, h.name || ' Gram Panchayat', 'gram_panchayat', null, nullif(split_part(h.id, ':', 2), ''),
           'https://github.com/yashveeeeeeer/india-geodata', 'Outline: Local Government Directory. Duties: WB Panchayat Act 1973, s.19'
    from hit h, town where h.kind = 'gp' and not town.yes
    union all
    select 4, null, h.name || ' Panchayat Samiti', 'panchayat_samiti', null, null,
           act.url, 'The samiti of this CD block. Duties: WB Panchayat Act 1973, s.109'
    from hit h, town, act where h.kind = 'block' and not town.yes
    union all
    select 5, null, h.name || ' Zilla Parishad', 'zilla_parishad', null, null,
           act.url, 'Duties: WB Panchayat Act 1973, s.153'
    from hit h, town, act where h.kind = 'district' and not town.yes
    union all
    -- Purulia's own blocks stand in for its district outline.
    select 5, null, 'Purulia Zilla Parishad', 'zilla_parishad', null, null,
           'https://purulia.gov.in/zilla-parishad/', 'Duties: WB Panchayat Act 1973, s.153'
    from town where not town.yes and exists (select 1 from hit where kind = 'block')
      and not exists (select 1 from hit where kind = 'district')
  ), alls as (
    select * from listed union all select * from derived
  ), one as (
    select distinct on (lower(body)) * from alls order by lower(body), rank
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'body', body, 'body_type', body_type, 'department', department,
      'lgd_code', lgd_code, 'source_url', source_url, 'note', note, 'from_map', id is null) order by rank, body), '[]'::jsonb)
  from one
$$;


commit;
