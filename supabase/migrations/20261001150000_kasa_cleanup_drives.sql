-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — cleanup drives
--
-- A moderator posts a drive (when, where people meet, where it ends, who
-- organises it, the route drawn on the map). The report map shows a banner
-- for it from when it is posted until a week after it starts; the drive
-- card lists the unresolved reports along the route, and after the start
-- the ones fixed since. "I'm coming" is counted once per network per drive.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.drives (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  place       text not null default 'purulia',
  starts_at   timestamptz not null,
  meet_point  text not null,
  end_point   text,
  organisers  jsonb not null default '[]'::jsonb,   -- [{name, url}]
  provided    text,                                -- what organisers hand out / what to bring
  notes       text,
  route       jsonb,                               -- [[lng, lat], …] along the roads
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table kasa_private.drives enable row level security;

create table if not exists kasa_private.drive_going (
  drive_id   uuid not null references kasa_private.drives(id) on delete cascade,
  ip_hash    text not null,
  created_at timestamptz not null default now(),
  primary key (drive_id, ip_hash)
);
alter table kasa_private.drive_going enable row level security;

create or replace function kasa_private.drive_json(d kasa_private.drives) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'title', d.title, 'place', d.place, 'starts_at', d.starts_at,
    'meet_point', d.meet_point, 'end_point', d.end_point, 'organisers', d.organisers,
    'provided', d.provided, 'notes', d.notes, 'route', d.route, 'hidden', d.hidden,
    'going', (select count(*) from kasa_private.drive_going g where g.drive_id = d.id))
$$;
revoke all on function kasa_private.drive_json(kasa_private.drives) from public;

-- Drives on the map: not hidden, starting from now back to a week ago, soonest first.
create or replace function public.kasa_drives() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(kasa_private.drive_json(d) order by d.starts_at), '[]'::jsonb)
  from kasa_private.drives d
  where not d.hidden and d.starts_at > now() - interval '7 days'
$$;

create or replace function public.kasa_drive_going(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ip text := coalesce(kasa_private.ip_hash(), 'unknown');
begin
  if not exists (select 1 from kasa_private.drives where id = p_id and not hidden) then
    perform kasa_private.fail('KASA_NOT_FOUND', 'That drive is not on the map.');
  end if;
  insert into kasa_private.drive_going (drive_id, ip_hash) values (p_id, v_ip) on conflict do nothing;
  return jsonb_build_object('going', (select count(*) from kasa_private.drive_going where drive_id = p_id));
end $$;

create or replace function public.kasa_admin_drives() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return (select coalesce(jsonb_agg(kasa_private.drive_json(d) order by d.starts_at desc), '[]'::jsonb) from kasa_private.drives d);
end $$;

-- p_id null adds a drive; otherwise edits it. p_drive carries the fields above.
create or replace function public.kasa_admin_save_drive(p_id uuid, p_drive jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_title text := left(btrim(coalesce(p_drive->>'title', '')), 140);
  v_meet  text := left(btrim(coalesce(p_drive->>'meet_point', '')), 200);
  v_start timestamptz;
  v_route jsonb := p_drive->'route';
  v_org   jsonb := coalesce(p_drive->'organisers', '[]'::jsonb);
  v_id    uuid;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  begin v_start := (p_drive->>'starts_at')::timestamptz; exception when others then v_start := null; end;
  if v_title = '' or v_meet = '' or v_start is null then
    perform kasa_private.fail('KASA_BAD_FORM', 'A drive needs a title, a meeting point and a start time.');
  end if;
  if jsonb_typeof(v_org) <> 'array' or jsonb_array_length(v_org) > 10
     or exists (select 1 from jsonb_array_elements(v_org) o
                where coalesce(btrim(o->>'name'), '') = '' or (coalesce(o->>'url', '') <> '' and o->>'url' !~ '^https://')) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Each organiser needs a name; links must start with https://.');
  end if;
  if v_route is not null and jsonb_typeof(v_route) = 'null' then v_route := null; end if;
  if v_route is not null and (jsonb_typeof(v_route) <> 'array' or jsonb_array_length(v_route) < 2 or jsonb_array_length(v_route) > 2000
     or exists (select 1 from jsonb_array_elements(v_route) p
                where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
                   or jsonb_typeof(p->0) <> 'number' or jsonb_typeof(p->1) <> 'number'
                   or (p->>0)::float8 not between 85 and 90 or (p->>1)::float8 not between 21 and 28)) then
    perform kasa_private.fail('KASA_BAD_FORM', 'The route must be at least two points inside West Bengal.');
  end if;
  if p_id is null then
    insert into kasa_private.drives (title, place, starts_at, meet_point, end_point, organisers, provided, notes, route, hidden)
    values (v_title, coalesce(nullif(btrim(p_drive->>'place'), ''), 'purulia'), v_start, v_meet,
            left(nullif(btrim(p_drive->>'end_point'), ''), 200), v_org,
            left(nullif(btrim(p_drive->>'provided'), ''), 300), left(nullif(btrim(p_drive->>'notes'), ''), 1000),
            v_route, coalesce((p_drive->>'hidden')::boolean, false))
    returning id into v_id;
  else
    update kasa_private.drives set title = v_title, place = coalesce(nullif(btrim(p_drive->>'place'), ''), place),
      starts_at = v_start, meet_point = v_meet, end_point = left(nullif(btrim(p_drive->>'end_point'), ''), 200),
      organisers = v_org, provided = left(nullif(btrim(p_drive->>'provided'), ''), 300),
      notes = left(nullif(btrim(p_drive->>'notes'), ''), 1000), route = v_route,
      hidden = coalesce((p_drive->>'hidden')::boolean, hidden), updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then perform kasa_private.fail('KASA_NOT_FOUND', 'No such drive.'); end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

revoke all on function public.kasa_drives() from public;
grant execute on function public.kasa_drives() to anon, authenticated;
revoke all on function public.kasa_drive_going(uuid) from public;
grant execute on function public.kasa_drive_going(uuid) to anon, authenticated;
revoke all on function public.kasa_admin_drives() from public, anon;
grant execute on function public.kasa_admin_drives() to authenticated;
revoke all on function public.kasa_admin_save_drive(uuid, jsonb) from public, anon;
grant execute on function public.kasa_admin_save_drive(uuid, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
