-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — weekly ward digest by email (Mondays, 9:00 IST)
--
-- pg_cron pings the kasa-weekly-digest Edge Function every Monday morning.
-- The function asks this database for last week's (Mon–Sun, IST) numbers per
-- town ward — computed only from the public view, so it says nothing the
-- website doesn't — and emails one digest.
--
-- Who gets it:
--   • weekly_digest_to (a setting, empty by default) — e.g. the municipality.
--   • The moderation team always gets a copy.
-- While weekly_digest_to is empty the digest goes to the team only, as a
-- preview, so nothing reaches an official until an admin sets the address:
--   update kasa_private.settings set value = '"office@example.gov.in"' where key = 'weekly_digest_to';
--
-- Each week is sent at most once (kasa_private.digest_sends); a failed send
-- is retried on the next ping.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('weekly_digest_to', '""', 'Email address(es), comma-separated, that get the Monday ward digest (the team always gets a copy). Empty = team-only preview.')
on conflict (key) do nothing;

create table if not exists kasa_private.digest_sends (
  week_start date primary key,
  claimed_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text
);
alter table kasa_private.digest_sends enable row level security;
revoke all on kasa_private.digest_sends from public, anon, authenticated;

-- Claims last week's digest (at most once; a failed or abandoned claim can be retried after 10 minutes).
create or replace function public.kasa_weekly_digest_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := (date_trunc('week', now() at time zone 'Asia/Kolkata') - interval '7 days')::date;
  v_from  timestamptz := v_start::timestamp at time zone 'Asia/Kolkata';
  v_to    timestamptz := (v_start + 7)::timestamp at time zone 'Asia/Kolkata';
  v_ok    boolean;
  v_to_setting text := coalesce(kasa_private.cfg('weekly_digest_to') #>> '{}', '');
begin
  insert into kasa_private.digest_sends (week_start) values (v_start)
  on conflict (week_start) do update set claimed_at = now(), error = null
    where kasa_private.digest_sends.sent_at is null
      and kasa_private.digest_sends.claimed_at < now() - interval '10 minutes'
  returning true into v_ok;
  if not coalesce(v_ok, false) then return null; end if;

  return jsonb_build_object(
    'week_start', v_start,
    'week_end', v_start + 6,
    'to', (select coalesce(jsonb_agg(trim(x)), '[]'::jsonb) from unnest(string_to_array(v_to_setting, ',')) x where trim(x) like '%@%'),
    'team', coalesce((select jsonb_agg(u.email) from public.admins a join auth.users u on u.id = a.user_id where u.email is not null), '[]'::jsonb),
    'wards', coalesce((
      select jsonb_agg(w order by (w->>'overdue')::int desc, (w->>'open')::int desc, (w->>'ward')::int)
      from (
        select jsonb_build_object(
          'ward', wd.ward_no, 'councillor', wd.councillor_name,
          'new',     count(*) filter (where r.created_at >= v_from and r.created_at < v_to),
          'fixed',   count(*) filter (where r.status = 'resolved' and r.resolution_method = 'community'
                                        and r.resolved_at >= v_from and r.resolved_at < v_to),
          'open',    count(*) filter (where r.created_at < v_to and not (r.status = 'resolved' and (r.resolved_at is null or r.resolved_at < v_to))),
          'overdue', count(*) filter (where r.created_at < v_to and not (r.status = 'resolved' and (r.resolved_at is null or r.resolved_at < v_to))
                                        and r.created_at < v_to - make_interval(days => coalesce(r.sla_days, 7))),
          'oldest', coalesce((
            select jsonb_agg(jsonb_build_object('id', o.id::text, 'category', o.category, 'landmark', o.landmark,
                                                'days', floor(extract(epoch from (v_to - o.created_at)) / 86400)::int)
                             order by o.created_at)
            from (select * from public.kasa_public_reports o
                  where o.ward_no = wd.ward_no and coalesce(o.area_kind, 'town') <> 'rural' and not coalesce(o.is_duplicate, false)
                    and o.created_at < v_to and not (o.status = 'resolved' and (o.resolved_at is null or o.resolved_at < v_to))
                  order by o.created_at limit 3) o), '[]'::jsonb)
        ) as w
        from public.wards wd
        left join public.kasa_public_reports r
          on r.ward_no = wd.ward_no and coalesce(r.area_kind, 'town') <> 'rural' and not coalesce(r.is_duplicate, false)
        group by wd.ward_no, wd.councillor_name
      ) t
      where (w->>'new')::int + (w->>'fixed')::int + (w->>'open')::int > 0), '[]'::jsonb));
end $$;

create or replace function public.kasa_weekly_digest_done(p_week date, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.digest_sends
  set sent_at = case when p_error is null then now() end, error = left(p_error, 300)
  where week_start = p_week
$$;

revoke all on function public.kasa_weekly_digest_claim() from public, anon, authenticated;
revoke all on function public.kasa_weekly_digest_done(date, text) from public, anon, authenticated;
grant execute on function public.kasa_weekly_digest_claim(), public.kasa_weekly_digest_done(date, text) to service_role;

-- Monday 03:30 UTC = 09:00 IST, and hourly retries through the morning in case a send failed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('kasa-weekly-digest') where exists (select 1 from cron.job where jobname = 'kasa-weekly-digest');
    perform cron.schedule('kasa-weekly-digest', '30 3-8 * * 1', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-weekly-digest', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        30000)
    $job$);
  end if;
exception when others then
  raise notice 'kasa: weekly digest scheduling skipped (%)', sqlerrm;
end $$;

commit;

notify pgrst, 'reload schema';
