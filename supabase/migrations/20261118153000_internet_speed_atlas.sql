-- Voluntary, coarse-location speed measurements. Apply before enabling public contributions.
create table if not exists public.internet_speed_tests (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 lat numeric(5,2) not null check(lat between 6 and 38),
 lng numeric(5,2) not null check(lng between 68 and 98),
 download_mbps numeric(9,2) not null check(download_mbps between 0.01 and 10000),
 upload_mbps numeric(9,2) not null check(upload_mbps between 0.01 and 10000),
 latency_ms integer not null check(latency_ms between 0 and 60000),
 connection_type text not null check(connection_type in ('mobile','fixed'))
);
alter table public.internet_speed_tests enable row level security;
revoke all on public.internet_speed_tests from anon,authenticated;
create or replace view public.internet_speed_public with (security_invoker=true) as
 select created_at,lat,lng,download_mbps,upload_mbps,latency_ms,connection_type from public.internet_speed_tests;
-- A public read policy is required for the security-invoker view.
drop policy if exists "speed_public_read" on public.internet_speed_tests;
create policy "speed_public_read" on public.internet_speed_tests for select to anon,authenticated using (true);
revoke select on public.internet_speed_tests from anon,authenticated;
revoke select on public.internet_speed_public from anon,authenticated;
create or replace function public.submit_internet_speed(p_lat numeric,p_lng numeric,p_download numeric,p_upload numeric,p_latency integer,p_kind text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_lat is null or p_lng is null or p_lat<>round(p_lat,2) or p_lng<>round(p_lng,2) then raise exception 'Location must be rounded to two decimals'; end if;
 insert into public.internet_speed_tests(lat,lng,download_mbps,upload_mbps,latency_ms,connection_type)
 values(p_lat,p_lng,p_download,p_upload,p_latency,p_kind);
end $$;
revoke all on function public.submit_internet_speed(numeric,numeric,numeric,numeric,integer,text) from public;
-- Disabled pending verified, rate-limited ingestion endpoint.
revoke all on function public.submit_internet_speed(numeric,numeric,numeric,numeric,integer,text) from anon,authenticated;
-- Before production: add edge-level rate limiting, bot protection and India polygon validation.
