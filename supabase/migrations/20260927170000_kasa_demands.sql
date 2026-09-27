-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — noticeboard.html: public demands to named leaders
--
-- public.demands          one row per demand, addressed to a named leader
--                         (municipality chairman, ward councillor, MLA, MP or
--                         someone else). Must be for the whole community, not
--                         for the person asking. Nothing appears until a
--                         moderator publishes it.
-- public.demand_supports  one "+1" per device per demand, with a per-network
--                         cap so one network cannot inflate a count.
-- public.demand_replies   a leader's public reply, with a link to where it was
--                         said. Anyone may add one; a moderator checks the link.
--
-- A moderator links a demand to a promise on promises.html once the leader
-- commits to it; the noticeboard then shows that promise's status.
-- Tables are closed to anon/authenticated; everything goes through the RPCs.
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.demands (
  id             uuid primary key default gen_random_uuid(),
  leader_role    text not null check (leader_role in ('chairman', 'councillor', 'mla', 'mp', 'other')),
  leader_name    text not null check (length(leader_name) between 2 and 120),
  leader_area    text check (length(leader_area) <= 120),
  title          text not null check (length(title) between 10 and 140),
  details        text not null check (length(details) between 30 and 1500),
  place          text check (length(place) <= 120),
  review         text not null default 'pending' check (review in ('pending', 'published', 'rejected')),
  promise_id     uuid references public.promises(id) on delete set null,
  supports       integer not null default 0,
  submitter_note text check (length(submitter_note) <= 600),
  ip_hash        text,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz not null default now(),
  published_at   timestamptz
);
create index if not exists demands_review_idx on public.demands (review, supports desc);
alter table public.demands enable row level security;
revoke all on public.demands from anon, authenticated;

create table if not exists public.demand_supports (
  demand_id  uuid not null references public.demands(id) on delete cascade,
  device     text not null,
  ip_hash    text,
  created_at timestamptz not null default now(),
  primary key (demand_id, device)
);
create index if not exists demand_supports_ip_idx on public.demand_supports (ip_hash, created_at);
alter table public.demand_supports enable row level security;
revoke all on public.demand_supports from anon, authenticated;

create table if not exists public.demand_replies (
  id          uuid primary key default gen_random_uuid(),
  demand_id   uuid not null references public.demands(id) on delete cascade,
  reply       text not null check (length(reply) between 10 and 800),
  said_on     date not null,
  source_url  text not null check (source_url ~* '^https?://[^\s]+$' and length(source_url) <= 1000),
  source_name text check (length(source_name) <= 120),
  review      text not null default 'pending' check (review in ('pending', 'published', 'rejected')),
  ip_hash     text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists demand_replies_demand_idx on public.demand_replies (demand_id, review);
alter table public.demand_replies enable row level security;
revoke all on public.demand_replies from anon, authenticated;

-- ── Public read ─────────────────────────────────────────────────────────
create or replace function public.kasa_demands()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'leader_role', d.leader_role, 'leader_name', d.leader_name, 'leader_area', d.leader_area,
    'title', d.title, 'details', d.details, 'place', d.place, 'supports', d.supports,
    'created_at', d.created_at, 'published_at', d.published_at,
    'promise', (select jsonb_build_object('id', p.id, 'status', p.status, 'promise', p.promise, 'who', p.who)
                from public.promises p where p.id = d.promise_id and p.review = 'published'),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('reply', r.reply, 'said_on', r.said_on,
                  'source_url', r.source_url, 'source_name', r.source_name) order by r.said_on desc)
                from public.demand_replies r where r.demand_id = d.id and r.review = 'published'), '[]'::jsonb)
  ) order by d.supports desc, d.published_at desc), '[]'::jsonb)
  from public.demands d where d.review = 'published'
$$;
revoke all on function public.kasa_demands() from public;
grant execute on function public.kasa_demands() to anon, authenticated;

-- ── Anyone: post a demand ───────────────────────────────────────────────
-- p_for_community: the asker ticked "this is for everyone, not for me or my family".
create or replace function public.kasa_demand_submit(
  p_leader_role text, p_leader_name text, p_leader_area text, p_title text, p_details text,
  p_place text default null, p_for_community boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := kasa_private.ip_hash();
  v_id uuid;
begin
  if not coalesce(p_for_community, false) then
    perform kasa_private.fail('KASA_NOT_COMMUNITY', 'The noticeboard is for things the whole area needs. For a problem of your own, use the Grievance page or the municipality helpline.');
  end if;
  if v_ip is not null and (select count(*) from public.demands where ip_hash = v_ip and created_at > now() - interval '1 day') >= 3 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Thanks! That is three demands today already. Please try again tomorrow.');
  end if;
  if (select count(*) from public.demands where review = 'pending') >= 300 then
    perform kasa_private.fail('KASA_QUEUE_FULL', 'The review queue is full right now. Please try again in a few days.');
  end if;
  insert into public.demands (leader_role, leader_name, leader_area, title, details, place, submitter_note, ip_hash)
  values (p_leader_role, trim(p_leader_name), nullif(trim(p_leader_area), ''), trim(p_title), trim(p_details),
          nullif(trim(p_place), ''), nullif(trim(p_note), ''), v_ip)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'review', 'pending');
exception
  when check_violation or not_null_violation then
    perform kasa_private.fail('KASA_BAD_INPUT', 'Please check the fields: pick a leader, a short title (at least 10 letters) and why it helps everyone (at least 30 letters).');
end $$;
revoke all on function public.kasa_demand_submit(text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.kasa_demand_submit(text, text, text, text, text, text, boolean, text) to anon, authenticated;

-- ── Anyone: +1 a published demand ───────────────────────────────────────
-- p_device: a random id the page keeps in the browser. One count per device; at most
-- 40 new counts per network per demand per day, 200 per network per day overall.
create or replace function public.kasa_demand_support(p_id uuid, p_device text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := kasa_private.ip_hash();
  v_n integer;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{16,64}$' then
    perform kasa_private.fail('KASA_BAD_INPUT', 'Could not count that. Please reload the page and try again.');
  end if;
  if not exists (select 1 from public.demands where id = p_id and review = 'published') then
    perform kasa_private.fail('KASA_NOT_FOUND', 'That demand was not found.');
  end if;
  if exists (select 1 from public.demand_supports where demand_id = p_id and device = p_device) then
    return jsonb_build_object('counted', false, 'supports', (select supports from public.demands where id = p_id));
  end if;
  if v_ip is not null and (
       (select count(*) from public.demand_supports where ip_hash = v_ip and demand_id = p_id and created_at > now() - interval '1 day') >= 40
    or (select count(*) from public.demand_supports where ip_hash = v_ip and created_at > now() - interval '1 day') >= 200) then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many +1s from this network today. Please try again tomorrow.');
  end if;
  insert into public.demand_supports (demand_id, device, ip_hash) values (p_id, p_device, v_ip) on conflict do nothing;
  update public.demands set supports = (select count(*) from public.demand_supports where demand_id = p_id)
  where id = p_id returning supports into v_n;
  return jsonb_build_object('counted', true, 'supports', v_n);
end $$;
revoke all on function public.kasa_demand_support(uuid, text) from public;
grant execute on function public.kasa_demand_support(uuid, text) to anon, authenticated;

-- ── Anyone: add a leader's reply, with a link to where it was said ─────
create or replace function public.kasa_demand_reply_suggest(p_demand uuid, p_reply text, p_said_on date, p_source_url text, p_source_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := kasa_private.ip_hash();
  v_id uuid;
begin
  if not exists (select 1 from public.demands where id = p_demand and review = 'published') then
    perform kasa_private.fail('KASA_NOT_FOUND', 'That demand was not found.');
  end if;
  if v_ip is not null and (select count(*) from public.demand_replies where ip_hash = v_ip and created_at > now() - interval '1 day') >= 5 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Thanks! That is five replies today already. Please try again tomorrow.');
  end if;
  if p_said_on > current_date then
    perform kasa_private.fail('KASA_BAD_DATE', 'A date cannot be in the future.');
  end if;
  insert into public.demand_replies (demand_id, reply, said_on, source_url, source_name, ip_hash)
  values (p_demand, trim(p_reply), p_said_on, trim(p_source_url), nullif(trim(p_source_name), ''), v_ip)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'review', 'pending');
exception
  when check_violation or not_null_violation then
    perform kasa_private.fail('KASA_BAD_INPUT', 'Please add what the leader said (at least 10 letters), the date, and a link starting with http.');
end $$;
revoke all on function public.kasa_demand_reply_suggest(uuid, text, date, text, text) from public;
grant execute on function public.kasa_demand_reply_suggest(uuid, text, date, text, text) to anon, authenticated;

-- ── Moderators ──────────────────────────────────────────────────────────
create or replace function public.kasa_admin_demands()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return jsonb_build_object(
    'pending', coalesce((select jsonb_agg(to_jsonb(d) - 'ip_hash' order by d.created_at)
      from public.demands d where d.review = 'pending'), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(to_jsonb(r) - 'ip_hash' || jsonb_build_object('demand_title', d.title, 'leader_name', d.leader_name)
        order by r.created_at)
      from public.demand_replies r join public.demands d on d.id = r.demand_id where r.review = 'pending'), '[]'::jsonb),
    'published', coalesce((select jsonb_agg(to_jsonb(d) - 'ip_hash' order by d.published_at desc)
      from public.demands d where d.review = 'published'), '[]'::jsonb),
    'promises', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'who', p.who, 'promise', left(p.promise, 120)) order by p.made_on desc)
      from public.promises p where p.review = 'published' and p.update_of is null), '[]'::jsonb));
end $$;
revoke all on function public.kasa_admin_demands() from public, anon;
grant execute on function public.kasa_admin_demands() to authenticated;

-- p_action: 'publish' or 'reject'. p_edits corrects fields first (leader_role, leader_name,
-- leader_area, title, details, place).
create or replace function public.kasa_admin_demand_review(p_id uuid, p_action text, p_edits jsonb default '{}'::jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('publish', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  p_edits := coalesce(p_edits, '{}'::jsonb);
  update public.demands set
    leader_role = coalesce(p_edits ->> 'leader_role', leader_role), leader_name = coalesce(p_edits ->> 'leader_name', leader_name),
    leader_area = coalesce(p_edits ->> 'leader_area', leader_area), title = coalesce(p_edits ->> 'title', title),
    details = coalesce(p_edits ->> 'details', details), place = coalesce(p_edits ->> 'place', place),
    review = case when p_action = 'publish' then 'published' else 'rejected' end,
    published_at = case when p_action = 'publish' then now() else published_at end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
  where id = p_id and review = 'pending';
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Already reviewed or not found.'); end if;
  return jsonb_build_object('review', case when p_action = 'publish' then 'published' else 'rejected' end);
exception when check_violation then
  perform kasa_private.fail('KASA_BAD_INPUT', 'An edited field is too short or too long.');
end $$;
revoke all on function public.kasa_admin_demand_review(uuid, text, jsonb, text) from public, anon;
grant execute on function public.kasa_admin_demand_review(uuid, text, jsonb, text) to authenticated;

create or replace function public.kasa_admin_demand_reply_review(p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('publish', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  update public.demand_replies set review = case when p_action = 'publish' then 'published' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and review = 'pending';
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Already reviewed or not found.'); end if;
  return jsonb_build_object('review', p_action);
end $$;
revoke all on function public.kasa_admin_demand_reply_review(uuid, text) from public, anon;
grant execute on function public.kasa_admin_demand_reply_review(uuid, text) to authenticated;

-- Link a published demand to a published promise (p_promise null unlinks), or take it down.
create or replace function public.kasa_admin_demand_edit(p_id uuid, p_promise uuid default null, p_take_down boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_promise is not null and not exists (select 1 from public.promises where id = p_promise and review = 'published' and update_of is null) then
    perform kasa_private.fail('KASA_NOT_FOUND', 'That promise is not published.');
  end if;
  update public.demands set
    promise_id = case when p_take_down then promise_id else p_promise end,
    review = case when p_take_down then 'rejected' else review end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and review = 'published';
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Demand not found.'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.kasa_admin_demand_edit(uuid, uuid, boolean) from public, anon;
grant execute on function public.kasa_admin_demand_edit(uuid, uuid, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
