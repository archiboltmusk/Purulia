-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — weekly email to each office listing its open reports
--
-- Every Monday the kasa-office-letters Edge Function asks for the offices
-- that have open, non-duplicate reports and have not been written to this
-- week: Purulia Municipality for town wards, the BDO for a village block.
-- An office with nothing open gets no email. One email per office per week;
-- calling the function again the same week sends nothing.
--
-- Office emails: West Bengal Disaster Management Dept, District Disaster
-- Management Plan Purulia 2023-24, p.34 and p.199.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.office_contacts (
  office text primary key,          -- 'municipality' or the block name as in purulia_blocks.geojson
  title text not null,
  addressee text not null,
  emails text[] not null,
  source text not null
);

create table if not exists kasa_private.office_letter_log (
  office text not null references kasa_private.office_contacts(office),
  week date not null,               -- Monday of the week (IST)
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  report_count integer not null default 0,
  error text,
  primary key (office, week)
);
alter table kasa_private.office_contacts enable row level security;
alter table kasa_private.office_letter_log enable row level security;

insert into kasa_private.office_contacts (office, title, addressee, emails, source)
select v.office,
       case when v.office = 'municipality' then 'Purulia Municipality' else 'BDO, ' || v.office end,
       case when v.office = 'municipality' then 'The Chairman, Purulia Municipality'
            else 'The Block Development Officer, ' || v.office || ' Block, Purulia' end,
       v.emails,
       'http://wbdmd.gov.in/writereaddata/uploaded/DP/DPPurulia59822.pdf (DDMP Purulia 2023-24, p.' || v.page || ')'
from (values
  ('municipality',    array['puruliamunicipality@gmail.com'], '34'),
  ('Purulia I',       array['bdo.purulia1@gmail.com', 'bdopurulia1block@gmail.com'], '34, 199'),
  ('Purulia II',      array['bdoeopurulia2@gmail.com'], '199'),
  ('Barabazar',       array['bdo.barabazar@gmail.com'], '199'),
  ('Manbazar II',     array['manbazar2.prl@gmail.com'], '199'),
  ('Bundwan',         array['bdo.bundwan@gmail.com'], '199'),
  ('Arsha',           array['arshablock@gmail.com'], '199'),
  ('Balarampur',      array['bdo.balarampurnew@gmail.com'], '199'),
  ('Jhalda I',        array['bdo.jhalda1@gmail.com'], '199'),
  ('Bagmundi',        array['bdo.baghmundi@gmail.com'], '199'),
  ('Jaipur',          array['bdo.joypur@gmail.com'], '199'),
  ('Jhalda II',       array['bdo.jhalda2@gmail.com'], '199'),
  ('Hura',            array['bdo.hura@gmail.com'], '199'),
  ('Puncha',          array['bdo.puncha@gmail.com'], '199'),
  ('Manbazar I',      array['bdo.manbazar1@gmail.com'], '199'),
  ('Kashipur',        array['bdokashipur@gmail.com'], '199'),
  ('Raghunathpur II', array['bdo.raghunathpur2@gmail.com'], '199'),
  ('Para',            array['para@nic.in'], '199'),
  ('Neturia',         array['bdo1neturia@gmail.com'], '199'),
  ('Santuri',         array['bdo.santuri@gmail.com'], '199'),
  ('Raghunathpur I',  array['bdormp1@gmail.com'], '199')
) v(office, emails, page)
on conflict (office) do update set title = excluded.title, addressee = excluded.addressee,
  emails = excluded.emails, source = excluded.source;

-- Claims this week's letters: one per office with open reports and no letter yet this week
-- (a claim older than 30 minutes without a send counts as abandoned). Returns each office
-- with its open reports, plus the moderators' emails for Reply-To.
create or replace function public.kasa_office_letters_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_week date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date;
  v_out jsonb;
begin
  with open_r as (
    select r.id, r.created_at, r.ward_no, r.category, r.landmark, r.sla_days,
           -- Jhalda and Raghunathpur towns have no email on file and aren't the BDO's to fix.
           case when r.ward_no is not null then 'municipality'
                when r.boundary_type = 'municipality' then null else r.block_name end as office
    from public.kasa_public_reports r
    where r.status <> 'resolved' and not coalesce(r.is_duplicate, false)
  ), due as (
    select c.office from kasa_private.office_contacts c
    where exists (select 1 from open_r o where o.office = c.office)
      and not exists (select 1 from kasa_private.office_letter_log l
                      where l.office = c.office and l.week = v_week
                        and (l.sent_at is not null or l.claimed_at > now() - interval '30 minutes'))
  ), claimed as (
    insert into kasa_private.office_letter_log as l (office, week, claimed_at, report_count)
    select d.office, v_week, now(), (select count(*) from open_r o where o.office = d.office) from due d
    on conflict (office, week) do update set claimed_at = now(), error = null, report_count = excluded.report_count
      where l.sent_at is null and l.claimed_at <= now() - interval '30 minutes'
    returning l.office
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'office', c.office, 'title', c.title, 'addressee', c.addressee, 'emails', to_jsonb(c.emails),
           'reports', (select jsonb_agg(jsonb_build_object(
                          'id', o.id, 'created_at', o.created_at, 'ward_no', o.ward_no, 'category', o.category,
                          'landmark', o.landmark, 'sla_days', o.sla_days,
                          'councillor', (select w.councillor_name from public.wards w where w.ward_no = o.ward_no))
                        order by o.created_at)
                       from open_r o where o.office = c.office))), '[]'::jsonb)
  into v_out
  from claimed x join kasa_private.office_contacts c on c.office = x.office;

  return jsonb_build_object('week', v_week, 'offices', v_out,
    'reply_to', coalesce((select jsonb_agg(u.email) from public.admins a join auth.users u on u.id = a.user_id
                          where u.email is not null), '[]'::jsonb));
end $$;

create or replace function public.kasa_office_letters_done(p_office text, p_week date, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.office_letter_log
  set sent_at = case when p_error is null then now() end,
      claimed_at = case when p_error is null then claimed_at else now() - interval '1 hour' end,
      error = left(p_error, 300)
  where office = p_office and week = p_week and sent_at is null
$$;

-- For the admin page: what went out recently.
create or replace function public.kasa_admin_office_letters() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('office', c.title, 'emails', to_jsonb(c.emails), 'week', l.week,
                     'sent_at', l.sent_at, 'reports', l.report_count, 'error', l.error) order by l.week desc, c.title)
    from kasa_private.office_letter_log l join kasa_private.office_contacts c using (office)
    where l.week > now() - interval '70 days'), '[]'::jsonb);
end $$;

revoke all on function public.kasa_office_letters_claim() from public, anon, authenticated;
revoke all on function public.kasa_office_letters_done(text, date, text) from public, anon, authenticated;
grant execute on function public.kasa_office_letters_claim(), public.kasa_office_letters_done(text, date, text) to service_role;
revoke all on function public.kasa_admin_office_letters() from public, anon;
grant execute on function public.kasa_admin_office_letters() to authenticated;

commit;

-- Mondays from 09:30 IST (04:00 UTC); the later hourly runs only retry offices whose send failed.
do $$
begin
  if not exists(select 1 from cron.job where jobname = 'kasa-office-letters') then
    perform cron.schedule('kasa-office-letters', '0 4-8 * * 1', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-office-letters', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        60000
      )
    $job$);
  end if;
exception when others then
  raise notice 'kasa: office letters scheduling skipped (%) - enable it manually if needed', sqlerrm;
end $$;

notify pgrst, 'reload schema';
