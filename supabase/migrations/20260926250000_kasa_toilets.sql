-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — public toilets as their own kind of report
--
-- Purulia was the only urban area in India not declared Open Defecation
-- Free as of 2021 — many built toilets go unused for want of water or
-- because of poor construction. People can now report a public toilet
-- that is locked, unusable, unclean, or without water, with the same live
-- photo, GPS and confirmation rules as any report. The "Public toilets"
-- page maps them. Unlike garbage/dumpsite, the photo check does not score
-- these for litter — a broken toilet doesn't look like a pile of waste.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function kasa_private.valid_category(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing', 'encroachment',
               'illegal_construction', 'illegal_mining', 'illegal_other', 'other',
               'hand_pump', 'anganwadi', 'health_centre', 'school', 'dumpsite', 'toilet')
$$;

-- kasa_create_report keeps its own list; add the new kind to every version of it.
do $do$
declare f record; v_def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'kasa_create_report' loop
    v_def := pg_get_functiondef(f.oid);
    if position('''toilet''' in v_def) = 0 and position('''health_centre'', ''school'', ''dumpsite'')' in v_def) > 0 then
      execute replace(v_def, '''health_centre'', ''school'', ''dumpsite'')', '''health_centre'', ''school'', ''dumpsite'', ''toilet'')');
    end if;
  end loop;
end $do$;

commit;

notify pgrst, 'reload schema';
