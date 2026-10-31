-- A public entry is valid for at most 24 hours. Expired reports never imply stock.
begin;
create table if not exists kasa_private.antivenom_facilities (
  id bigint generated always as identity primary key, name text not null,
  lat double precision not null check (lat between -90 and 90), lng double precision not null check (lng between -180 and 180),
  phone text, address text, status text not null check (status in ('available','unavailable')),
  source_url text not null check (source_url ~ '^https?://'), confirmed_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > confirmed_at and expires_at <= confirmed_at + interval '24 hours')
);
alter table kasa_private.antivenom_facilities enable row level security;
revoke all on kasa_private.antivenom_facilities from public, anon, authenticated;
create index if not exists kasa_antivenom_live_idx on kasa_private.antivenom_facilities (expires_at, status);
create or replace function public.kasa_antivenom_facilities() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'lat',round(lat::numeric,5),'lng',round(lng::numeric,5),'phone',phone,'address',address,'status',status,'source_url',source_url,'confirmed_at',confirmed_at,'expires_at',expires_at) order by name),'[]'::jsonb)
  from kasa_private.antivenom_facilities where expires_at > now()
$$;
revoke all on function public.kasa_antivenom_facilities() from public;
grant execute on function public.kasa_antivenom_facilities() to anon, authenticated;
commit;
