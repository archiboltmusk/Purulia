-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — official grievance numbers on a report
--
-- Anyone who files a report on an official channel (the central grievance
-- portal CPGRAMS, the state helpline, an RTI) can add the reference number
-- it gave them. The report sheet then shows "Filed on CPGRAMS: <number>, on
-- <date>", so the next person follows up the same complaint instead of
-- starting a new one. Numbers are public; who added them is not.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.report_dockets (
  id         bigserial primary key,
  report_id  text not null,
  portal     text not null check (portal in ('cpgrams', 'state', 'rti', 'other')),
  number     text not null,
  created_at timestamptz not null default now(),
  ip_hash    text,
  unique (report_id, portal, number)
);
alter table kasa_private.report_dockets enable row level security;
create index if not exists report_dockets_report_idx on kasa_private.report_dockets (report_id);

create or replace function public.kasa_add_docket(p_report_id text, p_portal text, p_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip  text := kasa_private.ip_hash();
  v_num text := upper(regexp_replace(btrim(coalesce(p_number, '')), '\s+', '', 'g'));
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
  if (v_ip is not null and (select count(*) from kasa_private.report_dockets
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10)
     or (select count(*) from kasa_private.report_dockets where report_id = p_report_id) >= 10 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many numbers added. Please try again tomorrow.');
  end if;
  insert into kasa_private.report_dockets (report_id, portal, number, ip_hash)
  values (p_report_id, p_portal, v_num, v_ip)
  on conflict (report_id, portal, number) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kasa_report_dockets(p_report_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('portal', d.portal, 'number', d.number, 'added', d.created_at::date)
                  order by d.created_at), '[]'::jsonb)
  from kasa_private.report_dockets d
  where d.report_id = p_report_id
    and exists (select 1 from public.kasa_public_reports v where v.id::text = p_report_id)
$$;

revoke all on function public.kasa_add_docket(text, text, text) from public;
grant execute on function public.kasa_add_docket(text, text, text) to anon, authenticated;
revoke all on function public.kasa_report_dockets(text) from public;
grant execute on function public.kasa_report_dockets(text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
