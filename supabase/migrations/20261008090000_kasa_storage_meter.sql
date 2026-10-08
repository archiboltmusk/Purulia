-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — storage meter, and when to move report photos to Cloudflare R2
--
-- Moving photos to R2 was looked at on 28 Sep 2026 and put off: photos were a few MB of the
-- free plan's 1 GB of file storage (Supabase free plan: 500 MB database, 1 GB file storage,
-- https://supabase.com/pricing). It pays off only once photos near the limit. This adds:
--   * kasa_admin_storage_usage(): photos (count, MB) and database size against those limits,
--     shown in admin;
--   * the daily moderator email (kasa-queue-alert) also says so once photos pass
--     r2_photo_threshold_mb (700 MB), so the move happens when it is needed, not before.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('r2_photo_threshold_mb', '700', 'Report photos past this many MB: time to move new photos to Cloudflare R2'),
  ('storage_limit_mb', '1024', 'File storage on the Supabase plan (free: 1 GB)'),
  ('db_limit_mb', '500', 'Database size on the Supabase plan (free: 500 MB)')
on conflict (key) do nothing;

create or replace function kasa_private.photo_usage() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'photos', count(*),
    'photos_mb', round(coalesce(sum((o.metadata ->> 'size')::numeric), 0) / 1048576, 1))
  from storage.objects o where o.bucket_id = 'kasa-photos'
$$;
revoke all on function kasa_private.photo_usage() from public, anon, authenticated;

create or replace function public.kasa_admin_storage_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return kasa_private.photo_usage() || jsonb_build_object(
    'db_mb', round(pg_database_size(current_database())::numeric / 1048576, 1),
    'storage_limit_mb', kasa_private.cfg_num('storage_limit_mb'),
    'db_limit_mb', kasa_private.cfg_num('db_limit_mb'),
    'r2_threshold_mb', kasa_private.cfg_num('r2_photo_threshold_mb'));
end $$;
revoke all on function public.kasa_admin_storage_usage() from public, anon;
grant execute on function public.kasa_admin_storage_usage() to authenticated;

-- Photos past the threshold, as one line for the daily email; empty when below it.
create or replace function kasa_private.storage_alert() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when (u ->> 'photos_mb')::numeric >= kasa_private.cfg_num('r2_photo_threshold_mb')
    then jsonb_build_object('photos_mb', u -> 'photos_mb', 'threshold_mb', kasa_private.cfg_num('r2_photo_threshold_mb'),
                            'limit_mb', kasa_private.cfg_num('storage_limit_mb'))
    else '{}'::jsonb end
  from kasa_private.photo_usage() u
$$;
revoke all on function kasa_private.storage_alert() from public, anon, authenticated;

create or replace function public.kasa_queue_alert_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_items jsonb := kasa_private.queue_backlog();
  v_store jsonb := kasa_private.storage_alert();
begin
  if v_items = '{}'::jsonb and v_store = '{}'::jsonb then
    return jsonb_build_object('day', v_day, 'items', v_items, 'storage', v_store, 'to', '[]'::jsonb);
  end if;
  insert into kasa_private.queue_alert_log as l (day, claimed_at, items) values (v_day, now(), v_items || jsonb_build_object('storage', v_store))
  on conflict (day) do update set claimed_at = now(), items = excluded.items, error = null
    where l.sent_at is null and l.claimed_at <= now() - interval '30 minutes';
  if not found then return jsonb_build_object('day', v_day, 'items', '{}'::jsonb, 'storage', '{}'::jsonb, 'to', '[]'::jsonb); end if;
  return jsonb_build_object('day', v_day, 'items', v_items, 'storage', v_store,
    'to', coalesce((select jsonb_agg(distinct u.email) from public.admins a join auth.users u on u.id = a.user_id
                    where u.email is not null), '[]'::jsonb));
end $$;
revoke all on function public.kasa_queue_alert_claim() from public, anon, authenticated;
grant execute on function public.kasa_queue_alert_claim() to service_role;

commit;

notify pgrst, 'reload schema';
