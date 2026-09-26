-- Schedule the weekly pattern digest to run every Monday at 6am UTC
-- (Adjust the time in the cron expression if needed)

do $$
begin
  if not exists(select 1 from cron.job where jobname = 'kasa-weekly-pattern') then
    perform cron.schedule('kasa-weekly-pattern', '30 6 * * 1', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-weekly-pattern', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        5000
      )
    $job$);
  end if;
exception when others then
  raise notice 'kasa: weekly pattern scheduling skipped (%) - enable it manually if needed', sqlerrm;
end $$;
