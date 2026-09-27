-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — post on X when a ward's unresolved reports cross a threshold
--
-- pg_cron pings the kasa-x-post Edge Function a few times a day. The function
-- claims at most one ward whose open reports (public view only) reached
-- x_post_threshold and that hasn't been posted about in x_post_repeat_days,
-- posts one message on X, and records it. Nothing is posted until the X keys
-- are set as Edge Function secrets (see the function's header).
--
-- Settings (kasa_private.settings):
--   x_post_threshold    unresolved reports in a ward before it is posted (default 5)
--   x_post_repeat_days  days before the same ward can be posted again (default 7)
--   x_post_mention      handle(s) added to every post, e.g. "@PuruliaMuni" (default none)
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('x_post_threshold',   '5',  'Unresolved reports in a town ward before it is posted on X'),
  ('x_post_repeat_days', '7',  'Days before the same ward can be posted on X again'),
  ('x_post_mention',     '""', 'Handle(s) added to every X post, e.g. "@PuruliaMuni". Empty = none.')
on conflict (key) do nothing;

create table if not exists kasa_private.x_posts (
  id         bigint generated always as identity primary key,
  ward_no    int not null,
  open_count int not null,
  claimed_at timestamptz not null default now(),
  posted_at  timestamptz,
  tweet_id   text,
  error      text
);
create index if not exists kasa_x_posts_ward_idx on kasa_private.x_posts (ward_no, claimed_at desc);
alter table kasa_private.x_posts enable row level security;
revoke all on kasa_private.x_posts from public, anon, authenticated;

-- Claims the ward most over the threshold that is due a post (a failed or abandoned claim frees up after 10 minutes).
create or replace function public.kasa_x_post_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_threshold int := coalesce(kasa_private.cfg_num('x_post_threshold'), 5);
  v_repeat    int := coalesce(kasa_private.cfg_num('x_post_repeat_days'), 7);
  v_row record;
  v_id bigint;
begin
  select r.ward_no, count(*)::int as open_count,
         count(*) filter (where r.created_at < now() - make_interval(days => r.sla_days))::int as overdue
  into v_row
  from public.kasa_public_reports r
  where r.ward_no is not null and coalesce(r.area_kind, 'town') <> 'rural'
    and not r.is_duplicate and r.status <> 'resolved'
    and not exists (
      select 1 from kasa_private.x_posts p
      where p.ward_no = r.ward_no
        and ((p.posted_at is not null and p.posted_at > now() - make_interval(days => v_repeat))
          or (p.posted_at is null and p.error is null and p.claimed_at > now() - interval '10 minutes')))
  group by r.ward_no
  having count(*) >= v_threshold
  order by count(*) desc, r.ward_no
  limit 1;

  if v_row.ward_no is null then return null; end if;

  insert into kasa_private.x_posts (ward_no, open_count) values (v_row.ward_no, v_row.open_count) returning id into v_id;
  return jsonb_build_object(
    'id', v_id, 'ward_no', v_row.ward_no, 'open', v_row.open_count, 'overdue', v_row.overdue,
    'councillor', (select w.councillor_name from public.wards w where w.ward_no = v_row.ward_no),
    'mention', kasa_private.cfg('x_post_mention') #>> '{}');
end $$;

create or replace function public.kasa_x_post_done(p_id bigint, p_tweet_id text, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.x_posts
  set posted_at = case when p_error is null then now() end,
      tweet_id = p_tweet_id,
      error = left(p_error, 300)
  where id = p_id
$$;

revoke all on function public.kasa_x_post_claim() from public, anon, authenticated;
revoke all on function public.kasa_x_post_done(bigint, text, text) from public, anon, authenticated;
grant execute on function public.kasa_x_post_claim(), public.kasa_x_post_done(bigint, text, text) to service_role;

-- 09:00, 12:00, 15:00 and 18:00 IST. One ward per run, so a bad day is at most four posts.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('kasa-x-post') where exists (select 1 from cron.job where jobname = 'kasa-x-post');
    perform cron.schedule('kasa-x-post', '30 3,6,9,12 * * *', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-x-post', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        30000)
    $job$);
  end if;
exception when others then
  raise notice 'kasa: X post scheduling skipped (%)', sqlerrm;
end $$;

commit;
