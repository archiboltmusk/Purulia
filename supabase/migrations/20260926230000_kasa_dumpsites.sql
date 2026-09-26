-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — dumping grounds as their own kind of report
--
-- Where does Purulia's waste go? Nobody publishes it. People can now report
-- a dumping ground: a place where trucks or carts unload waste, with the same
-- live photo, GPS and confirmation rules as any report. The "Where the waste
-- goes" page maps them. The photo check treats them like garbage.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function kasa_private.valid_category(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing', 'encroachment',
               'illegal_construction', 'illegal_mining', 'illegal_other', 'other',
               'hand_pump', 'anganwadi', 'health_centre', 'school', 'dumpsite')
$$;

-- kasa_create_report keeps its own list; add the new kind to every version of it.
do $do$
declare f record; v_def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'kasa_create_report' loop
    v_def := pg_get_functiondef(f.oid);
    if position('''dumpsite''' in v_def) = 0 and position('''health_centre'', ''school'')' in v_def) > 0 then
      execute replace(v_def, '''health_centre'', ''school'')', '''health_centre'', ''school'', ''dumpsite'')');
    end if;
  end loop;
end $do$;

update kasa_private.settings set value = value || '["dumpsite"]'::jsonb
where key = 'dirty_categories' and not value ? 'dumpsite';

commit;

notify pgrst, 'reload schema';
