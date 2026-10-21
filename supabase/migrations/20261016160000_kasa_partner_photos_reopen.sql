-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — partner workflow, phase 3: work photos and reopen.
--
-- Work photo: a worker takes it on site with the live camera (one-time
-- capture token, same as citizen photos), with GPS within
-- report_max_accuracy_m and within partner_site_radius_m of the reported
-- spot, and a photo time inside partner_photo_max_age_hours. Completing the
-- work needs at least one such photo. The officer must approve one before
-- sign-off.
--
-- Reopen: anyone may reopen a closed order (verified or paid) with a reason.
-- It returns to the officer as 'reopened'; the officer signs off again,
-- sends it back, or re-checks. Rate-limited per network.
--
-- Photo files: partner/<id>.jpg in the kasa-photos bucket. Check the storage
-- insert policy allows this prefix before the worker page goes live.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('partner_site_radius_m', '150', 'A work photo must be taken within this many metres of the reported spot'),
  ('partner_photo_max_age_hours', '24', 'A work photo must be taken within this many hours before it is recorded')
on conflict (key) do nothing;

alter table kasa_private.partner_orders drop constraint if exists partner_orders_state_check;
alter table kasa_private.partner_orders add constraint partner_orders_state_check
  check (state in ('approved', 'assigned', 'in_progress', 'completed', 'verified', 'paid', 'rejected', 'reopened'));

create table if not exists kasa_private.partner_work_photos (
  id              bigint generated always as identity primary key,
  order_id        bigint not null references kasa_private.partner_orders(id) on delete restrict,
  photo_path      text not null unique check (photo_path ~ '^partner/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$'),
  taken_at        timestamptz not null,
  lat             double precision not null,
  lng             double precision not null,
  accuracy_m      double precision not null,
  site_distance_m double precision not null,
  uploaded_by     uuid not null,
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  approved_by     uuid,
  rejected_at     timestamptz,
  reject_note     text check (reject_note is null or length(reject_note) <= 500)
);
create index if not exists partner_work_photos_order_idx on kasa_private.partner_work_photos (order_id);
alter table kasa_private.partner_work_photos enable row level security;
revoke all on kasa_private.partner_work_photos from public, anon, authenticated;

-- Worker: record a live work photo taken on site.
create or replace function public.kasa_partner_add_work_photo(p_order bigint, p_path text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o kasa_private.partner_orders%rowtype;
  r public.reports%rowtype;
  v_owner text;
  v_taken timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  v_token uuid;
  v_dist double precision;
  v_id bigint;
begin
  if not exists (select 1 from kasa_private.partner_workers where user_id = auth.uid() and active) then
    perform kasa_private.fail('KASA_NOT_WORKER', 'This account is not a registered partner worker.');
  end if;
  select * into o from kasa_private.partner_orders where id = p_order and worker_id = auth.uid() for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such order is assigned to you.'); end if;
  if o.state <> 'in_progress' then
    perform kasa_private.fail('KASA_BAD_STATE', 'Work photos are taken while the work is in progress.');
  end if;
  if p_path is null or p_path !~ '^partner/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$' then
    perform kasa_private.fail('KASA_PHOTO_INVALID', 'A work photo is required.');
  end if;
  select coalesce(ob.owner_id::text, ob.owner::text) into v_owner
  from storage.objects ob where ob.bucket_id = 'kasa-photos' and ob.name = p_path;
  if not found then perform kasa_private.fail('KASA_PHOTO_MISSING', 'Upload the photo first.'); end if;
  if v_owner is distinct from auth.uid()::text then
    perform kasa_private.fail('KASA_PHOTO_NOT_YOURS', 'You can only submit photos you uploaded.');
  end if;
  if exists (select 1 from kasa_private.partner_work_photos where photo_path = p_path) then
    return jsonb_build_object('recorded', false);
  end if;

  begin v_taken := (p_meta ->> 'taken_at')::timestamptz; exception when others then v_taken := null; end;
  if v_taken is null
     or v_taken < now() - make_interval(hours => kasa_private.cfg_num('partner_photo_max_age_hours')::integer)
     or v_taken > now() + interval '5 minutes' then
    perform kasa_private.fail('KASA_PHOTO_TIME', 'The photo time is missing or too old. Take a new photo.');
  end if;

  begin
    v_lat := (p_meta ->> 'lat')::double precision;
    v_lng := (p_meta ->> 'lng')::double precision;
    v_acc := (p_meta ->> 'accuracy')::double precision;
  exception when others then v_lat := null; v_lng := null; v_acc := null;
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
     or (v_lat = 0 and v_lng = 0) then
    perform kasa_private.fail('KASA_NO_GPS', 'Live GPS is needed for a work photo.');
  end if;
  if v_acc is null or v_acc <= 0 or v_acc > kasa_private.cfg_num('report_max_accuracy_m') then
    perform kasa_private.fail('KASA_NO_GPS', 'GPS is too weak. Move to open sky and take the photo again.');
  end if;

  select * into r from public.reports where id = o.report_id;
  v_dist := 2 * 6371000 * asin(sqrt(
    power(sin(radians(v_lat - r.lat) / 2), 2) +
    cos(radians(r.lat)) * cos(radians(v_lat)) * power(sin(radians(v_lng - r.lng) / 2), 2)));
  if v_dist > kasa_private.cfg_num('partner_site_radius_m') then
    perform kasa_private.fail('KASA_NOT_ON_SITE', 'You are not at the reported spot.');
  end if;

  -- "live" needs an unspent camera token of this account; spending it makes it one-time.
  begin v_token := (p_meta ->> 'capture_token')::uuid; exception when others then v_token := null; end;
  if v_token is null or p_meta ->> 'capture' is distinct from 'live' then
    perform kasa_private.fail('KASA_NOT_LIVE', 'Take the photo with the live camera.');
  end if;
  update kasa_private.capture_tokens set used_at = now(), photo_path = p_path
  where token = v_token and user_id = auth.uid() and used_at is null
    and issued_at > now() - make_interval(mins => kasa_private.cfg_num('capture_token_minutes')::integer);
  if not found then perform kasa_private.fail('KASA_NOT_LIVE', 'Open the camera again to take the photo.'); end if;

  insert into kasa_private.partner_work_photos
    (order_id, photo_path, taken_at, lat, lng, accuracy_m, site_distance_m, uploaded_by)
  values (p_order, p_path, v_taken, v_lat, v_lng, v_acc, v_dist, auth.uid())
  returning id into v_id;
  perform kasa_private.partner_log(p_order, o.state, o.state, 'Work photo taken on site');
  return jsonb_build_object('recorded', true, 'photo_id', v_id);
end $$;

-- Officer (moderator stand-in): approve or reject a work photo.
create or replace function public.kasa_admin_partner_photo_review(p_photo bigint, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p kasa_private.partner_work_photos%rowtype;
  o kasa_private.partner_orders%rowtype;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into p from kasa_private.partner_work_photos where id = p_photo for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such work photo.'); end if;
  select * into o from kasa_private.partner_orders where id = p.order_id;
  if o.state not in ('in_progress', 'completed', 'reopened') then
    perform kasa_private.fail('KASA_BAD_STATE', 'Photos can be reviewed while the order is open.');
  end if;
  if p_decision = 'approve' then
    update kasa_private.partner_work_photos set approved_at = now(), approved_by = auth.uid() where id = p_photo;
    perform kasa_private.partner_log(o.id, o.state, o.state, 'Work photo approved on site by the officer');
  elsif p_decision = 'reject' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.partner_work_photos set rejected_at = now(), reject_note = v_note where id = p_photo;
    perform kasa_private.partner_log(o.id, o.state, o.state, 'Work photo rejected: ' || v_note);
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Approve or reject.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Worker: start or complete my own order. Complete needs at least one work photo.
create or replace function public.kasa_partner_worker_step(p_order bigint, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o kasa_private.partner_orders%rowtype;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
  v_to text;
begin
  if not exists (select 1 from kasa_private.partner_workers where user_id = auth.uid() and active) then
    perform kasa_private.fail('KASA_NOT_WORKER', 'This account is not a registered partner worker.');
  end if;
  select * into o from kasa_private.partner_orders where id = p_order and worker_id = auth.uid() for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such order is assigned to you.'); end if;

  if p_action = 'start' then
    if o.state <> 'assigned' then perform kasa_private.fail('KASA_BAD_STATE', 'Only an assigned order can start.'); end if;
    update kasa_private.partner_orders set state = 'in_progress', updated_at = now() where id = p_order;
    v_to := 'in_progress';
  elsif p_action = 'complete' then
    if o.state <> 'in_progress' then perform kasa_private.fail('KASA_BAD_STATE', 'Only work in progress can be marked complete.'); end if;
    if not exists (select 1 from kasa_private.partner_work_photos where order_id = p_order) then
      perform kasa_private.fail('KASA_NEEDS_PHOTO', 'Take the work photo on site before you mark it complete.');
    end if;
    update kasa_private.partner_orders set state = 'completed', updated_at = now() where id = p_order;
    v_to := 'completed';
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Start or complete.');
  end if;
  perform kasa_private.partner_log(p_order, o.state, v_to, coalesce(v_note, case when p_action = 'complete' then 'Worker marked complete' else 'Worker started' end));
  return jsonb_build_object('ok', true, 'state', v_to);
end $$;

-- Moderator stand-in for the officer. Sign-off needs an approved work photo.
create or replace function public.kasa_admin_partner_step(
  p_order bigint, p_action text,
  p_firm text default null, p_order_no text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o kasa_private.partner_orders%rowtype;
  v_firm text := nullif(left(trim(coalesce(p_firm, '')), 120), '');
  v_no text := nullif(left(trim(coalesce(p_order_no, '')), 60), '');
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
  v_to text;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into o from kasa_private.partner_orders where id = p_order for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such work order.'); end if;

  if p_action = 'assign' then
    if o.state <> 'approved' then perform kasa_private.fail('KASA_BAD_STATE', 'Only an approved order can be assigned.'); end if;
    if v_firm is null or v_no is null then perform kasa_private.fail('KASA_BAD_FORM', 'Give the firm and the order number.'); end if;
    update kasa_private.partner_orders set state = 'assigned', firm_label = v_firm, order_no = v_no, updated_at = now() where id = p_order;
    v_to := 'assigned';
  elsif p_action = 'start' then
    if o.state <> 'assigned' then perform kasa_private.fail('KASA_BAD_STATE', 'Only an assigned order can start.'); end if;
    update kasa_private.partner_orders set state = 'in_progress', updated_at = now() where id = p_order;
    v_to := 'in_progress';
  elsif p_action = 'complete' then
    if o.state <> 'in_progress' then perform kasa_private.fail('KASA_BAD_STATE', 'Only work in progress can be marked complete.'); end if;
    update kasa_private.partner_orders set state = 'completed', updated_at = now() where id = p_order;
    v_to := 'completed';
  elsif p_action = 'signoff' then
    if o.state not in ('completed', 'reopened') then
      perform kasa_private.fail('KASA_BAD_STATE', 'Only a completed or reopened order can be signed off.');
    end if;
    if not exists (select 1 from kasa_private.partner_work_photos where order_id = p_order and approved_at is not null) then
      perform kasa_private.fail('KASA_NEEDS_PHOTO', 'Approve a work photo on site before sign-off.');
    end if;
    update kasa_private.partner_orders set state = 'completed', signed_off_at = now(), updated_at = now() where id = p_order;
    perform kasa_private.partner_log(p_order, o.state, 'completed', 'Officer sign-off given');
    perform kasa_private.partner_try_verify(p_order);
    return jsonb_build_object('ok', true);
  elsif p_action = 'send_back' then
    if o.state not in ('completed', 'reopened') then
      perform kasa_private.fail('KASA_BAD_STATE', 'Only a completed or reopened order can be sent back.');
    end if;
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.partner_orders set state = 'in_progress', signed_off_at = null, updated_at = now() where id = p_order;
    v_to := 'in_progress';
  elsif p_action = 'reject' then
    if o.state <> 'approved' then perform kasa_private.fail('KASA_BAD_STATE', 'Only an approved order can be rejected here.'); end if;
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.partner_orders set state = 'rejected', updated_at = now() where id = p_order;
    v_to := 'rejected';
  elsif p_action = 'sync' then
    perform kasa_private.partner_try_verify(p_order);
    return jsonb_build_object('ok', true);
  elsif p_action = 'pay' then
    if o.state <> 'verified' then perform kasa_private.fail('KASA_BAD_STATE', 'Only a verified order can record payment.'); end if;
    if v_no is null then perform kasa_private.fail('KASA_BAD_FORM', 'Give the municipality payment reference.'); end if;
    update kasa_private.partner_orders set state = 'paid', payment_ref = v_no, paid_on = current_date, updated_at = now() where id = p_order;
    v_to := 'paid';
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown step.');
  end if;

  perform kasa_private.partner_log(p_order, o.state, v_to, coalesce(v_note, case when p_action = 'pay' then 'Municipality payment reference recorded (no money moved by Parishkar)' end));
  return jsonb_build_object('ok', true, 'state', v_to);
end $$;

-- Anyone may reopen a closed order with a reason. It goes back to the officer.
create or replace function public.kasa_partner_reopen(p_order bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o kasa_private.partner_orders%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  perform kasa_private.net_limit('partner_reopen', 5, 20, 'Too many reopen requests from this network. Try again later.');
  if v_reason is null or length(v_reason) < 10 then
    perform kasa_private.fail('KASA_REASON_NEEDED', 'Say why in a sentence or two.');
  end if;
  select * into o from kasa_private.partner_orders where id = p_order for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such work order.'); end if;
  if o.state not in ('verified', 'paid') then
    perform kasa_private.fail('KASA_BAD_STATE', 'Only a closed order can be reopened.');
  end if;
  if exists (select 1 from kasa_private.partner_orders
             where report_id = o.report_id and id <> o.id and state not in ('rejected', 'paid')) then
    perform kasa_private.fail('KASA_ALREADY_ORDERED', 'This report already has a live work order.');
  end if;
  update kasa_private.partner_orders set state = 'reopened', signed_off_at = null, updated_at = now() where id = p_order;
  perform kasa_private.partner_log(p_order, o.state, 'reopened', 'Reopened: ' || v_reason);
  return jsonb_build_object('ok', true, 'state', 'reopened');
end $$;

-- Public board: adds photo counts per order (no photo paths, no worker ids).
create or replace function public.kasa_partner_board() returns jsonb
language sql stable security definer set search_path = '' as $$
with o as (
  select po.id, po.report_id, po.office_key, po.state, po.sla_due, po.firm_label, po.order_no,
         po.signed_off_at, po.paid_on, po.updated_at
  from kasa_private.partner_orders po
  order by po.updated_at desc
  limit 200
)
select jsonb_build_object(
  'counts', coalesce((select jsonb_object_agg(state, n) from (select state, count(*) n from kasa_private.partner_orders group by state) s), '{}'::jsonb),
  'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'report_id', o.report_id, 'office', o.office_key, 'state', o.state,
      'sla_due', o.sla_due, 'overdue', (o.sla_due is not null and o.sla_due < now() and o.state not in ('verified', 'paid', 'rejected')),
      'firm', o.firm_label, 'order_no', o.order_no, 'signed_off', o.signed_off_at is not null,
      'paid_on', o.paid_on, 'updated_at', o.updated_at,
      'photos', (select count(*) from kasa_private.partner_work_photos wp where wp.order_id = o.id),
      'photos_approved', (select count(*) from kasa_private.partner_work_photos wp where wp.order_id = o.id and wp.approved_at is not null),
      'timeline', coalesce((select jsonb_agg(jsonb_build_object('to', e.to_state, 'at', e.created_at, 'note', e.note) order by e.id)
                            from kasa_private.partner_order_events e where e.order_id = o.id), '[]'::jsonb)
    )) from o), '[]'::jsonb)
);
$$;

revoke all on function public.kasa_partner_add_work_photo(bigint, text, jsonb) from public;
revoke all on function public.kasa_admin_partner_photo_review(bigint, text, text) from public;
revoke all on function public.kasa_partner_reopen(bigint, text) from public;
grant execute on function public.kasa_partner_add_work_photo(bigint, text, jsonb) to authenticated;
grant execute on function public.kasa_admin_partner_photo_review(bigint, text, text) to authenticated;
grant execute on function public.kasa_partner_reopen(bigint, text) to anon, authenticated;

commit;
