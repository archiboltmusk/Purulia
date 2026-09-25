-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR PURULIA — School Audit
--
-- A different shape from a normal report: an audit is a snapshot assessment
-- of a school's condition (drinking water / toilets / boundary wall+safety /
-- building condition), not a problem to be claimed and resolved. There is
-- no canonical list of Purulia's schools to check against, so any citizen
-- can audit any school they visit — schools appear as they get audited, and
-- repeat audits of the same school are expected (a trend), never merged or
-- treated as duplicates the way repeat reports are.
--
-- Reuses the same server-enforced evidence chain as reports (live camera +
-- GPS via kasa_private.check_photo / photo_meta_verdict, anonymous identity
-- via kasa_private.me(), district bounds via kasa_private.locate()) and the
-- same flag → moderator-review pipeline (kasa_private.flags' network-
-- weighted threshold, mirrored here as kasa_private.school_audit_flags).
-- Photos are uploaded to the existing 'reports/' storage folder — no new
-- storage bucket or policy needed.
--
-- Unlike reports (hide-only, append-only evidence trail — the claim/verify
-- history depends on every row staying put), a school audit has no
-- downstream history pointing at it, so a moderator can hard-delete a bad
-- one outright, not just hide it.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('school_audits_per_hour', '5',  'School audits one person can file per hour'),
  ('school_audits_per_day',  '20', 'School audits one person can file per day')
on conflict (key) do nothing;

create table if not exists public.school_audits (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  user_id            uuid not null,
  client_id          text,
  school_name        text not null,
  lat                double precision not null,
  lng                double precision not null,
  accuracy_m         double precision,
  ward_no            integer,
  area_kind          text,
  block_name         text,
  photo_path         text not null,
  photo_url          text not null,
  water_ok           boolean not null,
  toilets_ok         boolean not null,
  boundary_ok        boolean not null,
  building_condition text not null check (building_condition in ('good', 'needs_repair', 'unsafe')),
  flags              integer not null default 0,
  moderation_status  text not null default 'approved' check (moderation_status in ('approved', 'review', 'flagged', 'hidden')),
  moderation_labels  jsonb not null default '{}'::jsonb
);
create unique index if not exists kasa_school_audits_client_id_uq on public.school_audits (user_id, client_id) where client_id is not null;
create index if not exists kasa_school_audits_created_idx on public.school_audits (created_at desc);
create index if not exists kasa_school_audits_user_idx on public.school_audits (user_id, created_at desc);
-- The loose "same school" grouping key the comparison view uses: normalized name + ward/block.
create index if not exists kasa_school_audits_group_idx on public.school_audits (lower(trim(school_name)), ward_no, block_name);

alter table public.school_audits enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'school_audits' loop
    execute format('drop policy %I on public.school_audits', p.policyname);
  end loop;
end $$;
create policy kasa_school_audits_admin_read on public.school_audits for select to authenticated using (kasa_private.is_admin());

create table if not exists kasa_private.school_audit_flags (
  audit_id   uuid not null references public.school_audits(id) on delete cascade,
  user_id    uuid not null,
  reason     text not null check (reason in ('not_this_school', 'fake_or_old_photo', 'inappropriate', 'other')),
  note       text,
  ip_hash    text,
  counts     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (audit_id, user_id)
);
alter table kasa_private.school_audit_flags enable row level security;

-- School-audit photos share the 'reports/' storage folder (no new bucket/policy needed),
-- so the shared reuse check must know about them too, or a photo already used for a
-- report/claim/vote could quietly be reused for a fake audit and vice versa.
create or replace function kasa_private.photo_in_use(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.photo_path = p_path)
      or exists (select 1 from kasa_private.claims c where c.photo_path = p_path)
      or exists (select 1 from kasa_private.votes v where v.photo_path = p_path)
      or exists (select 1 from public.school_audits a where a.photo_path = p_path)
$$;

-- A citizen audits one school: photo + GPS + a 4-point checklist. Mirrors
-- kasa_create_report's evidence checks and rate limiting; no duplicate/
-- recurrence detection (repeat audits are wanted, not merged) and no event
-- timeline (an audit has no claim/resolve lifecycle to narrate).
create or replace function public.kasa_create_school_audit(p_school_name text, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_ward_no integer, p_water_ok boolean, p_toilets_ok boolean, p_boundary_ok boolean,
    p_building_condition text, p_photo_path text, p_client_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me      kasa_private.profiles := kasa_private.me();
  v_chk   kasa_private.photo_checks;
  v_meta  jsonb;
  v_loc   jsonb;
  v_url   text;
  v_mod   text := 'approved';
  v_existing public.school_audits;
  v_new   public.school_audits;
begin
  if p_client_id is not null then
    select * into v_existing from public.school_audits where user_id = me.user_id and client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_existing.id, 'moderation_status', v_existing.moderation_status, 'replayed', true);
    end if;
  end if;

  if length(trim(coalesce(p_school_name, ''))) < 3 or length(p_school_name) > 140 then
    perform kasa_private.fail('KASA_BAD_SCHOOL_NAME', 'Enter the school''s name.');
  end if;
  if p_water_ok is null or p_toilets_ok is null or p_boundary_ok is null then
    perform kasa_private.fail('KASA_INCOMPLETE_AUDIT', 'Answer every checklist question.');
  end if;
  if p_building_condition not in ('good', 'needs_repair', 'unsafe') then
    perform kasa_private.fail('KASA_BAD_CONDITION', 'Choose the building condition.');
  end if;
  if p_ward_no is not null and p_ward_no not between 1 and 23 then
    perform kasa_private.fail('KASA_BAD_WARD', 'Ward must be between 1 and 23.');
  end if;
  v_loc := kasa_private.locate(p_lat, p_lng, p_ward_no);
  if v_loc is null then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia district.');
  end if;
  p_ward_no := case when v_loc ->> 'kind' = 'town' then (v_loc ->> 'ward')::integer end;

  if (select count(*) from public.school_audits where user_id = me.user_id and created_at > now() - interval '1 hour')
       >= kasa_private.cfg_num('school_audits_per_hour')
  or (select count(*) from public.school_audits where user_id = me.user_id and created_at > now() - interval '1 day')
       >= kasa_private.cfg_num('school_audits_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have filed a lot of audits. Try again later.');
  end if;

  v_chk := kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, p_lat, p_lng);
  v_meta := kasa_private.photo_meta_verdict(p_photo_path, false, p_lat, p_lng, null);
  v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;

  if coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> 'ai_edited')::boolean, false)
     or (kasa_private.cfg_bool('require_live_report_photo') and coalesce(v_meta ->> 'capture', 'unknown') <> 'live') then
    v_mod := 'review';
  elsif v_meta ? 'flag' then
    v_mod := 'flagged';
  end if;

  insert into public.school_audits (user_id, client_id, school_name, lat, lng, accuracy_m, ward_no, area_kind, block_name,
      photo_path, photo_url, water_ok, toilets_ok, boundary_ok, building_condition, moderation_status, moderation_labels)
  values (me.user_id, p_client_id, trim(p_school_name), p_lat, p_lng, p_accuracy, p_ward_no,
      v_loc ->> 'kind', v_loc ->> 'block', p_photo_path, v_url, p_water_ok, p_toilets_ok, p_boundary_ok, p_building_condition,
      v_mod, jsonb_build_object('photo', v_meta) ||
      case when v_chk.photo_path is null then '{}'::jsonb else jsonb_build_object('labels', v_chk.labels) end)
  returning * into v_new;

  return jsonb_build_object('id', v_new.id, 'moderation_status', v_new.moderation_status);
end $$;

-- Mirrors kasa_flag_report: a network-weighted threshold (flag_review_threshold,
-- min_distinct_networks — both already exist) so one abuser with several
-- accounts can't flag a true audit into review.
create or replace function public.kasa_flag_school_audit(p_audit_id text, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me       kasa_private.profiles := kasa_private.me();
  a        public.school_audits;
  v_joined timestamptz;
  v_counts boolean;
  v_n      integer;
  v_nets   integer;
  v_need   integer := kasa_private.cfg_num('flag_review_threshold')::integer;
begin
  select * into a from public.school_audits where id::text = p_audit_id and moderation_status in ('approved', 'flagged') for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Audit not found.'); end if;
  if a.user_id = me.user_id then perform kasa_private.fail('KASA_OWN_REPORT', 'You can''t flag your own audit.'); end if;
  if p_reason is null or p_reason not in ('not_this_school', 'fake_or_old_photo', 'inappropriate', 'other') then
    perform kasa_private.fail('KASA_BAD_REASON', 'Choose a reason.');
  end if;
  if kasa_private.text_verdict(p_note) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  select u.created_at into v_joined from auth.users u where u.id = me.user_id;
  v_counts := v_joined is not null
              and v_joined <= now() - make_interval(hours => kasa_private.cfg_num('voter_min_account_hours')::integer)
              and kasa_private.prior_actions(me.user_id, now()) >= kasa_private.cfg_num('voter_min_prior_actions');

  insert into kasa_private.school_audit_flags (audit_id, user_id, reason, note, ip_hash, counts)
  values (a.id, me.user_id, p_reason, nullif(left(trim(coalesce(p_note, '')), 280), ''), kasa_private.ip_hash(), v_counts)
  on conflict do nothing;
  if not found then return jsonb_build_object('counted', false, 'flags', a.flags); end if;

  select count(*), count(distinct coalesce(f.ip_hash, f.user_id::text)) into v_n, v_nets
  from kasa_private.school_audit_flags f where f.audit_id = a.id and f.counts;

  update public.school_audits set flags = coalesce(flags, 0) + 1,
         moderation_status = case when v_n >= v_need
                                        and v_nets >= least(v_need, kasa_private.cfg_num('min_distinct_networks')::integer)
                                        and moderation_status = 'approved' then 'flagged' else moderation_status end
  where id = a.id returning * into a;
  return jsonb_build_object('counted', true, 'weighs', v_counts, 'flags', a.flags, 'under_review', a.moderation_status = 'flagged');
end $$;

-- Moderators only. 'delete' is hard delete — an audit has no claim/resolve history
-- depending on it, unlike a report, so there's nothing to preserve by hiding instead.
create or replace function public.kasa_admin_moderate_school_audit(p_audit_id text, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.school_audits;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'hide', 'restore', 'delete') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  if p_action = 'delete' then
    delete from public.school_audits where id::text = p_audit_id returning * into a;
    if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Audit not found.'); end if;
    return jsonb_build_object('deleted', true);
  end if;
  update public.school_audits set moderation_status = case p_action when 'hide' then 'hidden' else 'approved' end
  where id::text = p_audit_id returning * into a;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Audit not found.'); end if;
  return jsonb_build_object('moderation_status', a.moderation_status);
end $$;

-- Moderation queue: audits waiting for review, newest first.
create or replace function public.kasa_admin_school_audit_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'created_at', a.created_at, 'school_name', a.school_name, 'ward_no', a.ward_no,
      'block_name', a.block_name, 'photo_url', a.photo_url, 'water_ok', a.water_ok, 'toilets_ok', a.toilets_ok,
      'boundary_ok', a.boundary_ok, 'building_condition', a.building_condition, 'moderation_status', a.moderation_status,
      'flags', a.flags) order by a.created_at)
    from public.school_audits a where a.moderation_status in ('review', 'flagged')
  ), '[]'::jsonb);
end $$;

create or replace view public.kasa_public_school_audits as
select a.id, date_trunc('hour', a.created_at) as created_at, a.school_name, a.lat, a.lng, a.ward_no, a.area_kind, a.block_name,
       a.photo_url, a.water_ok, a.toilets_ok, a.boundary_ok, a.building_condition, coalesce(a.flags, 0) as flags,
       a.moderation_status, lower(trim(a.school_name)) as group_key
from public.school_audits a
where a.moderation_status in ('approved', 'flagged');

revoke all on function public.kasa_create_school_audit(text, double precision, double precision, double precision, integer,
  boolean, boolean, boolean, text, text, text) from public, anon;
revoke all on function public.kasa_flag_school_audit(text, text, text) from public, anon;
revoke all on function public.kasa_admin_moderate_school_audit(text, text, text) from public, anon;
revoke all on function public.kasa_admin_school_audit_queue() from public, anon;

grant execute on function
  public.kasa_create_school_audit(text, double precision, double precision, double precision, integer,
    boolean, boolean, boolean, text, text, text),
  public.kasa_flag_school_audit(text, text, text)
to authenticated;
grant execute on function public.kasa_admin_moderate_school_audit(text, text, text), public.kasa_admin_school_audit_queue()
  to authenticated;

grant select on public.school_audits to authenticated;
grant select on public.kasa_public_school_audits to anon, authenticated;

commit;

notify pgrst, 'reload schema';
