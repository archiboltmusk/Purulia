-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — security loopholes (audit 2026-10-07)
--
-- 1. kasa_create_report accepted a report with no GPS accuracy (a hand-placed
--    pin) or any accuracy at all. Reports now need a live fix within
--    report_max_accuracy_m, and a per-network cap stops fresh anonymous
--    sign-ins from resetting the per-device limit.
-- 2. Feature suggestions: unlimited submissions and unlimited votes from one
--    person; direct table inserts could skip review. Now one vote per network,
--    5 an hour / 20 a day per network, RPC only, list size capped.
-- 3. Digest sign-up: anyone could subscribe any number of addresses. Now
--    5 an hour / 20 a day per network.
-- 4. Translation suggestions: wording with HTML tags (pages render some lines
--    as HTML) and non-path "page" links (javascript: in the moderator queue)
--    are refused.
-- 5. kasa-weekly-pattern emailed everyone on every call, and any visitor holds
--    the key that calls it. It now claims the week first, like the digest.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('report_max_accuracy_m', '1000', 'Reports with a GPS fix worse than this (metres) are refused'),
  ('reports_per_hour_network', '30', 'Reports per hour from one network (/24 or /48)'),
  ('reports_per_day_network', '100', 'Reports per day from one network (/24 or /48)')
on conflict (key) do nothing;

-- Actions counted per network (hashed /24 or /48, see kasa_private.ip_hash).
create table if not exists kasa_private.net_actions (
  kind    text not null,
  ip_hash text not null,
  at      timestamptz not null default now()
);
create index if not exists net_actions_kind_ip_at on kasa_private.net_actions (kind, ip_hash, at);
alter table kasa_private.net_actions enable row level security;

create or replace function kasa_private.net_limit(p_kind text, p_hour integer, p_day integer, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ip text := kasa_private.ip_hash();
begin
  if v_ip is null then return; end if;
  delete from kasa_private.net_actions where at < now() - interval '2 days';
  if (select count(*) from kasa_private.net_actions where kind = p_kind and ip_hash = v_ip and at > now() - interval '1 hour') >= p_hour
  or (select count(*) from kasa_private.net_actions where kind = p_kind and ip_hash = v_ip and at > now() - interval '1 day') >= p_day then
    perform kasa_private.fail('KASA_RATE_LIMIT', p_message);
  end if;
  insert into kasa_private.net_actions (kind, ip_hash) values (p_kind, v_ip);
end $$;
revoke all on function kasa_private.net_limit(text, integer, integer, text) from public, anon, authenticated;

create or replace function public.kasa_create_report(p_category text, p_severity text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_ward_no integer, p_description text, p_landmark text, p_photo_path text, p_client_id text default null::text, p_boundary_type text default null::text, p_waste_type text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  v_loc     jsonb;
begin
  if p_client_id is not null then
    select * into v_existing from public.reports where user_id = me.user_id and client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_existing.id, 'moderation_status', v_existing.moderation_status, 'replayed', true);
    end if;
  end if;

  -- The quick report has no category step: the optional "What's the problem?" pick (kept in
  -- the old waste_type column) says which category it is. The five garbage kinds only file an
  -- uncategorised report as garbage; every other pick sets the category outright.
  -- Live GPS is the only proof of place: no hand-placed pins, no missing or absurd accuracy.
  if p_lat is null or p_lng is null or p_accuracy is null or p_accuracy <= 0
     or p_accuracy > kasa_private.cfg_num('report_max_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_REQUIRED', 'Turn on location. A report needs a live GPS fix taken at the spot.');
  end if;
  -- Per-network cap on top of the per-device one, so a fresh anonymous sign-in can't reset it.
  perform kasa_private.net_limit('report', kasa_private.cfg_num('reports_per_hour_network')::integer,
    kasa_private.cfg_num('reports_per_day_network')::integer,
    'Many reports have come from this network. Try again later.');

  if p_waste_type is not null and kasa_private.subtype_category(p_waste_type) is null then
    perform kasa_private.fail('KASA_BAD_WASTE_TYPE', 'Choose a problem from the list.');
  end if;
  if p_waste_type in ('household', 'construction', 'mixed', 'e_waste', 'biomedical') then
    if p_category is null or p_category = 'other' then
      p_category := 'garbage';
    end if;
    if p_category not in ('garbage', 'dumpsite') then
      p_waste_type := null;
    end if;
  elsif p_waste_type is not null then
    p_category := kasa_private.subtype_category(p_waste_type);
  end if;
  if p_category is null then
    p_category := 'other';
  end if;
  if p_category not in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing',
      'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other',
      'hand_pump', 'anganwadi', 'health_centre', 'school', 'dumpsite', 'toilet', 'rural_jobs') then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Choose what kind of problem this is.');
  end if;
  if p_severity is null then
    p_severity := 'minor';
  elsif p_severity not in ('minor', 'severe', 'critical') then
    perform kasa_private.fail('KASA_BAD_SEVERITY', 'Choose a severity.');
  end if;
  if p_ward_no is not null and p_ward_no not between 1 and 23 then
    perform kasa_private.fail('KASA_BAD_WARD', 'Ward must be between 1 and 23.');
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, p_ward_no);
  if v_loc is null then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.');
  end if;
  p_ward_no := case when v_loc ->> 'kind' = 'town' then (v_loc ->> 'ward')::integer end;
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
     or coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> 'ai_edited')::boolean, false)
     or (kasa_private.cfg_bool('require_live_report_photo') and coalesce(v_meta ->> 'capture', 'unknown') <> 'live') then
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
      moderation_labels, category, landmark, user_id, client_id, accuracy_m, photo_path, boundary_type, waste_type)
  values (p_lat, p_lng, p_ward_no, p_severity, nullif(trim(p_description), ''), null,
      substr(md5(me.user_id::text || (kasa_private.cfg('ip_salt') #>> '{}')), 1, 16), v_url,
      'open', 0, 0, kasa_private.sla_days_for(p_severity), coalesce(v_parent.id, v_recur.id), v_parent.id is not null,
      'synced', v_mod,
      jsonb_build_object('photo', v_meta) ||
      case when v_chk.photo_path is null then '{}'::jsonb
           else jsonb_build_object('garbage_score', v_chk.garbage_score, 'labels', v_chk.labels) end,
      p_category, nullif(trim(p_landmark), ''), me.user_id, p_client_id, p_accuracy, p_photo_path, p_boundary_type, p_waste_type)
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

  return jsonb_build_object('id', v_new.id, 'moderation_status', v_new.moderation_status,
    'duplicate_of', v_parent.id, 'recurrence_of', v_recur.id);
end $function$;



-- ── Feature suggestions ────────────────────────────────────────────────
-- Only the RPCs write; a direct insert could set status/votes and skip review.
drop policy if exists "anon_can_submit" on public.feature_suggestions;
revoke insert, update, delete on public.feature_suggestions from anon, authenticated;

create table if not exists kasa_private.suggestion_votes (
  suggestion_id uuid not null references public.feature_suggestions(id) on delete cascade,
  ip_hash       text not null,
  created_at    timestamptz not null default now(),
  primary key (suggestion_id, ip_hash)
);
alter table kasa_private.suggestion_votes enable row level security;

create or replace function public.kasa_submit_suggestion(p_category text, p_title text, p_description text, p_email text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_title is null or trim(p_title) = '' then
    return jsonb_build_object('success', false, 'error', 'Title is required');
  end if;
  if p_description is null or trim(p_description) = '' then
    return jsonb_build_object('success', false, 'error', 'Description is required');
  end if;
  if p_category not in ('feature', 'improvement', 'reporting', 'other') then
    return jsonb_build_object('success', false, 'error', 'Invalid category');
  end if;
  if length(p_title) > 100 then
    return jsonb_build_object('success', false, 'error', 'Title too long');
  end if;
  if length(p_description) > 1000 then
    return jsonb_build_object('success', false, 'error', 'Description too long');
  end if;
  if length(coalesce(p_email, '')) > 254 then
    return jsonb_build_object('success', false, 'error', 'Email too long');
  end if;
  begin
    perform kasa_private.net_limit('suggestion', 5, 20, 'Thanks! That is a lot of ideas from this network. Please try again later.');
  exception when others then
    return jsonb_build_object('success', false, 'error', 'Thanks! That is a lot of ideas from this network. Please try again later.');
  end;
  insert into public.feature_suggestions (category, title, description, email)
  values (p_category, trim(p_title), trim(p_description), nullif(trim(p_email), ''))
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id, 'message', 'Thank you for your suggestion');
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end $$;

create or replace function public.kasa_vote_suggestion(p_suggestion_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := coalesce(kasa_private.ip_hash(), 'unknown');
  v_updated int;
begin
  if not exists (select 1 from public.feature_suggestions where id = p_suggestion_id and status <> 'submitted') then
    return jsonb_build_object('success', false, 'error', 'Suggestion not found');
  end if;
  insert into kasa_private.suggestion_votes (suggestion_id, ip_hash) values (p_suggestion_id, v_ip)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Already voted',
      'votes', (select votes from public.feature_suggestions where id = p_suggestion_id));
  end if;
  update public.feature_suggestions set votes = votes + 1 where id = p_suggestion_id
  returning votes into v_updated;
  return jsonb_build_object('success', true, 'votes', v_updated);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end $$;

create or replace function public.kasa_get_suggestions(p_limit integer default 50, p_offset integer default 0, p_category text default null)
returns table (id uuid, category text, title text, description text, status text, votes integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.category, s.title, s.description, s.status, s.votes, s.created_at
  from public.feature_suggestions s
  where s.status <> 'submitted'
    and (p_category is null or s.category = p_category)
  order by s.votes desc, s.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ── Digest sign-up ─────────────────────────────────────────────────────
create or replace function public.kasa_digest_subscribe(p_email text, p_name text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := nullif(left(trim(coalesce(p_name, '')), 80), '');
  v_count bigint;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    return json_build_object('success', false, 'message', 'Please enter a valid email address');
  end if;
  begin
    perform kasa_private.net_limit('digest', 5, 20, 'Too many sign-ups from this network. Please try again later.');
  exception when others then
    return json_build_object('success', false, 'message', 'Too many sign-ups from this network. Please try again later.');
  end;

  insert into public.digest_subscribers (email, name, unsubscribe_token, is_active)
  values (v_email, v_name,
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          true)
  on conflict (email) do update
  set is_active = true,
      name = coalesce(excluded.name, public.digest_subscribers.name),
      updated_at = now();

  select count(*) into v_count from public.digest_subscribers where is_active;

  return json_build_object(
    'success', true,
    'message', 'Subscribed to weekly civic digest',
    'email', v_email,
    'total_subscribers', v_count
  );
exception when others then
  return json_build_object('success', false, 'message', sqlerrm, 'error', sqlstate);
end $$;

-- ── Translation suggestions ────────────────────────────────────────────
create or replace function kasa_private.translation_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.suggested ~ '[<>]' then
    perform kasa_private.fail('KASA_BAD_TEXT', 'Please write plain text: < and > can''t be used.');
  end if;
  if new.page is not null and new.page !~ '^/[A-Za-z0-9/._-]*$' then
    new.page := null;
  end if;
  return new;
end $$;
drop trigger if exists translation_guard on kasa_private.translation_suggestions;
create trigger translation_guard before insert or update of suggested, page on kasa_private.translation_suggestions
  for each row execute function kasa_private.translation_guard();

-- ── Weekly pattern email: once per week ────────────────────────────────
create table if not exists kasa_private.weekly_pattern_log (
  week       date primary key,
  claimed_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text
);
alter table kasa_private.weekly_pattern_log enable row level security;

create or replace function public.kasa_weekly_pattern_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_week date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date;
begin
  insert into kasa_private.weekly_pattern_log as l (week, claimed_at) values (v_week, now())
  on conflict (week) do update set claimed_at = now(), error = null
    where l.sent_at is null and l.claimed_at <= now() - interval '30 minutes';
  return jsonb_build_object('week', v_week, 'claimed', found);
end $$;

create or replace function public.kasa_weekly_pattern_done(p_week date, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.weekly_pattern_log
  set sent_at = case when p_error is null then now() end,
      claimed_at = case when p_error is null then claimed_at else now() - interval '1 hour' end,
      error = left(p_error, 300)
  where week = p_week and sent_at is null
$$;
revoke all on function public.kasa_weekly_pattern_claim() from public, anon, authenticated;
revoke all on function public.kasa_weekly_pattern_done(date, text) from public, anon, authenticated;
grant execute on function public.kasa_weekly_pattern_claim(), public.kasa_weekly_pattern_done(date, text) to service_role;

-- Live-only helpers the weekly pattern email reads; pin their search_path.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('kasa_weekly_clusters', 'kasa_weekly_overdue', 'kasa_weekly_resolution', 'kasa_weekly_recurrence')
  loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;

commit;
