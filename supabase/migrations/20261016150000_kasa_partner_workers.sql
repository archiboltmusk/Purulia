-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — partner workflow, phase 2: workers, assignment, timeline.
--
-- Workers are signed-in accounts added by a moderator (who checks the firm
-- or worker against the municipality's order). A worker sees only the orders
-- assigned to them and can start and complete them. Worker work photos
-- (live camera + GPS, offline upload) are NOT here yet.
--
-- The board now carries each order's event timeline (state, time, public
-- note) so the UI can draw a tracking-style history. No actor ids, no phones.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.partner_workers (
  user_id     uuid primary key,
  firm_label  text not null check (length(firm_label) between 2 and 120),
  phone       text check (phone is null or length(phone) <= 20),
  active      boolean not null default true,
  added_by    uuid,
  created_at  timestamptz not null default now()
);

alter table kasa_private.partner_orders add column if not exists worker_id uuid;

-- Moderator adds a worker account to a firm label.
create or replace function public.kasa_admin_partner_add_worker(p_user uuid, p_firm text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_firm text := nullif(left(trim(coalesce(p_firm, '')), 120), '');
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 20), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_user is null then perform kasa_private.fail('KASA_BAD_FORM', 'Give the worker account id.'); end if;
  if v_firm is null or length(v_firm) < 2 then perform kasa_private.fail('KASA_BAD_FORM', 'Give the firm name as on the order.'); end if;
  insert into kasa_private.partner_workers (user_id, firm_label, phone, added_by)
  values (p_user, v_firm, v_phone, auth.uid())
  on conflict (user_id) do update set firm_label = excluded.firm_label, phone = excluded.phone, active = true;
  return jsonb_build_object('ok', true);
end $$;

-- Moderator assigns an approved order to a worker account.
create or replace function public.kasa_admin_partner_assign(p_order bigint, p_worker uuid, p_order_no text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o kasa_private.partner_orders%rowtype;
  w kasa_private.partner_workers%rowtype;
  v_no text := nullif(left(trim(coalesce(p_order_no, '')), 60), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into o from kasa_private.partner_orders where id = p_order for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such work order.'); end if;
  if o.state <> 'approved' then perform kasa_private.fail('KASA_BAD_STATE', 'Only an approved order can be assigned.'); end if;
  if v_no is null then perform kasa_private.fail('KASA_BAD_FORM', 'Give the municipality work order number.'); end if;
  select * into w from kasa_private.partner_workers where user_id = p_worker and active;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That worker account is not active.'); end if;
  update kasa_private.partner_orders
    set state = 'assigned', worker_id = p_worker, firm_label = w.firm_label, order_no = v_no, updated_at = now()
    where id = p_order;
  perform kasa_private.partner_log(p_order, 'approved', 'assigned', 'Assigned to ' || w.firm_label || ', order ' || v_no);
  return jsonb_build_object('ok', true);
end $$;

-- Worker: my orders (assigned to me, not yet closed).
create or replace function public.kasa_partner_my_orders()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from kasa_private.partner_workers where user_id = auth.uid() and active) then
    perform kasa_private.fail('KASA_NOT_WORKER', 'This account is not a registered partner worker.');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_id', po.id, 'report_id', po.report_id, 'office', po.office_key, 'state', po.state,
      'sla_due', po.sla_due, 'order_no', po.order_no, 'firm', po.firm_label, 'updated_at', po.updated_at)
      order by po.sla_due nulls last)
    from kasa_private.partner_orders po
    where po.worker_id = auth.uid() and po.state in ('assigned', 'in_progress', 'completed')
  ), '[]'::jsonb);
end $$;

-- Worker: start or complete my own order. Completion goes to the officer for sign-off.
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
    update kasa_private.partner_orders set state = 'completed', updated_at = now() where id = p_order;
    v_to := 'completed';
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Start or complete.');
  end if;
  perform kasa_private.partner_log(p_order, o.state, v_to, coalesce(v_note, case when p_action = 'complete' then 'Worker marked complete' else 'Worker started' end));
  return jsonb_build_object('ok', true, 'state', v_to);
end $$;

-- Public board, now with each order's timeline (state, time, public note).
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
      'timeline', coalesce((select jsonb_agg(jsonb_build_object('to', e.to_state, 'at', e.created_at, 'note', e.note) order by e.id)
                            from kasa_private.partner_order_events e where e.order_id = o.id), '[]'::jsonb)
    )) from o), '[]'::jsonb)
);
$$;

revoke all on function public.kasa_admin_partner_add_worker(uuid, text, text) from public;
revoke all on function public.kasa_admin_partner_assign(bigint, uuid, text) from public;
revoke all on function public.kasa_partner_my_orders() from public;
revoke all on function public.kasa_partner_worker_step(bigint, text, text) from public;
grant execute on function public.kasa_admin_partner_add_worker(uuid, text, text) to authenticated;
grant execute on function public.kasa_admin_partner_assign(bigint, uuid, text) to authenticated;
grant execute on function public.kasa_partner_my_orders() to authenticated;
grant execute on function public.kasa_partner_worker_step(bigint, text, text) to authenticated;
grant execute on function public.kasa_partner_board() to anon, authenticated;

commit;
