-- Status and evidence trail: every event row is append-only and hash-chained per report.
-- Each row stores prev_hash (the previous row_hash for the same report) and row_hash
-- (sha256 over the row's content plus prev_hash). Any edit or removed row breaks the chain,
-- and kasa_private.verify_event_chain(report) says so. Rows written before this migration
-- have null hashes; the chain starts at the first hashed row for each report.
-- Core sha256(bytea) is used, so no extension is needed.

alter table kasa_private.events add column if not exists prev_hash text;
alter table kasa_private.events add column if not exists row_hash text;

create or replace function kasa_private.events_hash_payload(e kasa_private.events)
returns text language sql immutable set search_path = '' as $$
  select concat_ws('|', e.report_id::text, e.kind, coalesce(e.actor_id::text, ''), coalesce(e.actor_tag, ''),
    coalesce(e.claim_id::text, ''), coalesce(e.photo_url, ''), coalesce(e.distance_m::text, ''),
    coalesce(e.detail::text, '{}'), to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(e.prev_hash, ''));
$$;

create or replace function kasa_private.events_chain_fill() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_prev text;
begin
  -- Serialise appends per report so two inserts cannot pick the same predecessor.
  perform pg_advisory_xact_lock(hashtext('kasa_events:' || new.report_id::text));
  select e.row_hash into v_prev from kasa_private.events e
    where e.report_id = new.report_id and e.row_hash is not null
    order by e.id desc limit 1;
  new.prev_hash := v_prev;
  new.row_hash := encode(sha256(convert_to(kasa_private.events_hash_payload(new), 'UTF8')), 'hex');
  return new;
end $$;

drop trigger if exists kasa_events_chain_fill on kasa_private.events;
create trigger kasa_events_chain_fill before insert on kasa_private.events
  for each row execute function kasa_private.events_chain_fill();

-- No update at all. Delete only as part of a report delete (the cascade): the parent row is
-- already gone when the child's delete trigger runs, so a direct delete of one event is refused.
create or replace function kasa_private.events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.reports r where r.id = old.report_id) then
    return old;
  end if;
  raise exception 'KASA_APPEND_ONLY' using detail = 'kasa_private.events rows cannot be changed or deleted.';
end $$;

drop trigger if exists kasa_events_append_only on kasa_private.events;
create trigger kasa_events_append_only before update or delete on kasa_private.events
  for each row execute function kasa_private.events_append_only();

-- Recomputes every hash for one report and reports the first row that does not match.
create or replace function kasa_private.verify_event_chain(p_report uuid)
returns table (ok boolean, bad_event_id bigint, checked integer)
language plpgsql stable set search_path = '' as $$
declare
  r        record;
  v_prev   text := null;
  v_count  integer := 0;
begin
  for r in select e.* from kasa_private.events e
           where e.report_id = p_report and e.row_hash is not null order by e.id loop
    v_count := v_count + 1;
    if r.prev_hash is distinct from v_prev
       or r.row_hash <> encode(sha256(convert_to(kasa_private.events_hash_payload(r), 'UTF8')), 'hex') then
      return query select false, r.id, v_count;
      return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return query select true, null::bigint, v_count;
end $$;

revoke all on function kasa_private.verify_event_chain(uuid) from public, anon, authenticated;
grant execute on function kasa_private.verify_event_chain(uuid) to service_role;
