-- A pinned spot can be anywhere in India, not only West Bengal (a town or ward problem outside WB
-- was refused with "must be in West Bengal"). Same function as 20261002090000_kasa_india.sql, bounds
-- widened to India's envelope (lat 6.5-37.6, lng 68.1-97.5). Points outside India are still refused.
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
      or (p_pin ->> 1)::double precision not between 6.5 and 37.6
      or (p_pin ->> 0)::double precision not between 68.1 and 97.5) then
    perform kasa_private.fail('KASA_BAD_FORM', 'The pinned spot must be in India.');
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

