-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — a visible SLA clock, and an SLA that actually varies
--
-- Every report got the same 7-day SLA regardless of severity — a critical
-- report and a minor one were held to the same target. Now:
--   • sla_critical_days / sla_severe_days / sla_minor_days (default 1/3/7)
--     set the target by severity at report creation.
--   • kasa_private.sla_days_for(severity) reads them.
-- The public API already carried sla_days per report; the frontend now
-- shows a live "Due in Xh" / "Xh overdue" clock on the report sheet
-- (kasa.js), not just a day count.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('sla_critical_days', '1', 'Days to fix a critical report before it counts as overdue'),
  ('sla_severe_days',   '3', 'Days to fix a severe report before it counts as overdue'),
  ('sla_minor_days',    '7', 'Days to fix a minor report before it counts as overdue')
on conflict (key) do nothing;

create or replace function kasa_private.sla_days_for(p_severity text) returns integer
language sql stable security definer set search_path = '' as $$
  select case p_severity
    when 'critical' then kasa_private.cfg_num('sla_critical_days')::integer
    when 'severe'   then kasa_private.cfg_num('sla_severe_days')::integer
    else kasa_private.cfg_num('sla_minor_days')::integer
  end
$$;

do $do$
declare f record; v_def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'kasa_create_report' loop
    v_def := pg_get_functiondef(f.oid);
    if position('sla_days_for' in v_def) = 0 and position('''open'', 0, 0, 7, coalesce(v_parent.id, v_recur.id)' in v_def) > 0 then
      execute replace(v_def,
        '''open'', 0, 0, 7, coalesce(v_parent.id, v_recur.id)',
        '''open'', 0, 0, kasa_private.sla_days_for(p_severity), coalesce(v_parent.id, v_recur.id)');
    end if;
  end loop;
end $do$;

commit;

notify pgrst, 'reload schema';
