-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — municipal partner workflow, phase 1 (server side only).
--
-- One work order per report. States:
--   approved -> assigned -> in_progress -> completed -> verified -> paid
--   approved -> rejected (report not actionable by this body)
--   completed -> in_progress (sent back by the officer)
-- verified needs BOTH the officer sign-off (signed_off_at) AND a verified
-- report (existing citizen verify path, kasa_private.report_is_verified).
-- paid only records the municipality's own payment reference. No money moves.
--
-- Phase 1 stand-in for the municipality officer: moderators (is_admin).
-- Partner officer accounts and worker photos (live camera + GPS) come later.
-- Append-only event log in kasa_private.partner_order_events.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.partner_orders (
  id            bigint generated always as identity primary key,
  report_id     uuid not null references public.reports(id) on delete restrict,
  office_key    text not null check (length(office_key) between 1 and 80),
  state         text not null default 'approved'
                check (state in ('approved', 'assigned', 'in_progress', 'completed', 'verified', 'paid', 'rejected')),
  sla_due       timestamptz,
  firm_label    text check (firm_label is null or length(firm_label) <= 120),
  order_no      text check (order_no is null or length(order_no) <= 60),
  signed_off_at timestamptz,
  payment_ref   text check (payment_ref is null or length(payment_ref) <= 120),
  paid_on       date,
  approved_by   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One live order per report; a rejected or paid order does not block a new one.
create unique index if not exists kasa_partner_orders_live_idx
  on kasa_private.partner_orders (report_id) where state not in ('rejected', 'paid');

create table if not exists kasa_private.partner_order_events (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references kasa_private.partner_orders(id) on delete restrict,
  from_state  text,
  to_state    text not null,
  actor       uuid,
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists kasa_partner_events_order_idx on kasa_private.partner_order_events (order_id, id);

create or replace function kasa_private.partner_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'partner_order_events is append-only';
end $$;

drop trigger if exists partner_events_no_change on kasa_private.partner_order_events;
create trigger partner_events_no_change
  before update or delete on kasa_private.partner_order_events
  for each row execute function kasa_private.partner_events_append_only();

-- Writes one event row for a state change.
create or replace function kasa_private.partner_log(p_order bigint, p_from text, p_to text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into kasa_private.partner_order_events (order_id, from_state, to_state, actor, note)
  values (p_order, p_from, p_to, auth.uid(), nullif(left(trim(coalesce(p_note, '')), 500), ''));
$$;

-- Moves a completed, signed-off order to verified once the report is verified.
create or replace function kasa_private.partner_try_verify(p_order bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o kasa_private.partner_orders%rowtype;
  r public.reports%rowtype;
begin
  select * into o from kasa_private.partner_orders where id = p_order for update;
  if not found or o.state <> 'completed' or o.signed_off_at is null then return; end if;
  select * into r from public.reports where id = o.report_id;
  if not found or not kasa_private.report_is_verified(r) then return; end if;
  update kasa_private.partner_orders set state = 'verified', updated_at = now() where id = p_order;
  perform kasa_private.partner_log(p_order, 'completed', 'verified', 'Officer sign-off and citizen verification on record');
end $$;

-- Moderator stand-in for the officer: approve a report for work by a body.
create or replace function public.kasa_admin_partner_approve(p_report uuid, p_office text, p_sla_days integer default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_office text := nullif(trim(coalesce(p_office, '')), '');
  v_id bigint;
  v_status text;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if v_office is null then perform kasa_private.fail('KASA_BAD_FORM', 'Name the office that will do the work.'); end if;
  if p_sla_days is null or p_sla_days < 1 or p_sla_days > 90 then
    perform kasa_private.fail('KASA_BAD_FORM', 'SLA must be 1 to 90 days.');
  end if;
  select status into v_status from public.reports where id = p_report;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such report.'); end if;
  if v_status = 'resolved' then perform kasa_private.fail('KASA_BAD_STATE', 'That report is already resolved.'); end if;

  insert into kasa_private.partner_orders (report_id, office_key, state, sla_due, approved_by)
  values (p_report, v_office, 'approved', now() + make_interval(days => p_sla_days), auth.uid())
  returning id into v_id;
  perform kasa_private.partner_log(v_id, null, 'approved', 'Approved for work by ' || v_office);
  return jsonb_build_object('ok', true, 'order_id', v_id);
exception when unique_violation then
  perform kasa_private.fail('KASA_ALREADY_ORDERED', 'This report already has a live work order.');
end $$;

-- Moves an order one step. Actions: assign, start, complete, signoff,
-- send_back, reject, sync (re-check verification), pay.
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
    if o.state <> 'completed' then perform kasa_private.fail('KASA_BAD_STATE', 'Only a completed order can be signed off.'); end if;
    update kasa_private.partner_orders set signed_off_at = now(), updated_at = now() where id = p_order;
    perform kasa_private.partner_log(p_order, 'completed', 'completed', 'Officer sign-off given');
    perform kasa_private.partner_try_verify(p_order);
    return jsonb_build_object('ok', true);
  elsif p_action = 'send_back' then
    if o.state <> 'completed' then perform kasa_private.fail('KASA_BAD_STATE', 'Only a completed order can be sent back.'); end if;
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

-- Public board: counts and dates, firm name only. No worker names or phones.
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
      'paid_on', o.paid_on, 'updated_at', o.updated_at)) from o), '[]'::jsonb)
);
$$;

revoke all on function public.kasa_admin_partner_approve(uuid, text, integer) from public;
revoke all on function public.kasa_admin_partner_step(bigint, text, text, text, text) from public;
grant execute on function public.kasa_admin_partner_approve(uuid, text, integer) to authenticated;
grant execute on function public.kasa_admin_partner_step(bigint, text, text, text, text) to authenticated;
grant execute on function public.kasa_partner_board() to anon, authenticated;

commit;
