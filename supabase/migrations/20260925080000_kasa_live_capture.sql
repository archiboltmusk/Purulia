-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — live-camera tokens for photos
--
-- The page asks for a one-time token when it opens the camera. The token
-- is spent when the photo's metadata is recorded (kasa_photo_meta). A photo
-- counts as "live" only with an unspent token of the same account issued
-- within capture_token_minutes; the page's own "live" label is no longer
-- trusted on its own.
--
-- With require_live_report_photo on, a report whose photo isn't live (sent
-- through the API with an old photo, or queued offline until the token
-- lapsed) goes to a moderator instead of straight onto the map. Cleanup
-- evidence keeps its existing rule (require_live_capture).
--
-- A token only proves timing, not the pixels: it shows the photo arrived
-- soon after this account opened the camera. Reused photos are still caught
-- by the fingerprint check, and confirmers on the spot remain the defence.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('capture_token_minutes', '30', 'A camera token is valid for this many minutes after the camera opens'),
  ('capture_tokens_per_hour', '30', 'Camera tokens one account can get per hour'),
  ('require_live_report_photo', 'true', 'Reports whose photo has no valid camera token wait for a moderator')
on conflict (key) do nothing;

create table if not exists kasa_private.capture_tokens (
  token      uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  issued_at  timestamptz not null default now(),
  used_at    timestamptz,
  photo_path text
);
create index if not exists capture_tokens_user_idx on kasa_private.capture_tokens (user_id, issued_at desc);
alter table kasa_private.capture_tokens enable row level security;
revoke all on kasa_private.capture_tokens from public, anon, authenticated;

create or replace function public.kasa_issue_capture_token() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me      kasa_private.profiles := kasa_private.me();
  v_token uuid;
begin
  if (select count(*) from kasa_private.capture_tokens
      where user_id = me.user_id and issued_at > now() - interval '1 hour') >= kasa_private.cfg_num('capture_tokens_per_hour') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You opened the camera many times. Try again later.');
  end if;
  delete from kasa_private.capture_tokens where issued_at < now() - interval '2 days';
  insert into kasa_private.capture_tokens (user_id) values (me.user_id) returning token into v_token;
  return v_token;
end $$;

create or replace function public.kasa_photo_meta(p_path text, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me        kasa_private.profiles := kasa_private.me();
  v_owner   text;
  v_taken   timestamptz;
  v_lat     double precision;
  v_lng     double precision;
  v_token   uuid;
  v_capture text := 'file';
begin
  if p_path is null or p_path !~ '^(reports|claims|votes)/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$' then
    perform kasa_private.fail('KASA_PHOTO_INVALID', 'A photo is required.');
  end if;
  select coalesce(o.owner_id::text, o.owner::text) into v_owner
  from storage.objects o where o.bucket_id = 'kasa-photos' and o.name = p_path;
  if not found then perform kasa_private.fail('KASA_PHOTO_MISSING', 'Upload the photo first.'); end if;
  if v_owner is distinct from me.user_id::text then
    perform kasa_private.fail('KASA_PHOTO_NOT_YOURS', 'You can only submit photos you uploaded.');
  end if;
  if exists (select 1 from kasa_private.photo_meta where photo_path = p_path) then
    return jsonb_build_object('recorded', false);
  end if;

  begin v_taken := (p_meta ->> 'taken_at')::timestamptz; exception when others then v_taken := null; end;
  begin
    v_lat := (p_meta ->> 'lat')::double precision;
    v_lng := (p_meta ->> 'lng')::double precision;
  exception when others then v_lat := null; v_lng := null;
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
     or (v_lat = 0 and v_lng = 0) then
    v_lat := null; v_lng := null;
  end if;

  -- "live" needs an unspent camera token of this account; spending it here makes it one-time.
  begin v_token := (p_meta ->> 'capture_token')::uuid; exception when others then v_token := null; end;
  if v_token is not null and p_meta ->> 'capture' = 'live' then
    update kasa_private.capture_tokens set used_at = now(), photo_path = p_path
    where token = v_token and user_id = me.user_id and used_at is null
      and issued_at > now() - make_interval(mins => kasa_private.cfg_num('capture_token_minutes')::integer);
    if found then v_capture := 'live'; end if;
  end if;

  insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_lat, exif_lng, ai_marker)
  values (p_path, me.user_id, v_capture, v_taken, v_lat, v_lng,
          nullif(left(trim(coalesce(p_meta ->> 'ai_marker', '')), 80), ''))
  on conflict (photo_path) do nothing;
  return jsonb_build_object('recorded', found, 'capture', v_capture);
end $$;

-- kasa_create_report: a report photo without a valid camera token waits for a moderator.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.kasa_create_report(text,text,double precision,double precision,double precision,integer,text,text,text,text)'::regprocedure);
  if position('require_live_report_photo' in v_def) = 0 then
    v_def := replace(v_def,
      'or coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> ''ai_edited'')::boolean, false) then',
      'or coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> ''ai_edited'')::boolean, false)
     or (kasa_private.cfg_bool(''require_live_report_photo'') and coalesce(v_meta ->> ''capture'', ''unknown'') <> ''live'') then');
    if position('require_live_report_photo' in v_def) = 0 then raise exception 'kasa_create_report: live rule not patched'; end if;
    execute v_def;
  end if;
end $do$;

revoke all on function public.kasa_issue_capture_token() from public, anon, authenticated;
grant execute on function public.kasa_issue_capture_token() to authenticated;
revoke all on function public.kasa_photo_meta(text, jsonb) from public, anon, authenticated;
grant execute on function public.kasa_photo_meta(text, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
