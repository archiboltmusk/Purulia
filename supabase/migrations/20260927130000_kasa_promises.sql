-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — promises.html: who promised what, and what was delivered
--
-- public.promises  one row per promise. Every row cites where and when it was
--                  said (source_url + made_on). A status other than 'promised'
--                  must cite its own evidence (status_source_url + status_date).
--                  Anyone may suggest a promise, or an update to one; nothing
--                  appears on the page until a moderator publishes it.
-- public.promise_news  headlines the daily kasa-promise-news function pulls from
--                  free news RSS feeds. Shown as links only, labelled as found
--                  automatically; a moderator can hide one. Never changes a
--                  promise's status by itself.
--
-- Tables are closed to anon/authenticated; everything goes through the RPCs.
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.promises (
  id                uuid primary key default gen_random_uuid(),
  who               text not null check (length(who) between 2 and 120),
  role              text check (length(role) <= 120),
  promise           text not null check (length(promise) between 10 and 600),
  area              text check (length(area) <= 80),
  made_on           date not null,
  due_by            date,
  source_url        text not null check (source_url ~* '^https?://[^\s]+$' and length(source_url) <= 1000),
  source_name       text check (length(source_name) <= 120),
  status            text not null default 'promised' check (status in ('promised', 'in_progress', 'delivered', 'broken')),
  status_note       text check (length(status_note) <= 600),
  status_source_url text check (status_source_url ~* '^https?://[^\s]+$' and length(status_source_url) <= 1000),
  status_date       date,
  review            text not null default 'pending' check (review in ('pending', 'published', 'rejected')),
  update_of         uuid references public.promises(id) on delete cascade,
  submitter_note    text check (length(submitter_note) <= 600),
  ip_hash           text,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- "In progress", "delivered" or "broken" is a claim, so it needs its own evidence.
  constraint promises_status_evidence check (status = 'promised' or (status_source_url is not null and status_date is not null))
);
create index if not exists promises_review_idx on public.promises (review, made_on desc);
create index if not exists promises_update_of_idx on public.promises (update_of);
alter table public.promises enable row level security;
revoke all on public.promises from anon, authenticated;

create table if not exists public.promise_news (
  id           bigint generated always as identity primary key,
  url          text not null unique,
  title        text not null,
  source       text,
  published_at timestamptz,
  topic        text,
  who          text,
  hidden       boolean not null default false,
  fetched_at   timestamptz not null default now()
);
create index if not exists promise_news_pub_idx on public.promise_news (published_at desc);
alter table public.promise_news enable row level security;
revoke all on public.promise_news from anon, authenticated;

-- ── Public read ─────────────────────────────────────────────────────────
create or replace function public.kasa_promises()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'promises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'who', p.who, 'role', p.role, 'promise', p.promise, 'area', p.area,
        'made_on', p.made_on, 'due_by', p.due_by, 'source_url', p.source_url, 'source_name', p.source_name,
        'status', p.status, 'status_note', p.status_note, 'status_source_url', p.status_source_url,
        'status_date', p.status_date, 'updated_at', p.updated_at) order by p.made_on desc, p.created_at desc)
      from public.promises p where p.review = 'published' and p.update_of is null), '[]'::jsonb),
    'news', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'url', n.url, 'title', n.title, 'source', n.source,
        'published_at', n.published_at, 'who', n.who) order by n.published_at desc nulls last)
      from (select * from public.promise_news where not hidden
            order by published_at desc nulls last limit 80) n), '[]'::jsonb),
    'news_checked_at', (select max(fetched_at) from public.promise_news)
  )
$$;
revoke all on function public.kasa_promises() from public;
grant execute on function public.kasa_promises() to anon, authenticated;

-- ── Anyone: suggest a promise, or an update to a published one ─────────
create or replace function public.kasa_promise_suggest(
  p_who text, p_role text, p_promise text, p_made_on date, p_source_url text, p_source_name text default null,
  p_status text default 'promised', p_status_source_url text default null, p_status_date date default null,
  p_status_note text default null, p_update_of uuid default null, p_note text default null, p_area text default null,
  p_due_by date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := kasa_private.ip_hash();
  v_target public.promises;
  v_id uuid;
begin
  if v_ip is not null and (select count(*) from public.promises where ip_hash = v_ip and created_at > now() - interval '1 day') >= 5 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Thanks! That is five suggestions today already. Please try again tomorrow.');
  end if;
  if (select count(*) from public.promises where review = 'pending') >= 300 then
    perform kasa_private.fail('KASA_QUEUE_FULL', 'The review queue is full right now. Please try again in a few days.');
  end if;
  if coalesce(p_status, 'promised') not in ('promised', 'in_progress', 'delivered', 'broken') then
    perform kasa_private.fail('KASA_BAD_STATUS', 'Unknown status.');
  end if;
  if coalesce(p_status, 'promised') <> 'promised' and (nullif(trim(p_status_source_url), '') is null or p_status_date is null) then
    perform kasa_private.fail('KASA_NEED_EVIDENCE', 'Add a link and a date showing the progress, delivery or failure.');
  end if;
  if p_made_on > current_date or p_status_date > current_date then
    perform kasa_private.fail('KASA_BAD_DATE', 'A date cannot be in the future.');
  end if;

  if p_update_of is not null then
    select * into v_target from public.promises where id = p_update_of and review = 'published' and update_of is null;
    if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That promise was not found.'); end if;
    if coalesce(p_status, 'promised') = 'promised' then
      perform kasa_private.fail('KASA_NEED_EVIDENCE', 'Pick the new status and add a link showing it.');
    end if;
    insert into public.promises (who, role, promise, area, made_on, due_by, source_url, source_name, status, status_note,
                                 status_source_url, status_date, update_of, submitter_note, ip_hash)
    values (v_target.who, v_target.role, v_target.promise, v_target.area, v_target.made_on, v_target.due_by,
            v_target.source_url, v_target.source_name, p_status, nullif(trim(p_status_note), ''),
            trim(p_status_source_url), p_status_date, v_target.id, nullif(trim(p_note), ''), v_ip)
    returning id into v_id;
  else
    insert into public.promises (who, role, promise, area, made_on, due_by, source_url, source_name, status, status_note,
                                 status_source_url, status_date, submitter_note, ip_hash)
    values (trim(p_who), nullif(trim(p_role), ''), trim(p_promise), nullif(trim(p_area), ''), p_made_on, p_due_by,
            trim(p_source_url), nullif(trim(p_source_name), ''), coalesce(p_status, 'promised'),
            nullif(trim(p_status_note), ''), nullif(trim(p_status_source_url), ''), p_status_date,
            nullif(trim(p_note), ''), v_ip)
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'review', 'pending');
exception
  when check_violation or not_null_violation then
    perform kasa_private.fail('KASA_BAD_INPUT', 'Please check the fields: a name, the promise (at least 10 letters), a date and a link starting with http.');
end $$;
revoke all on function public.kasa_promise_suggest(text, text, text, date, text, text, text, text, date, text, uuid, text, text, date) from public;
grant execute on function public.kasa_promise_suggest(text, text, text, date, text, text, text, text, date, text, uuid, text, text, date) to anon, authenticated;

-- ── Moderators ──────────────────────────────────────────────────────────
create or replace function public.kasa_admin_promises()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return jsonb_build_object(
    'pending', coalesce((select jsonb_agg(to_jsonb(p) - 'ip_hash' || jsonb_build_object(
        'target', (select jsonb_build_object('status', t.status, 'status_source_url', t.status_source_url, 'status_date', t.status_date)
                   from public.promises t where t.id = p.update_of)) order by p.created_at)
      from public.promises p where p.review = 'pending'), '[]'::jsonb),
    'published', coalesce((select jsonb_agg(to_jsonb(p) - 'ip_hash' order by p.made_on desc)
      from public.promises p where p.review = 'published' and p.update_of is null), '[]'::jsonb),
    'news', coalesce((select jsonb_agg(to_jsonb(n) order by n.published_at desc nulls last)
      from (select * from public.promise_news order by published_at desc nulls last limit 60) n), '[]'::jsonb));
end $$;
revoke all on function public.kasa_admin_promises() from public, anon;
grant execute on function public.kasa_admin_promises() to authenticated;

-- p_action: 'publish' or 'reject'. p_edits lets the moderator correct fields first
-- (same keys as the table). Publishing an update copies its status into the promise.
create or replace function public.kasa_admin_promise_review(p_id uuid, p_action text, p_edits jsonb default '{}'::jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.promises;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('publish', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  select * into r from public.promises where id = p_id and review = 'pending' for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Already reviewed or not found.'); end if;

  if p_action = 'reject' then
    update public.promises set review = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
    where id = p_id;
    return jsonb_build_object('review', 'rejected');
  end if;

  p_edits := coalesce(p_edits, '{}'::jsonb);
  update public.promises set
    who = coalesce(p_edits ->> 'who', who), role = coalesce(p_edits ->> 'role', role),
    promise = coalesce(p_edits ->> 'promise', promise), area = coalesce(p_edits ->> 'area', area),
    made_on = coalesce((p_edits ->> 'made_on')::date, made_on), due_by = coalesce((p_edits ->> 'due_by')::date, due_by),
    source_url = coalesce(p_edits ->> 'source_url', source_url), source_name = coalesce(p_edits ->> 'source_name', source_name),
    status = coalesce(p_edits ->> 'status', status), status_note = coalesce(p_edits ->> 'status_note', status_note),
    status_source_url = coalesce(p_edits ->> 'status_source_url', status_source_url),
    status_date = coalesce((p_edits ->> 'status_date')::date, status_date),
    review = 'published', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note, updated_at = now()
  where id = p_id returning * into r;

  if r.update_of is not null then
    update public.promises set status = r.status, status_note = r.status_note, status_source_url = r.status_source_url,
      status_date = r.status_date, updated_at = now()
    where id = r.update_of;
  end if;
  return jsonb_build_object('review', 'published');
end $$;
revoke all on function public.kasa_admin_promise_review(uuid, text, jsonb, text) from public, anon;
grant execute on function public.kasa_admin_promise_review(uuid, text, jsonb, text) to authenticated;

-- Moderator edits a published promise directly (e.g. marks it delivered with evidence),
-- or takes it down (p_fields = {"review": "rejected"}).
create or replace function public.kasa_admin_promise_edit(p_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  update public.promises set
    who = coalesce(p_fields ->> 'who', who), role = coalesce(p_fields ->> 'role', role),
    promise = coalesce(p_fields ->> 'promise', promise), area = coalesce(p_fields ->> 'area', area),
    made_on = coalesce((p_fields ->> 'made_on')::date, made_on), due_by = coalesce((p_fields ->> 'due_by')::date, due_by),
    source_url = coalesce(p_fields ->> 'source_url', source_url), source_name = coalesce(p_fields ->> 'source_name', source_name),
    status = coalesce(p_fields ->> 'status', status), status_note = coalesce(p_fields ->> 'status_note', status_note),
    status_source_url = coalesce(p_fields ->> 'status_source_url', status_source_url),
    status_date = coalesce((p_fields ->> 'status_date')::date, status_date),
    review = case when p_fields ->> 'review' = 'rejected' then 'rejected' else review end,
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_id and review = 'published' and update_of is null;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Promise not found.'); end if;
  return jsonb_build_object('ok', true);
exception when check_violation then
  perform kasa_private.fail('KASA_NEED_EVIDENCE', 'A status other than "promised" needs an evidence link and date.');
end $$;
revoke all on function public.kasa_admin_promise_edit(uuid, jsonb) from public, anon;
grant execute on function public.kasa_admin_promise_edit(uuid, jsonb) to authenticated;

create or replace function public.kasa_admin_promise_news_hide(p_id bigint, p_hidden boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  update public.promise_news set hidden = p_hidden where id = p_id;
  return jsonb_build_object('hidden', p_hidden);
end $$;
revoke all on function public.kasa_admin_promise_news_hide(bigint, boolean) from public, anon;
grant execute on function public.kasa_admin_promise_news_hide(bigint, boolean) to authenticated;

-- ── Daily news job (service role only) ──────────────────────────────────
-- p_items: [{url, title, source, published_at, topic}]. Tags each headline with the
-- published promise-maker it names, and drops headlines older than a year.
create or replace function public.kasa_promise_news_ingest(p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.promise_news (url, title, source, published_at, topic, who)
  select left(i ->> 'url', 1000), left(i ->> 'title', 400), left(i ->> 'source', 120),
         (i ->> 'published_at')::timestamptz, left(i ->> 'topic', 80),
         (select p.who from public.promises p
          where p.review = 'published' and p.update_of is null
            and position(lower(p.who) in lower(i ->> 'title')) > 0 limit 1)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  where i ->> 'url' ~* '^https?://' and coalesce(i ->> 'title', '') <> ''
  on conflict (url) do nothing;
  get diagnostics n = row_count;
  delete from public.promise_news where published_at < now() - interval '1 year';
  return n;
end $$;
revoke all on function public.kasa_promise_news_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.kasa_promise_news_ingest(jsonb) to service_role;

-- Names to search news for: everyone with a published promise.
create or replace function public.kasa_promise_people()
returns setof text language sql stable security definer set search_path = '' as $$
  select distinct who from public.promises where review = 'published' and update_of is null
$$;
revoke all on function public.kasa_promise_people() from public, anon, authenticated;
grant execute on function public.kasa_promise_people() to service_role;

-- ── Starting entries, waiting for a moderator to check and publish ─────
insert into public.promises (who, role, promise, area, made_on, source_url, source_name, submitter_note)
select * from (values
  ('Suvendu Adhikari', 'Chief Minister of West Bengal',
   'Piped drinking water to more than 84,500 rural households in five blocks of Purulia district, and bulk water to Purulia Municipality, through the ₹1,296-crore JICA-backed West Bengal Piped Water Supply Project inaugurated at Manbazar.',
   'Purulia district', date '2026-08-17',
   'https://indianmasterminds.com/news/suvendu-adhikari-purulia-jica-water-project-225249/', 'Indian Masterminds',
   'Starting entry added with the page. Check the source before publishing.'),
  ('Suvendu Adhikari', 'Chief Minister of West Bengal',
   'A ₹4,000-crore integrated steel plant by Amit Metaliks at Durmut, Raghunathpur, with local people given priority for jobs in the plant.',
   'Raghunathpur', date '2026-08-17',
   'https://www.freepressjournal.in/india/west-bengals-industrial-push-cm-suvendu-adhikari-launches-5296-crore-projects-in-purulia', 'Free Press Journal',
   'Starting entry added with the page. Check the source before publishing.')
) v(who, role, promise, area, made_on, source_url, source_name, submitter_note)
where not exists (select 1 from public.promises p where p.source_url = v.source_url);

commit;

-- Every day at 06:45 IST.
do $$
begin
  if not exists(select 1 from cron.job where jobname = 'kasa-promise-news') then
    perform cron.schedule('kasa-promise-news', '15 1 * * *', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-promise-news', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        30000
      )
    $job$);
  end if;
exception when others then
  raise notice 'kasa: promise news scheduling skipped (%) - enable it manually if needed', sqlerrm;
end $$;

notify pgrst, 'reload schema';
