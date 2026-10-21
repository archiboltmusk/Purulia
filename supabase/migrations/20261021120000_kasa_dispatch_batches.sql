-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — municipal dispatch, phase 1 (server side only).
--
-- Batch dispatch: two fixed batches a day per office (am = overnight reports,
-- pm = morning reports). Supervisor triages each approved work order (machine,
-- band, or out-of-jurisdiction), then puts triaged orders into a batch in the
-- order the supervisor chose. The batch is read back as an ordered list of stops.
-- No routing engine. Ordering is the supervisor's choice; the page builds the
-- map link (design: research/municipal-dispatch-design-2026-10-16.md).
--
-- Rules enforced here:
--   * an order must be triaged (machine + band) before it joins a batch;
--   * out_of_jurisdiction orders never join a batch (they go to the grievance route);
--   * an order is in at most one open batch at a time;
--   * a batch holds at most 10 stops (one Google Maps link carries 10 waypoints);
--   * closed batches are never edited.
-- Phase 1 stand-in for the supervisor: moderators (is_admin), as partner_orders does.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.dispatch_triage (
  order_id   bigint primary key references kasa_private.partner_orders(id) on delete restrict,
  status     text not null default 'triaged'
             check (status in ('triaged', 'out_of_jurisdiction')),
  machine    text check (machine is null or machine in ('manual_loader', 'mini_tipper', 'tractor', 'backhoe_loader')),
  band       text check (band is null or band in ('small', 'medium', 'large')),
  note       text check (note is null or length(note) <= 500),
  source_url text check (source_url is null or source_url like 'https://%'),
  triaged_by uuid,
  triaged_at timestamptz not null default now(),
  check (status = 'out_of_jurisdiction' or (machine is not null and band is not null)),
  check (status = 'triaged' or (note is not null or source_url is not null))
);

create table if not exists kasa_private.dispatch_batches (
  id          bigint generated always as identity primary key,
  office_key  text not null check (length(office_key) between 1 and 80),
  batch_date  date not null,
  slot        text not null check (slot in ('am', 'pm')),
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (office_key, batch_date, slot)
);

create table if not exists kasa_private.dispatch_batch_stops (
  batch_id bigint not null references kasa_private.dispatch_batches(id) on delete restrict,
  order_id bigint not null references kasa_private.partner_orders(id) on delete restrict,
  seq      integer not null check (seq between 1 and 10),
  primary key (batch_id, order_id),
  unique (batch_id, seq)
);

-- Supervisor triage for one order. Idempotent: triaging again replaces the earlier pick.
create or replace function public.kasa_admin_dispatch_triage(
  p_order bigint, p_status text, p_machine text default null, p_band text default null,
  p_note text default null, p_source_url text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o kasa_private.partner_orders%rowtype;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
  v_src text := nullif(trim(coalesce(p_source_url, '')), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into o from kasa_private.partner_orders where id = p_order;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such work order.'); end if;
  if o.state not in ('approved', 'assigned') then
    perform kasa_private.fail('KASA_BAD_STATE', 'Only approved or assigned orders are triaged.');
  end if;
  if p_status = 'triaged' then
    if p_machine is null or p_band is null then
      perform kasa_private.fail('KASA_BAD_FORM', 'Pick a machine and a band.');
    end if;
    insert into kasa_private.dispatch_triage (order_id, status, machine, band, note, source_url, triaged_by, triaged_at)
    values (p_order, 'triaged', p_machine, p_band, v_note, v_src, auth.uid(), now())
    on conflict (order_id) do update set status = 'triaged', machine = excluded.machine, band = excluded.band,
      note = excluded.note, source_url = excluded.source_url, triaged_by = excluded.triaged_by, triaged_at = now();
  elsif p_status = 'out_of_jurisdiction' then
    if v_note is null and v_src is null then
      perform kasa_private.fail('KASA_BAD_FORM', 'Say whose land or road it is: a note or a source link.');
    end if;
    insert into kasa_private.dispatch_triage (order_id, status, machine, band, note, source_url, triaged_by, triaged_at)
    values (p_order, 'out_of_jurisdiction', null, null, v_note, v_src, auth.uid(), now())
    on conflict (order_id) do update set status = 'out_of_jurisdiction', machine = null, band = null,
      note = excluded.note, source_url = excluded.source_url, triaged_by = excluded.triaged_by, triaged_at = now();
  else
    perform kasa_private.fail('KASA_BAD_FORM', 'Status must be triaged or out_of_jurisdiction.');
  end if;
  return jsonb_build_object('ok', true, 'order_id', p_order, 'status', p_status);
end $$;

-- Puts triaged orders into one batch for an office and slot, in the order given.
-- Creates the batch if it does not exist yet; refuses a closed batch.
create or replace function public.kasa_admin_dispatch_batch_set(
  p_office text, p_date date, p_slot text, p_order_ids bigint[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_office text := nullif(trim(coalesce(p_office, '')), '');
  v_batch bigint;
  v_status text;
  v_id bigint;
  v_seq integer := 0;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if v_office is null then perform kasa_private.fail('KASA_BAD_FORM', 'Name the office.'); end if;
  if p_slot not in ('am', 'pm') then perform kasa_private.fail('KASA_BAD_FORM', 'Slot must be am or pm.'); end if;
  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Pick at least one order.');
  end if;
  if cardinality(p_order_ids) > 10 then
    perform kasa_private.fail('KASA_BAD_FORM', 'A batch holds at most 10 stops.');
  end if;
  if (select count(distinct x) from unnest(p_order_ids) x) <> cardinality(p_order_ids) then
    perform kasa_private.fail('KASA_BAD_FORM', 'An order appears twice.');
  end if;

  insert into kasa_private.dispatch_batches (office_key, batch_date, slot, created_by)
  values (v_office, p_date, p_slot, auth.uid())
  on conflict (office_key, batch_date, slot) do nothing;
  select id, status into v_batch, v_status from kasa_private.dispatch_batches
   where office_key = v_office and batch_date = p_date and slot = p_slot;
  if v_status = 'closed' then perform kasa_private.fail('KASA_BAD_STATE', 'That batch is closed.'); end if;

  delete from kasa_private.dispatch_batch_stops where batch_id = v_batch;

  foreach v_id in array p_order_ids loop
    v_seq := v_seq + 1;
    if not exists (
      select 1 from kasa_private.partner_orders o
        join kasa_private.dispatch_triage t on t.order_id = o.id
       where o.id = v_id and o.office_key = v_office and o.state in ('approved', 'assigned') and t.status = 'triaged'
    ) then
      perform kasa_private.fail('KASA_BAD_STATE', 'Every order must be triaged, open and in this office.');
    end if;
    if exists (
      select 1 from kasa_private.dispatch_batch_stops s
        join kasa_private.dispatch_batches b on b.id = s.batch_id
       where s.order_id = v_id and b.status = 'open' and s.batch_id <> v_batch
    ) then
      perform kasa_private.fail('KASA_BAD_STATE', 'An order is already in another open batch.');
    end if;
    insert into kasa_private.dispatch_batch_stops (batch_id, order_id, seq) values (v_batch, v_id, v_seq);
  end loop;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'stops', v_seq);
end $$;

-- Closes a batch: no more edits.
create or replace function public.kasa_admin_dispatch_batch_close(p_batch bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  update kasa_private.dispatch_batches set status = 'closed' where id = p_batch and status = 'open';
  if not found then perform kasa_private.fail('KASA_BAD_STATE', 'No open batch with that id.'); end if;
  return jsonb_build_object('ok', true, 'batch_id', p_batch);
end $$;

-- Moderator view: the day's batches with ordered stops, plus untriaged approved orders waiting in each office.
create or replace function public.kasa_admin_dispatch_board(p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return jsonb_build_object(
    'date', p_date,
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', b.id, 'office', b.office_key, 'slot', b.slot, 'status', b.status,
        'stops', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'seq', s.seq, 'order_id', o.id, 'report_id', r.id,
            'lat', r.lat, 'lng', r.lng, 'machine', t.machine, 'band', t.band
          ) order by s.seq), '[]'::jsonb)
          from kasa_private.dispatch_batch_stops s
          join kasa_private.partner_orders o on o.id = s.order_id
          join public.reports r on r.id = o.report_id
          join kasa_private.dispatch_triage t on t.order_id = o.id
          where s.batch_id = b.id
        )
      ) order by b.office_key, b.slot)
      from kasa_private.dispatch_batches b
      where b.batch_date = p_date
    ), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'office', o.office_key, 'state', o.state,
        'triage', coalesce(t.status, 'untriaged'), 'machine', t.machine, 'band', t.band
      ) order by o.office_key, o.id)
      from kasa_private.partner_orders o
      left join kasa_private.dispatch_triage t on t.order_id = o.id
      where o.state in ('approved', 'assigned')
        and not exists (
          select 1 from kasa_private.dispatch_batch_stops s
          join kasa_private.dispatch_batches b on b.id = s.batch_id
          where s.order_id = o.id and (b.status = 'open' or b.batch_date = p_date)
        )
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.kasa_admin_dispatch_triage(bigint, text, text, text, text, text) from public, anon;
revoke all on function public.kasa_admin_dispatch_batch_set(text, date, text, bigint[]) from public, anon;
revoke all on function public.kasa_admin_dispatch_batch_close(bigint) from public, anon;
revoke all on function public.kasa_admin_dispatch_board(date) from public, anon;
grant execute on function public.kasa_admin_dispatch_triage(bigint, text, text, text, text, text) to authenticated;
grant execute on function public.kasa_admin_dispatch_batch_set(text, date, text, bigint[]) to authenticated;
grant execute on function public.kasa_admin_dispatch_batch_close(bigint) to authenticated;
grant execute on function public.kasa_admin_dispatch_board(date) to authenticated;

commit;
