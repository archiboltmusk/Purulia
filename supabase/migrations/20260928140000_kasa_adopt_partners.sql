-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — Adopt-a-Spot partners (shop + club + ward office)
--
-- A spot can now be looked after by more than one group, each in its own role:
--   shop   – the daytime anchor (tea stall, corner shop, vendor)
--   club   – the para club or puja committee (vigilance, walls, planters)
--   school, family, other – as before
-- The first adopter within adopt_radius_m makes the spot; someone standing
-- there in a role the spot does not have yet joins it as a partner
-- (parent_id). The same role twice at one spot is still KASA_ALREADY_ADOPTED.
--
-- The ward office's part (clearance, bins, daily pickup) is recorded by a
-- moderator only, with an https source (a letter, order or news report):
-- kasa_admin_set_spot_office. Nothing about the office shows without it.
--
-- Adoption now works wherever reports do (kasa_private.locate_any).
-- kasa_adopted_spots keeps its old top-level fields (id, name, mine…) and adds
-- `partners` and `office`. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table kasa_private.adoptions add column if not exists role text not null default 'other';
alter table kasa_private.adoptions add column if not exists parent_id bigint references kasa_private.adoptions (id);
alter table kasa_private.adoptions add column if not exists district text;
alter table kasa_private.adoptions add column if not exists place text;
alter table kasa_private.adoptions add column if not exists office_note text;
alter table kasa_private.adoptions add column if not exists office_source_url text;
alter table kasa_private.adoptions add column if not exists office_set_at timestamptz;
do $$ begin
  alter table kasa_private.adoptions add constraint adoptions_role_check
    check (role in ('shop', 'club', 'school', 'family', 'other'));
exception when duplicate_object then null; end $$;
create index if not exists kasa_adoptions_parent_idx on kasa_private.adoptions (parent_id) where ended_at is null;

-- When the head of a spot ends, the oldest remaining partner becomes the head and keeps the office record.
create or replace function kasa_private.adoption_rehome(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old  kasa_private.adoptions;
  v_new  bigint;
begin
  select * into v_old from kasa_private.adoptions where id = p_id;
  if v_old.parent_id is not null then return; end if;
  select id into v_new from kasa_private.adoptions
  where parent_id = p_id and ended_at is null order by created_at, id limit 1;
  if v_new is null then return; end if;
  update kasa_private.adoptions set parent_id = null,
    office_note = v_old.office_note, office_source_url = v_old.office_source_url, office_set_at = v_old.office_set_at
  where id = v_new;
  update kasa_private.adoptions set parent_id = v_new where parent_id = p_id and ended_at is null and id <> v_new;
end $$;
revoke all on function kasa_private.adoption_rehome(bigint) from public, anon, authenticated;

create or replace function public.kasa_adopted_spots() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'open')::integer desc, x ->> 'since'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', a.id,
      'name', (select string_agg(p.name, ' · ' order by p.parent_id nulls first, p.created_at)
               from kasa_private.adoptions p where (p.id = a.id or p.parent_id = a.id) and p.ended_at is null),
      'lat', round(a.lat::numeric, 5), 'lng', round(a.lng::numeric, 5),
      'ward_no', a.ward_no, 'block_name', a.block_name, 'place', a.place, 'place_name', (select pl.name from kasa_private.places pl where pl.slug = a.place),
      'district', a.district, 'since', a.created_at,
      'mine', exists (select 1 from kasa_private.adoptions p
                      where (p.id = a.id or p.parent_id = a.id) and p.ended_at is null and p.user_id = auth.uid()),
      'partners', (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'since', p.created_at,
                                                       'mine', p.user_id = auth.uid())
                                    order by p.parent_id nulls first, p.created_at)
                   from kasa_private.adoptions p where (p.id = a.id or p.parent_id = a.id) and p.ended_at is null),
      'office', case when a.office_set_at is not null then
                  jsonb_build_object('note', a.office_note, 'source_url', a.office_source_url, 'since', a.office_set_at) end,
      'open', (select count(*) from public.reports r
               where r.moderation_status in ('approved', 'flagged') and r.status <> 'resolved' and not coalesce(r.is_duplicate, false)
                 and r.lat between a.lat - 0.001 and a.lat + 0.001 and r.lng between a.lng - 0.0011 and a.lng + 0.0011
                 and kasa_private.distance_m(a.lat, a.lng, r.lat, r.lng) <= kasa_private.cfg_num('adopt_radius_m')),
      'fixed', (select count(*) from public.reports r
                where r.moderation_status in ('approved', 'flagged') and r.status = 'resolved' and r.resolved_at >= a.created_at
                  and r.lat between a.lat - 0.001 and a.lat + 0.001 and r.lng between a.lng - 0.0011 and a.lng + 0.0011
                  and kasa_private.distance_m(a.lat, a.lng, r.lat, r.lng) <= kasa_private.cfg_num('adopt_radius_m')),
      'last_problem_at', (select max(r.created_at) from public.reports r
                where r.moderation_status in ('approved', 'flagged') and r.created_at >= a.created_at
                  and r.lat between a.lat - 0.001 and a.lat + 0.001 and r.lng between a.lng - 0.0011 and a.lng + 0.0011
                  and kasa_private.distance_m(a.lat, a.lng, r.lat, r.lng) <= kasa_private.cfg_num('adopt_radius_m'))
    ) as x
    from kasa_private.adoptions a where a.ended_at is null and a.parent_id is null
  ) t
$$;

drop function if exists public.kasa_adopt_spot(text, double precision, double precision, double precision);
create or replace function public.kasa_adopt_spot(p_name text, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_role text default 'other') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_role text := coalesce(nullif(trim(p_role), ''), 'other');
  v_loc  jsonb;
  v_near kasa_private.adoptions;
  v_head bigint;
  v_id   bigint;
begin
  if v_role not in ('shop', 'club', 'school', 'family', 'other') then
    perform kasa_private.fail('KASA_BAD_ROLE', 'Choose who is looking after the spot: a shop, a club, a school, a family or other.');
  end if;
  if length(v_name) < 3 or length(v_name) > 60 then
    perform kasa_private.fail('KASA_NAME_LENGTH', 'Give a name of 3 to 60 characters, like a shop, school or club.');
  end if;
  if p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.'); end if;
  if (select count(*) from kasa_private.adoptions where user_id = me.user_id and ended_at is null)
     >= kasa_private.cfg_num('adopt_max_per_user') then
    perform kasa_private.fail('KASA_ADOPT_LIMIT', 'You already look after as many spots as one person can. Let one go first.');
  end if;
  -- The nearest spot within reach; join it if this role is still free there.
  select * into v_near from kasa_private.adoptions a
  where a.ended_at is null and a.parent_id is null
    and a.lat between p_lat - 0.001 and p_lat + 0.001 and a.lng between p_lng - 0.0011 and p_lng + 0.0011
    and kasa_private.distance_m(a.lat, a.lng, p_lat, p_lng) <= kasa_private.cfg_num('adopt_radius_m')
  order by kasa_private.distance_m(a.lat, a.lng, p_lat, p_lng) limit 1;
  if v_near.id is not null then
    if exists (select 1 from kasa_private.adoptions p
               where (p.id = v_near.id or p.parent_id = v_near.id) and p.ended_at is null
                 and (p.role = v_role or p.user_id = me.user_id)) then
      perform kasa_private.fail('KASA_ALREADY_ADOPTED', 'Someone already looks after this spot: ' || v_near.name || '.',
        jsonb_build_object('name', v_near.name));
    end if;
    v_head := v_near.id;
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  insert into kasa_private.adoptions (user_id, name, role, parent_id, lat, lng, accuracy_m, ward_no, block_name, district, place)
  values (me.user_id, v_name, v_role, v_head,
          coalesce(v_near.lat, p_lat), coalesce(v_near.lng, p_lng), p_accuracy,
          case when v_loc ->> 'kind' in ('town', 'place') then nullif(v_loc ->> 'ward', '')::integer end,
          v_loc ->> 'block', v_loc ->> 'district', v_loc ->> 'place')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'role', v_role, 'joined', v_head is not null,
                            'with', case when v_head is not null then v_near.name end);
end $$;

create or replace function public.kasa_leave_spot(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update kasa_private.adoptions set ended_at = now(), ended_reason = 'left'
  where id = p_id and user_id = auth.uid() and ended_at is null;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That spot is not one you look after.'); end if;
  perform kasa_private.adoption_rehome(p_id);
  return jsonb_build_object('left', true);
end $$;

create or replace function public.kasa_admin_remove_adoption(p_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
  update kasa_private.adoptions set ended_at = now(), ended_reason = left(trim(p_reason), 280)
  where id = p_id and ended_at is null;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such adopted spot.'); end if;
  perform kasa_private.adoption_rehome(p_id);
  return jsonb_build_object('removed', true);
end $$;

-- A moderator records what the ward office has committed at a spot, with its source. An empty note clears it.
create or replace function public.kasa_admin_set_spot_office(p_id bigint, p_note text, p_source_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g');
  v_url  text := trim(coalesce(p_source_url, ''));
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if v_note = '' then
    update kasa_private.adoptions set office_note = null, office_source_url = null, office_set_at = null
    where id = p_id and parent_id is null and ended_at is null;
  else
    if length(v_note) < 5 or length(v_note) > 280 then
      perform kasa_private.fail('KASA_NOTE_LENGTH', 'Say what the ward office committed in 5 to 280 characters.');
    end if;
    if v_url !~ '^https://[^\s/]+\.[^\s]+$' or length(v_url) > 500 then
      perform kasa_private.fail('KASA_SOURCE_NEEDED', 'Give an https link to the letter, order or news report.');
    end if;
    update kasa_private.adoptions set office_note = v_note, office_source_url = v_url, office_set_at = now()
    where id = p_id and parent_id is null and ended_at is null;
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such adopted spot.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kasa_adopted_spots() from public;
grant execute on function public.kasa_adopted_spots() to anon, authenticated;
revoke all on function public.kasa_adopt_spot(text, double precision, double precision, double precision, text) from public, anon;
revoke all on function public.kasa_leave_spot(bigint) from public, anon;
revoke all on function public.kasa_admin_remove_adoption(bigint, text) from public, anon;
revoke all on function public.kasa_admin_set_spot_office(bigint, text, text) from public, anon;
grant execute on function public.kasa_adopt_spot(text, double precision, double precision, double precision, text),
  public.kasa_leave_spot(bigint), public.kasa_admin_remove_adoption(bigint, text),
  public.kasa_admin_set_spot_office(bigint, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
