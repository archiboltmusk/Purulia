-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — a fix only counts if it lasts
--
-- A fix followed by a new report at the same spot (a recurrence, linked by
-- parent_report_id) within fix_must_last_days is shown as "didn't last" and
-- isn't counted as fixed. The pages work this out from the public view; this
-- migration adds the setting and makes the weekly email digest agree.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('fix_must_last_days', '14', 'A fix reported again at the spot within this many days does not count as fixed (keep in step with fixMustLastDays in city.js)')
on conflict (key) do nothing;

do $do$
declare v_def text;
begin
  if to_regprocedure('public.kasa_weekly_digest_claim()') is not null then
    v_def := pg_get_functiondef('public.kasa_weekly_digest_claim()'::regprocedure);
    if position('fix_must_last_days' in v_def) = 0 then
      v_def := replace(v_def, $a$r.resolution_method in ('community', 'photo_check')$a$,
        $a$r.resolution_method in ('community', 'photo_check')
                                        and not exists (select 1 from public.reports c
                                          where c.parent_report_id = r.id and not coalesce(c.is_duplicate, false)
                                            and c.created_at >= r.resolved_at - interval '1 hour'
                                            and c.created_at <= r.resolved_at + make_interval(days => kasa_private.cfg_num('fix_must_last_days')::integer))$a$);
      if position('fix_must_last_days' in v_def) = 0 then raise exception 'kasa_weekly_digest_claim: fix-must-last patch did not apply'; end if;
      execute v_def;
    end if;
  end if;
end $do$;

commit;

notify pgrst, 'reload schema';
