-- SQL functions for weekly pattern digest
-- These are pure SQL analysis queries — no ML, no external calls.

-- 1. Category clusters: find categories with 5+ reports in one ward this week
create or replace function kasa_weekly_clusters(p_days int = 7)
returns table(ward_no int, category text, count bigint) as $$
  select
    r.ward_no,
    r.category,
    count(*) as count
  from public.reports r
  where r.created_at > now() - (p_days || ' days')::interval
    and r.status = 'open'
    and r.ward_no is not null
  group by r.ward_no, r.category
  having count(*) >= 5
  order by count desc, r.ward_no;
$$ language sql stable;

-- 2. Overdue reports: find what's past SLA by ward
create or replace function kasa_weekly_overdue(p_limit int = 10)
returns table(ward_no int, category text, count_overdue bigint, sla_days int, oldest_days int) as $$
  select
    r.ward_no,
    r.category,
    count(*) as count_overdue,
    r.sla_days,
    max(
      extract(day from now() - r.created_at)::int
    ) as oldest_days
  from public.reports r
  where r.status = 'open'
    and r.ward_no is not null
    and (now() - r.created_at) > (r.sla_days || ' days')::interval
  group by r.ward_no, r.category, r.sla_days
  order by oldest_days desc
  limit p_limit;
$$ language sql stable;

-- 3. Resolution rate by category chain (engineering, sanitation, etc.)
create or replace function kasa_weekly_resolution(p_days int = 7)
returns table(chain text, opened bigint, resolved bigint) as $$
  with categories as (
    select 'garbage'::text as cat, 'sanitation'::text as chain union
    select 'drain', 'sanitation' union
    select 'dumpsite', 'sanitation' union
    select 'road', 'engineering' union
    select 'streetlight', 'lighting' union
    select 'water', 'water' union
    select 'missing', 'engineering' union
    select 'encroachment', 'enforcement' union
    select 'illegal_construction', 'enforcement' union
    select 'illegal_mining', 'mining' union
    select 'illegal_other', 'police' union
    select 'hand_pump', 'water' union
    select 'anganwadi', 'icds' union
    select 'health_centre', 'health' union
    select 'school', 'education' union
    select 'toilet', 'sanitation'
  )
  select
    c.chain,
    count(r.id) filter (where r.created_at > now() - (p_days || ' days')::interval) as opened,
    count(r.id) filter (where r.resolved_at > now() - (p_days || ' days')::interval) as resolved
  from categories c
  left join public.reports r on r.category = c.cat
  group by c.chain
  order by chain;
$$ language sql stable;

-- 4. Recurrence: same issue at same spot within 60 days (pure SQL distance, no PostGIS)
create or replace function kasa_weekly_recurrence(p_days int = 60)
returns table(id uuid, ward_no int, category text, landmark text, recurrence_count int) as $$
  select
    r.id,
    r.ward_no,
    r.category,
    r.landmark,
    count(distinct rp.id) - 1 as recurrence_count
  from public.reports r
  inner join public.reports rp on (
    rp.category = r.category
    and rp.ward_no = r.ward_no
    -- Rough distance check: within ~100m means <0.001 degrees (at equator ~111m per degree)
    and abs(rp.lat - r.lat) < 0.001
    and abs(rp.lng - r.lng) < 0.001
    and rp.resolved_at > now() - (p_days || ' days')::interval
    and rp.created_at > r.created_at  -- rp is newer
  )
  where r.status = 'open'
  group by r.id, r.ward_no, r.category, r.landmark
  having count(distinct rp.id) > 1  -- has recurrences
  order by recurrence_count desc;
$$ language sql stable;
