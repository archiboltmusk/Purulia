-- Loads every West Bengal school on the UDISE+ school list, as published on India
-- Data Portal ("Basic Details of Schools", Ministry of Education UDISE+, retrieved
-- from src.udiseplus.gov.in on 12 Jan 2022, ODC-By:
-- https://ckan.indiadataportal.com/dataset/f1b2fdba-3b56-47ca-bfc6-819fc64b712a),
-- into public.schools (the district comes from the UDISE code, see
-- supabase/migrations/20261001090000_kasa_wb_schools.sql). Run in the Supabase SQL
-- editor (needs pg_net), in two steps:
--
--   1. Run STEP 1. It asks India Data Portal for all 75,322 rows, 5,000 at a time.
--   2. Wait a minute, check `select count(*) from net._http_response h join
--      kasa_private.udise_fetch f on f.req = h.id where h.status_code = 200` is 16,
--      then run STEP 2.
--
-- Existing schools keep their names, blocks and villages (Purulia's came from the
-- district's own spreadsheet); a missing location or official record is filled in.
-- No school is deleted. Safe to re-run.

-- STEP 1
create table if not exists kasa_private.udise_fetch (req bigint primary key);
truncate kasa_private.udise_fetch;
insert into kasa_private.udise_fetch
select net.http_get(
  'https://ckan.indiadataportal.com/api/3/action/datastore_search?resource_id=457fddf1-982f-4c85-855d-5095578accc1'
  || '&sort=_id&limit=5000&offset=' || o
  || '&filters=' || '%7B%22state_name%22%3A%22West%20Bengal%22%7D'
  || '&fields=udise_school_code,school_name,latitude,longitude,subdistrict_name,village_name,ward,management,'
  || 'school_category,class_students,total_teachers,class_rooms',
  timeout_milliseconds := 120000)
from generate_series(0, 75000, 5000) o;

-- STEP 2
with rec as (
  select distinct on (x ->> 'udise_school_code') x, kasa_private.udise_district(x ->> 'udise_school_code') as slug
  from kasa_private.udise_fetch f
  join net._http_response h on h.id = f.req and h.status_code = 200
  cross join lateral jsonb_array_elements(h.content::jsonb #> '{result,records}') x
  where x ->> 'udise_school_code' ~ '^19[0-9]{9}$' and kasa_private.udise_district(x ->> 'udise_school_code') is not null
  order by x ->> 'udise_school_code'
), row_ as (
  select x ->> 'udise_school_code' as code, nullif(btrim(x ->> 'school_name'), '') as name, slug,
         -- West Bengal's bounding box; anything outside is a bad pin, so the school is kept without one.
         case when (x ->> 'latitude')::float between 21.4 and 27.3 and (x ->> 'longitude')::float between 85.8 and 89.95
              then (x ->> 'latitude')::float end as lat,
         case when (x ->> 'latitude')::float between 21.4 and 27.3 and (x ->> 'longitude')::float between 85.8 and 89.95
              then (x ->> 'longitude')::float end as lng,
         case when slug = 'purulia' then upper(x ->> 'subdistrict_name') else x ->> 'subdistrict_name' end as block,
         nullif(coalesce(nullif(x ->> 'village_name', ''), nullif(x ->> 'ward', '')), '') as village,
         nullif(x ->> 'management', '') as management, nullif(x ->> 'school_category', '') as category,
         jsonb_strip_nulls(jsonb_build_object(
           'enrolment', (x ->> 'class_students')::int, 'teachers', (x ->> 'total_teachers')::int,
           'classrooms', (x ->> 'class_rooms')::int, 'source', 'india_data_portal')) as official
  from rec
)
insert into public.schools as s (udise_code, name, lat, lng, block_name, village, management, category, district, official, official_year)
select code, name, lat, lng, block, village, management, category, slug, official, 'as listed in Jan 2022'
from row_ where name is not null
on conflict (udise_code) do update set
  district = coalesce(s.district, excluded.district),
  lat = coalesce(s.lat, excluded.lat), lng = case when s.lat is null then excluded.lng else s.lng end,
  management = coalesce(s.management, excluded.management), category = coalesce(s.category, excluded.category),
  official_year = case when s.official is null then excluded.official_year else s.official_year end,
  official = coalesce(s.official, excluded.official),
  updated_at = now();

drop table kasa_private.udise_fetch;
