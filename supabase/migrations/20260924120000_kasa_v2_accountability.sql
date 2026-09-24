-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA v2 — tamper-proof reporting and community-verified cleanups
--
-- Run once in the Supabase SQL editor (safe to re-run). See SETUP-KASA.md.
--
-- What this enforces on the server (the browser can't bypass any of it):
--   • Nobody — citizen, official or admin — can edit a report directly.
--     Every change goes through a function below that checks the evidence.
--   • A report is only "resolved" when someone on site posts a fresh cleanup
--     photo AND enough other people, each on site with their own fresh photo,
--     confirm it, AND nobody manages to dispute it during a challenge window.
--   • Claimants can't confirm their own claim. Accounts created after a claim
--     can't confirm it. Confirmations must come from more than one network.
--   • Photos can't be reused, swapped after the fact, or taken elsewhere
--     (GPS geofence + upload-time checks + optional Google Vision checks).
--   • Flags send a report for review; they can never hide or resolve it.
--   • Every action lands in an append-only public evidence trail.
--   • Neighbours on the spot rate reports (1–5); enough of them earn a
--     "Verified by neighbours" badge, or send a doubtful report for review.
--   • Officials get a right of reply, published by moderators on the report.
--   • Opt-in alerts for new reports near you (web push via kasa-notify).
--   • The pre-v2 API surface is closed: one-step resolve functions, open
--     insert policy, anon-readable admin/analytics views, and the weekly
--     photo cleanup that deleted photos it didn't recognise.
-- ════════════════════════════════════════════════════════════════════════

begin;

create schema if not exists kasa_private;
revoke all on schema kasa_private from public;

-- ── Settings ────────────────────────────────────────────────────────────
create table if not exists kasa_private.settings (
  key   text primary key,
  value jsonb not null,
  note  text
);

insert into kasa_private.settings (key, value, note) values
  ('verify_quorum',            '3',     'On-site confirmations (besides the claimant) needed to resolve'),
  ('dispute_quorum',           '2',     'On-site disputes that reject a cleanup claim'),
  ('min_distinct_networks',    '2',     'Confirmations must come from at least this many different IP networks'),
  ('challenge_hours',          '12',    'After quorum, a claim stays open to disputes this long before it is final'),
  ('claim_expiry_days',        '14',    'Claims that never reach quorum expire and the report reopens'),
  ('claim_radius_m',           '50',    'Claimant must be within this distance of the reported spot'),
  ('vote_radius_m',            '100',   'Confirmers and disputers must be within this distance'),
  ('max_gps_accuracy_m',       '60',    'GPS fixes worse than this are rejected for claims and votes'),
  ('require_vote_photo',       'true',  'Confirmations and disputes must include a fresh photo'),
  ('require_photo_check',      'false', 'Set true after deploying the kasa-photo-check Edge Function'),
  ('clean_max_garbage_score',  '0.6',   'Cleanup/confirm photos scoring above this for garbage are rejected'),
  ('dispute_min_garbage_score','0',     'If > 0, garbage disputes must show at least this much garbage (off: never block citizens)'),
  ('near_duplicate_distance',  '6',     'Photos within this fingerprint distance count as the same picture'),
  ('elsewhere_radius_m',       '200',   'A look-alike of a photo used farther away than this was taken somewhere else'),
  ('max_strikes',              '3',     'After this many rejected claims a person can no longer claim cleanups'),
  ('claim_cooldown_hours',     '24',    'After a rejected claim, the same person must wait before re-claiming'),
  ('reports_per_hour',         '5',     'Matches the pre-existing reports_rate_limit trigger'),
  ('reports_per_day',          '20',    null),
  ('actions_per_hour',         '40',    'Seen / flag / claim / vote actions per person per hour'),
  ('flag_review_threshold',    '3',     'Distinct flags that mark a report "under review" (it stays visible)'),
  ('duplicate_radius_m',       '25',    null),
  ('duplicate_hours',          '72',    null),
  ('recurrence_days',          '60',    'A new report near a spot resolved within this many days counts as a recurrence'),
  ('bbox', '{"min_lat":23.20,"max_lat":23.46,"min_lng":86.22,"max_lng":86.52}', 'Reports must fall inside Purulia town'),
  ('review_categories', '["encroachment","illegal_construction","illegal_mining","illegal_other"]',
                                    'Categories hidden until a moderator approves them'),
  ('dirty_categories', '["garbage","drain"]', 'Categories where photo checks look for garbage'),
  ('neighbour_min_raters',     '3',     'On-site ratings needed before a neighbour verdict is shown'),
  ('neighbour_verified_avg',   '4',     'Average authenticity (1–5) at or above which a report is "Verified by neighbours"'),
  ('neighbour_doubt_avg',      '2',     'Average authenticity at or below which a report goes to moderator review'),
  ('push_radius_m',            '500',   'Default alert radius for nearby-report notifications'),
  ('push_max_subs_per_user',   '3',     null),
  ('storage_public_base', '"https://cnmikcyvyamplbldiivp.supabase.co/storage/v1/object/public/kasa-photos/"', null)
on conflict (key) do nothing;

insert into kasa_private.settings (key, value, note)
values ('ip_salt', to_jsonb(md5(random()::text || clock_timestamp()::text)), 'Salt for hashing IPs; never exposed')
on conflict (key) do nothing;

create or replace function kasa_private.cfg_num(p_key text) returns numeric
language sql stable security definer set search_path = '' as
$$ select (value #>> '{}')::numeric from kasa_private.settings where key = p_key $$;

create or replace function kasa_private.cfg_bool(p_key text) returns boolean
language sql stable security definer set search_path = '' as
$$ select (value #>> '{}')::boolean from kasa_private.settings where key = p_key $$;

create or replace function kasa_private.cfg(p_key text) returns jsonb
language sql stable security definer set search_path = '' as
$$ select value from kasa_private.settings where key = p_key $$;

-- ── Reports table: create if missing, then add every column v2 relies on ──
create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lat        double precision not null,
  lng        double precision not null,
  status     text not null default 'open'
);

do $$
declare
  v_idtype text;
  v_con    text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_idtype
  from pg_attribute a where a.attrelid = 'public.reports'::regclass and a.attname = 'id';

  execute format($f$
    alter table public.reports
      add column if not exists ward_no            integer,
      add column if not exists severity           text default 'minor',
      add column if not exists description        text,
      add column if not exists reporter_name      text,
      add column if not exists reporter_hash      text,
      add column if not exists photo_url          text,
      add column if not exists upvotes            integer default 0,
      add column if not exists flags              integer default 0,
      add column if not exists sla_days           integer default 7,
      add column if not exists parent_report_id   %1$s,
      add column if not exists is_duplicate       boolean default false,
      add column if not exists sync_status        text,
      add column if not exists moderation_status  text default 'approved',
      add column if not exists moderation_labels  jsonb default '{}'::jsonb,
      add column if not exists resolved_at        timestamptz,
      add column if not exists resolved_photo_url text,
      add column if not exists category           text not null default 'garbage',
      add column if not exists landmark           text,
      add column if not exists user_id            uuid,
      add column if not exists client_id          text,
      add column if not exists accuracy_m         double precision,
      add column if not exists photo_path         text,
      add column if not exists claim_id           uuid,
      add column if not exists recurrence_count   integer not null default 0,
      add column if not exists rejected_claims    integer not null default 0,
      add column if not exists seen_on_site       integer not null default 0,
      add column if not exists resolution_method  text,
      add column if not exists rating_count        integer not null default 0,
      add column if not exists onsite_rating_count integer not null default 0,
      add column if not exists authenticity_avg    numeric(3,2),
      add column if not exists severity_avg        numeric(3,2),
      add column if not exists neighbour_status    text,
      add column if not exists reply_count         integer not null default 0,
      add column if not exists notified_at         timestamptz,
      add column if not exists updated_at         timestamptz default now()
  $f$, v_idtype);

  -- Drop legacy CHECK constraints on the columns whose allowed values change.
  for v_con in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.reports'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\m(status|moderation_status|category)\M'
      and c.conname not in ('kasa_reports_status_chk', 'kasa_reports_moderation_chk', 'kasa_reports_category_chk')
  loop
    execute format('alter table public.reports drop constraint %I', v_con);
  end loop;
end $$;

-- Normalise legacy data before adding the new constraints.
update public.reports set status = 'open'
  where status is null or status not in ('open', 'claimed', 'resolved');
update public.reports set moderation_status = case
    when moderation_status in ('rejected', 'hidden') then 'hidden'
    when moderation_status in ('review', 'flagged') then moderation_status
    else 'approved' end
  where moderation_status is null or moderation_status not in ('approved', 'review', 'flagged', 'hidden');
-- Anything resolved before v2 was resolved without community verification. Keep it
-- resolved, but say so publicly instead of pretending it was verified.
update public.reports set resolution_method = 'legacy_unverified'
  where status = 'resolved' and resolution_method is null;
update public.reports set status = 'open', claim_id = null
  where status = 'claimed' and claim_id is null;

do $$ begin
  alter table public.reports add constraint kasa_reports_status_chk
    check (status in ('open', 'claimed', 'resolved'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.reports add constraint kasa_reports_moderation_chk
    check (moderation_status in ('approved', 'review', 'flagged', 'hidden'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.reports add constraint kasa_reports_neighbour_chk
    check (neighbour_status is null or neighbour_status in ('verified', 'doubted'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.reports add constraint kasa_reports_category_chk
    check (category in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing',
                        'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other'));
exception when duplicate_object then null; end $$;

create unique index if not exists kasa_reports_client_id_uq on public.reports (user_id, client_id) where client_id is not null;
create index if not exists kasa_reports_created_idx on public.reports (created_at desc);
create index if not exists kasa_reports_user_idx on public.reports (user_id, created_at desc);

-- ── Private tables (never reachable through the REST API directly) ───────
do $$
declare
  t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
  from pg_attribute a where a.attrelid = 'public.reports'::regclass and a.attname = 'id';

  execute format($f$
    create table if not exists kasa_private.claims (
      id               uuid primary key default gen_random_uuid(),
      report_id        %1$s not null references public.reports(id) on delete cascade,
      claimant_id      uuid not null,
      photo_path       text not null unique,
      photo_url        text not null,
      lat              double precision not null,
      lng              double precision not null,
      accuracy_m       double precision not null,
      distance_m       double precision not null,
      ip_hash          text,
      status           text not null default 'pending'
                       check (status in ('pending', 'accepted', 'rejected', 'expired')),
      verify_count     integer not null default 0,
      dispute_count    integer not null default 0,
      quorum_reached_at timestamptz,
      decided_at       timestamptz,
      decided_reason   text,
      created_at       timestamptz not null default now()
    );

    create table if not exists kasa_private.seen (
      report_id       %1$s not null references public.reports(id) on delete cascade,
      user_id         uuid not null,
      on_site         boolean not null default false,
      distance_m      double precision,
      authenticity    smallint check (authenticity between 1 and 5),
      severity_rating smallint check (severity_rating between 1 and 5),
      rated_at        timestamptz,
      ip_hash         text,
      created_at      timestamptz not null default now(),
      primary key (report_id, user_id)
    );

    create table if not exists kasa_private.replies (
      id             uuid primary key default gen_random_uuid(),
      report_id      %1$s not null references public.reports(id) on delete cascade,
      responder_name text not null check (length(responder_name) between 2 and 120),
      responder_role text not null check (length(responder_role) between 2 and 160),
      body           text not null check (length(body) between 10 and 2000),
      verified_note  text,
      posted_by      uuid,
      hidden_at      timestamptz,
      hidden_reason  text,
      created_at     timestamptz not null default now()
    );

    create table if not exists kasa_private.flags (
      report_id  %1$s not null references public.reports(id) on delete cascade,
      user_id    uuid not null,
      reason     text not null check (reason in ('not_an_issue', 'wrong_location', 'duplicate',
                                                  'inappropriate', 'fake_or_old_photo', 'other')),
      note       text,
      created_at timestamptz not null default now(),
      primary key (report_id, user_id)
    );

    create table if not exists kasa_private.events (
      id          bigserial primary key,
      report_id   %1$s not null references public.reports(id) on delete cascade,
      kind        text not null,
      actor_id    uuid,
      actor_tag   text,
      claim_id    uuid,
      photo_url   text,
      distance_m  double precision,
      detail      jsonb not null default '{}'::jsonb,
      created_at  timestamptz not null default now()
    );
  $f$, t);
end $$;

create unique index if not exists kasa_claims_one_pending on kasa_private.claims (report_id) where status = 'pending';
create index if not exists kasa_claims_claimant_idx on kasa_private.claims (claimant_id, created_at desc);
create index if not exists kasa_events_report_idx on kasa_private.events (report_id, created_at);
create index if not exists kasa_seen_user_idx on kasa_private.seen (user_id, created_at desc);
create index if not exists kasa_flags_user_idx on kasa_private.flags (user_id, created_at desc);

create table if not exists kasa_private.votes (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references kasa_private.claims(id) on delete cascade,
  voter_id    uuid not null,
  vote        text not null check (vote in ('verify', 'dispute')),
  photo_path  text unique,
  photo_url   text,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision not null,
  distance_m  double precision not null,
  ip_hash     text,
  note        text,
  voided_at   timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  unique (claim_id, voter_id)
);
alter table kasa_private.votes add column if not exists voided_at timestamptz, add column if not exists void_reason text;
create index if not exists kasa_votes_voter_idx on kasa_private.votes (voter_id, created_at desc);

alter table kasa_private.seen
  add column if not exists authenticity    smallint check (authenticity between 1 and 5),
  add column if not exists severity_rating smallint check (severity_rating between 1 and 5),
  add column if not exists rated_at        timestamptz,
  add column if not exists ip_hash         text;
create index if not exists kasa_replies_report_idx on kasa_private.replies (report_id, created_at);

-- Opt-in "new report near me" alerts. Location is rounded to ~100 m.
create table if not exists kasa_private.push_subs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  lat          double precision not null,
  lng          double precision not null,
  radius_m     integer not null default 500 check (radius_m between 100 and 2000),
  lang         text not null default 'en',
  fail_count   integer not null default 0,
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists kasa_push_subs_user_idx on kasa_private.push_subs (user_id, created_at);

create table if not exists kasa_private.profiles (
  user_id    uuid primary key,
  strikes    integer not null default 0,
  banned     boolean not null default false,
  created_at timestamptz not null default now()
);

-- Written only by the kasa-photo-check Edge Function (service role).
create table if not exists kasa_private.photo_checks (
  photo_path    text primary key,
  sha256        text not null,
  dhash         text,
  garbage_score double precision,
  labels        jsonb not null default '[]'::jsonb,
  unsafe        boolean not null default false,
  face_count    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists kasa_photo_checks_sha_idx on kasa_private.photo_checks (sha256);

alter table kasa_private.settings     enable row level security;
alter table kasa_private.claims       enable row level security;
alter table kasa_private.votes        enable row level security;
alter table kasa_private.seen         enable row level security;
alter table kasa_private.flags        enable row level security;
alter table kasa_private.events       enable row level security;
alter table kasa_private.profiles     enable row level security;
alter table kasa_private.photo_checks enable row level security;
alter table kasa_private.replies      enable row level security;
alter table kasa_private.push_subs    enable row level security;

-- ── Internal helpers ─────────────────────────────────────────────────────
create or replace function kasa_private.fail(p_code text, p_message text, p_data jsonb default null)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_message,
    hint = coalesce(p_data::text, '');
end $$;

create or replace function kasa_private.distance_m(lat1 double precision, lng1 double precision,
                                                   lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Distance between two photo fingerprints from the kasa-photo-check function
-- (64 hex chars: 128 edge signs, then a 128-bit "clear edge" mask). An edge
-- that is flat in one photo and clear in the other counts as a difference.
-- Null when either photo has too little detail to compare.
create or replace function kasa_private.photo_distance(a text, b text) returns integer
language sql immutable as $$
  select case when bit_count(ca | cb) < 24 then null
              else (bit_count(ca # cb) + bit_count(ca & cb & (sa # sb)))::integer end
  from (select ('x' || substr(a, 1, 32))::bit(128) as sa, ('x' || substr(a, 33, 32))::bit(128) as ca,
               ('x' || substr(b, 1, 32))::bit(128) as sb, ('x' || substr(b, 33, 32))::bit(128) as cb
        where length(a) = 64 and length(b) = 64
          and a ~ '^[0-9a-f]+$' and b ~ '^[0-9a-f]+$') t
$$;

create or replace function kasa_private.is_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or to_regclass('public.admins') is null then return false; end if;
  return exists (select 1 from public.admins a where a.user_id = auth.uid());
end $$;

-- Current caller; creates their profile on first use and enforces bans.
create or replace function kasa_private.me() returns kasa_private.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v kasa_private.profiles;
begin
  if auth.uid() is null then
    perform kasa_private.fail('KASA_AUTH_REQUIRED', 'Sign-in is required for this action.');
  end if;
  insert into kasa_private.profiles (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into v from kasa_private.profiles where user_id = auth.uid();
  if v.banned then
    perform kasa_private.fail('KASA_BLOCKED', 'This device has been blocked for abuse.');
  end if;
  return v;
end $$;

-- Per-report pseudonym: stable within one report, unlinkable across reports.
create or replace function kasa_private.tag(p_user uuid, p_report text) returns text
language sql stable security definer set search_path = '' as $$
  select upper(substr(md5(p_user::text || ':' || p_report || ':' ||
                          (select value #>> '{}' from kasa_private.settings where key = 'ip_salt')), 1, 6))
$$;

create or replace function kasa_private.ip_hash() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  h json;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;
  if h is null then return null; end if;
  ip := coalesce(h ->> 'cf-connecting-ip', nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''), h ->> 'x-real-ip');
  if ip is null then return null; end if;
  -- Group IPv4 by /24 and IPv6 by /48 so one phone hopping addresses is still one network.
  if ip ~ '^\d+\.\d+\.\d+\.\d+$' then
    ip := regexp_replace(ip, '\.\d+$', '');
  elsif position(':' in ip) > 0 then
    ip := array_to_string((string_to_array(ip, ':'))[1:3], ':');
  end if;
  return md5(ip || (select value #>> '{}' from kasa_private.settings where key = 'ip_salt'));
end $$;

create or replace function kasa_private.rate_limit_actions(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  select (select count(*) from kasa_private.seen   where user_id     = p_uid and created_at > now() - interval '1 hour')
       + (select count(*) from kasa_private.flags  where user_id     = p_uid and created_at > now() - interval '1 hour')
       + (select count(*) from kasa_private.claims where claimant_id = p_uid and created_at > now() - interval '1 hour')
       + (select count(*) from kasa_private.votes  where voter_id    = p_uid and created_at > now() - interval '1 hour')
    into n;
  if n >= kasa_private.cfg_num('actions_per_hour') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many actions. Try again in an hour.');
  end if;
end $$;

create or replace function kasa_private.add_event(p_report_id text, p_kind text, p_actor uuid,
    p_claim uuid default null, p_photo_url text default null, p_distance double precision default null,
    p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.events (report_id, kind, actor_id, actor_tag, claim_id, photo_url, distance_m, detail)
  select r.id, p_kind, p_actor,
         case when p_actor is null then null else kasa_private.tag(p_actor, p_report_id) end,
         p_claim, p_photo_url, p_distance, coalesce(p_detail, '{}'::jsonb)
  from public.reports r where r.id::text = p_report_id;
end $$;

-- Validates an uploaded photo and returns its server-side check (null if none).
create or replace function kasa_private.check_photo(p_path text, p_folder text, p_uid uuid, p_not_before timestamptz,
                                                    p_lat double precision, p_lng double precision)
returns kasa_private.photo_checks
language plpgsql security definer set search_path = '' as $$
declare
  v_created timestamptz;
  v_owner   text;
  v_chk     kasa_private.photo_checks;
  v_near    integer := kasa_private.cfg_num('near_duplicate_distance')::integer;
  v_far     double precision := kasa_private.cfg_num('elsewhere_radius_m');
begin
  -- Flat random names: a public photo link must not reveal who uploaded it.
  -- Ownership comes from the owner Supabase Storage records for the upload.
  if p_path is null or p_path !~ ('^' || p_folder || '/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$') then
    perform kasa_private.fail('KASA_PHOTO_INVALID', 'A photo is required.');
  end if;

  select o.created_at, coalesce(o.owner_id::text, o.owner::text) into v_created, v_owner
  from storage.objects o where o.bucket_id = 'kasa-photos' and o.name = p_path;
  if not found then
    perform kasa_private.fail('KASA_PHOTO_MISSING', 'Upload the photo first.');
  end if;
  if v_owner is distinct from p_uid::text then
    perform kasa_private.fail('KASA_PHOTO_NOT_YOURS', 'You can only submit photos you uploaded.');
  end if;
  if v_created < coalesce(p_not_before, '-infinity') or v_created < now() - interval '24 hours' then
    perform kasa_private.fail('KASA_PHOTO_STALE', 'Take a new photo now — older uploads can''t be used.');
  end if;
  if exists (select 1 from public.reports  where photo_path = p_path)
  or exists (select 1 from kasa_private.claims where photo_path = p_path)
  or exists (select 1 from kasa_private.votes  where photo_path = p_path) then
    perform kasa_private.fail('KASA_PHOTO_REUSED', 'This photo has already been used.');
  end if;

  select * into v_chk from kasa_private.photo_checks where photo_path = p_path;
  if not found then
    if kasa_private.cfg_bool('require_photo_check') then
      perform kasa_private.fail('KASA_PHOTO_UNCHECKED', 'Photo verification is unavailable right now. Try again shortly.');
    end if;
    return null;
  end if;
  if v_chk.unsafe then
    perform kasa_private.fail('KASA_PHOTO_UNSAFE', 'This photo can''t be published.');
  end if;
  -- The exact same file is never a new photo, wherever it was used before.
  if exists (select 1 from kasa_private.photo_checks c where c.photo_path <> p_path and c.sha256 = v_chk.sha256) then
    perform kasa_private.fail('KASA_PHOTO_REUSED', 'This photo has already been used. Take a new one.');
  end if;
  -- A look-alike of a photo used at a different place was taken somewhere else.
  -- (Look-alikes at the same spot are allowed: honest people photographing the
  -- same clean corner produce near-identical pictures.)
  if p_lat is not null and exists (
      select 1 from kasa_private.photo_checks c
      join lateral (
        select r.lat, r.lng from public.reports r where r.photo_path = c.photo_path
        union all select cl.lat, cl.lng from kasa_private.claims cl where cl.photo_path = c.photo_path
        union all select v.lat, v.lng from kasa_private.votes v where v.photo_path = c.photo_path
      ) used on true
      where c.photo_path <> p_path
        and kasa_private.photo_distance(c.dhash, v_chk.dhash) <= v_near
        and kasa_private.distance_m(used.lat, used.lng, p_lat, p_lng) > v_far) then
    perform kasa_private.fail('KASA_PHOTO_ELSEWHERE', 'This photo matches one taken at a different place.');
  end if;
  return v_chk;
end $$;

create or replace function kasa_private.reject_claim(p_claim_id uuid, p_reason text, p_actor uuid, p_strike boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c kasa_private.claims;
begin
  update kasa_private.claims set status = 'rejected', decided_at = now(), decided_reason = p_reason
  where id = p_claim_id and status = 'pending' returning * into c;
  if not found then return; end if;
  update public.reports set status = 'open', claim_id = null, rejected_claims = rejected_claims + 1, updated_at = now()
  where id = c.report_id;
  if p_strike then
    insert into kasa_private.profiles (user_id, strikes) values (c.claimant_id, 1)
    on conflict (user_id) do update set strikes = kasa_private.profiles.strikes + 1;
  end if;
  perform kasa_private.add_event(c.report_id::text, 'claim_rejected', p_actor, c.id, null, null,
    jsonb_build_object('reason', p_reason, 'verify_count', c.verify_count, 'dispute_count', c.dispute_count));
end $$;

-- Decides a pending claim if the rules allow. Returns the claim's status afterwards.
create or replace function kasa_private.evaluate_claim(p_claim_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c        kasa_private.claims;
  v_nets   integer;
  v_need   integer := kasa_private.cfg_num('verify_quorum')::integer;
begin
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found or c.status <> 'pending' then return coalesce(c.status, 'missing'); end if;

  if c.dispute_count >= kasa_private.cfg_num('dispute_quorum') then
    perform kasa_private.reject_claim(c.id, 'disputed_on_site', null, true);
    return 'rejected';
  end if;

  select count(distinct coalesce(v.ip_hash, v.id::text)) into v_nets
  from kasa_private.votes v where v.claim_id = c.id and v.vote = 'verify' and v.voided_at is null;

  if c.quorum_reached_at is null and c.verify_count >= v_need
     and v_nets >= least(v_need, kasa_private.cfg_num('min_distinct_networks')::integer) then
    update kasa_private.claims set quorum_reached_at = now() where id = c.id returning * into c;
    perform kasa_private.add_event(c.report_id::text, 'quorum_reached', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count,
                         'final_after', now() + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer)));
  end if;

  if c.quorum_reached_at is not null
     and c.quorum_reached_at + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer) <= now() then
    update kasa_private.claims set status = 'accepted', decided_at = now(), decided_reason = 'community_verified'
    where id = c.id;
    update public.reports set status = 'resolved', resolved_at = now(), resolved_photo_url = c.photo_url,
           resolution_method = 'community', updated_at = now()
    where id = c.report_id;
    perform kasa_private.add_event(c.report_id::text, 'resolved', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'dispute_count', c.dispute_count));
    return 'accepted';
  end if;

  if c.quorum_reached_at is null
     and c.created_at + make_interval(days => kasa_private.cfg_num('claim_expiry_days')::integer) <= now() then
    update kasa_private.claims set status = 'expired', decided_at = now(), decided_reason = 'not_enough_confirmations'
    where id = c.id;
    update public.reports set status = 'open', claim_id = null, updated_at = now() where id = c.report_id;
    perform kasa_private.add_event(c.report_id::text, 'claim_expired', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count));
    return 'expired';
  end if;

  return 'pending';
end $$;

-- ── Public API ───────────────────────────────────────────────────────────
create or replace function public.kasa_version() returns integer
language sql immutable as $$ select 2 $$;

create or replace function public.kasa_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(key, value) from kasa_private.settings
  where key in ('verify_quorum', 'dispute_quorum', 'challenge_hours', 'claim_expiry_days', 'claim_radius_m',
                'vote_radius_m', 'max_gps_accuracy_m', 'require_vote_photo', 'review_categories', 'bbox')
$$;

create or replace function public.kasa_create_report(
  p_category text, p_severity text, p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_ward_no integer, p_description text, p_landmark text,
  p_photo_path text, p_client_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me        kasa_private.profiles := kasa_private.me();
  v_bbox    jsonb := kasa_private.cfg('bbox');
  v_chk     kasa_private.photo_checks;
  v_existing public.reports;
  v_parent  public.reports;
  v_recur   public.reports;
  v_new     public.reports;
  v_mod     text := 'approved';
  v_url     text;
begin
  if p_client_id is not null then
    select * into v_existing from public.reports where user_id = me.user_id and client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_existing.id, 'moderation_status', v_existing.moderation_status, 'replayed', true);
    end if;
  end if;

  if p_category is null or p_category not in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing',
      'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other') then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Choose what kind of problem this is.');
  end if;
  if coalesce(p_severity, '') not in ('minor', 'severe', 'critical') then
    perform kasa_private.fail('KASA_BAD_SEVERITY', 'Choose a severity.');
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between (v_bbox ->> 'min_lat')::float8 and (v_bbox ->> 'max_lat')::float8
     or p_lng not between (v_bbox ->> 'min_lng')::float8 and (v_bbox ->> 'max_lng')::float8 then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia town.');
  end if;
  if p_ward_no is not null and p_ward_no not between 1 and 23 then
    perform kasa_private.fail('KASA_BAD_WARD', 'Ward must be between 1 and 23.');
  end if;
  if length(coalesce(p_description, '')) > 500 or length(coalesce(p_landmark, '')) > 140 then
    perform kasa_private.fail('KASA_TOO_LONG', 'Description is too long.');
  end if;

  if (select count(*) from public.reports where user_id = me.user_id and created_at > now() - interval '1 hour')
       >= kasa_private.cfg_num('reports_per_hour')
  or (select count(*) from public.reports where user_id = me.user_id and created_at > now() - interval '1 day')
       >= kasa_private.cfg_num('reports_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have filed a lot of reports. Try again later.');
  end if;

  v_chk := kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, p_lat, p_lng);
  v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;

  if p_category in (select jsonb_array_elements_text(kasa_private.cfg('review_categories')))
     or coalesce(v_chk.face_count, 0) > 0 then
    v_mod := 'review';
  end if;

  -- Same problem already reported nearby → link to it and count this person as a witness.
  select * into v_parent from public.reports r
  where r.category = p_category and r.status in ('open', 'claimed') and not coalesce(r.is_duplicate, false)
    and r.moderation_status <> 'hidden'
    and r.created_at > now() - make_interval(hours => kasa_private.cfg_num('duplicate_hours')::integer)
    and kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng) <= kasa_private.cfg_num('duplicate_radius_m')
  order by kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng) limit 1;

  if v_parent.id is null then
    -- A spot that was "resolved" recently and is dirty again is a recurrence, on the record.
    select * into v_recur from public.reports r
    where r.category = p_category and r.status = 'resolved'
      and r.resolved_at > now() - make_interval(days => kasa_private.cfg_num('recurrence_days')::integer)
      and kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng) <= kasa_private.cfg_num('duplicate_radius_m')
    order by r.resolved_at desc limit 1;
  end if;

  insert into public.reports (lat, lng, ward_no, severity, description, reporter_name, reporter_hash, photo_url,
      status, upvotes, flags, sla_days, parent_report_id, is_duplicate, sync_status, moderation_status,
      moderation_labels, category, landmark, user_id, client_id, accuracy_m, photo_path)
  values (p_lat, p_lng, p_ward_no, p_severity, nullif(trim(p_description), ''), null,
      substr(md5(me.user_id::text || (kasa_private.cfg('ip_salt') #>> '{}')), 1, 16), v_url,
      'open', 0, 0, 7, coalesce(v_parent.id, v_recur.id), v_parent.id is not null, 'synced', v_mod,
      case when v_chk.photo_path is null then '{}'::jsonb
           else jsonb_build_object('garbage_score', v_chk.garbage_score, 'labels', v_chk.labels) end,
      p_category, nullif(trim(p_landmark), ''), me.user_id, p_client_id, p_accuracy, p_photo_path)
  returning * into v_new;

  perform kasa_private.add_event(v_new.id::text, 'reported', me.user_id, null, v_url, null,
    jsonb_build_object('gps', p_accuracy is not null, 'accuracy_m', round(p_accuracy::numeric)));

  if v_parent.id is not null then
    insert into kasa_private.seen (report_id, user_id, on_site, distance_m)
    values (v_parent.id, me.user_id, p_accuracy is not null and p_accuracy <= kasa_private.cfg_num('max_gps_accuracy_m'),
            kasa_private.distance_m(v_parent.lat, v_parent.lng, p_lat, p_lng))
    on conflict do nothing;
    if found then
      update public.reports set upvotes = coalesce(upvotes, 0) + 1,
             seen_on_site = seen_on_site + (case when p_accuracy is not null
               and p_accuracy <= kasa_private.cfg_num('max_gps_accuracy_m') then 1 else 0 end)
      where id = v_parent.id;
    end if;
  elsif v_recur.id is not null then
    update public.reports set recurrence_count = recurrence_count + 1 where id = v_recur.id;
    perform kasa_private.add_event(v_recur.id::text, 'recurred', me.user_id, null, v_url, null,
      jsonb_build_object('new_report_id', v_new.id));
  end if;

  return jsonb_build_object('id', v_new.id, 'moderation_status', v_mod,
    'duplicate_of', v_parent.id, 'recurrence_of', v_recur.id);
end $$;

create or replace function public.kasa_mark_seen(p_report_id text, p_lat double precision default null,
    p_lng double precision default null, p_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me      kasa_private.profiles := kasa_private.me();
  r       public.reports;
  v_dist  double precision;
  v_site  boolean := false;
begin
  select * into r from public.reports where id::text = p_report_id and moderation_status in ('approved', 'flagged') for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.status = 'resolved' then
    perform kasa_private.fail('KASA_ALREADY_RESOLVED', 'This was marked resolved. If it is back, file a new report here.');
  end if;
  if r.user_id = me.user_id then
    return jsonb_build_object('counted', false, 'reason', 'own_report', 'seen_count', coalesce(r.upvotes, 0) + 1);
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  if p_lat is not null and p_lng is not null then
    v_dist := kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng);
    v_site := coalesce(p_accuracy, 1e9) <= kasa_private.cfg_num('max_gps_accuracy_m')
              and v_dist <= kasa_private.cfg_num('vote_radius_m');
  end if;

  insert into kasa_private.seen (report_id, user_id, on_site, distance_m, ip_hash)
  values (r.id, me.user_id, v_site, v_dist, kasa_private.ip_hash()) on conflict do nothing;
  if not found then
    return jsonb_build_object('counted', false, 'reason', 'already_counted', 'seen_count', coalesce(r.upvotes, 0) + 1);
  end if;

  update public.reports set upvotes = coalesce(upvotes, 0) + 1,
         seen_on_site = seen_on_site + (case when v_site then 1 else 0 end)
  where id = r.id returning * into r;
  return jsonb_build_object('counted', true, 'on_site', v_site, 'seen_count', coalesce(r.upvotes, 0) + 1);
end $$;

create or replace function public.kasa_claim_cleanup(p_report_id text, p_photo_path text,
    p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  r      public.reports;
  v_chk  kasa_private.photo_checks;
  v_orig kasa_private.photo_checks;
  v_dist double precision;
  c      kasa_private.claims;
begin
  select * into r from public.reports where id::text = p_report_id for update;
  if not found or r.moderation_status = 'hidden' then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.status = 'claimed' then perform kasa_private.fail('KASA_ALREADY_CLAIMED', 'A cleanup is already being verified. Confirm or dispute it instead.'); end if;
  if r.status = 'resolved' then perform kasa_private.fail('KASA_ALREADY_RESOLVED', 'This is already resolved.'); end if;
  if coalesce(r.is_duplicate, false) then perform kasa_private.fail('KASA_IS_DUPLICATE', 'This report is linked to another one. Verify the original.'); end if;

  if me.strikes >= kasa_private.cfg_num('max_strikes') then
    perform kasa_private.fail('KASA_CLAIM_BLOCKED', 'Too many of your cleanup claims were rejected. You can still confirm or dispute others.');
  end if;
  if exists (select 1 from kasa_private.claims where report_id = r.id and claimant_id = me.user_id and status = 'rejected'
             and decided_at > now() - make_interval(hours => kasa_private.cfg_num('claim_cooldown_hours')::integer)) then
    perform kasa_private.fail('KASA_COOLDOWN', 'Your last claim here was rejected. Wait before claiming again.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  if p_lat is null or p_lng is null or p_accuracy is null then
    perform kasa_private.fail('KASA_GPS_REQUIRED', 'Turn on location — you need to be at the spot.');
  end if;
  if p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'GPS signal is too weak. Step outside and try again.',
      jsonb_build_object('accuracy_m', round(p_accuracy::numeric)));
  end if;
  v_dist := kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng);
  if v_dist > kasa_private.cfg_num('claim_radius_m') then
    perform kasa_private.fail('KASA_TOO_FAR', 'You must be at the reported spot.',
      jsonb_build_object('distance_m', round(v_dist::numeric), 'limit_m', kasa_private.cfg_num('claim_radius_m')));
  end if;

  v_chk := kasa_private.check_photo(p_photo_path, 'claims', me.user_id, r.created_at, p_lat, p_lng);
  if v_chk.photo_path is not null then
    if r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories')))
       and coalesce(v_chk.garbage_score, 0) > kasa_private.cfg_num('clean_max_garbage_score') then
      perform kasa_private.fail('KASA_STILL_DIRTY', 'The photo still shows garbage.',
        jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)));
    end if;
    select * into v_orig from kasa_private.photo_checks where photo_path = r.photo_path;
    if kasa_private.photo_distance(v_orig.dhash, v_chk.dhash) <= kasa_private.cfg_num('near_duplicate_distance') then
      perform kasa_private.fail('KASA_PHOTO_REUSED', 'This looks like the original report photo — nothing has changed.');
    end if;
  end if;

  insert into kasa_private.claims (report_id, claimant_id, photo_path, photo_url, lat, lng, accuracy_m, distance_m, ip_hash)
  values (r.id, me.user_id, p_photo_path, (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path,
          p_lat, p_lng, p_accuracy, v_dist, kasa_private.ip_hash())
  returning * into c;
  update public.reports set status = 'claimed', claim_id = c.id, updated_at = now() where id = r.id;
  perform kasa_private.add_event(r.id::text, 'claimed', me.user_id, c.id, c.photo_url, v_dist,
    case when v_chk.photo_path is null then '{}'::jsonb
         else jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)) end);

  return jsonb_build_object('claim_id', c.id, 'status', 'claimed',
    'verify_needed', kasa_private.cfg_num('verify_quorum'), 'distance_m', round(v_dist::numeric));
end $$;

create or replace function public.kasa_vote_claim(p_claim_id uuid, p_vote text, p_photo_path text,
    p_lat double precision, p_lng double precision, p_accuracy double precision, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me       kasa_private.profiles := kasa_private.me();
  c        kasa_private.claims;
  r        public.reports;
  v_chk    kasa_private.photo_checks;
  v_dist   double precision;
  v_joined timestamptz;
  v_state  text;
  v_url    text;
begin
  if p_vote not in ('verify', 'dispute') then perform kasa_private.fail('KASA_BAD_VOTE', 'Unknown vote.'); end if;
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found or c.status <> 'pending' then
    perform kasa_private.fail('KASA_CLAIM_CLOSED', 'This cleanup claim is no longer open.');
  end if;
  select * into r from public.reports where id = c.report_id;
  if c.claimant_id = me.user_id then
    perform kasa_private.fail('KASA_OWN_CLAIM', 'You made this claim — other people have to confirm it.');
  end if;
  if exists (select 1 from kasa_private.votes where claim_id = c.id and voter_id = me.user_id) then
    perform kasa_private.fail('KASA_ALREADY_VOTED', 'You already responded to this claim.');
  end if;
  if p_vote = 'verify' then
    select u.created_at into v_joined from auth.users u where u.id = me.user_id;
    if v_joined is null or v_joined >= c.created_at then
      perform kasa_private.fail('KASA_ACCOUNT_TOO_NEW', 'Only people who were using Kasa before this cleanup was claimed can confirm it.');
    end if;
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  if p_lat is null or p_lng is null or p_accuracy is null then
    perform kasa_private.fail('KASA_GPS_REQUIRED', 'Turn on location — you need to be at the spot.');
  end if;
  if p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'GPS signal is too weak. Step outside and try again.',
      jsonb_build_object('accuracy_m', round(p_accuracy::numeric)));
  end if;
  v_dist := kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng);
  if v_dist > kasa_private.cfg_num('vote_radius_m') then
    perform kasa_private.fail('KASA_TOO_FAR', 'You must be at the reported spot.',
      jsonb_build_object('distance_m', round(v_dist::numeric), 'limit_m', kasa_private.cfg_num('vote_radius_m')));
  end if;

  if p_photo_path is null then
    if kasa_private.cfg_bool('require_vote_photo') then
      perform kasa_private.fail('KASA_PHOTO_INVALID', 'Take a photo of the spot as it is now.');
    end if;
  else
    v_chk := kasa_private.check_photo(p_photo_path, 'votes', me.user_id, c.created_at, p_lat, p_lng);
    v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;
    if v_chk.photo_path is not null then
      if r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories'))) then
        if p_vote = 'verify' and coalesce(v_chk.garbage_score, 0) > kasa_private.cfg_num('clean_max_garbage_score') then
          perform kasa_private.fail('KASA_STILL_DIRTY', 'Your photo still shows garbage — choose "Still dirty" instead.',
            jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)));
        end if;
        if p_vote = 'dispute' and kasa_private.cfg_num('dispute_min_garbage_score') > 0
           and coalesce(v_chk.garbage_score, 1) < kasa_private.cfg_num('dispute_min_garbage_score') then
          perform kasa_private.fail('KASA_LOOKS_CLEAN', 'Your photo doesn''t show garbage. Photograph what is still there.');
        end if;
      end if;
    end if;
  end if;

  insert into kasa_private.votes (claim_id, voter_id, vote, photo_path, photo_url, lat, lng, accuracy_m, distance_m, ip_hash, note)
  values (c.id, me.user_id, p_vote, p_photo_path, v_url, p_lat, p_lng, p_accuracy, v_dist,
          kasa_private.ip_hash(), nullif(left(trim(coalesce(p_note, '')), 280), ''));

  if p_vote = 'verify' then
    update kasa_private.claims set verify_count = verify_count + 1 where id = c.id;
  else
    update kasa_private.claims set dispute_count = dispute_count + 1 where id = c.id;
  end if;
  perform kasa_private.add_event(r.id::text, case when p_vote = 'verify' then 'verified' else 'disputed' end,
    me.user_id, c.id, v_url, v_dist,
    case when v_chk.photo_path is null then '{}'::jsonb
         else jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)) end);

  v_state := kasa_private.evaluate_claim(c.id);
  select * into c from kasa_private.claims where id = c.id;
  return jsonb_build_object('claim_status', v_state, 'verify_count', c.verify_count, 'dispute_count', c.dispute_count,
    'verify_needed', kasa_private.cfg_num('verify_quorum'), 'dispute_needed', kasa_private.cfg_num('dispute_quorum'),
    'final_after', case when c.quorum_reached_at is null then null
                        else c.quorum_reached_at + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer) end);
end $$;

create or replace function public.kasa_finalize_due() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n  integer := 0;
  v_state text;
begin
  for v_id in
    select id from kasa_private.claims
    where status = 'pending'
      and ((quorum_reached_at is not null
            and quorum_reached_at + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer) <= now())
        or created_at + make_interval(days => kasa_private.cfg_num('claim_expiry_days')::integer) <= now())
    limit 200
  loop
    v_state := kasa_private.evaluate_claim(v_id);
    if v_state <> 'pending' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

create or replace function public.kasa_flag_report(p_report_id text, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
  r  public.reports;
begin
  select * into r from public.reports where id::text = p_report_id and moderation_status in ('approved', 'flagged') for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.user_id = me.user_id then perform kasa_private.fail('KASA_OWN_REPORT', 'You can''t flag your own report.'); end if;
  if p_reason is null or p_reason not in ('not_an_issue', 'wrong_location', 'duplicate', 'inappropriate', 'fake_or_old_photo', 'other') then
    perform kasa_private.fail('KASA_BAD_REASON', 'Choose a reason.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  insert into kasa_private.flags (report_id, user_id, reason, note)
  values (r.id, me.user_id, p_reason, nullif(left(trim(coalesce(p_note, '')), 280), ''))
  on conflict do nothing;
  if not found then return jsonb_build_object('counted', false, 'flags', r.flags); end if;

  update public.reports set flags = coalesce(flags, 0) + 1,
         moderation_status = case when coalesce(flags, 0) + 1 >= kasa_private.cfg_num('flag_review_threshold')
                                        and moderation_status = 'approved' then 'flagged' else moderation_status end
  where id = r.id returning * into r;
  perform kasa_private.add_event(r.id::text, 'flagged', me.user_id, null, null, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('counted', true, 'flags', r.flags, 'under_review', r.moderation_status = 'flagged');
end $$;

-- Neighbour rating: "is this real?" and "how bad is it?" (1–5). Counts as a
-- sighting too. Only on-site ratings from 2+ networks can earn a verdict.
create or replace function public.kasa_rate_report(p_report_id text, p_authenticity integer, p_severity integer,
    p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  r      public.reports;
  v_prev kasa_private.seen;
  v_dist double precision;
  v_site boolean := false;
  v_new  boolean := false;
  a      record;
  v_min  integer := kasa_private.cfg_num('neighbour_min_raters')::integer;
  v_verdict text;
begin
  select * into r from public.reports where id::text = p_report_id and moderation_status in ('approved', 'flagged') for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.status = 'resolved' then
    perform kasa_private.fail('KASA_ALREADY_RESOLVED', 'This was marked resolved. If it is back, file a new report here.');
  end if;
  if r.user_id = me.user_id then perform kasa_private.fail('KASA_OWN_REPORT', 'You can''t rate your own report.'); end if;
  if (p_authenticity is null and p_severity is null)
     or coalesce(p_authenticity, 3) not between 1 and 5 or coalesce(p_severity, 3) not between 1 and 5 then
    perform kasa_private.fail('KASA_BAD_RATING', 'Ratings go from 1 to 5.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  if p_lat is not null and p_lng is not null then
    v_dist := kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng);
    v_site := coalesce(p_accuracy, 1e9) <= kasa_private.cfg_num('max_gps_accuracy_m')
              and v_dist <= kasa_private.cfg_num('vote_radius_m');
  end if;

  select * into v_prev from kasa_private.seen where report_id = r.id and user_id = me.user_id for update;
  if not found then
    v_new := true;
    insert into kasa_private.seen (report_id, user_id, on_site, distance_m, authenticity, severity_rating, rated_at, ip_hash)
    values (r.id, me.user_id, v_site, v_dist, p_authenticity, p_severity, now(), kasa_private.ip_hash());
    update public.reports set upvotes = coalesce(upvotes, 0) + 1, seen_on_site = seen_on_site + (case when v_site then 1 else 0 end)
    where id = r.id;
  else
    update kasa_private.seen set
      authenticity = coalesce(p_authenticity, authenticity), severity_rating = coalesce(p_severity, severity_rating),
      rated_at = now(), on_site = on_site or v_site,
      distance_m = case when v_site then v_dist else distance_m end,
      ip_hash = coalesce(kasa_private.ip_hash(), ip_hash)
    where report_id = r.id and user_id = me.user_id;
    if v_site and not v_prev.on_site then
      update public.reports set seen_on_site = seen_on_site + 1 where id = r.id;
    end if;
  end if;

  select count(*) filter (where s.authenticity is not null) as n_all,
         avg(s.authenticity) as a_all, avg(s.severity_rating) as s_all,
         count(*) filter (where s.on_site and s.authenticity is not null) as n_site,
         avg(s.authenticity) filter (where s.on_site) as a_site,
         count(distinct coalesce(s.ip_hash, s.user_id::text)) filter (where s.on_site and s.authenticity is not null) as nets
    into a from kasa_private.seen s where s.report_id = r.id;

  if a.n_site >= v_min and a.nets >= least(2, v_min) then
    if a.a_site >= kasa_private.cfg_num('neighbour_verified_avg') then v_verdict := 'verified';
    elsif a.a_site <= kasa_private.cfg_num('neighbour_doubt_avg') then v_verdict := 'doubted';
    end if;
  end if;

  update public.reports set rating_count = a.n_all, onsite_rating_count = a.n_site,
         authenticity_avg = round(a.a_all, 2), severity_avg = round(a.s_all, 2), neighbour_status = v_verdict,
         moderation_status = case when v_verdict = 'doubted' and moderation_status = 'approved' then 'flagged' else moderation_status end,
         updated_at = now()
  where id = r.id;
  if v_verdict is not null and v_verdict is distinct from r.neighbour_status then
    perform kasa_private.add_event(r.id::text, 'neighbours_' || v_verdict, null, null, null, null,
      jsonb_build_object('ratings', a.n_site, 'average', round(a.a_site, 1)));
  end if;

  return jsonb_build_object('counted', v_new, 'on_site', v_site, 'seen_count', coalesce(r.upvotes, 0) + 1 + (case when v_new then 1 else 0 end),
    'rating_count', a.n_all, 'onsite_rating_count', a.n_site, 'authenticity_avg', round(a.a_all, 1),
    'severity_avg', round(a.s_all, 1), 'neighbour_status', v_verdict);
end $$;

-- Nearby alerts: a signed-in device registers its push endpoint and a rough location.
create or replace function public.kasa_push_subscribe(p_endpoint text, p_p256dh text, p_auth text,
    p_lat double precision, p_lng double precision, p_radius integer default null, p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_bbox jsonb := kasa_private.cfg('bbox');
  v_id   uuid;
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or length(coalesce(p_p256dh, '')) not between 20 and 200 or length(coalesce(p_auth, '')) not between 8 and 100 then
    perform kasa_private.fail('KASA_BAD_SUBSCRIPTION', 'This browser returned an invalid push subscription.');
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between (v_bbox ->> 'min_lat')::float8 - 0.1 and (v_bbox ->> 'max_lat')::float8 + 0.1
     or p_lng not between (v_bbox ->> 'min_lng')::float8 - 0.1 and (v_bbox ->> 'max_lng')::float8 + 0.1 then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'Alerts are only available in and around Purulia town.');
  end if;
  insert into kasa_private.push_subs (user_id, endpoint, p256dh, auth, lat, lng, radius_m, lang)
  values (me.user_id, p_endpoint, p_p256dh, p_auth, round(p_lat::numeric, 3), round(p_lng::numeric, 3),
          greatest(100, least(2000, coalesce(p_radius, kasa_private.cfg_num('push_radius_m')::integer))),
          case when p_lang in ('en', 'bn', 'hi') then p_lang else 'en' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m, lang = excluded.lang, fail_count = 0
  returning id into v_id;
  delete from kasa_private.push_subs where id in (
    select id from kasa_private.push_subs where user_id = me.user_id
    order by created_at desc offset kasa_private.cfg_num('push_max_subs_per_user')::integer);
  return jsonb_build_object('subscribed', true);
end $$;

create or replace function public.kasa_push_unsubscribe(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
begin
  delete from kasa_private.push_subs where endpoint = p_endpoint and user_id = me.user_id;
  return jsonb_build_object('subscribed', false);
end $$;

-- Service role only (kasa-notify): claims a fresh report for notification exactly once
-- and returns the devices within their chosen radius.
create or replace function public.kasa_notify_targets(p_report_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
begin
  update public.reports set notified_at = now()
  where id::text = p_report_id and notified_at is null and moderation_status = 'approved'
    and not coalesce(is_duplicate, false) and status = 'open' and created_at > now() - interval '30 minutes'
  returning * into r;
  if not found then return jsonb_build_object('report', null, 'targets', '[]'::jsonb); end if;
  return jsonb_build_object(
    'report', jsonb_build_object('id', r.id, 'category', r.category, 'severity', r.severity, 'ward_no', r.ward_no, 'landmark', r.landmark),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                  'lang', s.lang, 'distance_m', round(kasa_private.distance_m(s.lat, s.lng, r.lat, r.lng)::numeric)))
      from (select * from kasa_private.push_subs s
            where s.user_id is distinct from r.user_id
              and kasa_private.distance_m(s.lat, s.lng, r.lat, r.lng) <= s.radius_m
            limit 500) s), '[]'::jsonb));
end $$;

create or replace function public.kasa_push_result(p_sub_id uuid, p_ok boolean, p_gone boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_gone then delete from kasa_private.push_subs where id = p_sub_id;
  elsif p_ok then update kasa_private.push_subs set fail_count = 0, last_sent_at = now() where id = p_sub_id;
  else
    update kasa_private.push_subs set fail_count = fail_count + 1 where id = p_sub_id;
    delete from kasa_private.push_subs where id = p_sub_id and fail_count >= 5;
  end if;
end $$;

-- ── Moderator API (members of public.admins only) ────────────────────────
-- Moderators can hide abusive content and throw out fake cleanup claims.
-- They can NOT resolve anything: resolution only comes from on-site citizens.
create or replace function public.kasa_admin_moderate(p_report_id text, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'hide', 'restore') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  update public.reports set moderation_status = case p_action when 'hide' then 'hidden' else 'approved' end, updated_at = now()
  where id::text = p_report_id returning * into r;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  perform kasa_private.add_event(r.id::text, 'moderated', null, null, null, null,
    jsonb_build_object('action', p_action, 'reason', p_reason));
  return jsonb_build_object('moderation_status', r.moderation_status);
end $$;

create or replace function public.kasa_admin_reject_claim(p_claim_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if coalesce(trim(p_reason), '') = '' then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a public reason.'); end if;
  perform kasa_private.reject_claim(p_claim_id, 'moderator: ' || left(p_reason, 200), null, true);
  return jsonb_build_object('ok', true);
end $$;

-- Voids one obviously fake confirmation or dispute on an open claim, on the public record.
create or replace function public.kasa_admin_void_vote(p_vote_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v kasa_private.votes;
  c kasa_private.claims;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if coalesce(trim(p_reason), '') = '' then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a public reason.'); end if;
  select * into v from kasa_private.votes where id = p_vote_id for update;
  if not found or v.voided_at is not null then perform kasa_private.fail('KASA_NOT_FOUND', 'Vote not found.'); end if;
  select * into c from kasa_private.claims where id = v.claim_id for update;
  if c.status <> 'pending' then perform kasa_private.fail('KASA_CLAIM_CLOSED', 'This claim is already decided.'); end if;
  update kasa_private.votes set voided_at = now(), void_reason = left(p_reason, 200) where id = v.id;
  update kasa_private.claims set verify_count = verify_count - (case when v.vote = 'verify' then 1 else 0 end),
                                 dispute_count = dispute_count - (case when v.vote = 'dispute' then 1 else 0 end)
  where id = c.id;
  perform kasa_private.add_event(c.report_id::text, 'vote_voided', null, c.id, v.photo_url, null,
    jsonb_build_object('vote', v.vote, 'reason', left(p_reason, 200), 'voter', kasa_private.tag(v.voter_id, c.report_id::text)));
  return jsonb_build_object('claim_status', kasa_private.evaluate_claim(c.id));
end $$;

create or replace function public.kasa_admin_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select r.id, r.created_at, r.category, r.severity, r.ward_no, r.description, r.landmark, r.photo_url,
               r.moderation_status, r.flags, r.moderation_labels,
               (select jsonb_agg(jsonb_build_object('reason', f.reason, 'note', f.note, 'at', f.created_at))
                  from kasa_private.flags f where f.report_id = r.id) as flag_reasons
        from public.reports r where r.moderation_status in ('review', 'flagged')
        order by r.created_at desc limit 100) x), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(to_jsonb(y) order by y.created_at desc) from (
        select c.id, c.report_id, c.created_at, c.photo_url, round(c.distance_m::numeric) as distance_m,
               c.verify_count, c.dispute_count, c.quorum_reached_at, r.photo_url as original_photo_url,
               r.category, r.ward_no, r.description,
               (select jsonb_agg(jsonb_build_object('id', v.id, 'vote', v.vote, 'photo_url', v.photo_url,
                        'distance_m', round(v.distance_m::numeric), 'at', v.created_at) order by v.created_at)
                  from kasa_private.votes v where v.claim_id = c.id and v.voided_at is null) as votes
        from kasa_private.claims c join public.reports r on r.id = c.report_id
        where c.status = 'pending' order by c.created_at desc limit 100) y), '[]'::jsonb));
end $$;

-- Right of reply. An official emails the Grievance Officer from a verifiable
-- address; a moderator publishes the response on the report, on the record.
create or replace function public.kasa_admin_post_reply(p_report_id text, p_name text, p_role text, p_body text,
    p_verified_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r   public.reports;
  v_id uuid;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into r from public.reports where id::text = p_report_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  insert into kasa_private.replies (report_id, responder_name, responder_role, body, verified_note, posted_by)
  values (r.id, trim(p_name), trim(p_role), trim(p_body), nullif(trim(coalesce(p_verified_note, '')), ''), auth.uid())
  returning id into v_id;
  update public.reports set reply_count = reply_count + 1, updated_at = now() where id = r.id;
  perform kasa_private.add_event(r.id::text, 'official_reply', null, null, null, null,
    jsonb_build_object('name', trim(p_name), 'role', trim(p_role)));
  return jsonb_build_object('reply_id', v_id);
end $$;

create or replace function public.kasa_admin_hide_reply(p_reply_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v kasa_private.replies;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if coalesce(trim(p_reason), '') = '' then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a public reason.'); end if;
  update kasa_private.replies set hidden_at = now(), hidden_reason = left(p_reason, 200)
  where id = p_reply_id and hidden_at is null returning * into v;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Reply not found.'); end if;
  update public.reports set reply_count = greatest(0, reply_count - 1) where id = v.report_id;
  perform kasa_private.add_event(v.report_id::text, 'reply_hidden', null, null, null, null, jsonb_build_object('reason', left(p_reason, 200)));
  return jsonb_build_object('ok', true);
end $$;

-- Called only by the kasa-photo-check Edge Function with the service role key.
create or replace function public.kasa_record_photo_check(p_path text, p_sha256 text, p_dhash text,
    p_garbage_score double precision, p_labels jsonb, p_unsafe boolean, p_face_count integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.photo_checks (photo_path, sha256, dhash, garbage_score, labels, unsafe, face_count)
  values (p_path, p_sha256, p_dhash, p_garbage_score, coalesce(p_labels, '[]'::jsonb), coalesce(p_unsafe, false), coalesce(p_face_count, 0))
  on conflict (photo_path) do nothing;
end $$;

-- ── Public read models (no user ids, no IPs, pseudonymous actors) ───────
create or replace view public.kasa_public_reports as
select r.id, r.created_at, r.lat, r.lng, r.ward_no, r.category, r.severity, r.status,
       r.description, r.landmark, r.photo_url,
       coalesce(r.upvotes, 0) as upvotes, r.seen_on_site, coalesce(r.flags, 0) as flags,
       r.moderation_status, coalesce(r.is_duplicate, false) as is_duplicate, r.parent_report_id,
       r.recurrence_count, r.rejected_claims, r.resolved_at, r.resolved_photo_url, r.resolution_method,
       coalesce(r.sla_days, 7) as sla_days, (r.accuracy_m is not null) as gps_verified,
       c.id as claim_id, c.photo_url as claim_photo_url, c.created_at as claim_created_at,
       c.verify_count as claim_verify_count, c.dispute_count as claim_dispute_count,
       c.quorum_reached_at as claim_quorum_reached_at,
       c.quorum_reached_at + make_interval(hours => (
         select (s.value #>> '{}')::integer from kasa_private.settings s where s.key = 'challenge_hours'
       )) as claim_finalize_after,
       round(c.distance_m::numeric) as claim_distance_m,
       r.rating_count, r.onsite_rating_count, r.authenticity_avg, r.severity_avg, r.neighbour_status, r.reply_count
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id and c.status = 'pending'
where r.moderation_status in ('approved', 'flagged');

create or replace view public.kasa_public_events as
select e.id, e.report_id, e.kind, e.actor_tag, e.claim_id, e.photo_url,
       round(e.distance_m::numeric) as distance_m, e.detail, e.created_at
from kasa_private.events e
join public.reports r on r.id = e.report_id
where r.moderation_status in ('approved', 'flagged');

create or replace view public.kasa_public_replies as
select p.id, p.report_id, p.responder_name, p.responder_role, p.body, p.verified_note, p.created_at
from kasa_private.replies p
join public.reports r on r.id = p.report_id
where p.hidden_at is null and r.moderation_status in ('approved', 'flagged');

-- ── Privileges ───────────────────────────────────────────────────────────
-- Direct writes to reports are closed to everyone except the database owner.
alter table public.reports enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'reports' loop
    execute format('drop policy %I on public.reports', p.policyname);
  end loop;
end $$;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
create policy kasa_reports_admin_read on public.reports for select to authenticated using (kasa_private.is_admin());

-- The admin read policy runs as the caller, so they need to reach is_admin().
grant usage on schema kasa_private to authenticated;
revoke all on all tables in schema kasa_private from anon, authenticated;
revoke all on all functions in schema kasa_private from public, anon, authenticated;
grant execute on function kasa_private.is_admin() to authenticated;

-- Supabase grants ALL on new views to anon/authenticated by default; read-only here.
revoke all on public.kasa_public_reports, public.kasa_public_events, public.kasa_public_replies from public, anon, authenticated;
grant select on public.kasa_public_reports, public.kasa_public_events, public.kasa_public_replies to anon, authenticated;

revoke all on function public.kasa_version() from public;
revoke all on function public.kasa_rules() from public;
revoke all on function public.kasa_create_report(text, text, double precision, double precision, double precision, integer, text, text, text, text) from public, anon;
revoke all on function public.kasa_mark_seen(text, double precision, double precision, double precision) from public, anon;
revoke all on function public.kasa_claim_cleanup(text, text, double precision, double precision, double precision) from public, anon;
revoke all on function public.kasa_vote_claim(uuid, text, text, double precision, double precision, double precision, text) from public, anon;
revoke all on function public.kasa_flag_report(text, text, text) from public, anon;
revoke all on function public.kasa_finalize_due() from public;
revoke all on function public.kasa_admin_moderate(text, text, text) from public, anon;
revoke all on function public.kasa_admin_reject_claim(uuid, text) from public, anon;
revoke all on function public.kasa_admin_queue() from public, anon;
revoke all on function public.kasa_admin_void_vote(uuid, text) from public, anon;
revoke all on function public.kasa_rate_report(text, integer, integer, double precision, double precision, double precision) from public, anon;
revoke all on function public.kasa_push_subscribe(text, text, text, double precision, double precision, integer, text) from public, anon;
revoke all on function public.kasa_push_unsubscribe(text) from public, anon;
revoke all on function public.kasa_admin_post_reply(text, text, text, text, text) from public, anon;
revoke all on function public.kasa_admin_hide_reply(uuid, text) from public, anon;
revoke all on function public.kasa_notify_targets(text) from public, anon, authenticated;
revoke all on function public.kasa_push_result(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer) from public, anon, authenticated;

grant execute on function public.kasa_version(), public.kasa_rules(), public.kasa_finalize_due() to anon, authenticated;
grant execute on function
  public.kasa_create_report(text, text, double precision, double precision, double precision, integer, text, text, text, text),
  public.kasa_mark_seen(text, double precision, double precision, double precision),
  public.kasa_claim_cleanup(text, text, double precision, double precision, double precision),
  public.kasa_vote_claim(uuid, text, text, double precision, double precision, double precision, text),
  public.kasa_flag_report(text, text, text),
  public.kasa_admin_moderate(text, text, text),
  public.kasa_admin_reject_claim(uuid, text),
  public.kasa_admin_queue(),
  public.kasa_admin_void_vote(uuid, text),
  public.kasa_rate_report(text, integer, integer, double precision, double precision, double precision),
  public.kasa_push_subscribe(text, text, text, double precision, double precision, integer, text),
  public.kasa_push_unsubscribe(text),
  public.kasa_admin_post_reply(text, text, text, text, text),
  public.kasa_admin_hide_reply(uuid, text)
to authenticated;
do $$ begin
  execute 'grant execute on function public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer),
    public.kasa_notify_targets(text), public.kasa_push_result(uuid, boolean, boolean) to service_role';
exception when undefined_object then null; end $$;

-- Wards stay publicly readable and are not writable from the browser.
do $$ begin
  if to_regclass('public.wards') is not null then
    execute 'revoke insert, update, delete, truncate on public.wards from anon, authenticated';
    execute 'grant select on public.wards to anon, authenticated';
  end if;
end $$;

-- ── Pre-v2 API surface ───────────────────────────────────────────────────
-- Found on the live project (24 Sep 2026): every one of these was callable
-- with the public anon key. Each is only replaced where it exists.

-- One-step resolve / approve: anyone (or any admin) could close a report with any photo.
do $legacy$ begin
  if to_regprocedure('public.mark_resolved(uuid,text,text)') is not null then
    execute $fn$create or replace function public.mark_resolved(p_report_id uuid, p_resolved_photo_url text, p_resolved_by text default null)
returns void language plpgsql security definer set search_path = '' as $body$
begin
  raise exception 'mark_resolved is retired: reports are resolved only by on-site community verification (kasa v2)';
end $body$$fn$;
  end if;
end $legacy$;
do $legacy$ begin
  if to_regprocedure('public.submit_resolution(uuid,text,text)') is not null then
    execute $fn$create or replace function public.submit_resolution(p_report_id uuid, p_resolved_photo_url text, p_submitted_by text default null)
returns void language plpgsql security definer set search_path = '' as $body$
begin
  raise exception 'submit_resolution is retired: use kasa_claim_cleanup (kasa v2)';
end $body$$fn$;
  end if;
end $legacy$;
do $legacy$ begin
  if to_regprocedure('public.approve_resolution(uuid,text)') is not null then
    execute $fn$create or replace function public.approve_resolution(p_report_id uuid, p_reviewed_by text default null)
returns void language plpgsql security definer set search_path = '' as $body$
begin
  raise exception 'approve_resolution is retired: moderators cannot resolve reports (kasa v2)';
end $body$$fn$;
  end if;
end $legacy$;

-- Admin moderation keeps working, mapped onto v2 moderation (and logged publicly).
do $legacy$ begin
  if to_regprocedure('public.approve_report(uuid)') is not null then
    execute $fn$create or replace function public.approve_report(p_report_id uuid)
returns void language plpgsql security definer set search_path = '' as $body$
begin
  perform public.kasa_admin_moderate(p_report_id::text, 'approve', null);
end $body$$fn$;
  end if;
end $legacy$;
do $legacy$ begin
  if to_regprocedure('public.reject_report(uuid,text)') is not null then
    execute $fn$create or replace function public.reject_report(p_report_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $body$
begin
  perform public.kasa_admin_moderate(p_report_id::text, 'hide', coalesce(p_reason, 'moderation'));
end $body$$fn$;
  end if;
end $legacy$;

-- The old cleanup deleted every photo whose path didn't contain a report id —
-- which was every photo the old client uploaded. Only truly unreferenced
-- uploads older than two days are removed now.
do $legacy$ begin
  if to_regprocedure('public.cleanup_orphaned_photos()') is not null then
    execute $fn$create or replace function public.cleanup_orphaned_photos() returns integer
language plpgsql security definer set search_path = '' as $body$
declare
  n integer;
begin
  delete from storage.objects o
  where o.bucket_id = 'kasa-photos'
    and o.created_at < now() - interval '2 days'
    and o.name !~ '\.emptyFolderPlaceholder$'
    and not exists (select 1 from public.reports r
                    where r.photo_path = o.name
                       or r.photo_url like ('%/kasa-photos/' || o.name)
                       or r.resolved_photo_url like ('%/kasa-photos/' || o.name))
    and not exists (select 1 from kasa_private.claims c where c.photo_path = o.name)
    and not exists (select 1 from kasa_private.votes v where v.photo_path = o.name);
  get diagnostics n = row_count;
  return n;
end $body$$fn$;
  end if;
end $legacy$;

-- Resolved reports used to be "archived" by marking them rejected, which erased
-- them from every ward's record. They now stay on the public record.
do $legacy$ begin
  if to_regprocedure('public.run_auto_cleanup()') is not null then
    execute $fn$create or replace function public.run_auto_cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $body$
declare
  result jsonb;
begin
  result := jsonb_build_object('orphaned_photos', public.cleanup_orphaned_photos(), 'archived_reports', 0, 'ran_at', now());
  insert into public.automation_log (job_name, result, ran_at) values ('auto_cleanup', result, now());
  return result;
end $body$$fn$;
  end if;
end $legacy$;

-- Reports no longer sit in "pending"; the 2-hourly moderation job now finalises
-- cleanup claims whose challenge window has passed.
do $legacy$ begin
  if to_regprocedure('public.run_auto_moderation()') is not null then
    execute $fn$create or replace function public.run_auto_moderation() returns jsonb
language plpgsql security definer set search_path = '' as $body$
declare
  result jsonb;
begin
  result := jsonb_build_object('finalised_claims', public.kasa_finalize_due(), 'ran_at', now());
  insert into public.automation_log (job_name, result, ran_at) values ('auto_moderation', result, now());
  return result;
end $body$$fn$;
  end if;
end $legacy$;

do $$
declare
  f record;
  v record;
begin
  -- Nothing pre-v2 stays callable from the browser. Scheduled jobs run as the
  -- database owner and are unaffected.
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('mark_resolved', 'submit_resolution', 'approve_resolution', 'reject_resolution',
                               'upvote_report', 'flag_report', 'approve_report', 'reject_report', 'find_nearby_report',
                               'cleanup_orphaned_photos', 'escalate_overdue_reports', 'run_auto_cleanup',
                               'run_auto_escalation', 'run_auto_moderation', 'run_ward_health_check',
                               'check_report_rate_limit', 'rls_auto_enable')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  -- approve_report / reject_report are admin tools; they check is_admin() themselves.
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('approve_report', 'reject_report')
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  if to_regprocedure('public.is_admin()') is not null then
    execute 'revoke all on function public.is_admin() from public, anon';
    execute 'grant execute on function public.is_admin() to authenticated';
    execute 'alter function public.is_admin() set search_path = ''''';
  end if;

  -- Admin and analytics views run with the owner's rights, so anyone could read
  -- every report through them — hidden, rejected and under-review ones included.
  for v in select viewname from pg_views
           where schemaname = 'public' and viewname not in ('kasa_public_reports', 'kasa_public_events', 'kasa_public_replies')
  loop
    execute format('revoke all on public.%I from public, anon, authenticated', v.viewname);
  end loop;

  -- Legacy tables: no direct writes from the browser; no public reporter hashes.
  if to_regclass('public.report_upvotes') is not null then execute 'revoke all on public.report_upvotes from anon, authenticated'; end if;
  if to_regclass('public.report_flags') is not null then execute 'revoke all on public.report_flags from anon, authenticated'; end if;
  if to_regclass('public.admins') is not null then execute 'revoke insert, update, delete, truncate on public.admins from anon, authenticated'; end if;
  if to_regclass('public.automation_log') is not null then execute 'revoke insert, update, delete, truncate on public.automation_log from anon, authenticated'; end if;
end $$;

-- ── Storage: signed-in uploads with random names, never overwrite or delete ─
do $$
declare p record;
begin
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('kasa-photos', 'kasa-photos', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 6291456,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
  exception when others then
    raise notice 'kasa: could not update the kasa-photos bucket (%). Set it public with a 6 MB image-only limit in the dashboard.', sqlerrm;
  end;

  begin
    for p in select policyname from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and (coalesce(qual, '') ilike '%kasa-photos%' or coalesce(with_check, '') ilike '%kasa-photos%')
    loop
      execute format('drop policy %I on storage.objects', p.policyname);
    end loop;
    execute $p$
      create policy kasa_photos_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'kasa-photos'
        and name ~ '^(reports|claims|votes)/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$'
      )
    $p$;
  exception when others then
    raise notice 'kasa: could not replace storage policies (%). See SETUP-KASA.md step 3.', sqlerrm;
  end;
end $$;

-- ── Scheduled finalisation (pg_cron, if enabled). Pages also call it on load. ─
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kasa-finalize';
    perform cron.schedule('kasa-finalize', '*/10 * * * *', 'select public.kasa_finalize_due()');
  end if;
exception when others then
  raise notice 'kasa: pg_cron scheduling skipped (%)', sqlerrm;
end $$;

commit;

notify pgrst, 'reload schema';
