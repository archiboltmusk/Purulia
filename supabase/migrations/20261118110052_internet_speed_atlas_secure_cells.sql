-- Mirrors the deployed internet_speed_atlas_secure_cells migration.
create table if not exists public.internet_speed_tests (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 user_id uuid not null references auth.users(id) on delete cascade,
 cell_lat numeric(4,1) not null check(cell_lat between 6 and 38),
 cell_lng numeric(4,1) not null check(cell_lng between 68 and 98),
 download_mbps numeric(9,2) not null check(download_mbps between 0.01 and 10000),
 upload_mbps numeric(9,2) not null check(upload_mbps between 0.01 and 10000),
 latency_ms integer not null check(latency_ms between 0 and 60000),
 connection_type text not null check(connection_type in ('mobile','fixed'))
);
create index if not exists speed_cell_idx on public.internet_speed_tests(cell_lat,cell_lng,connection_type,created_at);
create index if not exists speed_user_idx on public.internet_speed_tests(user_id,created_at desc);
alter table public.internet_speed_tests enable row level security;
revoke all on public.internet_speed_tests from public,anon,authenticated;
grant insert on public.internet_speed_tests to authenticated;
drop policy if exists speed_insert_self on public.internet_speed_tests;
create policy speed_insert_self on public.internet_speed_tests for insert to authenticated with check ((select auth.uid())=user_id);
create or replace function public.submit_internet_speed(p_lat numeric,p_lng numeric,p_download numeric,p_upload numeric,p_latency integer,p_kind text)
returns void language plpgsql security invoker set search_path=public as $$
declare u uuid;
begin
 u:=auth.uid();
 if u is null then raise exception 'Authentication required'; end if;
 if p_lat is null or p_lng is null or p_lat<6 or p_lat>38 or p_lng<68 or p_lng>98 then raise exception 'Location outside supported bounds'; end if;
 if p_download is null or p_download<0.01 or p_download>10000 or p_upload is null or p_upload<0.01 or p_upload>10000 or p_latency is null or p_latency<0 or p_latency>60000 or p_kind not in ('mobile','fixed') then raise exception 'Invalid measurement'; end if;
 if exists(select 1 from public.internet_speed_tests where user_id=u and created_at>now()-interval '15 minutes') then raise exception 'Wait 15 minutes between contributions'; end if;
 insert into public.internet_speed_tests(user_id,cell_lat,cell_lng,download_mbps,upload_mbps,latency_ms,connection_type)
 values(u,round(p_lat,1),round(p_lng,1),p_download,p_upload,p_latency,p_kind);
end $$;
revoke all on function public.submit_internet_speed(numeric,numeric,numeric,numeric,integer,text) from public,anon;
grant execute on function public.submit_internet_speed(numeric,numeric,numeric,numeric,integer,text) to authenticated;
create or replace function public.internet_speed_cells()
returns table(lat numeric,lng numeric,download_mbps numeric,upload_mbps numeric,latency_ms numeric,connection_type text,samples bigint)
language sql security definer set search_path=public as $$
 select cell_lat,cell_lng,round(percentile_cont(0.5) within group(order by download_mbps)::numeric,2),
 round(percentile_cont(0.5) within group(order by upload_mbps)::numeric,2),
 round(percentile_cont(0.5) within group(order by latency_ms)::numeric,0),
 connection_type,count(*) from public.internet_speed_tests
 where created_at>now()-interval '90 days'
 group by cell_lat,cell_lng,connection_type having count(distinct user_id)>=5
 limit 5000;
$$;
revoke all on function public.internet_speed_cells() from public;
grant execute on function public.internet_speed_cells() to anon,authenticated;
