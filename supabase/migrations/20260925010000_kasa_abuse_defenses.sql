-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — abuse defenses
--
--  • Text filter (English / Bengali / Hindi, Latin and native script) on
--    report descriptions, landmarks and vote notes. "block" terms refuse the
--    submission; "review" terms (personal accusations, phone numbers, ID
--    numbers) send a report to the moderator queue and drop a vote's note.
--    Moderators edit kasa_private.text_terms; nothing is logged about who
--    typed what.
--  • Impossible travel: an account's GPS action is refused when it implies
--    moving faster than max_travel_kmh since its last GPS action. Only
--    locations already stored with reports/claims/votes are compared.
--  • Photo location: every photo verdict says whether its GPS was checked
--    (gps_checked), unused uploads lose their coordinates after 24 hours,
--    and the never-used photo_checks coordinate columns are dropped.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('max_travel_kmh', '150', 'GPS actions implying faster movement than this since the last one are refused'),
  ('travel_window_hours', '6', 'Only the last GPS action within this many hours is compared'),
  ('travel_min_m', '2000', 'Jumps shorter than this (after subtracting GPS accuracy) are never refused'),
  ('travel_max_accuracy_m', '500', 'GPS fixes less precise than this are ignored by the travel check')
on conflict (key) do nothing;

-- ── Text filter ──────────────────────────────────────────────────────────
create table if not exists kasa_private.text_terms (
  term  text primary key,
  level text not null check (level in ('block', 'review')),
  note  text
);
alter table kasa_private.text_terms enable row level security;

insert into kasa_private.text_terms (term, level, note) values
  -- English abuse
  ('fuck', 'block', 'en'), ('fucker', 'block', 'en'), ('fucking', 'block', 'en'), ('motherfucker', 'block', 'en'),
  ('bitch', 'block', 'en'), ('bastard', 'block', 'en'), ('cunt', 'block', 'en'), ('whore', 'block', 'en'),
  ('slut', 'block', 'en'), ('asshole', 'block', 'en'), ('dickhead', 'block', 'en'), ('retard', 'block', 'en'),
  -- Hindi abuse (Latin)
  ('madarchod', 'block', 'hi'), ('maderchod', 'block', 'hi'), ('behenchod', 'block', 'hi'), ('bhenchod', 'block', 'hi'),
  ('benchod', 'block', 'hi'), ('chutiya', 'block', 'hi'), ('chutiye', 'block', 'hi'), ('bhosdike', 'block', 'hi'),
  ('bhosdi', 'block', 'hi'), ('randi', 'block', 'hi'), ('gandu', 'block', 'hi'), ('lauda', 'block', 'hi'),
  ('lawda', 'block', 'hi'), ('harami', 'block', 'hi'), ('haramzada', 'block', 'hi'),
  -- Hindi abuse (Devanagari)
  ('मादरचोद', 'block', 'hi'), ('बहनचोद', 'block', 'hi'), ('भेनचोद', 'block', 'hi'), ('चूतिया', 'block', 'hi'),
  ('भोसड़ी', 'block', 'hi'), ('भोसडी', 'block', 'hi'), ('रंडी', 'block', 'hi'), ('गांडू', 'block', 'hi'),
  ('हरामी', 'block', 'hi'), ('हरामज़ादा', 'block', 'hi'), ('हरामजादा', 'block', 'hi'),
  -- Bengali abuse (Latin)
  ('khanki', 'block', 'bn'), ('bokachoda', 'block', 'bn'), ('banchod', 'block', 'bn'), ('bainchod', 'block', 'bn'),
  ('magi', 'block', 'bn'), ('chodna', 'block', 'bn'), ('shuorer baccha', 'block', 'bn'), ('shuorer bachcha', 'block', 'bn'),
  -- Bengali abuse (Bengali script)
  ('খানকি', 'block', 'bn'), ('বোকাচোদা', 'block', 'bn'), ('বানচোদ', 'block', 'bn'), ('মাগি', 'block', 'bn'),
  ('মাগী', 'block', 'bn'), ('শুয়োরের বাচ্চা', 'block', 'bn'), ('চুদি', 'block', 'bn'),
  -- Slurs that can also be names or ordinary words: a moderator decides
  ('chamar', 'review', 'caste slur / name'), ('bhangi', 'review', 'caste slur / name'),
  ('katua', 'review', 'religious slur'), ('kattua', 'review', 'religious slur'), ('mulla', 'review', 'religious slur / title'),
  ('চামার', 'review', 'caste slur / name'), ('কাটুয়া', 'review', 'religious slur'),
  ('चमार', 'review', 'caste slur / name'), ('भंगी', 'review', 'caste slur / name'), ('कटुआ', 'review', 'religious slur'),
  -- Personal accusations (defamation risk): published only after a moderator looks
  ('chor', 'review', 'accusation'), ('thief', 'review', 'accusation'), ('corrupt', 'review', 'accusation'),
  ('corruption', 'review', 'accusation'), ('bribe', 'review', 'accusation'), ('ghoos', 'review', 'accusation'),
  ('ghush', 'review', 'accusation'), ('ghus', 'review', 'accusation'), ('rishwat', 'review', 'accusation'),
  ('scam', 'review', 'accusation'), ('dalal', 'review', 'accusation'), ('goonda', 'review', 'accusation'),
  ('চোর', 'review', 'accusation'), ('ঘুষ', 'review', 'accusation'), ('দুর্নীতি', 'review', 'accusation'),
  ('দালাল', 'review', 'accusation'), ('গুন্ডা', 'review', 'accusation'),
  ('चोर', 'review', 'accusation'), ('घूस', 'review', 'accusation'), ('रिश्वत', 'review', 'accusation'),
  ('भ्रष्ट', 'review', 'accusation'), ('दलाल', 'review', 'accusation'), ('गुंडा', 'review', 'accusation')
on conflict (term) do nothing;

-- Latin text: lower-case, undo common digit/symbol swaps. Other scripts unchanged.
create or replace function kasa_private.text_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(p, '')), '013457@$', 'oieastas')
$$;

-- 'block', 'review' or null, plus which kind of thing matched (never stored with the user).
create or replace function kasa_private.text_verdict(p text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  n  text := kasa_private.text_norm(p);
  n1 text := regexp_replace(kasa_private.text_norm(p), '([a-z])\1+', '\1', 'g');
  t  record;
  v_review text;
begin
  if coalesce(trim(p), '') = '' then return null; end if;
  for t in select term, level, note from kasa_private.text_terms order by level loop  -- 'block' first
    if (t.term ~ '^[a-z ]+$'
          and (n ~ ('\m' || t.term || '\M')
               or n1 ~ ('\m' || regexp_replace(t.term, '([a-z])\1+', '\1', 'g') || '\M')))
       or (t.term !~ '^[a-z ]+$' and position(t.term in n) > 0) then
      if t.level = 'block' then return jsonb_build_object('level', 'block', 'why', 'abuse'); end if;
      v_review := coalesce(v_review, t.note);
    end if;
  end loop;
  -- Personal data about third parties: phone numbers, Aadhaar-like numbers, e-mail addresses.
  if p ~ '(\+?91[\s-]?)?[6-9][0-9]{4}[\s-]?[0-9]{5}' then v_review := coalesce(v_review, 'phone number'); end if;
  if p ~ '[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}' then v_review := coalesce(v_review, 'ID number'); end if;
  if p ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then v_review := coalesce(v_review, 'e-mail address'); end if;
  if v_review is not null then return jsonb_build_object('level', 'review', 'why', v_review); end if;
  return null;
end $$;

create or replace function kasa_private.guard_report_text() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_d jsonb := kasa_private.text_verdict(new.description);
  v_l jsonb := kasa_private.text_verdict(new.landmark);
  v   jsonb;
begin
  v := case when v_d ->> 'level' = 'block' or v_l ->> 'level' = 'block' then jsonb_build_object('level', 'block')
            else coalesce(v_d, v_l) end;
  if v ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  elsif v ->> 'level' = 'review' then
    if new.moderation_status in ('approved', 'flagged') then new.moderation_status := 'review'; end if;
    new.moderation_labels := coalesce(new.moderation_labels, '{}'::jsonb) || jsonb_build_object('text', v ->> 'why');
  end if;
  return new;
end $$;

drop trigger if exists kasa_report_text on public.reports;
create trigger kasa_report_text before insert on public.reports
  for each row execute function kasa_private.guard_report_text();

create or replace function kasa_private.guard_vote_text() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb := kasa_private.text_verdict(new.note);
begin
  if v ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  elsif v ->> 'level' = 'review' then
    new.note := null;  -- the vote still counts; the note is never published
  end if;
  return new;
end $$;

drop trigger if exists kasa_vote_text on kasa_private.votes;
create trigger kasa_vote_text before insert on kasa_private.votes
  for each row execute function kasa_private.guard_vote_text();

-- kasa_create_report reported its pre-insert status; return what was actually stored.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.kasa_create_report(text, text, double precision, double precision, double precision, integer, text, text, text, text)'::regprocedure)
    into v_def;
  if position('''moderation_status'', v_mod,' in v_def) > 0 then
    execute replace(v_def, '''moderation_status'', v_mod,', '''moderation_status'', v_new.moderation_status,');
  end if;
end $$;

-- ── Impossible travel ────────────────────────────────────────────────────
create or replace function kasa_private.guard_travel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j      jsonb := to_jsonb(new);
  v_uid  uuid;
  v_acc  double precision;
  v_max  double precision := kasa_private.cfg_num('travel_max_accuracy_m');
  p      record;
  v_dist double precision;
  v_secs double precision;
begin
  v_uid := (j ->> case tg_table_name when 'reports' then 'user_id' when 'claims' then 'claimant_id' else 'voter_id' end)::uuid;
  v_acc := (j ->> 'accuracy_m')::double precision;
  if v_uid is null or v_acc is null or v_acc > v_max or new.lat is null or new.lng is null then return new; end if;

  select x.lat, x.lng, x.acc, x.at into p from (
    select r.lat, r.lng, r.accuracy_m as acc, r.created_at as at from public.reports r
      where r.user_id = v_uid and r.accuracy_m is not null
    union all
    select c.lat, c.lng, c.accuracy_m, c.created_at from kasa_private.claims c where c.claimant_id = v_uid
    union all
    select v.lat, v.lng, v.accuracy_m, v.created_at from kasa_private.votes v where v.voter_id = v_uid
  ) x
  where x.acc <= v_max and x.at > now() - make_interval(hours => kasa_private.cfg_num('travel_window_hours')::integer)
  order by x.at desc limit 1;
  if not found then return new; end if;

  v_dist := kasa_private.distance_m(p.lat, p.lng, new.lat, new.lng) - v_acc - p.acc;
  v_secs := greatest(extract(epoch from now() - p.at), 1);
  if v_dist > kasa_private.cfg_num('travel_min_m')
     and v_dist / v_secs * 3.6 > kasa_private.cfg_num('max_travel_kmh') then
    perform kasa_private.fail('KASA_IMPOSSIBLE_TRAVEL',
      'Your location jumped too far too quickly. Wait a few minutes and try again.');
  end if;
  return new;
end $$;

drop trigger if exists kasa_travel on public.reports;
create trigger kasa_travel before insert on public.reports for each row execute function kasa_private.guard_travel();
drop trigger if exists kasa_travel on kasa_private.claims;
create trigger kasa_travel before insert on kasa_private.claims for each row execute function kasa_private.guard_travel();
drop trigger if exists kasa_travel on kasa_private.votes;
create trigger kasa_travel before insert on kasa_private.votes for each row execute function kasa_private.guard_travel();

-- ── Photo location ───────────────────────────────────────────────────────
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
    return jsonb_build_object('capture', 'unknown', 'gps_checked', false);
  end if;
  if p_evidence and m.capture <> 'live' and kasa_private.cfg_bool('require_live_capture') then
    perform kasa_private.fail('KASA_LIVE_CAMERA_REQUIRED', 'Take the photo with the camera on this page.');
  end if;

  if m.ai_marker is not null and p_evidence then
    perform kasa_private.fail('KASA_PHOTO_AI_EDITED',
      'This photo says it was made or edited with AI, so it can''t be evidence. Take a new photo with the camera.');
  end if;

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
  update kasa_private.photo_meta
  set exif_distance_m = coalesce(round(v_dist::numeric)::double precision, exif_distance_m), exif_lat = null, exif_lng = null
  where photo_path = p_path;

  return jsonb_strip_nulls(jsonb_build_object(
    'capture', m.capture,
    'taken_minutes_ago', round(v_age),
    'exif_distance_m', round(v_dist::numeric),
    'ai_edited', case when m.ai_marker is not null then true end,
    'flag', v_flag)) || jsonb_build_object('gps_checked', v_dist is not null);
end $$;

create or replace function kasa_private.forget_unused_photo_gps() returns integer
language sql security definer set search_path = '' as $$
  with u as (
    update kasa_private.photo_meta set exif_lat = null, exif_lng = null
    where (exif_lat is not null or exif_lng is not null) and created_at < now() - interval '24 hours'
    returning 1)
  select count(*)::integer from u
$$;

-- Runs with the existing kasa_finalize_due cron job.
create or replace function public.kasa_finalize_due() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n  integer := 0;
  v_state text;
begin
  perform kasa_private.forget_unused_photo_gps();
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

-- Photo coordinates were never needed here: only the distance is kept.
drop function if exists public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer,
  double precision, double precision, boolean);
create function public.kasa_record_photo_check(p_path text, p_sha256 text, p_dhash text,
    p_garbage_score double precision, p_labels jsonb, p_unsafe boolean, p_face_count integer,
    p_exif_gps_lat double precision default null, p_exif_gps_lng double precision default null,
    p_exif_match boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.photo_checks (photo_path, sha256, dhash, garbage_score, labels, unsafe, face_count, exif_match)
  values (p_path, p_sha256, p_dhash, p_garbage_score, coalesce(p_labels, '[]'::jsonb), coalesce(p_unsafe, false),
          coalesce(p_face_count, 0), p_exif_match)
  on conflict (photo_path) do nothing;
end $$;
alter table kasa_private.photo_checks drop column if exists exif_gps_lat, drop column if exists exif_gps_lng;

revoke all on all functions in schema kasa_private from public, anon, authenticated;
grant execute on function kasa_private.is_admin() to authenticated;
revoke all on function public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer,
  double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer,
  double precision, double precision, boolean) to service_role;
revoke all on function public.kasa_finalize_due() from public;
grant execute on function public.kasa_finalize_due() to anon, authenticated;
revoke all on kasa_private.text_terms from anon, authenticated;

commit;

notify pgrst, 'reload schema';
