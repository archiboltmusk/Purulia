-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — government notices mapped to administrative areas.
--
-- Maps the proposed notice schema onto what already exists, and adds only
-- what is missing:
--   lgd_boundaries          -> kasa_private.areas (+ lgd_code, now unique;
--                              + lgd_source, the official LGD export it came from)
--   government_notices      -> kasa_private.documents (document_type =
--                              'government_notice', source_id, archive_url,
--                              rights_review, sha256) + notice_details (dates,
--                              moderator publish flag). raw_content is not
--                              copied: the archived file is the record.
--   notice_lgd_mappings     -> kasa_private.document_areas (new, generic:
--                              any document can be tagged to an area)
--   get_notices_in_viewport -> public.kasa_notices_in_viewport (read-only)
--   get_ward_map_with_notices -> public.kasa_notice_map (counts aggregated
--                              per area before the join, so no double count)
--
-- No LGD codes are inserted here. They come only from the official LGD export,
-- loaded with its source recorded in lgd_source.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Areas: LGD code and its source ───────────────────────────────────
alter table kasa_private.areas add column if not exists lgd_source text;      -- e.g. the LGD export file/URL and its date
alter table kasa_private.areas add column if not exists lgd_checked_on date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'areas_lgd_source_required') then
    alter table kasa_private.areas add constraint areas_lgd_source_required
      check (lgd_code is null or lgd_source is not null);
  end if;
end $$;

-- An LGD code names one area. Partial, so areas without a code are unaffected.
create unique index if not exists areas_lgd_code_uidx on kasa_private.areas (lgd_code) where lgd_code is not null;

-- ── 2. Notice details (one row per notice document) ─────────────────────
create table if not exists kasa_private.notice_details (
  document_id  bigint primary key references kasa_private.documents (id) on delete cascade,
  start_date   date,
  end_date     date,
  published_at timestamptz,                    -- set by a moderator; nothing is public before this
  created_at   timestamptz not null default now(),
  constraint notice_dates_order check (start_date is null or end_date is null or end_date >= start_date)
);
create index if not exists notice_details_published_idx on kasa_private.notice_details (published_at) where published_at is not null;
alter table kasa_private.notice_details enable row level security;
revoke all on kasa_private.notice_details from public, anon, authenticated;

-- ── 3. Document → area tags (spatial tags) ──────────────────────────────
create table if not exists kasa_private.document_areas (
  id          bigint generated always as identity primary key,
  document_id bigint not null references kasa_private.documents (id) on delete cascade,
  area_id     text not null references kasa_private.areas (id) on delete cascade,
  match_type  text not null check (match_type in ('exact', 'fuzzy', 'inherited', 'manual')),
  confidence  numeric(4, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at  timestamptz not null default now(),
  unique (document_id, area_id)
);
create index if not exists document_areas_area_idx on kasa_private.document_areas (area_id);
alter table kasa_private.document_areas enable row level security;
revoke all on kasa_private.document_areas from public, anon, authenticated;

-- ── 4. Moderator publish switch ─────────────────────────────────────────
create or replace function public.kasa_admin_set_notice_published(p_document_id bigint, p_publish boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  update kasa_private.notice_details
     set published_at = case when p_publish then coalesce(published_at, now()) else null end
   where document_id = p_document_id;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such notice.'); end if;
  return jsonb_build_object('document_id', p_document_id, 'published', p_publish);
end $$;

-- ── 5. Public read: notices touching the map view ───────────────────────
-- Bounding-box overlap on the areas' stored limits (same test the old
-- geometry && check made). Only published notices whose rights allow a link.
create or replace function public.kasa_notices_in_viewport(p_min_lng double precision, p_min_lat double precision,
    p_max_lng double precision, p_max_lat double precision) returns jsonb
language sql stable security definer set search_path = '' as $$
  with vis as (
    select a.id, a.name, a.kind, a.lgd_code from kasa_private.areas a
    where a.min_lat <= p_max_lat and a.max_lat >= p_min_lat
      and a.min_lng <= p_max_lng and a.max_lng >= p_min_lng
  ), notices as (
    select d.id, d.title, d.url, d.published_on, d.rights_review,
           nd.start_date, nd.end_date, nd.published_at
    from kasa_private.notice_details nd
    join kasa_private.documents d on d.id = nd.document_id
    where nd.published_at is not null
      and d.rights_review in ('permitted', 'link_only', 'public_domain')
      and d.status <> 'gone'
      and exists (select 1 from kasa_private.document_areas da join vis on vis.id = da.area_id where da.document_id = d.id)
    order by nd.published_at desc
    limit 100
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'notice_id', n.id, 'title', n.title, 'url', n.url, 'published_on', n.published_on,
      'start_date', n.start_date, 'end_date', n.end_date,
      'areas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'area_id', v.id, 'name', v.name, 'kind', v.kind, 'lgd_code', v.lgd_code,
                  'match_type', da.match_type) order by v.name), '[]'::jsonb)
                from kasa_private.document_areas da join vis v on v.id = da.area_id
                where da.document_id = n.id)
    ) order by n.published_at desc), '[]'::jsonb)
  from notices n;
$$;

-- ── 6. Public read: ward/area outlines with published-notice counts ─────
-- Counts are taken per area in their own subquery and joined afterwards, so a
-- notice tagged to several areas counts once per area and nothing is multiplied.
create or replace function public.kasa_notice_map(p_parent text, p_kind text default 'ward') returns jsonb
language sql stable security definer set search_path = '' as $$
  with counts as (
    select da.area_id, count(*) as notice_count
    from kasa_private.document_areas da
    join kasa_private.notice_details nd on nd.document_id = da.document_id and nd.published_at is not null
    group by da.area_id
  )
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'geometry', jsonb_build_object('type', 'MultiPolygon', 'coordinates', a.polygons),
      'properties', jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'lgd_code', a.lgd_code,
                                       'notice_count', coalesce(c.notice_count, 0))
    ) order by a.name), '[]'::jsonb))
  from kasa_private.areas a
  left join counts c on c.area_id = a.id
  where a.kind = p_kind and a.parent = p_parent;
$$;

-- ── 7. Grants: anon/authenticated get the two read RPCs only ────────────
revoke all on function public.kasa_admin_set_notice_published(bigint, boolean) from public, anon;
grant execute on function public.kasa_admin_set_notice_published(bigint, boolean) to authenticated;
revoke all on function public.kasa_notices_in_viewport(double precision, double precision, double precision, double precision) from public;
grant execute on function public.kasa_notices_in_viewport(double precision, double precision, double precision, double precision) to anon, authenticated;
revoke all on function public.kasa_notice_map(text, text) from public;
grant execute on function public.kasa_notice_map(text, text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
