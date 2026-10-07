-- Reports, and ward maps drawn on add-town.html, anywhere in India.
-- A spot outside West Bengal is filed under its district and state (kasa_private.locate_india, rows in
-- 20261002090100_kasa_india_district_rows.sql from tools/build-in-map.py): area_kind 'india',
-- place 'in:<state-slug>:<district-slug>', district and state set. Everything in West Bengal is unchanged,
-- and every West Bengal page and count (which read place, district) stays as it was.
-- A town's ward map can be sent from any district in India ('<District>, <State>').
-- Safe to re-run.
begin;

alter table kasa_private.areas drop constraint if exists areas_kind_check;
alter table kasa_private.areas add constraint areas_kind_check
  check (kind in ('block', 'ward', 'town', 'gp', 'place_ward', 'district', 'in_district'));

alter table public.reports add column if not exists state text;

create or replace function kasa_private.locate_india(p_lat double precision, p_lng double precision)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', 'india', 'district', split_part(a.name, ', ', 1),
                            'state', substr(a.name, length(split_part(a.name, ', ', 1)) + 3), 'place', a.id)
  from kasa_private.areas a
  where a.kind = 'in_district' and p_lat between a.min_lat and a.max_lat and p_lng between a.min_lng and a.max_lng
    and kasa_private.in_polygons(p_lat, p_lng, a.polygons)
  order by a.id limit 1
$$;

create or replace function kasa_private.locate_any(p_lat double precision, p_lng double precision, p_ward integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(kasa_private.locate(p_lat, p_lng, p_ward), kasa_private.locate_place(p_lat, p_lng),
                  kasa_private.locate_district(p_lat, p_lng), kasa_private.locate_india(p_lat, p_lng))
$$;

create or replace function kasa_private.set_report_area()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_loc jsonb := kasa_private.locate_any(new.lat, new.lng, new.ward_no);
begin
  new.area_kind     := v_loc ->> 'kind';
  new.block_name    := v_loc ->> 'block';
  new.local_body    := v_loc ->> 'body';
  new.boundary_type := coalesce(v_loc ->> 'body_type', new.boundary_type);
  new.place         := v_loc ->> 'place';
  new.place_ward    := case when v_loc ->> 'kind' = 'place' then (v_loc ->> 'ward')::integer end;
  new.district      := v_loc ->> 'district';
  new.state         := coalesce(v_loc ->> 'state', 'West Bengal');
  return new;
end $$;

create or replace function public.kasa_submit_place(p_town text, p_district text, p_body text, p_body_type text,
    p_incharge text, p_incharge_source text, p_complaint_url text, p_map_source text, p_drawn boolean,
    p_fix_of text, p_geojson jsonb, p_contact text, p_note text default null, p_pin jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip    text := kasa_private.ip_hash();
  v_town  text := nullif(trim(p_town), '');
  v_body  text := nullif(trim(p_body), '');
  v_src   text := nullif(trim(p_map_source), '');
  v_url   text := nullif(trim(p_complaint_url), '');
  v_note  text := nullif(trim(p_note), '');
  v_only_note boolean;
  v_wards jsonb;
begin
  if v_town is null or length(v_town) > 80 then perform kasa_private.fail('KASA_BAD_FORM', 'Give the town''s name.'); end if;
  if p_district is null or not (exists (select 1 from kasa_private.areas where kind in ('district', 'in_district') and name = p_district)
                                or (coalesce(p_fix_of, '') = 'purulia' and p_district = 'Purulia')
                                or (coalesce(p_fix_of, '') like 'area:%' and p_district = 'Purulia')) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose the district.');
  end if;
  if v_body is null or length(v_body) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Name the municipality or panchayat.'); end if;
  if p_body_type not in ('municipality', 'gram_panchayat') then perform kasa_private.fail('KASA_BAD_FORM', 'Choose the kind of local body.'); end if;
  if nullif(trim(p_incharge), '') is not null and nullif(trim(p_incharge_source), '') is null then
    perform kasa_private.fail('KASA_BAD_FORM', 'Say where you found who is in charge of cleaning.');
  end if;
  if length(coalesce(p_incharge, '')) > 300 or length(coalesce(p_incharge_source, '')) > 300
     or length(coalesce(v_src, '')) > 300 or length(coalesce(p_contact, '')) > 120 or length(coalesce(v_note, '')) > 1000 then
    perform kasa_private.fail('KASA_TOO_LONG', 'That is too long. Please shorten it.');
  end if;
  if v_url is not null and (v_url !~* '^https://[^ ]+$' or length(v_url) > 300) then
    perform kasa_private.fail('KASA_BAD_FORM', 'The complaint link must start with https://');
  end if;
  if p_fix_of is not null and p_fix_of <> 'purulia'
     and not (length(p_fix_of) <= 200 and p_fix_of ~ '^area:(district:[a-z0-9-]+|block:[a-z0-9-]+:[^:]+|gp:[a-z0-9-]+:[^:]+:[^:]+)$')
     and not exists (select 1 from kasa_private.places where slug = p_fix_of) then
    perform kasa_private.fail('KASA_BAD_FORM', 'That town is not on the map yet.');
  end if;
  if p_pin is not null and (jsonb_typeof(p_pin) <> 'array' or jsonb_array_length(p_pin) <> 2
      or jsonb_typeof(p_pin -> 0) <> 'number' or jsonb_typeof(p_pin -> 1) <> 'number'
      or (p_pin ->> 1)::double precision not between 21.4 and 27.4
      or (p_pin ->> 0)::double precision not between 85.7 and 90.0) then
    perform kasa_private.fail('KASA_BAD_FORM', 'The pinned spot must be in West Bengal.');
  end if;
  v_only_note := p_fix_of is not null and v_note is not null
    and (p_geojson is null or jsonb_typeof(p_geojson -> 'features') <> 'array' or jsonb_array_length(p_geojson -> 'features') = 0);
  if v_src is null and not v_only_note then perform kasa_private.fail('KASA_BAD_FORM', 'Say where the ward map comes from.'); end if;
  if length(coalesce(p_geojson::text, '')) > 2000000 then
    perform kasa_private.fail('KASA_BAD_MAP', 'The map file is too big (2 MB at most). Simplify it and try again.');
  end if;
  v_wards := case when v_only_note then '[]'::jsonb else kasa_private.clean_wards(p_geojson) end;
  if kasa_private.text_verdict(concat_ws(' ', v_town, v_body, p_incharge, v_src, v_note,
       (select string_agg(concat_ws(' ', w ->> 'name', w ->> 'note'), ' ') from jsonb_array_elements(v_wards) w))) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.place_submissions
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 5)
     or (select count(*) from kasa_private.place_submissions where created_at > now() - interval '1 day') >= 50 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many maps sent right now. Please try again tomorrow.');
  end if;
  insert into kasa_private.place_submissions (town, district, body, body_type, incharge, incharge_source, complaint_url,
      map_source, drawn, fix_of, wards, ward_count, contact, ip_hash, note, pin)
  values (v_town, p_district, v_body, p_body_type, nullif(trim(p_incharge), ''), nullif(trim(p_incharge_source), ''), v_url,
      coalesce(v_src, 'Note only'), coalesce(p_drawn, false) and not v_only_note, p_fix_of, v_wards, jsonb_array_length(v_wards),
      nullif(trim(p_contact), ''), v_ip, v_note, p_pin);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- A ward map can be anywhere in India (it was West Bengal's box).
create or replace function kasa_private.clean_wards(p_geojson jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  f jsonb; g jsonb; v_ward integer; v_raw text; v_polys jsonb; v_out jsonb := '[]'::jsonb;
  v_seen integer[] := '{}'; v_points integer := 0; r jsonb;
begin
  if p_geojson is null or jsonb_typeof(p_geojson) <> 'object' or p_geojson ->> 'type' <> 'FeatureCollection'
     or jsonb_typeof(p_geojson -> 'features') <> 'array' then
    perform kasa_private.fail('KASA_BAD_MAP', 'The map must be a GeoJSON FeatureCollection of ward outlines.');
  end if;
  if jsonb_array_length(p_geojson -> 'features') not between 1 and 300 then
    perform kasa_private.fail('KASA_BAD_MAP', 'The map needs between 1 and 300 wards.');
  end if;
  for f in select jsonb_array_elements(p_geojson -> 'features') loop
    g := f -> 'geometry';
    v_raw := coalesce(f #>> '{properties,ward}', f #>> '{properties,ward_no}', f #>> '{properties,WARD}',
                      f #>> '{properties,Ward}', f #>> '{properties,WARD_NO}', f #>> '{properties,Ward_No}');
    if v_raw is null or trim(v_raw) !~ '^[0-9]{1,3}$' then
      perform kasa_private.fail('KASA_BAD_MAP', 'Every ward needs its number (a "ward" property).');
    end if;
    v_ward := trim(v_raw)::integer;
    if v_ward not between 1 and 500 or v_ward = any(v_seen) then
      perform kasa_private.fail('KASA_BAD_MAP', format('Ward %s is missing a valid number or appears twice.', v_ward));
    end if;
    v_seen := v_seen || v_ward;
    if g ->> 'type' = 'Polygon' then v_polys := jsonb_build_array(g -> 'coordinates');
    elsif g ->> 'type' = 'MultiPolygon' then v_polys := g -> 'coordinates';
    else perform kasa_private.fail('KASA_BAD_MAP', format('Ward %s is not a polygon.', v_ward));
    end if;
    if jsonb_typeof(v_polys) <> 'array' or jsonb_array_length(v_polys) = 0
       or exists (select 1 from jsonb_array_elements(v_polys) p
                  where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0
                     or exists (select 1 from jsonb_array_elements(p) ring
                                where jsonb_typeof(ring) <> 'array' or jsonb_array_length(ring) < 4)) then
      perform kasa_private.fail('KASA_BAD_MAP', format('Ward %s has a broken outline.', v_ward));
    end if;
    for r in select jsonb_path_query(v_polys, '$[*][*][*]') loop
      v_points := v_points + 1;
      if jsonb_typeof(r) <> 'array' or jsonb_typeof(r -> 0) <> 'number' or jsonb_typeof(r -> 1) <> 'number'
         or (r ->> 1)::double precision not between 6.5 and 37.5
         or (r ->> 0)::double precision not between 68.0 and 97.5 then
        perform kasa_private.fail('KASA_BAD_MAP', format('Ward %s has points outside West Bengal.', v_ward));
      end if;
    end loop;
    v_polys := (select jsonb_agg((select jsonb_agg((select jsonb_agg(jsonb_build_array(
                  round((pt ->> 0)::numeric, 6), round((pt ->> 1)::numeric, 6)))
                  from jsonb_array_elements(ring) pt)) from jsonb_array_elements(p) ring))
                from jsonb_array_elements(v_polys) p);
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('ward', v_ward, 'polygons', v_polys,
      'name', left(nullif(trim(f #>> '{properties,name}'), ''), 80),
      'note', left(nullif(trim(f #>> '{properties,note}'), ''), 300))));
  end loop;
  if v_points > 60000 then perform kasa_private.fail('KASA_BAD_MAP', 'The map is too detailed. Simplify it and try again.'); end if;
  return v_out;
end $$;

-- District and state on every public report (a report outside West Bengal is named by them).
create or replace view kasa_private.public_reports_all as
select r.id,
       date_trunc('hour', r.created_at) as created_at,
       r.lat, r.lng, r.ward_no, r.category, r.severity, r.status, r.description, r.landmark, r.photo_url,
       coalesce(r.upvotes, 0) as upvotes, r.seen_on_site, coalesce(r.flags, 0) as flags, r.moderation_status,
       coalesce(r.is_duplicate, false) as is_duplicate, r.parent_report_id, r.recurrence_count, r.rejected_claims,
       date_trunc('hour', r.resolved_at) as resolved_at,
       r.resolved_photo_url, r.resolution_method, coalesce(r.sla_days, 7) as sla_days,
       (r.accuracy_m is not null) as gps_verified,
       c.id as claim_id, c.photo_url as claim_photo_url,
       date_trunc('hour', c.created_at) as claim_created_at,
       c.verify_count as claim_verify_count, c.dispute_count as claim_dispute_count,
       date_trunc('hour', c.quorum_reached_at) as claim_quorum_reached_at,
       date_trunc('hour', c.final_after + interval '59 minutes 59 seconds') as claim_finalize_after,
       round(c.distance_m::numeric) as claim_distance_m,
       r.rating_count, r.onsite_rating_count, r.authenticity_avg, r.severity_avg, r.neighbour_status, r.reply_count,
       c.needs_review as claim_needs_review,
       r.area_kind, r.block_name,
       (select (s.value #>> '{}')::integer from kasa_private.settings s
        where s.key = case when r.area_kind = 'rural' then 'rural_verify_quorum' else 'verify_quorum' end) as verify_needed,
       date_trunc('hour', c.reviewed_at) as claim_reviewed_at,
       r.boundary_type,
       r.waste_type,
       r.local_body,
       r.place,
       r.place_ward,
       r.district,
       r.state
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id
where r.moderation_status in ('approved', 'flagged');
revoke all on kasa_private.public_reports_all from public, anon, authenticated;

-- Purulia only: every Purulia page (map, analytics, ward, digest, waste, toilets) reads this.
create or replace view public.kasa_public_reports as
select * from kasa_private.public_reports_all where place is null;
revoke all on public.kasa_public_reports from public, anon, authenticated;
grant select on public.kasa_public_reports to anon, authenticated;

create or replace view public.kasa_public_place_reports as
select * from kasa_private.public_reports_all where place is not null;
revoke all on public.kasa_public_place_reports from public, anon, authenticated;
grant select on public.kasa_public_place_reports to anon, authenticated;

revoke all on function kasa_private.locate_india(double precision, double precision) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
