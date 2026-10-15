-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — features borrowed (as ideas, not code) from other civic sites
--
-- 1. RTI tracker (from Alaveteli): an RTI number added on a report's "Filed
--    officially" list can carry the date it was filed. The report sheet counts
--    the 30 days a Public Information Officer has to answer (RTI Act 2005,
--    s.7(1)) and the 30 days after that for a first appeal (s.19(1)). Whoever
--    added it gets a private key, kept on their phone, to mark it answered,
--    refused, appealed or no reply.
-- 2. Moderator reply templates (from FixMyStreet): saved public reasons that
--    moderators pick from instead of retyping them.
-- 3. Ward priorities (from Decidim's budgets): one vote per signed-in device for
--    up to three problems a ward or block should fix first. Counts are public.
-- 4. Retention (from FixMyStreet's inactive-report job): network hashes older
--    than 180 days are wiped, once a day, from records that no fraud check
--    reads later.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. RTI tracker ──────────────────────────────────────────────────────
alter table kasa_private.report_dockets add column if not exists filed_on date;
alter table kasa_private.report_dockets add column if not exists rti_status text;
alter table kasa_private.report_dockets add column if not exists status_at timestamptz;
alter table kasa_private.report_dockets add column if not exists edit_hash text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'report_dockets_rti_status_check') then
    alter table kasa_private.report_dockets add constraint report_dockets_rti_status_check
      check (rti_status is null or rti_status in ('waiting', 'answered', 'refused', 'appealed', 'no_reply'));
  end if;
end $$;

drop function if exists public.kasa_add_docket(text, text, text);
create or replace function public.kasa_add_docket(p_report_id text, p_portal text, p_number text, p_filed_on date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip  text := kasa_private.ip_hash();
  v_num text := upper(regexp_replace(btrim(coalesce(p_number, '')), '\s+', '', 'g'));
  v_key text;
  v_id  bigint;
begin
  if not exists (select 1 from public.kasa_public_reports v where v.id::text = p_report_id) then
    perform kasa_private.fail('KASA_NOT_FOUND', 'That report is not on the map.');
  end if;
  if p_portal is null or p_portal not in ('cpgrams', 'state', 'rti', 'other') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose where you filed it.');
  end if;
  if v_num !~ '^[A-Z0-9][A-Z0-9/._-]{3,39}$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Type the reference number exactly as you got it (letters, numbers, / and -).');
  end if;
  -- The RTI Act came into force on 12 October 2005.
  if p_filed_on is not null and (p_filed_on > (now() at time zone 'Asia/Kolkata')::date or p_filed_on < date '2005-10-12') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Pick the date you filed it.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.report_dockets
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10)
     or (select count(*) from kasa_private.report_dockets where report_id = p_report_id) >= 10 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many numbers added. Please try again tomorrow.');
  end if;
  if p_portal = 'rti' then v_key := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); end if;
  insert into kasa_private.report_dockets (report_id, portal, number, ip_hash, filed_on, rti_status, edit_hash)
  values (p_report_id, p_portal, v_num, v_ip,
          case when p_portal = 'rti' then coalesce(p_filed_on, (now() at time zone 'Asia/Kolkata')::date) end,
          case when p_portal = 'rti' then 'waiting' end,
          case when v_key is not null then md5(v_key) end)
  on conflict (report_id, portal, number) do nothing
  returning id into v_id;
  return jsonb_build_object('ok', true) || case when v_id is not null and v_key is not null
    then jsonb_build_object('id', v_id, 'key', v_key) else '{}'::jsonb end;
end $$;

-- Only whoever added the RTI number (they hold the key) can move it along.
create or replace function public.kasa_set_rti_status(p_id bigint, p_key text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('waiting', 'answered', 'refused', 'appealed', 'no_reply') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose what happened.');
  end if;
  update kasa_private.report_dockets set rti_status = p_status, status_at = now()
  where id = p_id and portal = 'rti' and edit_hash is not null and edit_hash = md5(coalesce(p_key, ''));
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Only the phone that added this RTI can change it.'); end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

create or replace function public.kasa_report_dockets(p_report_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'portal', d.portal, 'number', d.number, 'added', d.created_at::date)
                  || case when d.portal = 'rti' and d.filed_on is not null then jsonb_build_object(
                       'filed_on', d.filed_on, 'reply_due', d.filed_on + 30, 'appeal_by', d.filed_on + 60,
                       'status', coalesce(d.rti_status, 'waiting'), 'status_at', d.status_at::date) else '{}'::jsonb end
                  order by d.created_at), '[]'::jsonb)
  from kasa_private.report_dockets d
  where d.report_id = p_report_id
    and exists (select 1 from public.kasa_public_reports v where v.id::text = p_report_id)
$$;

-- ── 2. Moderator reply templates ────────────────────────────────────────
create table if not exists kasa_private.reply_templates (
  id         bigserial primary key,
  kind       text not null check (kind in ('hide', 'recategorize', 'clear', 'remove_photo', 'unlink', 'remove', 'any')),
  body       text not null check (length(body) between 3 and 400),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, body)
);
alter table kasa_private.reply_templates enable row level security;

create or replace function public.kasa_admin_reply_templates() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'body', t.body) order by t.kind, t.body)
                   from kasa_private.reply_templates t), '[]'::jsonb);
end $$;

create or replace function public.kasa_admin_save_reply_template(p_kind text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_body text := btrim(coalesce(p_body, ''));
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_kind is null or p_kind not in ('hide', 'recategorize', 'clear', 'remove_photo', 'unlink', 'remove', 'any') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Unknown kind of reason.');
  end if;
  if length(v_body) not between 3 and 400 then perform kasa_private.fail('KASA_BAD_FORM', 'Write the reason (3 to 400 letters).'); end if;
  if (select count(*) from kasa_private.reply_templates) >= 200 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many saved reasons. Delete one first.');
  end if;
  insert into kasa_private.reply_templates (kind, body, created_by) values (p_kind, v_body, auth.uid())
  on conflict (kind, body) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kasa_admin_delete_reply_template(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  delete from kasa_private.reply_templates where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ── 3. Ward priorities ──────────────────────────────────────────────────
create table if not exists kasa_private.ward_priorities (
  area       text not null,                         -- ward.html area: 'ward:7' or 'block:Arsha'
  voter      uuid not null,
  picks      text[] not null,
  ip_hash    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (area, voter)
);
alter table kasa_private.ward_priorities enable row level security;

create or replace function kasa_private.priority_categories() returns text[]
language sql immutable set search_path = '' as $$
  select array['garbage', 'dumpsite', 'toilet', 'drain', 'road', 'streetlight', 'water', 'missing',
               'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other']
$$;

create or replace function public.kasa_ward_priority_vote(p_area text, p_picks text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_picks text[];
begin
  if v_uid is null then perform kasa_private.fail('KASA_NO_SESSION', 'Please try again.'); end if;
  if p_area is null or p_area !~ '^(ward:[0-9]{1,3}|block:[A-Za-z][A-Za-z .-]{1,39})$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Pick a ward or block.');
  end if;
  select array_agg(distinct x order by x) into v_picks from unnest(coalesce(p_picks, '{}')) x;
  if v_picks is null or cardinality(v_picks) > 3 or not (v_picks <@ kasa_private.priority_categories()) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Pick one to three problems.');
  end if;
  if not exists (select 1 from kasa_private.ward_priorities where area = p_area and voter = v_uid) then
    perform kasa_private.net_limit('priority', 30, 100, 'Too many votes from this network. Please try again later.');
  end if;
  insert into kasa_private.ward_priorities (area, voter, picks, ip_hash)
  values (p_area, v_uid, v_picks, kasa_private.ip_hash())
  on conflict (area, voter) do update set picks = excluded.picks, updated_at = now();
  return public.kasa_ward_priorities(p_area);
end $$;

create or replace function public.kasa_ward_priorities(p_area text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'voters', (select count(*) from kasa_private.ward_priorities where area = p_area),
    'counts', coalesce((select jsonb_object_agg(c, n) from (
        select c, count(*) n from kasa_private.ward_priorities w, unnest(w.picks) c where w.area = p_area group by c) s), '{}'::jsonb),
    'mine', (select to_jsonb(w.picks) from kasa_private.ward_priorities w where w.area = p_area and w.voter = auth.uid()))
$$;

-- ── 4. Retention: wipe old network hashes ───────────────────────────────
create table if not exists kasa_private.maintenance_runs (
  job    text primary key,
  ran_at timestamptz not null
);
alter table kasa_private.maintenance_runs enable row level security;

-- Tables with an UPDATE trigger (claims, votes, flags…) are left alone: their hashes feed fraud checks.
create or replace function kasa_private.wipe_old_ip_hashes(p_days integer default 180) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  n integer := 0;
  k integer;
begin
  for t in
    select c.table_schema s, c.table_name tb
    from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    join information_schema.columns cr on cr.table_schema = c.table_schema and cr.table_name = c.table_name and cr.column_name = 'created_at'
    where c.column_name = 'ip_hash' and c.is_nullable = 'YES' and c.table_schema in ('public', 'kasa_private')
      and not exists (select 1 from pg_trigger g
                      where g.tgrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
                        and not g.tgisinternal and (g.tgtype & 16) <> 0)
  loop
    execute format('update %I.%I set ip_hash = null where ip_hash is not null and created_at < now() - make_interval(days => %s)',
                   t.s, t.tb, p_days);
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;
revoke all on function kasa_private.wipe_old_ip_hashes(integer) from public, anon, authenticated;

-- Called by the report map on open; does the work at most once a day.
create or replace function public.kasa_retention_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('kasa_retention')) then return jsonb_build_object('ran', false); end if;
  if exists (select 1 from kasa_private.maintenance_runs where job = 'wipe_ip_hashes' and ran_at > now() - interval '1 day') then
    return jsonb_build_object('ran', false);
  end if;
  insert into kasa_private.maintenance_runs (job, ran_at) values ('wipe_ip_hashes', now())
  on conflict (job) do update set ran_at = excluded.ran_at;
  v_n := kasa_private.wipe_old_ip_hashes(180);
  return jsonb_build_object('ran', true, 'wiped', v_n);
end $$;

revoke all on function public.kasa_add_docket(text, text, text, date) from public;
grant execute on function public.kasa_add_docket(text, text, text, date) to anon, authenticated;
revoke all on function public.kasa_set_rti_status(bigint, text, text) from public;
grant execute on function public.kasa_set_rti_status(bigint, text, text) to anon, authenticated;
revoke all on function public.kasa_report_dockets(text) from public;
grant execute on function public.kasa_report_dockets(text) to anon, authenticated;
revoke all on function public.kasa_admin_reply_templates() from public, anon;
grant execute on function public.kasa_admin_reply_templates() to authenticated;
revoke all on function public.kasa_admin_save_reply_template(text, text) from public, anon;
grant execute on function public.kasa_admin_save_reply_template(text, text) to authenticated;
revoke all on function public.kasa_admin_delete_reply_template(bigint) from public, anon;
grant execute on function public.kasa_admin_delete_reply_template(bigint) to authenticated;
revoke all on function public.kasa_ward_priority_vote(text, text[]) from public, anon;
grant execute on function public.kasa_ward_priority_vote(text, text[]) to authenticated;
revoke all on function public.kasa_ward_priorities(text) from public;
grant execute on function public.kasa_ward_priorities(text) to anon, authenticated;
revoke all on function public.kasa_retention_tick() from public;
grant execute on function public.kasa_retention_tick() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
