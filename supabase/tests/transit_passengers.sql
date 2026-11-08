-- Run after the standard migration suite; rollback all synthetic passenger data.
begin;
select set_config('request.headers','{"x-forwarded-for":"198.51.100.12"}',true);
delete from kasa_private.transit_passengers;
select public.kasa_transit_submit('00000000-0000-4000-8000-000000000001','TEST-ONLY',28.60123,77.20123,10,clock_timestamp());
select public.kasa_transit_submit('00000000-0000-4000-8000-000000000002','TEST-ONLY',28.60123,77.20123,10,clock_timestamp());
do $$ begin
  if exists(select 1 from public.kasa_transit_reports('TEST-ONLY')) then raise exception 'Privacy threshold failed'; end if;
  begin
    perform public.kasa_transit_submit('00000000-0000-4000-8000-000000000001','TEST-ONLY',28.6,77.2,10,clock_timestamp());
    raise exception 'Accepted report too soon';
  exception when others then
    if sqlerrm = 'Accepted report too soon' then raise; end if;
  end;
end $$;
select public.kasa_transit_submit('00000000-0000-4000-8000-000000000003','TEST-ONLY',28.60123,77.20123,10,clock_timestamp());
do $$ declare r jsonb; begin
  select * into r from public.kasa_transit_reports('TEST-ONLY');
  if (r->>'sessions')::int <> 3 or (r->>'lat')::numeric <> 28.60 then raise exception 'Grouping or location rounding failed'; end if;
  if r ? 'token_hash' or r ? 'p_token' then raise exception 'Session identity exposed'; end if;
  if has_table_privilege('anon','kasa_private.transit_passengers','SELECT') then raise exception 'Raw table access exposed'; end if;
  begin
    perform public.kasa_transit_submit('00000000-0000-4000-8000-000000000004','TEST-ONLY',28.6,77.2,10,clock_timestamp()-interval '31 seconds');
    raise exception 'Accepted stale position';
  exception when others then
    if sqlerrm = 'Accepted stale position' then raise; end if;
  end;
end $$;
select public.kasa_transit_withdraw('00000000-0000-4000-8000-000000000003');
do $$ begin
  if exists(select 1 from public.kasa_transit_reports('TEST-ONLY')) then raise exception 'Withdrawal failed'; end if;
end $$;
update kasa_private.transit_passengers set received_at=now()-interval '11 minutes',observed_at=now()-interval '11 minutes';
do $$ begin
  if exists(select 1 from public.kasa_transit_reports('TEST-ONLY')) then raise exception 'Report expiry failed'; end if;
end $$;
rollback;
