-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — the whole of Purulia district
--
-- Reports are accepted anywhere in the district's 20 CD blocks. The server
-- decides where a report is from its GPS point, never from the phone:
--
--  • Inside a Purulia municipality ward outline → "town", with that ward.
--    (The ward map has 22 of 23 wards, so a report that names a ward within
--    1.5 km of the town also counts as town.)
--  • Otherwise inside a block outline → "rural", with that block, no ward.
--  • Outside every block → refused.
--
-- Villages have fewer Kasa users and often a single mobile network, so
-- rural cleanups use lighter settings (rural_verify_quorum,
-- rural_min_distinct_networks, rural_claim_expiry_days). Account age, earlier
-- activity, the ring check and moderator holds still apply everywhere.
--
-- New categories for village services: hand pump, anganwadi, health centre,
-- school.
--
-- Boundaries: blocks from OpenStreetMap (ODbL), simplified to ~150 m; wards
-- from purulia_wards.geojson. Both are approximate. Regenerate the data with
-- tools/build-areas.py. Jhalda and Raghunathpur municipalities have no ward
-- map yet, so reports there count under their block.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;


insert into kasa_private.settings (key, value, note) values
  ('rural_verify_quorum', '2', 'Confirmations needed for a cleanup outside Purulia town'),
  ('rural_min_distinct_networks', '1', 'Different networks needed among rural confirmers (villages often share one tower)'),
  ('rural_claim_expiry_days', '30', 'Days a rural cleanup claim stays open for confirmations'),
  ('town_ward_margin_m', '1500', 'A report naming a ward counts as town if it is this close to the ward map')
on conflict (key) do nothing;

-- The whole district (slightly padded); the block outlines decide exactly.
update kasa_private.settings set value = '{"min_lat":22.69,"max_lat":23.71,"min_lng":85.80,"max_lng":86.92}'::jsonb
where key = 'bbox';
-- A camera token only proves the photo came after the camera opened; a longer
-- window doesn't help a cheat (they can ask for a fresh one) but spares
-- people on slow village connections.
update kasa_private.settings set value = '180'::jsonb where key = 'capture_token_minutes';


-- ── Point in polygon (no PostGIS needed) ─────────────────────────────────
create or replace function kasa_private.in_polygons(p_lat double precision, p_lng double precision, p_polys jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_poly   jsonb;
  v_ring   jsonb;
  v_first  boolean;
  v_inside boolean;
  v_hole   boolean;
  n integer; j integer;
  xi double precision; yi double precision; xj double precision; yj double precision;
begin
  for v_poly in select value from jsonb_array_elements(p_polys) loop
    v_first := true; v_hole := false;
    for v_ring in select value from jsonb_array_elements(v_poly) loop
      v_inside := false;
      n := jsonb_array_length(v_ring);
      j := n - 1;
      for i in 0 .. n - 1 loop
        xi := (v_ring -> i ->> 0)::double precision; yi := (v_ring -> i ->> 1)::double precision;
        xj := (v_ring -> j ->> 0)::double precision; yj := (v_ring -> j ->> 1)::double precision;
        if (yi > p_lat) <> (yj > p_lat) and p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi then
          v_inside := not v_inside;
        end if;
        j := i;
      end loop;
      if v_first then
        exit when not v_inside;
        v_first := false;
      elsif v_inside then
        v_hole := true;
        exit;
      end if;
    end loop;
    if not v_first and not v_hole then return true; end if;
  end loop;
  return false;
end $$;

-- Where a point is: {"kind":"town","ward":n} or {"kind":"rural","block":"..."}; null outside the district.
create or replace function kasa_private.locate(p_lat double precision, p_lng double precision, p_ward integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ward  integer;
  v_block text;
  v_pad   double precision := kasa_private.cfg_num('town_ward_margin_m') / 111000.0;
begin
  if p_lat is null or p_lng is null then return null; end if;
  select a.ward_no into v_ward from kasa_private.areas a
  where a.kind = 'ward' and p_lat between a.min_lat and a.max_lat and p_lng between a.min_lng and a.max_lng
    and kasa_private.in_polygons(p_lat, p_lng, a.polygons)
  order by a.ward_no limit 1;
  if v_ward is not null then
    return jsonb_build_object('kind', 'town', 'ward', coalesce(p_ward, v_ward));
  end if;
  if p_ward between 1 and 23 and exists (
      select 1 from kasa_private.areas a
      cross join lateral jsonb_array_elements(a.polygons) poly
      cross join lateral jsonb_array_elements(poly -> 0) pt
      where a.kind = 'ward'
        and p_lat between a.min_lat - v_pad and a.max_lat + v_pad and p_lng between a.min_lng - v_pad and a.max_lng + v_pad
        and kasa_private.distance_m(p_lat, p_lng, (pt ->> 1)::double precision, (pt ->> 0)::double precision)
            <= kasa_private.cfg_num('town_ward_margin_m')) then
    return jsonb_build_object('kind', 'town', 'ward', p_ward);
  end if;
  select a.name into v_block from kasa_private.areas a
  where a.kind = 'block' and p_lat between a.min_lat and a.max_lat and p_lng between a.min_lng and a.max_lng
    and kasa_private.in_polygons(p_lat, p_lng, a.polygons)
  order by a.id limit 1;
  if v_block is not null then
    return jsonb_build_object('kind', 'rural', 'block', v_block);
  end if;
  return null;
end $$;

alter table public.reports
  add column if not exists area_kind  text,
  add column if not exists block_name text;

-- A claim setting for this report's area: rural_<key> outside town when it exists.
create or replace function kasa_private.area_num(p_key text, p_report_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when (select r.area_kind from public.reports r where r.id = p_report_id) = 'rural'
                   and exists (select 1 from kasa_private.settings s where s.key = 'rural_' || p_key)
              then kasa_private.cfg_num('rural_' || p_key)
              else kasa_private.cfg_num(p_key) end
$$;

-- ── Where each report is ──────────────────────────────────────────────────
create or replace function kasa_private.set_report_area() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_loc jsonb := kasa_private.locate(new.lat, new.lng, new.ward_no);
begin
  new.area_kind  := v_loc ->> 'kind';
  new.block_name := v_loc ->> 'block';
  return new;
end $$;
drop trigger if exists set_report_area on public.reports;
create trigger set_report_area before insert or update of lat, lng, ward_no on public.reports
  for each row execute function kasa_private.set_report_area();

update public.reports r set area_kind = l ->> 'kind', block_name = l ->> 'block'
from (select id, kasa_private.locate(lat, lng, ward_no) l from public.reports) x
where x.id = r.id and (r.area_kind is distinct from x.l ->> 'kind' or r.block_name is distinct from x.l ->> 'block');

-- ── Categories for village services ───────────────────────────────────────
create or replace function kasa_private.valid_category(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing', 'encroachment',
               'illegal_construction', 'illegal_mining', 'illegal_other', 'other',
               'hand_pump', 'anganwadi', 'health_centre', 'school')
$$;
alter table public.reports drop constraint if exists kasa_reports_category_chk;
alter table public.reports add constraint kasa_reports_category_chk
  check (category is null or kasa_private.valid_category(category)) not valid;

-- ── kasa_create_report: district-wide, server-assigned area ───────────────
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.kasa_create_report(text,text,double precision,double precision,double precision,integer,text,text,text,text)'::regprocedure);
  if position('kasa_private.locate' in v_def) = 0 then
    v_def := replace(v_def, E'  v_url     text;\nbegin', E'  v_url     text;\n  v_loc     jsonb;\nbegin');
    v_def := replace(v_def,
      $a$'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other') then$a$,
      $a$'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other',
      'hand_pump', 'anganwadi', 'health_centre', 'school') then$a$);
    v_def := replace(v_def,
      $a$  if p_lat is null or p_lng is null
     or p_lat not between (v_bbox ->> 'min_lat')::float8 and (v_bbox ->> 'max_lat')::float8
     or p_lng not between (v_bbox ->> 'min_lng')::float8 and (v_bbox ->> 'max_lng')::float8 then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia town.');
  end if;$a$,
      $a$  if p_ward_no is not null and p_ward_no not between 1 and 23 then
    perform kasa_private.fail('KASA_BAD_WARD', 'Ward must be between 1 and 23.');
  end if;
  v_loc := kasa_private.locate(p_lat, p_lng, p_ward_no);
  if v_loc is null then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia district.');
  end if;
  p_ward_no := case when v_loc ->> 'kind' = 'town' then (v_loc ->> 'ward')::integer end;$a$);
    if position('kasa_private.locate' in v_def) = 0 or position('''hand_pump''' in v_def) = 0
       or position('v_loc     jsonb' in v_def) = 0 then
      raise exception 'kasa_create_report: district patch did not apply';
    end if;
    execute v_def;
  end if;
end $do$;

-- ── Claims use the report's area settings ─────────────────────────────────
create or replace function kasa_private.evaluate_claim(p_claim_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c         kasa_private.claims;
  v_nets    integer;
  v_dnets   integer;
  v_trusted integer;
  v_ring    boolean;
  v_need    integer;
  v_dneed   integer;
  v_min_net integer;
  v_expiry  integer;
begin
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found or c.status <> 'pending' then return coalesce(c.status, 'missing'); end if;
  v_need    := kasa_private.area_num('verify_quorum', c.report_id)::integer;
  v_dneed   := kasa_private.area_num('dispute_quorum', c.report_id)::integer;
  v_min_net := kasa_private.area_num('min_distinct_networks', c.report_id)::integer;
  v_expiry  := kasa_private.area_num('claim_expiry_days', c.report_id)::integer;

  if c.dispute_count >= v_dneed then
    select count(distinct coalesce(v.ip_hash, v.id::text)) into v_dnets
    from kasa_private.votes v where v.claim_id = c.id and v.vote = 'dispute' and v.voided_at is null;
    if v_dnets >= least(v_dneed, v_min_net) then
      perform kasa_private.reject_claim(c.id, 'disputed_on_site', null, false);
      return 'rejected';
    end if;
    if not c.needs_review and (c.reviewed_at is null or c.reviewed_at < (
         select max(v.created_at) from kasa_private.votes v
         where v.claim_id = c.id and v.vote = 'dispute' and v.voided_at is null)) then
      update kasa_private.claims set needs_review = true where id = c.id returning * into c;
      perform kasa_private.add_event(c.report_id::text, 'claim_held', null, c.id, null, null,
        jsonb_build_object('reason', 'disputes_one_network'));
    end if;
  end if;

  select count(distinct coalesce(v.ip_hash, v.id::text)),
         count(*) filter (where kasa_private.prior_actions(v.voter_id, c.created_at)
                                >= kasa_private.cfg_num('trusted_prior_actions'))
    into v_nets, v_trusted
  from kasa_private.votes v
  where v.claim_id = c.id and v.vote = 'verify' and v.voided_at is null and not v.needs_review;

  if c.quorum_reached_at is null and c.verify_count >= v_need and v_nets >= least(v_need, v_min_net) then
    v_ring := kasa_private.confirmers_often_together(c.id);
    update kasa_private.claims set quorum_reached_at = now(),
        needs_review = needs_review or v_trusted = 0 or v_ring
    where id = c.id returning * into c;
    if v_ring then
      perform kasa_private.add_event(c.report_id::text, 'claim_held', null, c.id, null, null,
        jsonb_build_object('reason', 'confirmers_often_together'));
    end if;
    perform kasa_private.add_event(c.report_id::text, 'quorum_reached', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'needs_review', c.needs_review,
                         'final_after', c.final_after));
  end if;

  if c.quorum_reached_at is not null and not c.needs_review
     and coalesce(c.final_after, kasa_private.claim_final_after(c.quorum_reached_at)) <= now() then
    update kasa_private.claims set status = 'accepted', decided_at = now(), decided_reason = 'community_verified'
    where id = c.id;
    update public.reports set status = 'resolved', resolved_at = now(), resolved_photo_url = c.photo_url,
           resolution_method = 'community', updated_at = now()
    where id = c.report_id;
    perform kasa_private.add_event(c.report_id::text, 'resolved', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'dispute_count', c.dispute_count));
    return 'accepted';
  end if;

  if (c.quorum_reached_at is null or c.needs_review)
     and c.created_at + make_interval(days => v_expiry) <= now() then
    update kasa_private.claims set status = 'expired', decided_at = now(),
           decided_reason = case when c.needs_review then 'photo_not_reviewed' else 'not_enough_confirmations' end
    where id = c.id;
    update public.reports set status = 'open', claim_id = null, updated_at = now() where id = c.report_id;
    perform kasa_private.add_event(c.report_id::text, 'claim_expired', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'needs_review', c.needs_review));
    return 'expired';
  end if;

  return 'pending';
end $$;

create or replace function public.kasa_finalize_due() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n  integer := 0;
  v_state text;
begin
  perform kasa_private.forget_unused_photo_gps();
  for v_id in
    select c.id from kasa_private.claims c
    where c.status = 'pending'
      and ((c.quorum_reached_at is not null and coalesce(c.final_after, kasa_private.claim_final_after(c.quorum_reached_at)) <= now())
        or c.created_at + make_interval(days => kasa_private.cfg_num('claim_expiry_days')::integer) <= now()
        or c.created_at + make_interval(days => kasa_private.area_num('claim_expiry_days', c.report_id)::integer) <= now())
    limit 200
  loop
    v_state := kasa_private.evaluate_claim(v_id);
    if v_state <> 'pending' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Replies from kasa_vote_claim and kasa_claim_cleanup report the area's numbers.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.kasa_vote_claim(uuid,text,text,double precision,double precision,double precision,text)'::regprocedure);
  if position('area_num' in v_def) = 0 then
    v_def := replace(v_def,
      $a$'verify_needed', kasa_private.cfg_num('verify_quorum'), 'dispute_needed', kasa_private.cfg_num('dispute_quorum'),$a$,
      $a$'verify_needed', kasa_private.area_num('verify_quorum', c.report_id), 'dispute_needed', kasa_private.area_num('dispute_quorum', c.report_id),$a$);
    if position('area_num' in v_def) = 0 then raise exception 'kasa_vote_claim: area patch did not apply'; end if;
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.kasa_claim_cleanup(text,text,double precision,double precision,double precision)'::regprocedure);
  if position('area_num' in v_def) = 0 then
    v_def := replace(v_def, $a$'verify_needed', kasa_private.cfg_num('verify_quorum'),$a$,
                            $a$'verify_needed', kasa_private.area_num('verify_quorum', r.id),$a$);
    if position('area_num' in v_def) = 0 then raise exception 'kasa_claim_cleanup: area patch did not apply'; end if;
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.kasa_push_subscribe(text,text,text,double precision,double precision,integer,text)'::regprocedure);
  if position('in and around Purulia town' in v_def) > 0 then
    execute replace(v_def, 'in and around Purulia town', 'in and around Purulia district');
  end if;
end $do$;

create or replace function public.kasa_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(key, value) from kasa_private.settings
  where key in ('verify_quorum', 'dispute_quorum', 'challenge_hours', 'claim_expiry_days', 'claim_radius_m',
                'vote_radius_m', 'max_gps_accuracy_m', 'require_vote_photo', 'review_categories', 'bbox',
                'max_photo_age_minutes', 'photo_gps_far_m', 'require_live_capture',
                'rural_verify_quorum', 'rural_min_distinct_networks', 'rural_claim_expiry_days', 'town_ward_margin_m',
                'min_distinct_networks')
$$;

-- ── Public view: where each report is, and how many confirmations it needs ─
create or replace view public.kasa_public_reports as
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
        where s.key = case when r.area_kind = 'rural' then 'rural_verify_quorum' else 'verify_quorum' end) as verify_needed
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id and c.status = 'pending'
where r.moderation_status in ('approved', 'flagged');

revoke all on function kasa_private.in_polygons(double precision, double precision, jsonb) from public, anon, authenticated;
revoke all on function kasa_private.locate(double precision, double precision, integer) from public, anon, authenticated;
revoke all on function kasa_private.area_num(text, uuid) from public, anon, authenticated;
revoke all on function kasa_private.set_report_area() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
