-- Plain PostgreSQL test projects do not ship these managed extensions.
do $migration$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net')
     or to_regtype('extensions.geometry') is null then
    raise notice 'India live feeds require pg_cron, pg_net and PostGIS in extensions';
    return;
  end if;
create schema if not exists kasa_private;

create table if not exists kasa_private.india_feed (
  id text primary key,
  endpoint text not null,
  interval_minutes integer not null check (interval_minutes > 0),
  request_id bigint,
  requested_at timestamptz,
  succeeded_at timestamptz,
  last_error text
);
create table if not exists kasa_private.india_observation (
  source_id text not null references kasa_private.india_feed,
  external_id text not null,
  observed_at timestamptz not null,
  geom extensions.geometry(Point,4326) not null,
  label text not null,
  magnitude numeric,
  primary key (source_id, external_id)
);
create index if not exists india_observation_time on kasa_private.india_observation(source_id, observed_at desc);
create index if not exists india_observation_geom on kasa_private.india_observation using gist(geom);
alter table kasa_private.india_feed enable row level security;
alter table kasa_private.india_observation enable row level security;
revoke all on kasa_private.india_feed, kasa_private.india_observation from public, anon, authenticated;
insert into kasa_private.india_feed(id, endpoint, interval_minutes)
values ('usgs-earthquakes','https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',1) on conflict (id) do nothing;

create or replace function kasa_private.ingest_india_feeds() returns void
language plpgsql set search_path = '' as $$
declare
  feed kasa_private.india_feed%rowtype;
  response record;
  payload jsonb;
begin
  for feed in select * from kasa_private.india_feed where id = 'usgs-earthquakes' for update skip locked loop
    if feed.request_id is not null then
      select status_code, content, timed_out into response from net._http_response where id = feed.request_id;
      if not found and feed.requested_at > now() - interval '3 minutes' then continue; end if;
      begin
        if response.status_code is distinct from 200 or response.timed_out is true then
          raise exception 'Source HTTP status %', coalesce(response.status_code::text, 'unavailable');
        end if;
        payload := response.content::jsonb;
        if payload->>'type' is distinct from 'FeatureCollection'
           or jsonb_typeof(payload->'features') is distinct from 'array' then
          raise exception 'Invalid earthquake feed';
        end if;
        with parsed as materialized (
          select f->>'id' as id, f#>>'{properties,place}' as label,
            case when jsonb_typeof(f#>'{properties,time}') = 'number' then (f#>>'{properties,time}')::numeric end as epoch,
            case when jsonb_typeof(f#>'{properties,mag}') = 'number' then (f#>>'{properties,mag}')::numeric end as mag,
            case when jsonb_typeof(f#>'{geometry,coordinates,0}') = 'number' then (f#>>'{geometry,coordinates,0}')::numeric end as lng,
            case when jsonb_typeof(f#>'{geometry,coordinates,1}') = 'number' then (f#>>'{geometry,coordinates,1}')::numeric end as lat
          from jsonb_array_elements(payload->'features') f
          where f#>>'{geometry,type}' = 'Point'
        )
        insert into kasa_private.india_observation(source_id, external_id, observed_at, geom, label, magnitude)
        select distinct on(parsed.id) feed.id, parsed.id, to_timestamp(epoch::double precision / 1000),
          extensions.st_setsrid(extensions.st_makepoint(lng, lat),4326),
          left(coalesce(label,'Earthquake'),300), mag
        from parsed
        where length(id) between 1 and 100 and lng between 65 and 100 and lat between 5 and 39
          and epoch between extract(epoch from now() - interval '3 days') * 1000
            and extract(epoch from now() + interval '5 minutes') * 1000
        order by parsed.id, parsed.epoch desc
        on conflict (source_id, external_id) do update
        set observed_at = excluded.observed_at, geom = excluded.geom,
          label = excluded.label, magnitude = excluded.magnitude
        where (india_observation.observed_at, extensions.st_asewkb(india_observation.geom), india_observation.label, india_observation.magnitude)
          is distinct from (excluded.observed_at, extensions.st_asewkb(excluded.geom), excluded.label, excluded.magnitude);
        update kasa_private.india_feed set succeeded_at = now(), last_error = null where id = feed.id;
      exception when data_exception or raise_exception then
        update kasa_private.india_feed set last_error = 'Source response unavailable or invalid' where id = feed.id;
      end;
      update kasa_private.india_feed set request_id = null where id = feed.id;
    end if;
    if feed.requested_at is null or feed.requested_at <= now() - make_interval(mins => feed.interval_minutes) then
      update kasa_private.india_feed
      set request_id = net.http_get(url := feed.endpoint, timeout_milliseconds := 12000), requested_at = now()
      where id = feed.id;
    end if;
  end loop;
end;
$$;
revoke all on function kasa_private.ingest_india_feeds() from public, anon, authenticated;

create or replace function public.india_earthquake_snapshot(p_days integer default 1) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last_success', f.succeeded_at, 'error', f.last_error,
    'type','FeatureCollection',
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type','Feature','id',o.external_id,
        'geometry',extensions.st_asgeojson(o.geom)::jsonb,
        'properties',jsonb_build_object('observed',o.observed_at,'label',o.label,'mag',o.magnitude)
      ) order by o.observed_at desc)
      from (
        select external_id, observed_at, geom, label, magnitude
        from kasa_private.india_observation
        where source_id = f.id and observed_at >= now() - make_interval(days => greatest(1,least(p_days,30)))
        order by observed_at desc limit 5000
      ) o
    ),'[]'::jsonb)
  ) from kasa_private.india_feed f where f.id = 'usgs-earthquakes';
$$;
revoke all on function public.india_earthquake_snapshot(integer) from public;
grant execute on function public.india_earthquake_snapshot(integer) to anon, authenticated;
perform cron.schedule('india-live-feeds', '* * * * *', 'select kasa_private.ingest_india_feeds()');
perform cron.schedule('india-live-retention', '21 2 * * *', $job$delete from kasa_private.india_observation where observed_at < now() - interval '90 days'$job$);
perform kasa_private.ingest_india_feeds();
end;
$migration$;
