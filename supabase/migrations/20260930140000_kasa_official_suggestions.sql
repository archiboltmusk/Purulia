-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — "Add who's responsible here" on the place card
--
-- Where a gram panchayat, block or district card has nobody on record (the
-- pradhan, sabhapati, sabhadhipati, or an officer the district website does
-- not list), anyone can send the name with a link to where it is published.
-- Nothing is public until a moderator has opened that link and approved it;
-- then kasa_officials() returns it and the card shows it with its source.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.official_suggestions (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  district    text not null,                       -- slug, as in places/wb_districts.geojson
  block       text,
  gp          text,
  level       text not null check (level in ('gp', 'block', 'district')),
  role        text not null check (role in ('pradhan', 'sabhapati', 'sabhadhipati', 'bdo', 'dm', 'zp')),
  name        text not null,
  phone       text,
  source_url  text not null,
  lat         double precision,
  lng         double precision,
  ip_hash     text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  review_note text
);
create index if not exists kasa_official_suggestions_status_idx on kasa_private.official_suggestions (status, created_at);
create index if not exists kasa_official_suggestions_district_idx on kasa_private.official_suggestions (district, status);
alter table kasa_private.official_suggestions enable row level security;

create or replace function public.kasa_submit_official(p_level text, p_district text, p_block text, p_gp text,
    p_role text, p_name text, p_phone text, p_source_url text, p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip    text := kasa_private.ip_hash();
  v_name  text := nullif(btrim(p_name), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+ -]', '', 'g'), '');
  v_url   text := nullif(btrim(p_source_url), '');
  v_block text := nullif(btrim(p_block), '');
  v_gp    text := nullif(btrim(p_gp), '');
begin
  if p_district is null or p_district !~ '^[a-z0-9-]{3,40}$' then perform kasa_private.fail('KASA_BAD_FORM', 'Choose the district.'); end if;
  if p_level not in ('gp', 'block', 'district') then perform kasa_private.fail('KASA_BAD_FORM', 'Choose the place.'); end if;
  -- Each role belongs to one tier: a pradhan to a gram panchayat, a sabhapati or BDO to a block, the rest to the district.
  if not ((p_role = 'pradhan' and p_level = 'gp' and v_gp is not null and v_block is not null)
       or (p_role in ('sabhapati', 'bdo') and v_block is not null)
       or (p_role in ('sabhadhipati', 'dm', 'zp') and p_level = 'district')) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose who you are adding.');
  end if;
  if p_role in ('sabhapati', 'bdo') then v_gp := null; end if;
  if p_role in ('sabhadhipati', 'dm', 'zp') then v_block := null; v_gp := null; end if;
  if v_name is null or length(v_name) > 120 or length(coalesce(v_block, '')) > 80 or length(coalesce(v_gp, '')) > 80
     or length(coalesce(v_phone, '')) > 20 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give the name (120 letters at most).');
  end if;
  if v_url is null or v_url !~* '^https?://[^ ]+\.[^ ]+$' or length(v_url) > 300 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Add the link where this is published.');
  end if;
  if p_lat is not null and (p_lat not between 21.4 and 27.4 or p_lng is null or p_lng not between 85.7 and 90.0) then
    perform kasa_private.fail('KASA_BAD_FORM', 'The place must be in West Bengal.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, v_block, v_gp)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.official_suggestions
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10)
     or (select count(*) from kasa_private.official_suggestions where created_at > now() - interval '1 day') >= 200 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many sent right now. Please try again tomorrow.');
  end if;
  insert into kasa_private.official_suggestions (district, block, gp, level, role, name, phone, source_url, lat, lng, ip_hash)
  values (p_district, v_block, v_gp, case when p_role = 'pradhan' then 'gp' when v_block is not null then 'block' else 'district' end,
          p_role, v_name, v_phone, v_url, p_lat, p_lng, v_ip);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- Approved names in a district: the newest approval for each role and place.
create or replace function public.kasa_officials(p_district text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('level', o.level, 'block', o.block, 'gp', o.gp, 'role', o.role, 'name', o.name,
                                               'phone', o.phone, 'source_url', o.source_url, 'checked', o.reviewed_at::date)), '[]'::jsonb)
  from (select distinct on (role, coalesce(block, ''), coalesce(gp, '')) *
        from kasa_private.official_suggestions
        where district = p_district and status = 'approved'
        order by role, coalesce(block, ''), coalesce(gp, ''), reviewed_at desc) o;
$$;

create or replace function public.kasa_admin_official_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at, 'district', s.district, 'block', s.block,
             'gp', s.gp, 'level', s.level, 'role', s.role, 'name', s.name, 'phone', s.phone, 'source_url', s.source_url,
             'lat', s.lat, 'lng', s.lng) order by s.created_at)
    from kasa_private.official_suggestions s where s.status = 'pending'
  ), '[]'::jsonb);
end $$;

-- Approve only after opening the source link and finding the name there.
create or replace function public.kasa_admin_review_official(p_id bigint, p_action text, p_name text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s kasa_private.official_suggestions;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Approve or reject.'); end if;
  update kasa_private.official_suggestions
  set status = case p_action when 'approve' then 'approved' else 'rejected' end,
      name = case when p_action = 'approve' and nullif(btrim(p_name), '') is not null then left(btrim(p_name), 120) else name end,
      reviewed_at = now(), review_note = left(p_note, 500)
  where id = p_id and status = 'pending' returning * into s;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That is not waiting any more.'); end if;
  return jsonb_build_object('id', s.id, 'status', s.status);
end $$;

revoke all on function public.kasa_submit_official(text, text, text, text, text, text, text, text, double precision, double precision) from public;
grant execute on function public.kasa_submit_official(text, text, text, text, text, text, text, text, double precision, double precision) to anon, authenticated;
revoke all on function public.kasa_officials(text) from public;
grant execute on function public.kasa_officials(text) to anon, authenticated;
revoke all on function public.kasa_admin_official_queue() from public, anon;
grant execute on function public.kasa_admin_official_queue() to authenticated;
revoke all on function public.kasa_admin_review_official(bigint, text, text, text) from public, anon;
grant execute on function public.kasa_admin_review_official(bigint, text, text, text) to authenticated;

commit;
