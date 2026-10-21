-- Border fixes go live on moderator approval. A fix to Purulia's wards (fix_of = 'purulia') or to a town's wards
-- (fix_of = town slug) is checked (closed rings, inside West Bengal) and applied. Each change logs actor, previous
-- and new geometry and time in kasa_private.boundary_changes and kasa_private.audit_log. A moderator can roll back
-- the newest live change of a ward. Purulia's outlines come from purulia_wards.geojson; live fixes overlay that file
-- (kasa_boundary_live). District, block and GP fixes (fix_of 'area:…') still change nothing here and are edited by hand.
begin;

create table if not exists kasa_private.boundary_changes (
  id              bigint generated always as identity primary key,
  applied_at      timestamptz not null default now(),
  submission_id   bigint references kasa_private.place_submissions (id),
  fix_of          text not null,
  ward_no         integer not null,
  prev_polygons   jsonb,              -- live outline before this change; null = the shipped boundary file (Purulia)
  new_polygons    jsonb not null,     -- MultiPolygon coordinates
  source          text not null,      -- the contributor's cited map source
  applied_by      uuid,
  rolled_back_at  timestamptz,
  rolled_back_by  uuid,
  rollback_note   text
);
alter table kasa_private.boundary_changes enable row level security;
create index if not exists boundary_changes_live_idx on kasa_private.boundary_changes (fix_of, ward_no, id) where rolled_back_at is null;

-- Every ring closed, at least 4 points, inside West Bengal's box, non-zero area. Self-intersection is not checked.
create or replace function kasa_private.polygons_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare poly jsonb; ring jsonb; n integer; a double precision; i integer;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then return false; end if;
  for poly in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(poly) <> 'array' or jsonb_array_length(poly) = 0 then return false; end if;
    for ring in select value from jsonb_array_elements(poly) loop
      if jsonb_typeof(ring) <> 'array' then return false; end if;
      n := jsonb_array_length(ring);
      if n < 4 then return false; end if;
      if exists (select 1 from jsonb_array_elements(ring) pt
                 where jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
                    or jsonb_typeof(pt -> 0) <> 'number' or jsonb_typeof(pt -> 1) <> 'number') then return false; end if;
      if exists (select 1 from jsonb_array_elements(ring) pt
                 where (pt ->> 0)::double precision not between 85.7 and 90.0
                    or (pt ->> 1)::double precision not between 21.4 and 27.4) then return false; end if;
      if ring -> 0 is distinct from ring -> (n - 1) then return false; end if;
      a := 0;
      for i in 0 .. n - 2 loop
        a := a + (ring -> i ->> 0)::double precision * (ring -> (i + 1) ->> 1)::double precision
               - (ring -> (i + 1) ->> 0)::double precision * (ring -> i ->> 1)::double precision;
      end loop;
      if a = 0 then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

-- Sets a town's ward outline in kasa_private.areas (null polygons removes it).
create or replace function kasa_private.put_place_ward(p_slug text, p_ward integer, p_polygons jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from kasa_private.areas where kind = 'place_ward' and parent = p_slug and ward_no = p_ward;
  if p_polygons is null then return; end if;
  insert into kasa_private.areas (id, kind, name, ward_no, min_lat, max_lat, min_lng, max_lng, polygons, parent)
  select 'place_ward:' || p_slug || ':' || p_ward, 'place_ward', 'Ward ' || p_ward, p_ward,
         b.min_lat, b.max_lat, b.min_lng, b.max_lng, p_polygons, p_slug
  from (select min((pt ->> 1)::double precision) as min_lat, max((pt ->> 1)::double precision) as max_lat,
               min((pt ->> 0)::double precision) as min_lng, max((pt ->> 0)::double precision) as max_lng
        from jsonb_path_query(p_polygons, '$[*][*][*]') pt) b;
end $$;

-- One ward of an approved fix goes live: logs the change, then sets the outline for towns.
create or replace function kasa_private.apply_ward_fix(p_submission bigint, p_fix_of text, p_ward integer,
                                                       p_polygons jsonb, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id bigint;
begin
  if p_fix_of = 'purulia' then
    select c.new_polygons into v_prev from kasa_private.boundary_changes c
    where c.fix_of = 'purulia' and c.ward_no = p_ward and c.rolled_back_at is null order by c.id desc limit 1;
  else
    select a.polygons into v_prev from kasa_private.areas a
    where a.kind = 'place_ward' and a.parent = p_fix_of and a.ward_no = p_ward;
  end if;
  insert into kasa_private.boundary_changes (submission_id, fix_of, ward_no, prev_polygons, new_polygons, source, applied_by)
  values (p_submission, p_fix_of, p_ward, v_prev, p_polygons, p_source, auth.uid())
  returning id into v_id;
  if p_fix_of <> 'purulia' then perform kasa_private.put_place_ward(p_fix_of, p_ward, p_polygons); end if;
  insert into kasa_private.audit_log (actor_id, action, target_type, target_id, before, after)
  values (auth.uid(), 'boundary.apply', 'boundary_change', v_id::text, v_prev, p_polygons);
end $$;

create or replace function public.kasa_admin_review_place(p_id bigint, p_action text, p_slug text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s kasa_private.place_submissions;
  v_slug text;
  w record;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into s from kasa_private.place_submissions where id = p_id for update;
  if not found or s.status <> 'pending' then perform kasa_private.fail('KASA_BAD_FORM', 'That map was already reviewed.'); end if;
  if p_action = 'reject' then
    update kasa_private.place_submissions set status = 'rejected', review_note = nullif(trim(p_note), ''), reviewed_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  elsif p_action <> 'approve' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Approve or reject.');
  end if;
  -- A note-only fix, or an area fix (district, block or GP outline, changed by hand), changes nothing here.
  if s.ward_count = 0 or s.fix_of like 'area:%' then
    update kasa_private.place_submissions set status = 'approved',
           slug = (select p.slug from kasa_private.places p where p.slug = s.fix_of), review_note = nullif(trim(p_note), ''),
           reviewed_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'approved', 'slug', (select p.slug from kasa_private.places p where p.slug = s.fix_of));
  end if;

  -- A border fix to Purulia's wards or a town's wards: checked, then live.
  if s.fix_of is not null then
    if s.fix_of <> 'purulia' and not exists (select 1 from kasa_private.places where slug = s.fix_of) then
      perform kasa_private.fail('KASA_BAD_FORM', 'That town is not on the map yet.');
    end if;
    for w in select (x ->> 'ward')::integer as ward, x -> 'polygons' as polygons from jsonb_array_elements(s.wards) x loop
      if not kasa_private.polygons_valid(w.polygons) then
        perform kasa_private.fail('KASA_BAD_MAP', format('Ward %s is not a closed, valid outline.', w.ward));
      end if;
    end loop;
    if s.fix_of <> 'purulia' then
      update kasa_private.places set
        status = case when s.drawn then 'provisional' else status end,
        community = true,
        incharge = coalesce(s.incharge, incharge), incharge_source = coalesce(s.incharge_source, incharge_source),
        complaint_url = coalesce(s.complaint_url, complaint_url),
        source = case when source like '%' || s.map_source || '%' then source else source || '; fixes: ' || s.map_source end,
        updated_at = now()
      where slug = s.fix_of;
    end if;
    for w in select (x ->> 'ward')::integer as ward, x -> 'polygons' as polygons from jsonb_array_elements(s.wards) x loop
      perform kasa_private.apply_ward_fix(p_id, s.fix_of, w.ward, w.polygons, s.map_source);
    end loop;
    update kasa_private.place_submissions set status = 'approved', slug = nullif(s.fix_of, 'purulia'),
           review_note = nullif(trim(p_note), ''), reviewed_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'approved', 'slug', nullif(s.fix_of, 'purulia'));
  end if;

  -- A new town.
  v_slug := nullif(trim(lower(p_slug)), '');
  if v_slug is null then v_slug := trim(both '-' from regexp_replace(lower(s.town), '[^a-z0-9]+', '-', 'g')); end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' or v_slug = 'purulia' or v_slug like 'district%' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give the town a short web name, like "bankura".');
  end if;
  if exists (select 1 from kasa_private.places where slug = v_slug) then
    perform kasa_private.fail('KASA_BAD_FORM', format('"%s" is already on the map; approve it as a fix instead.', v_slug));
  end if;
  for w in select (x ->> 'ward')::integer as ward, x -> 'polygons' as polygons from jsonb_array_elements(s.wards) x loop
    if not kasa_private.polygons_valid(w.polygons) then
      perform kasa_private.fail('KASA_BAD_MAP', format('Ward %s is not a closed, valid outline.', w.ward));
    end if;
  end loop;
  insert into kasa_private.places (slug, name, body, body_type, complaint_url, wards_mapped, wards_total, source, licence,
                                   district, status, community, incharge, incharge_source, updated_at)
  values (v_slug, s.town, s.body, s.body_type, s.complaint_url, s.ward_count, null, s.map_source,
          case when s.drawn then 'Community-drawn on Parishkar' else 'As sent by the contributor' end,
          s.district, case when s.drawn then 'provisional' else 'live' end, true, s.incharge, s.incharge_source, now());
  for w in select (x ->> 'ward')::integer as ward, x -> 'polygons' as polygons from jsonb_array_elements(s.wards) x loop
    perform kasa_private.put_place_ward(v_slug, w.ward, w.polygons);
  end loop;
  update kasa_private.places set wards_mapped = (select count(*) from kasa_private.areas
                                                 where kind = 'place_ward' and parent = v_slug)
  where slug = v_slug;
  update kasa_private.place_submissions set status = 'approved', slug = v_slug, review_note = nullif(trim(p_note), ''),
         reviewed_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'approved', 'slug', v_slug);
end $$;

-- Live outlines that replace a shipped or earlier one: the newest change per ward that is not rolled back.
create or replace function public.kasa_boundary_live(p_fix_of text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('ward', x.ward_no, 'polygons', x.new_polygons,
                                               'source', x.source, 'applied_on', x.applied_at::date)
                            order by x.ward_no), '[]'::jsonb)
  from (select distinct on (c.ward_no) c.ward_no, c.new_polygons, c.source, c.applied_at
        from kasa_private.boundary_changes c
        where c.fix_of = p_fix_of and c.rolled_back_at is null
        order by c.ward_no, c.id desc) x;
$$;

-- Public change log: what changed, when, from which source, and whether it was rolled back.
create or replace function public.kasa_boundary_history(p_fix_of text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('ward', x.ward_no, 'source', x.source, 'applied_on', x.applied_at::date,
                                               'rolled_back_on', x.rolled_back_at::date) order by x.id desc), '[]'::jsonb)
  from (select c.* from kasa_private.boundary_changes c where c.fix_of = p_fix_of order by c.id desc limit 100) x;
$$;

-- Moderator: roll back the newest live change of a ward; previous outline is restored.
create or replace function public.kasa_admin_rollback_boundary(p_change_id bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c kasa_private.boundary_changes;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into c from kasa_private.boundary_changes where id = p_change_id for update;
  if not found or c.rolled_back_at is not null then perform kasa_private.fail('KASA_BAD_FORM', 'That change is not live.'); end if;
  if exists (select 1 from kasa_private.boundary_changes n
             where n.fix_of = c.fix_of and n.ward_no = c.ward_no and n.id > c.id and n.rolled_back_at is null) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Roll back the newer change to this ward first.');
  end if;
  if c.fix_of <> 'purulia' then perform kasa_private.put_place_ward(c.fix_of, c.ward_no, c.prev_polygons); end if;
  update kasa_private.boundary_changes set rolled_back_at = now(), rolled_back_by = auth.uid(),
         rollback_note = nullif(trim(p_note), '')
  where id = p_change_id;
  insert into kasa_private.audit_log (actor_id, action, target_type, target_id, before, after)
  values (auth.uid(), 'boundary.rollback', 'boundary_change', p_change_id::text, c.new_polygons, c.prev_polygons);
  return jsonb_build_object('ok', true, 'status', 'rolled_back');
end $$;

-- Moderator: recent changes, for the rollback list.
create or replace function public.kasa_admin_boundary_changes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'fix_of', x.fix_of, 'ward', x.ward_no, 'source', x.source,
                                                       'applied_at', x.applied_at, 'rolled_back_at', x.rolled_back_at,
                                                       'submission_id', x.submission_id, 'applied_by', x.applied_by)
                                         order by x.id desc)
                   from (select * from kasa_private.boundary_changes order by id desc limit 200) x), '[]'::jsonb);
end $$;

revoke all on function kasa_private.polygons_valid(jsonb) from public, anon, authenticated;
revoke all on function kasa_private.put_place_ward(text, integer, jsonb) from public, anon, authenticated;
revoke all on function kasa_private.apply_ward_fix(bigint, text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.kasa_admin_review_place(bigint, text, text, text) from public, anon;
grant execute on function public.kasa_admin_review_place(bigint, text, text, text) to authenticated;
revoke all on function public.kasa_boundary_live(text) from public;
grant execute on function public.kasa_boundary_live(text) to anon, authenticated;
revoke all on function public.kasa_boundary_history(text) from public;
grant execute on function public.kasa_boundary_history(text) to anon, authenticated;
revoke all on function public.kasa_admin_rollback_boundary(bigint, text) from public, anon;
grant execute on function public.kasa_admin_rollback_boundary(bigint, text) to authenticated;
revoke all on function public.kasa_admin_boundary_changes() from public, anon;
grant execute on function public.kasa_admin_boundary_changes() to authenticated;

commit;

notify pgrst, 'reload schema';
