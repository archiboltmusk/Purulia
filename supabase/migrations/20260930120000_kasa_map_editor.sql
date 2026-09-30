-- Map editor on add-town.html: a note and a pinned spot for the moderator, ward names and notes kept
-- with each submitted ward, and fixes that are only a note (no redrawn wards).
begin;

alter table kasa_private.place_submissions add column if not exists note text;   -- what is wrong / what changed
alter table kasa_private.place_submissions add column if not exists pin  jsonb;  -- [lng, lat] the sender pinned

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
         or (r ->> 1)::double precision not between 21.4 and 27.4
         or (r ->> 0)::double precision not between 85.7 and 90.0 then
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


-- Adds p_note and p_pin. A fix may be just a note (and pin) with no wards; the moderator redraws it.
drop function if exists public.kasa_submit_place(text, text, text, text, text, text, text, text, boolean, text, jsonb, text);
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
  if p_district is null or not exists (select 1 from kasa_private.areas where kind = 'district' and name = p_district) then
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
  if p_fix_of is not null and not exists (select 1 from kasa_private.places where slug = p_fix_of) then
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

-- Approve: the town goes on the map (a fix replaces only the wards it sends). Reject: kept, with the reason.
create or replace function public.kasa_admin_review_place(p_id bigint, p_action text, p_slug text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s kasa_private.place_submissions;
  v_slug text;
  v_wards integer[];
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into s from kasa_private.place_submissions where id = p_id for update;
  if not found or s.status <> 'pending' then perform kasa_private.fail('KASA_BAD_FORM', 'That map was already reviewed.'); end if;
  if p_action = 'reject' then
    update kasa_private.place_submissions set status = 'rejected', review_note = nullif(trim(p_note), ''), reviewed_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  elsif p_action <> 'approve' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Approve or reject.');
  end if;
  -- A note-only fix changes nothing on the map: approving it marks it done (a moderator fixes the border).
  if s.ward_count = 0 then
    update kasa_private.place_submissions set status = 'approved', slug = s.fix_of, review_note = nullif(trim(p_note), ''),
           reviewed_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'approved', 'slug', s.fix_of);
  end if;

  v_slug := coalesce(s.fix_of, nullif(trim(lower(p_slug)), ''),
                     trim(both '-' from regexp_replace(lower(s.town), '[^a-z0-9]+', '-', 'g')));
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' or v_slug = 'purulia' or v_slug like 'district%' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give the town a short web name, like "bankura".');
  end if;
  if s.fix_of is null and exists (select 1 from kasa_private.places where slug = v_slug) then
    perform kasa_private.fail('KASA_BAD_FORM', format('"%s" is already on the map; approve it as a fix instead.', v_slug));
  end if;

  select array_agg((w ->> 'ward')::integer) into v_wards from jsonb_array_elements(s.wards) w;
  if s.fix_of is null then
    insert into kasa_private.places (slug, name, body, body_type, complaint_url, wards_mapped, wards_total, source, licence,
                                     district, status, community, incharge, incharge_source, updated_at)
    values (v_slug, s.town, s.body, s.body_type, s.complaint_url, s.ward_count, null, s.map_source,
            case when s.drawn then 'Community-drawn on Parishkar' else 'As sent by the contributor' end,
            s.district, case when s.drawn then 'provisional' else 'live' end, true, s.incharge, s.incharge_source, now());
  else
    -- A fix changes the borders it sends; the rest of the town stays as it was.
    delete from kasa_private.areas where kind = 'place_ward' and parent = v_slug and ward_no = any(v_wards);
    update kasa_private.places set
      status = case when s.drawn then 'provisional' else status end,
      community = true,
      incharge = coalesce(s.incharge, incharge), incharge_source = coalesce(s.incharge_source, incharge_source),
      complaint_url = coalesce(s.complaint_url, complaint_url),
      source = case when source like '%' || s.map_source || '%' then source else source || '; fixes: ' || s.map_source end,
      updated_at = now()
    where slug = v_slug;
  end if;

  delete from kasa_private.areas where kind = 'place_ward' and parent = v_slug and ward_no = any(v_wards);
  insert into kasa_private.areas (id, kind, name, ward_no, min_lat, max_lat, min_lng, max_lng, polygons, parent)
  select 'place_ward:' || v_slug || ':' || (w ->> 'ward'), 'place_ward', 'Ward ' || (w ->> 'ward'), (w ->> 'ward')::integer,
         b.min_lat, b.max_lat, b.min_lng, b.max_lng, w -> 'polygons', v_slug
  from jsonb_array_elements(s.wards) w
  cross join lateral (
    select min((pt ->> 1)::double precision) as min_lat, max((pt ->> 1)::double precision) as max_lat,
           min((pt ->> 0)::double precision) as min_lng, max((pt ->> 0)::double precision) as max_lng
    from jsonb_path_query(w -> 'polygons', '$[*][*][*]') pt) b;
  update kasa_private.places set wards_mapped = (select count(*) from kasa_private.areas
                                                 where kind = 'place_ward' and parent = v_slug)
  where slug = v_slug;

  update kasa_private.place_submissions set status = 'approved', slug = v_slug, review_note = nullif(trim(p_note), ''),
         reviewed_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'approved', 'slug', v_slug);
end $$;


revoke all on function kasa_private.clean_wards(jsonb) from public, anon, authenticated;
revoke all on function public.kasa_submit_place(text, text, text, text, text, text, text, text, boolean, text, jsonb, text, text, jsonb) from public;
grant execute on function public.kasa_submit_place(text, text, text, text, text, text, text, text, boolean, text, jsonb, text, text, jsonb) to anon, authenticated;
revoke all on function public.kasa_admin_review_place(bigint, text, text, text) from public, anon;
grant execute on function public.kasa_admin_review_place(bigint, text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
