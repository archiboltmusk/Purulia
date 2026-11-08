-- Optional passenger reports for the static travel page. Never authoritative vehicle telemetry.
-- Raw coordinates are not stored: only 0.01-degree cells. Public groups require 3 sessions.
create table if not exists kasa_private.transit_passengers (
  token_hash text primary key,
  route_id text not null check (length(route_id) between 1 and 120),
  lat_cell numeric(5,2) not null check (lat_cell between -90 and 90),
  lon_cell numeric(5,2) not null check (lon_cell between -180 and 180),
  observed_at timestamptz not null,
  received_at timestamptz not null default now()
);
alter table kasa_private.transit_passengers enable row level security;
revoke all on kasa_private.transit_passengers from public, anon, authenticated;
create index if not exists transit_passengers_route_time on kasa_private.transit_passengers(route_id, received_at);

create or replace function public.kasa_transit_status() returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$ select jsonb_build_object('available',true,'ttl_seconds',600,'minimum_sessions',3); $$;

create or replace function public.kasa_transit_submit(p_token uuid, p_route text, p_lat double precision, p_lon double precision, p_accuracy double precision, p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare h text; net text;
begin
  if p_token is null or p_route is null or length(trim(p_route)) not between 1 and 120 or p_route ~ '[[:cntrl:]]'
    or p_lat is null or not (p_lat between -90 and 90) or p_lon is null or not (p_lon between -180 and 180)
    or p_accuracy is null or not (p_accuracy > 0 and p_accuracy <= 50)
    or p_observed_at is null or p_observed_at > clock_timestamp() or p_observed_at < clock_timestamp() - interval '30 seconds' then
    raise exception 'A recent accurate location, route ID and session token are required';
  end if;
  h := encode(digest(p_token::text, 'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('transit:' || h, 0));
  if exists(select 1 from kasa_private.transit_passengers where token_hash=h and received_at > clock_timestamp() - interval '30 seconds') then
    raise exception 'Wait 30 seconds before sending another report';
  end if;
  net := kasa_private.ip_hash();
  if net is null then raise exception 'Network identity unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('transit-net:' || net, 0));
  perform kasa_private.net_limit('transit_passenger', 240, 2400, 'Too many reports from this network. Try again later.');
  delete from kasa_private.transit_passengers where received_at < clock_timestamp() - interval '10 minutes';
  insert into kasa_private.transit_passengers(token_hash,route_id,lat_cell,lon_cell,observed_at,received_at)
    values(h,trim(p_route),round(p_lat::numeric,2),round(p_lon::numeric,2),p_observed_at,clock_timestamp())
  on conflict(token_hash) do update set route_id=excluded.route_id,lat_cell=excluded.lat_cell,lon_cell=excluded.lon_cell,observed_at=excluded.observed_at,received_at=excluded.received_at;
  return jsonb_build_object('shared',true,'expires_in_seconds',600);
end $$;

create or replace function public.kasa_transit_withdraw(p_token uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
begin
  if p_token is null then raise exception 'Session token required'; end if;
  delete from kasa_private.transit_passengers where token_hash=encode(digest(p_token::text,'sha256'),'hex');
  return jsonb_build_object('withdrawn',true);
end $$;

create or replace function public.kasa_transit_reports(p_route text) returns setof jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  select jsonb_build_object('lat',lat_cell::double precision,'lon',lon_cell::double precision,'sessions',count(*)::integer,'latest_at',max(observed_at),'expires_at',min(least(observed_at,received_at))+interval '10 minutes','source','passenger_unverified')
  from kasa_private.transit_passengers
  where route_id=trim(p_route) and length(p_route) between 1 and 120
    and received_at > now() - interval '10 minutes' and observed_at > now() - interval '10 minutes'
  group by lat_cell,lon_cell having count(*) >= 3
  order by max(observed_at) desc limit 50;
$$;

revoke all on function public.kasa_transit_status() from public;
revoke all on function public.kasa_transit_submit(uuid,text,double precision,double precision,double precision,timestamptz) from public;
revoke all on function public.kasa_transit_withdraw(uuid) from public;
revoke all on function public.kasa_transit_reports(text) from public;
grant execute on function public.kasa_transit_status() to anon,authenticated;
grant execute on function public.kasa_transit_submit(uuid,text,double precision,double precision,double precision,timestamptz) to anon,authenticated;
grant execute on function public.kasa_transit_withdraw(uuid) to anon,authenticated;
grant execute on function public.kasa_transit_reports(text) to anon,authenticated;
