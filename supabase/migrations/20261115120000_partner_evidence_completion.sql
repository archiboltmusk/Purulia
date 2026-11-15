-- Finish the existing partner workflow; retain historical photos and decisions.
begin;
alter table kasa_private.partner_orders add column if not exists evidence_after timestamptz not null default now();

-- Storage paths are random and unlinkable. Only registered workers may add partner photos.
drop policy if exists kasa_partner_photos_insert on storage.objects;
create policy kasa_partner_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'kasa-photos' and name ~ '^partner/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$'
 and exists (select 1 from kasa_private.partner_workers where user_id = auth.uid() and active));
-- RLS expressions must not expose or require direct access to the private worker table.
create or replace function public.kasa_partner_can_upload() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists (select 1 from kasa_private.partner_workers where user_id = auth.uid() and active)
$$;
revoke all on function public.kasa_partner_can_upload() from public, anon;
grant execute on function public.kasa_partner_can_upload() to authenticated;
alter policy kasa_partner_photos_insert on storage.objects with check (
 bucket_id = 'kasa-photos' and name ~ '^partner/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$'
 and public.kasa_partner_can_upload());

create or replace function kasa_private.partner_evidence_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if (new.state = 'reopened' and old.state <> 'reopened')
    or (new.state = 'in_progress' and old.state in ('completed', 'reopened')) then
   new.evidence_after := clock_timestamp(); new.signed_off_at := null;
   -- A public dispute awaits officer review. Sending back confirms that a new
   -- cleanup claim must be possible; historical claims/events remain intact.
   if new.state = 'in_progress' then
    update public.reports set status = 'open', resolved_at = null,
      resolution_method = null, resolved_photo_url = null, updated_at = now()
      where id = new.report_id;
   end if;
 end if;
 if new.state = 'completed' and old.state = 'in_progress' and not exists (
   select 1 from kasa_private.partner_work_photos where order_id = new.id
     and created_at >= new.evidence_after and rejected_at is null) then
   perform kasa_private.fail('KASA_NEEDS_PHOTO', 'Take a new work photo on site before completing this job.');
 end if;
 if new.signed_off_at is not null and new.signed_off_at is distinct from old.signed_off_at and not exists (
   select 1 from kasa_private.partner_work_photos where order_id = new.id
     and created_at >= new.evidence_after and approved_at is not null and rejected_at is null
     and approved_by is distinct from new.worker_id) then
   perform kasa_private.fail('KASA_NEEDS_PHOTO', 'An independent officer must approve a current work photo.');
 end if;
 return new;
end $$;
drop trigger if exists partner_evidence_guard on kasa_private.partner_orders;
create trigger partner_evidence_guard before update on kasa_private.partner_orders
for each row execute function kasa_private.partner_evidence_guard();

create or replace function kasa_private.partner_photo_decision_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o kasa_private.partner_orders%rowtype;
begin
 select * into o from kasa_private.partner_orders where id = new.order_id for update;
 if new.approved_at is distinct from old.approved_at or new.rejected_at is distinct from old.rejected_at then
  if new.created_at < o.evidence_after then perform kasa_private.fail('KASA_OLD_PHOTO', 'Review a photo from the current work cycle.'); end if;
  if new.approved_at is distinct from old.approved_at then
   if new.uploaded_by = auth.uid() or o.worker_id = auth.uid() then
    perform kasa_private.fail('KASA_SELF_REVIEW', 'A different officer must review your work photo.');
   end if;
   new.rejected_at := null;new.reject_note := null;
  else
   new.approved_at := null;new.approved_by := null;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists partner_photo_decision_guard on kasa_private.partner_work_photos;
create trigger partner_photo_decision_guard before update on kasa_private.partner_work_photos
for each row execute function kasa_private.partner_photo_decision_guard();

-- "report_is_verified" checks original report provenance, NOT resolution.
-- A work order needs a current accepted community claim with an independent verifier.
create or replace function kasa_private.partner_try_verify(p_order bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare o kasa_private.partner_orders%rowtype;r public.reports%rowtype;
begin
 select * into o from kasa_private.partner_orders where id = p_order for update;
 if not found or o.state <> 'completed' or o.signed_off_at is null then return;end if;
 select * into r from public.reports where id = o.report_id;
 if not found or not kasa_private.report_is_verified(r) or r.status <> 'resolved'
   or r.resolution_method is distinct from 'community' or r.resolved_at is null or r.resolved_at < o.evidence_after then return;end if;
 if not exists (
  select 1 from kasa_private.claims c join kasa_private.votes v on v.claim_id = c.id
  where c.report_id = o.report_id and c.status = 'accepted' and c.created_at >= o.evidence_after
   and v.vote = 'verify' and v.voided_at is null and not v.needs_review
   and v.voter_id is distinct from o.worker_id
   and exists (select 1 from kasa_private.partner_work_photos p where p.order_id = o.id
     and p.created_at >= o.evidence_after and p.approved_at is not null and p.rejected_at is null
     and p.approved_by is distinct from o.worker_id and p.approved_by is distinct from v.voter_id)
 ) then return;end if;
 update kasa_private.partner_orders set state = 'verified', updated_at = now() where id = p_order;
 perform kasa_private.partner_log(p_order, 'completed', 'verified', 'Current work photo approved and independent community resolution verified');
end $$;

-- Authenticated actor-only photo read. Public board continues to expose counts, never paths/GPS.
create or replace function public.kasa_partner_order_photos(p_order bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o kasa_private.partner_orders%rowtype;
begin
 select * into o from kasa_private.partner_orders where id = p_order;
 if not found or not (kasa_private.is_admin() or (o.worker_id = auth.uid() and public.kasa_partner_can_upload())) then
  perform kasa_private.fail('KASA_NOT_ALLOWED', 'Only the assigned worker or officer may view work photos.');
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'path',photo_path,'taken_at',taken_at,
   'approved',approved_at is not null,'rejected',rejected_at is not null,'note',reject_note,
   'current',created_at >= o.evidence_after) order by created_at desc)
   from kasa_private.partner_work_photos where order_id = p_order),'[]'::jsonb);
end $$;
revoke all on function public.kasa_partner_order_photos(bigint) from public, anon;
grant execute on function public.kasa_partner_order_photos(bigint) to authenticated;
create or replace function public.kasa_partner_board() returns jsonb
language sql stable security definer set search_path = '' as $$
with o as (
  select po.id, po.report_id, po.office_key, po.state, po.sla_due, po.firm_label, po.order_no,
         po.signed_off_at, po.paid_on, po.updated_at, po.evidence_after
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
      'photos', (select count(*) from kasa_private.partner_work_photos wp where wp.order_id = o.id and wp.created_at >= o.evidence_after and wp.rejected_at is null),
      'photos_approved', (select count(*) from kasa_private.partner_work_photos wp where wp.order_id = o.id and wp.approved_at is not null and wp.rejected_at is null and wp.created_at >= o.evidence_after),
      'timeline', coalesce((select jsonb_agg(jsonb_build_object('to', e.to_state, 'at', e.created_at, 'note', e.note) order by e.id)
                            from kasa_private.partner_order_events e where e.order_id = o.id), '[]'::jsonb)
    )) from o), '[]'::jsonb)
);
$$;

commit;
notify pgrst, 'reload schema';
