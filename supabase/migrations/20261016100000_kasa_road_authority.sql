-- Road authority per report (OpenStreetMap India network tags) and tender
-- candidates for that road. Tenders are candidates until a moderator confirms
-- the match to a road. Warranty only from a tender record that states it.
--
-- Tables: kasa_private.road_tags (one row per report, filled by kasa-road-tag),
--         kasa_private.tender_candidates (added by a moderator from the portal page).
-- Public: kasa_report_road(report_id) -> authority, road, candidate tenders.
-- Data: OpenStreetMap (ODbL) IN:NH / IN:SH / IN:MDR / IN:ODR / IN:VR network tags.

create table if not exists kasa_private.road_tags (
  report_id  uuid primary key references public.reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  tries      smallint not null default 0,
  checked_at timestamptz,            -- null until a lookup finished
  way_id     bigint,                 -- OSM way id of the nearest tagged road
  road_name  text,
  road_ref   text,
  network    text,                   -- raw OSM network tag, e.g. IN:SH
  authority  text                    -- national_highway | state_highway | major_district_road | other_district_road | village_road
);
create index if not exists road_tags_pending on kasa_private.road_tags (created_at) where checked_at is null;

create table if not exists kasa_private.tender_candidates (
  id                 bigserial primary key,
  added_at           timestamptz not null default now(),
  tender_id          text not null unique,
  reference_number   text,
  title              text not null,
  organisation_chain text,
  town               text,
  published_at       timestamptz,
  bid_closes_at      timestamptz,
  bid_opens_at       timestamptz,
  tender_value_inr   text,
  emd_inr            text,
  period_days        integer,
  source_url         text not null check (source_url like 'https://%'),
  warranty_months    smallint check (warranty_months between 0 and 120),
  warranty_source_url text,
  constraint tender_warranty_cited check (warranty_months is null or warranty_source_url is not null),
  way_id             bigint,         -- set only by a moderator confirming the road match
  status             text not null default 'candidate' check (status in ('candidate', 'confirmed', 'rejected')),
  reviewed_at        timestamptz,
  review_note        text
);

revoke all on kasa_private.road_tags, kasa_private.tender_candidates from public, anon, authenticated;

-- ── Authority from OSM tags ──────────────────────────────────────────────
create or replace function kasa_private.road_authority(p_network text, p_ref text) returns text
language sql immutable set search_path = '' as $$
  select case upper(trim(coalesce(p_network, '')))
    when 'IN:NH' then 'national_highway'
    when 'IN:SH' then 'state_highway'
    when 'IN:MDR' then 'major_district_road'
    when 'IN:ODR' then 'other_district_road'
    when 'IN:VR' then 'village_road'
    else case when upper(coalesce(p_ref, '')) ~ '^NH[ -]?[0-9]' then 'national_highway'
              when upper(coalesce(p_ref, '')) ~ '^SH[ -]?[0-9]' then 'state_highway'
              else null end
  end
$$;

create or replace function kasa_private.road_authority_label(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case p_code
    when 'national_highway' then 'National highway'
    when 'state_highway' then 'State highway'
    when 'major_district_road' then 'Major district road'
    when 'other_district_road' then 'Other district road'
    when 'village_road' then 'Village road'
  end
$$;

-- ── Pending rows: one per report, queued on insert ───────────────────────
create or replace function kasa_private.queue_road_tag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.road_tags (report_id) values (new.id) on conflict do nothing;
  return null;
exception when others then
  return null;  -- a road lookup must never block a report
end $$;
revoke all on function kasa_private.queue_road_tag() from public, anon, authenticated;

create or replace trigger kasa_road_tag_row after insert on public.reports
  for each row execute function kasa_private.queue_road_tag();

insert into kasa_private.road_tags (report_id)
select id from public.reports where lat is not null and lng is not null
on conflict do nothing;

-- ── Ping the edge function (same pattern as kasa-geocode) ────────────────
create or replace function kasa_private.ping_road_tag() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  if v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 60000)'
      using v_url || '/kasa-road-tag',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
  return null;
exception when others then
  return null;
end $$;
revoke all on function kasa_private.ping_road_tag() from public, anon, authenticated;

create or replace trigger kasa_road_tag after insert on public.reports
  for each statement execute function kasa_private.ping_road_tag();

-- ── Edge function side (service role only) ───────────────────────────────
create or replace function public.kasa_road_tag_claim(p_limit integer default 10) returns jsonb
language sql security definer set search_path = '' as $$
  with c as (
    update kasa_private.road_tags t set claimed_at = now(), tries = t.tries + 1
    from public.reports r
    where r.id = t.report_id
      and t.report_id in (
        select report_id from kasa_private.road_tags
        where checked_at is null and tries < 3
          and (claimed_at is null or claimed_at < now() - interval '10 minutes')
        order by created_at desc
        limit greatest(1, least(coalesce(p_limit, 10), 40))
        for update skip locked)
    returning t.report_id, r.lat, r.lng)
  select coalesce(jsonb_agg(jsonb_build_object('id', report_id::text, 'lat', lat, 'lng', lng)), '[]'::jsonb) from c
$$;

create or replace function public.kasa_road_tag_done(p_report_id text, p_way_id bigint, p_road_name text,
    p_road_ref text, p_network text, p_retry boolean default false) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.road_tags set
    checked_at = case when coalesce(p_retry, false) then null else now() end,
    way_id = p_way_id,
    road_name = nullif(left(trim(coalesce(p_road_name, '')), 160), ''),
    road_ref = nullif(left(trim(coalesce(p_road_ref, '')), 40), ''),
    network = nullif(left(trim(coalesce(p_network, '')), 40), ''),
    authority = kasa_private.road_authority(p_network, p_road_ref)
  where report_id = p_report_id::uuid
$$;

revoke all on function public.kasa_road_tag_claim(integer) from public, anon, authenticated;
revoke all on function public.kasa_road_tag_done(text, bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.kasa_road_tag_claim(integer) to service_role;
grant execute on function public.kasa_road_tag_done(text, bigint, text, text, text, boolean) to service_role;

-- ── Public read: the report's road and its tender candidates ─────────────
create or replace function public.kasa_report_road(p_report_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t kasa_private.road_tags%rowtype;
  v_tenders jsonb;
begin
  select * into t from kasa_private.road_tags where report_id::text = p_report_id;
  if not found or t.checked_at is null then
    return jsonb_build_object('checked', false);
  end if;
  select coalesce(jsonb_agg(x order by x.status, x.published_at desc nulls last), '[]'::jsonb) into v_tenders
  from (
    select c.status, c.published_at, jsonb_build_object(
      'tender_id', c.tender_id, 'title', c.title, 'status', c.status,
      'published_at', c.published_at, 'bid_closes_at', c.bid_closes_at,
      'tender_value_inr', c.tender_value_inr, 'period_days', c.period_days,
      'source_url', c.source_url,
      'warranty_months', c.warranty_months, 'warranty_source_url', c.warranty_source_url) as x
    from kasa_private.tender_candidates c
    where c.status in ('candidate', 'confirmed')
      and (c.way_id = t.way_id
           or (t.road_ref is not null and c.title ilike '%' || t.road_ref || '%')
           or (length(coalesce(t.road_name, '')) >= 8 and c.title ilike '%' || t.road_name || '%'))
    order by c.published_at desc nulls last
    limit 5) s;
  return jsonb_build_object(
    'checked', true,
    'authority', t.authority,
    'authority_label', kasa_private.road_authority_label(t.authority),
    'road_name', t.road_name,
    'road_ref', t.road_ref,
    'network', t.network,
    'tenders', v_tenders);
end $$;

revoke all on function public.kasa_report_road(text) from public;
grant execute on function public.kasa_report_road(text) to anon, authenticated;

-- ── Moderators: add a tender from its portal page, confirm the road match ─
create or replace function public.kasa_admin_add_tender_candidate(p_row jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  insert into kasa_private.tender_candidates (tender_id, reference_number, title, organisation_chain, town,
    published_at, bid_closes_at, bid_opens_at, tender_value_inr, emd_inr, period_days, source_url,
    warranty_months, warranty_source_url)
  values (p_row->>'tender_id', p_row->>'reference_number', p_row->>'title', p_row->>'organisation_chain',
    p_row->>'town', (p_row->>'published_at')::timestamptz, (p_row->>'bid_closes_at')::timestamptz,
    (p_row->>'bid_opens_at')::timestamptz, p_row->>'tender_value_inr', p_row->>'emd_inr',
    (p_row->>'period_days')::integer, p_row->>'source_url', (p_row->>'warranty_months')::smallint,
    p_row->>'warranty_source_url')
  on conflict (tender_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kasa_admin_review_tender_candidate(p_id bigint, p_action text,
    p_way_id bigint default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(left(trim(coalesce(p_note, '')), 280), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action = 'confirm' then
    if p_way_id is null or not exists (select 1 from kasa_private.road_tags where way_id = p_way_id) then
      perform kasa_private.fail('KASA_NOT_FOUND', 'That road is not on any report.');
    end if;
    update kasa_private.tender_candidates set status = 'confirmed', way_id = p_way_id,
      review_note = v_note, reviewed_at = now() where id = p_id and status = 'candidate';
  elsif p_action = 'reject' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.tender_candidates set status = 'rejected', way_id = null,
      review_note = v_note, reviewed_at = now() where id = p_id and status in ('candidate', 'confirmed');
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Confirm or reject.');
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such tender waiting.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kasa_admin_add_tender_candidate(jsonb),
  public.kasa_admin_review_tender_candidate(bigint, text, bigint, text) from public, anon;
grant execute on function public.kasa_admin_add_tender_candidate(jsonb),
  public.kasa_admin_review_tender_candidate(bigint, text, bigint, text) to authenticated;

-- ── Self-check: the authority mapping is what the page relies on ─────────
do $$
begin
  assert kasa_private.road_authority('IN:NH', null) = 'national_highway';
  assert kasa_private.road_authority('in:sh', null) = 'state_highway';
  assert kasa_private.road_authority('IN:MDR', null) = 'major_district_road';
  assert kasa_private.road_authority(null, 'NH 19') = 'national_highway';
  assert kasa_private.road_authority(null, 'Main Road') is null;
  assert kasa_private.road_authority_label('village_road') = 'Village road';
end $$;
