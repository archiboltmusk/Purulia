-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA v2.2 — evidence photos: live camera, taken-time, photo GPS,
-- AI-edit markers
--
-- Before uploading, the page reads the photo's own metadata on the phone and
-- sends a short summary with kasa_photo_meta(): how it was captured (the
-- page's live camera, or a file), when the camera says it was taken, where
-- the camera says it was taken, and whether the file declares it was made or
-- edited with AI (IPTC digital source type "trainedAlgorithmicMedia" /
-- "compositeSynthetic", which Google, Samsung, Adobe and OpenAI write). The
-- photo itself is always re-encoded without metadata before upload.
--
-- Rules for cleanup claims, confirmations and disputes:
--   • AI-made or AI-edited photo            → refused
--   • taken more than 2 hours ago, or before the claim it answers → refused
--   • photo GPS more than 500 m from the spot → accepted but held for a
--     moderator: a held confirmation doesn't count, a held claim can't be
--     finalised. (Camera apps sometimes stamp a stale location, so this is
--     never an automatic rejection.) Held disputes still count — a real
--     dispute must never be silenced by a metadata glitch.
--   • no metadata at all                    → recorded, never refused
-- New reports: AI-marked photos wait for a moderator; photo GPS far from the
-- pin marks the report "under review" (it stays visible).
--
-- This is client-reported data, so it stops careless cheating, not a
-- determined one. The real protection is still several people on the spot.
-- Only the distance is kept — never the photo's coordinates.
--
-- Safe to re-run. Apply after the two earlier migrations. If you ever re-run
-- an earlier migration by itself, re-run this one afterwards.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('max_photo_age_minutes',    '120',   'Evidence photos whose camera time is older than this are refused'),
  ('photo_clock_skew_minutes', '10',    'Tolerance for phone clocks when comparing photo times'),
  ('photo_gps_far_m',          '500',   'Photo GPS farther than this from the spot holds the photo for a moderator'),
  ('require_live_capture',     'false', 'If true, evidence photos must come from the in-page camera (breaks in-app browsers without camera access)')
on conflict (key) do nothing;

-- ── What the phone said about each photo ─────────────────────────────────
create table if not exists kasa_private.photo_meta (
  photo_path      text primary key,
  user_id         uuid not null,
  capture         text not null check (capture in ('live', 'file')),
  taken_at        timestamptz,
  exif_lat        double precision,   -- cleared as soon as the photo is used
  exif_lng        double precision,
  exif_distance_m double precision,
  ai_marker       text,
  created_at      timestamptz not null default now()
);
alter table kasa_private.photo_meta enable row level security;

alter table kasa_private.claims
  add column if not exists capture      text,
  add column if not exists photo_meta   jsonb not null default '{}'::jsonb,
  add column if not exists needs_review boolean not null default false,
  add column if not exists reviewed_at  timestamptz,
  add column if not exists review_note  text;
alter table kasa_private.votes
  add column if not exists capture      text,
  add column if not exists photo_meta   jsonb not null default '{}'::jsonb,
  add column if not exists needs_review boolean not null default false,
  add column if not exists reviewed_at  timestamptz,
  add column if not exists review_note  text;

-- The page calls this right after uploading, before using the photo. First
-- write wins, so a refused photo can't be "fixed" by resending other values.
create or replace function public.kasa_photo_meta(p_path text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me      kasa_private.profiles := kasa_private.me();
  v_owner text;
  v_taken timestamptz;
  v_lat   double precision;
  v_lng   double precision;
begin
  if p_path is null or p_path !~ '^(reports|claims|votes)/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$' then
    perform kasa_private.fail('KASA_PHOTO_INVALID', 'A photo is required.');
  end if;
  select coalesce(o.owner_id::text, o.owner::text) into v_owner
  from storage.objects o where o.bucket_id = 'kasa-photos' and o.name = p_path;
  if not found then perform kasa_private.fail('KASA_PHOTO_MISSING', 'Upload the photo first.'); end if;
  if v_owner is distinct from me.user_id::text then
    perform kasa_private.fail('KASA_PHOTO_NOT_YOURS', 'You can only submit photos you uploaded.');
  end if;

  begin v_taken := (p_meta ->> 'taken_at')::timestamptz; exception when others then v_taken := null; end;
  begin
    v_lat := (p_meta ->> 'lat')::double precision;
    v_lng := (p_meta ->> 'lng')::double precision;
  exception when others then v_lat := null; v_lng := null;
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
     or (v_lat = 0 and v_lng = 0) then
    v_lat := null; v_lng := null;
  end if;

  insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_lat, exif_lng, ai_marker)
  values (p_path, me.user_id,
          case when p_meta ->> 'capture' = 'live' then 'live' else 'file' end,
          v_taken, v_lat, v_lng, nullif(left(trim(coalesce(p_meta ->> 'ai_marker', '')), 80), ''))
  on conflict (photo_path) do nothing;
  return jsonb_build_object('recorded', found);
end $$;

-- Applies the rules above to one photo as it is used. Raises for refusals;
-- otherwise returns the public summary, with "flag" set when the photo must
-- wait for a moderator.
create or replace function kasa_private.photo_meta_verdict(p_path text, p_evidence boolean,
    p_lat double precision, p_lng double precision, p_not_before timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m      kasa_private.photo_meta;
  v_skew interval := make_interval(mins => kasa_private.cfg_num('photo_clock_skew_minutes')::integer);
  v_age  numeric;
  v_dist double precision;
  v_flag text;
begin
  select * into m from kasa_private.photo_meta where photo_path = p_path for update;
  if not found then
    if p_evidence and kasa_private.cfg_bool('require_live_capture') then
      perform kasa_private.fail('KASA_LIVE_CAMERA_REQUIRED', 'Take the photo with the camera on this page.');
    end if;
    return jsonb_build_object('capture', 'unknown');
  end if;
  if p_evidence and m.capture <> 'live' and kasa_private.cfg_bool('require_live_capture') then
    perform kasa_private.fail('KASA_LIVE_CAMERA_REQUIRED', 'Take the photo with the camera on this page.');
  end if;

  if m.ai_marker is not null and p_evidence then
    perform kasa_private.fail('KASA_PHOTO_AI_EDITED',
      'This photo says it was made or edited with AI, so it can''t be evidence. Take a new photo with the camera.');
  end if;

  -- A camera time in the future means a wrong phone clock: ignore it.
  if m.taken_at is not null and m.taken_at <= now() + v_skew then
    v_age := greatest(0, extract(epoch from now() - m.taken_at) / 60);
    if p_evidence and (m.taken_at < now() - make_interval(mins => kasa_private.cfg_num('max_photo_age_minutes')::integer)
                       or (p_not_before is not null and m.taken_at < p_not_before - v_skew)) then
      perform kasa_private.fail('KASA_PHOTO_OLD', 'This photo was taken earlier. Take a new one at the spot now.',
        jsonb_build_object('taken_minutes_ago', round(v_age)));
    end if;
  end if;

  if m.exif_lat is not null and m.exif_lng is not null and p_lat is not null and p_lng is not null then
    v_dist := kasa_private.distance_m(m.exif_lat, m.exif_lng, p_lat, p_lng);
    if v_dist > kasa_private.cfg_num('photo_gps_far_m') then v_flag := 'gps_far'; end if;
  end if;
  -- Keep only the distance, never where the photo was taken.
  update kasa_private.photo_meta
  set exif_distance_m = coalesce(round(v_dist::numeric)::double precision, exif_distance_m), exif_lat = null, exif_lng = null
  where photo_path = p_path;

  return jsonb_strip_nulls(jsonb_build_object(
    'capture', m.capture,
    'taken_minutes_ago', round(v_age),
    'exif_distance_m', round(v_dist::numeric),
    'ai_edited', case when m.ai_marker is not null then true end,
    'flag', v_flag));
end $$;

-- ── Reports ──────────────────────────────────────────────────────────────
create or replace function public.kasa_create_report(
  p_category text, p_severity text, p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_ward_no integer, p_description text, p_landmark text,
  p_photo_path text, p_client_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me        kasa_private.profiles := kasa_private.me();
  v_bbox    jsonb := kasa_private.cfg('bbox');
  v_chk     kasa_private.photo_checks;
  v_meta    jsonb;
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
  v_meta := kasa_private.photo_meta_verdict(p_photo_path, false, p_lat, p_lng, null);
  v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;

  if p_category in (select jsonb_array_elements_text(kasa_private.cfg('review_categories')))
     or coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> 'ai_edited')::boolean, false) then
    v_mod := 'review';
  elsif v_meta ? 'flag' then
    v_mod := 'flagged';
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
      jsonb_build_object('photo', v_meta) ||
      case when v_chk.photo_path is null then '{}'::jsonb
           else jsonb_build_object('garbage_score', v_chk.garbage_score, 'labels', v_chk.labels) end,
      p_category, nullif(trim(p_landmark), ''), me.user_id, p_client_id, p_accuracy, p_photo_path)
  returning * into v_new;

  perform kasa_private.add_event(v_new.id::text, 'reported', me.user_id, null, v_url, null,
    jsonb_build_object('gps', p_accuracy is not null, 'accuracy_m', round(p_accuracy::numeric)) || v_meta);

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

-- ── Cleanup claims ───────────────────────────────────────────────────────
create or replace function public.kasa_claim_cleanup(p_report_id text, p_photo_path text,
    p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  r      public.reports;
  v_chk  kasa_private.photo_checks;
  v_orig kasa_private.photo_checks;
  v_meta jsonb;
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
  v_meta := kasa_private.photo_meta_verdict(p_photo_path, true, r.lat, r.lng, r.created_at);
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

  insert into kasa_private.claims (report_id, claimant_id, photo_path, photo_url, lat, lng, accuracy_m, distance_m, ip_hash,
                                   capture, photo_meta, needs_review)
  values (r.id, me.user_id, p_photo_path, (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path,
          p_lat, p_lng, p_accuracy, v_dist, kasa_private.ip_hash(), v_meta ->> 'capture', v_meta, v_meta ? 'flag')
  returning * into c;
  update public.reports set status = 'claimed', claim_id = c.id, updated_at = now() where id = r.id;
  perform kasa_private.add_event(r.id::text, 'claimed', me.user_id, c.id, c.photo_url, v_dist,
    (case when v_chk.photo_path is null then '{}'::jsonb
          else jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)) end)
    || v_meta || jsonb_build_object('needs_review', c.needs_review));

  return jsonb_build_object('claim_id', c.id, 'status', 'claimed', 'needs_review', c.needs_review,
    'verify_needed', kasa_private.cfg_num('verify_quorum'), 'distance_m', round(v_dist::numeric));
end $$;

-- ── Confirmations and disputes ───────────────────────────────────────────
create or replace function public.kasa_vote_claim(p_claim_id uuid, p_vote text, p_photo_path text,
    p_lat double precision, p_lng double precision, p_accuracy double precision, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me       kasa_private.profiles := kasa_private.me();
  c        kasa_private.claims;
  r        public.reports;
  v_chk    kasa_private.photo_checks;
  v_meta   jsonb := jsonb_build_object('capture', 'none');
  v_review boolean := false;
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
    v_meta := kasa_private.photo_meta_verdict(p_photo_path, true, r.lat, r.lng, c.created_at);
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
  -- A confirmation whose photo metadata points elsewhere waits for a moderator.
  -- Disputes always count: they are the safety valve against fake cleanups.
  v_review := p_vote = 'verify' and v_meta ? 'flag';

  insert into kasa_private.votes (claim_id, voter_id, vote, photo_path, photo_url, lat, lng, accuracy_m, distance_m, ip_hash, note,
                                  capture, photo_meta, needs_review)
  values (c.id, me.user_id, p_vote, p_photo_path, v_url, p_lat, p_lng, p_accuracy, v_dist,
          kasa_private.ip_hash(), nullif(left(trim(coalesce(p_note, '')), 280), ''),
          v_meta ->> 'capture', v_meta, v_review);

  if p_vote = 'verify' then
    if not v_review then update kasa_private.claims set verify_count = verify_count + 1 where id = c.id; end if;
  else
    update kasa_private.claims set dispute_count = dispute_count + 1 where id = c.id;
  end if;
  perform kasa_private.add_event(r.id::text, case when p_vote = 'verify' then 'verified' else 'disputed' end,
    me.user_id, c.id, v_url, v_dist,
    (case when v_chk.photo_path is null then '{}'::jsonb
          else jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)) end)
    || v_meta || jsonb_build_object('needs_review', v_review));

  v_state := kasa_private.evaluate_claim(c.id);
  select * into c from kasa_private.claims where id = c.id;
  return jsonb_build_object('claim_status', v_state, 'verify_count', c.verify_count, 'dispute_count', c.dispute_count,
    'needs_review', v_review,
    'verify_needed', kasa_private.cfg_num('verify_quorum'), 'dispute_needed', kasa_private.cfg_num('dispute_quorum'),
    'final_after', case when c.quorum_reached_at is null then null
                        else c.quorum_reached_at + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer) end);
end $$;

-- Held confirmations don't count; a held claim can't be finalised, and it
-- expires like any claim if nobody reviews it.
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
  from kasa_private.votes v
  where v.claim_id = c.id and v.vote = 'verify' and v.voided_at is null and not v.needs_review;

  if c.quorum_reached_at is null and c.verify_count >= v_need
     and v_nets >= least(v_need, kasa_private.cfg_num('min_distinct_networks')::integer) then
    update kasa_private.claims set quorum_reached_at = now() where id = c.id returning * into c;
    perform kasa_private.add_event(c.report_id::text, 'quorum_reached', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count,
                         'final_after', now() + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer)));
  end if;

  if c.quorum_reached_at is not null and not c.needs_review
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

  if (c.quorum_reached_at is null or c.needs_review)
     and c.created_at + make_interval(days => kasa_private.cfg_num('claim_expiry_days')::integer) <= now() then
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

-- ── Moderators ───────────────────────────────────────────────────────────
-- Clearing a held photo lets it count. Like every moderator action it is on
-- the public record with a reason; a moderator still can't resolve anything.
create or replace function public.kasa_admin_clear_vote(p_vote_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v kasa_private.votes;
  c kasa_private.claims;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if coalesce(trim(p_note), '') = '' then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a public reason.'); end if;
  select * into v from kasa_private.votes where id = p_vote_id for update;
  if not found or v.voided_at is not null or not v.needs_review then
    perform kasa_private.fail('KASA_NOT_FOUND', 'No held photo with this id.');
  end if;
  select * into c from kasa_private.claims where id = v.claim_id for update;
  if c.status <> 'pending' then perform kasa_private.fail('KASA_CLAIM_CLOSED', 'This claim is already decided.'); end if;
  update kasa_private.votes set needs_review = false, reviewed_at = now(), review_note = left(p_note, 200) where id = v.id;
  if v.vote = 'verify' then update kasa_private.claims set verify_count = verify_count + 1 where id = c.id; end if;
  perform kasa_private.add_event(c.report_id::text, 'vote_cleared', null, c.id, v.photo_url, null,
    jsonb_build_object('vote', v.vote, 'reason', left(p_note, 200), 'voter', kasa_private.tag(v.voter_id, c.report_id::text)));
  return jsonb_build_object('claim_status', kasa_private.evaluate_claim(c.id));
end $$;

create or replace function public.kasa_admin_clear_claim(p_claim_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c kasa_private.claims;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if coalesce(trim(p_note), '') = '' then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a public reason.'); end if;
  update kasa_private.claims set needs_review = false, reviewed_at = now(), review_note = left(p_note, 200)
  where id = p_claim_id and status = 'pending' and needs_review returning * into c;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No held claim with this id.'); end if;
  perform kasa_private.add_event(c.report_id::text, 'claim_cleared', null, c.id, c.photo_url, null,
    jsonb_build_object('reason', left(p_note, 200)));
  return jsonb_build_object('claim_status', kasa_private.evaluate_claim(c.id));
end $$;

-- A held confirmation was never counted, so voiding it must not uncount it.
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
  update kasa_private.claims
  set verify_count = verify_count - (case when v.vote = 'verify' and not v.needs_review then 1 else 0 end),
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
    'claims', coalesce((select jsonb_agg(to_jsonb(y) order by y.needs_attention desc, y.created_at desc) from (
        select c.id, c.report_id, c.created_at, c.photo_url, round(c.distance_m::numeric) as distance_m,
               c.verify_count, c.dispute_count, c.quorum_reached_at, r.photo_url as original_photo_url,
               r.category, r.ward_no, r.description, c.needs_review, c.photo_meta,
               c.needs_review or exists (select 1 from kasa_private.votes hv
                                         where hv.claim_id = c.id and hv.needs_review and hv.voided_at is null) as needs_attention,
               (select jsonb_agg(jsonb_build_object('id', v.id, 'vote', v.vote, 'photo_url', v.photo_url,
                        'distance_m', round(v.distance_m::numeric), 'at', v.created_at,
                        'needs_review', v.needs_review, 'photo_meta', v.photo_meta) order by v.created_at)
                  from kasa_private.votes v where v.claim_id = c.id and v.voided_at is null) as votes
        from kasa_private.claims c join public.reports r on r.id = c.report_id
        where c.status = 'pending' order by c.created_at desc limit 100) y), '[]'::jsonb));
end $$;

create or replace function public.kasa_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(key, value) from kasa_private.settings
  where key in ('verify_quorum', 'dispute_quorum', 'challenge_hours', 'claim_expiry_days', 'claim_radius_m',
                'vote_radius_m', 'max_gps_accuracy_m', 'require_vote_photo', 'review_categories', 'bbox',
                'max_photo_age_minutes', 'photo_gps_far_m', 'require_live_capture')
$$;

-- The public view gains one column at the end: whether the open claim is
-- waiting for a moderator to check a photo.
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
       r.rating_count, r.onsite_rating_count, r.authenticity_avg, r.severity_avg, r.neighbour_status, r.reply_count,
       c.needs_review as claim_needs_review
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id and c.status = 'pending'
where r.moderation_status in ('approved', 'flagged');

-- ── Privileges ───────────────────────────────────────────────────────────
revoke all on all functions in schema kasa_private from public, anon, authenticated;
grant execute on function kasa_private.is_admin() to authenticated;
revoke all on table kasa_private.photo_meta from anon, authenticated;
revoke all on public.kasa_public_reports from public, anon, authenticated;
grant select on public.kasa_public_reports to anon, authenticated;

revoke all on function public.kasa_photo_meta(text, jsonb) from public, anon;
revoke all on function public.kasa_admin_clear_vote(uuid, text) from public, anon;
revoke all on function public.kasa_admin_clear_claim(uuid, text) from public, anon;
grant execute on function public.kasa_photo_meta(text, jsonb), public.kasa_admin_clear_vote(uuid, text),
  public.kasa_admin_clear_claim(uuid, text) to authenticated;

-- ── Security advisor: pin search_path on helpers that lacked it ──────────
alter function public.kasa_version() set search_path = '';
alter function kasa_private.fail(text, text, jsonb) set search_path = '';
alter function kasa_private.distance_m(double precision, double precision, double precision, double precision) set search_path = '';
alter function kasa_private.photo_distance(text, text) set search_path = '';
-- Pre-v2 functions (no longer callable from the browser) keep their old
-- lookup behaviour, just pinned.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proconfig is null
             and p.proname in ('upvote_report', 'flag_report', 'escalate_overdue_reports', 'check_report_rate_limit',
                               'reject_resolution', 'find_nearby_report', 'run_auto_escalation', 'run_ward_health_check')
  loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
