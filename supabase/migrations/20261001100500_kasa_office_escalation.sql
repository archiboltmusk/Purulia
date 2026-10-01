-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — escalate overdue reports to the District Magistrate
--
-- The weekly office letters go to the municipality or the BDO. A report
-- still open 14 days past its deadline (so it has been in at least two of
-- those letters since the deadline) is also listed in a weekly letter to
-- the District Magistrate, naming the office that was told.
--
-- DM email: purulia.gov.in Who's Who (also places/wb_officials.json).
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.office_contacts (office, title, addressee, emails, source)
values ('dm', 'District Magistrate, Purulia', 'The District Magistrate, Purulia',
        array['dm-pur-wb@nic.in'], 'https://purulia.gov.in/whos-who/')
on conflict (office) do update set title = excluded.title, addressee = excluded.addressee,
  emails = excluded.emails, source = excluded.source;

create or replace function public.kasa_office_letters_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_week date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date;
  v_out jsonb;
begin
  with base as (
    select r.id, r.created_at, r.ward_no, r.category, r.landmark, r.sla_days,
           -- Jhalda and Raghunathpur towns have no email on file and aren't the BDO's to fix.
           case when r.ward_no is not null then 'municipality'
                when r.boundary_type = 'municipality' then null else r.block_name end as office
    from public.kasa_public_reports r
    where r.status <> 'resolved' and not coalesce(r.is_duplicate, false)
  ), open_r as (
    select b.*, null::text as via from base b
    union all
    -- The next step up: 14 days past the deadline, the DM gets it too.
    select b.id, b.created_at, b.ward_no, b.category, b.landmark, b.sla_days, 'dm',
           (select c.title from kasa_private.office_contacts c where c.office = b.office)
    from base b
    where b.office is not null
      and b.created_at < now() - make_interval(days => coalesce(b.sla_days, 7) + 14)
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
                          'landmark', o.landmark, 'sla_days', o.sla_days, 'via', o.via,
                          'councillor', (select w.councillor_name from public.wards w where w.ward_no = o.ward_no))
                        order by o.created_at)
                       from open_r o where o.office = c.office))), '[]'::jsonb)
  into v_out
  from claimed x join kasa_private.office_contacts c on c.office = x.office;

  return jsonb_build_object('week', v_week, 'offices', v_out,
    'reply_to', coalesce((select jsonb_agg(u.email) from public.admins a join auth.users u on u.id = a.user_id
                          where u.email is not null), '[]'::jsonb));
end $$;
revoke all on function public.kasa_office_letters_claim() from public, anon, authenticated;
grant execute on function public.kasa_office_letters_claim() to service_role;

-- Public: how often each office has been written to, for analytics.html.
create or replace function public.kasa_office_letters_public() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'office' = 'dm' desc, (x->>'letters')::int desc, x->>'title'), '[]'::jsonb)
  from (
    select jsonb_build_object('office', c.office, 'title', c.title, 'source', c.source,
             'letters', count(*), 'first', min(l.week), 'last', max(l.week),
             'last_count', (select l2.report_count from kasa_private.office_letter_log l2
                            where l2.office = c.office and l2.sent_at is not null order by l2.week desc limit 1)) x
    from kasa_private.office_letter_log l join kasa_private.office_contacts c using (office)
    where l.sent_at is not null
    group by c.office, c.title, c.source
  ) t
$$;
revoke all on function public.kasa_office_letters_public() from public;
grant execute on function public.kasa_office_letters_public() to anon, authenticated;

commit;
