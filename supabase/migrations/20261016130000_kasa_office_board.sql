-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — per-office board: open reports grouped by the office that
-- owns them, with counts and dates only.
--
-- Owner per open report (first rule that matches):
--   town ward                         -> municipality (Purulia Municipality)
--   village dry tap / pump broken     -> phed (PHE (Civil), Purulia)
--   road, OSM state highway           -> pwd   (no contact on file)
--   road, OSM national highway        -> nh    (no contact on file)
--   road, OSM district/village road   -> zp    (no contact on file)
--   other village report              -> BDO of its block (contact if on file)
--   anything else                     -> unassigned
-- Road authority comes from kasa_private.road_tags (OSM IN:NH/SH/MDR/ODR/VR).
-- An office with no row in kasa_private.office_contacts is shown as
-- "not on record yet". Public data only: counts, dates, report ids.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_office_board() returns jsonb
language sql stable security definer set search_path = '' as $$
with base as (
  select r.id, r.created_at, r.category, r.ward_no, r.area_kind, r.block_name, r.waste_type, r.sla_days,
         rt.authority
  from public.kasa_public_reports r
  left join kasa_private.road_tags rt on rt.report_id = r.id
  where r.status <> 'resolved' and not coalesce(r.is_duplicate, false)
), owned as (
  select b.*,
    case
      when b.ward_no is not null then 'municipality'
      when b.area_kind = 'rural' and b.waste_type in ('dry_tap', 'pump_broken') then 'phed'
      when b.category = 'road' and b.authority = 'state_highway' then 'pwd'
      when b.category = 'road' and b.authority = 'national_highway' then 'nh'
      when b.category = 'road' and b.authority in ('major_district_road', 'other_district_road', 'village_road') then 'zp'
      when b.category = 'road' then 'unassigned'
      when b.block_name is not null then 'block:' || b.block_name
      else 'unassigned'
    end as office_key
  from base b
), grp as (
  select o.office_key, count(*) as open_count, min(o.created_at) as oldest_open,
         count(*) filter (where o.sla_days is not null and o.created_at < now() - make_interval(days => o.sla_days)) as overdue_count
  from owned o group by o.office_key
), cats as (
  select x.office_key, jsonb_object_agg(x.category, x.n) as by_category
  from (select office_key, category, count(*) as n from owned group by office_key, category) x
  group by x.office_key
)
select coalesce(jsonb_agg(jsonb_build_object(
  'office', g.office_key,
  'title', coalesce(c.title, case g.office_key
             when 'municipality' then 'Purulia Municipality'
             when 'phed' then 'PHE (Civil), Purulia'
             when 'pwd' then 'PWD: state highways'
             when 'nh' then 'National highway (NHAI / MoRTH)'
             when 'zp' then 'Zilla Parishad: district and village roads'
             when 'unassigned' then 'Owner not on record yet'
             else 'BDO, ' || substr(g.office_key, 7) || ' block' end),
  'on_record', c.office is not null,
  'source', c.source,
  'open', g.open_count,
  'overdue', g.overdue_count,
  'oldest_open', g.oldest_open,
  'oldest_days', floor(extract(epoch from now() - g.oldest_open) / 86400),
  'by_category', coalesce(ct.by_category, '{}'::jsonb),
  'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', x.id, 'created_at', x.created_at, 'category', x.category,
                'days_open', floor(extract(epoch from now() - x.created_at) / 86400)) order by x.created_at), '[]'::jsonb)
              from (select o2.* from owned o2 where o2.office_key = g.office_key order by o2.created_at limit 200) x)
) order by g.open_count desc, g.office_key), '[]'::jsonb)
from grp g
left join cats ct on ct.office_key = g.office_key
left join kasa_private.office_contacts c on c.office = case
  when g.office_key in ('municipality', 'phed') then g.office_key
  when g.office_key like 'block:%' then substr(g.office_key, 7) end
$$;

revoke all on function public.kasa_office_board() from public;
grant execute on function public.kasa_office_board() to anon, authenticated;

commit;
