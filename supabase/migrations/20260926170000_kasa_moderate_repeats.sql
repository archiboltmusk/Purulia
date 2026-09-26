-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — moderators decide which reports are repeats
--
-- The automatic check joins a report to an earlier one when both are the same
-- kind of problem within duplicate_radius_m. It can be wrong: two different
-- piles 30 m apart get joined. Moderators (and admins) now decide:
--   • kasa_admin_confirm_duplicate(child)   "same spot": keep the link, and it
--     leaves the review list.
--   • kasa_admin_unlink_duplicate(child)    "not the same": the report stands
--     on its own again, and the "people saw this" count it added is taken back.
--   • kasa_admin_link_duplicate(child, parent)  join a report the check missed.
--   • kasa_admin_remove_photo(...)          delete a repeat photo; moderators
--     may now do this too, not only admins.
-- Every change is a public "moderator action" on the report's timeline.
-- kasa_admin_repeat_photos() now lists only links nobody has reviewed yet.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.duplicate_reviews (
  report_id   text primary key,
  reviewed_by uuid,
  reviewed_at timestamptz not null default now()
);
alter table kasa_private.duplicate_reviews enable row level security;
revoke all on kasa_private.duplicate_reviews from public, anon, authenticated;

create or replace function public.kasa_admin_repeat_photos(p_limit integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', d.id::text, 'photo_url', d.photo_url, 'created_at', d.created_at,
                                'parent_id', p.id::text, 'parent_photo_url', p.photo_url, 'category', p.category,
                                'ward_no', p.ward_no, 'block_name', p.block_name,
                                'distance_m', round(kasa_private.distance_m(p.lat, p.lng, d.lat, d.lng))) as x
      from public.reports d join public.reports p on p.id = d.parent_report_id
      where coalesce(d.is_duplicate, false)
        and not exists (select 1 from kasa_private.duplicate_reviews v where v.report_id = d.id::text)
      order by d.created_at desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))) t), '[]'::jsonb);
end $$;

create or replace function public.kasa_admin_confirm_duplicate(p_report_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if not exists (select 1 from public.reports where id::text = p_report_id and coalesce(is_duplicate, false)) then
    perform kasa_private.fail('KASA_NOT_FOUND', 'That report is not joined to another one.');
  end if;
  insert into kasa_private.duplicate_reviews (report_id, reviewed_by) values (p_report_id, auth.uid())
  on conflict (report_id) do update set reviewed_by = excluded.reviewed_by, reviewed_at = now();
  return jsonb_build_object('confirmed', true);
end $$;

create or replace function public.kasa_admin_unlink_duplicate(p_report_id text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.reports;
  s kasa_private.seen;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into d from public.reports where id::text = p_report_id and coalesce(is_duplicate, false) for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That report is not joined to another one.'); end if;

  update public.reports set is_duplicate = false, parent_report_id = null, updated_at = now() where id = d.id;
  -- Take back the "people saw this" the join added to the other report.
  delete from kasa_private.seen where report_id = d.parent_report_id and user_id = d.user_id returning * into s;
  if s.report_id is not null then
    update public.reports set upvotes = greatest(coalesce(upvotes, 0) - 1, 0),
           seen_on_site = greatest(seen_on_site - (case when s.on_site then 1 else 0 end), 0)
    where id = d.parent_report_id;
  end if;
  insert into kasa_private.duplicate_reviews (report_id, reviewed_by) values (d.id::text, auth.uid())
  on conflict (report_id) do update set reviewed_by = excluded.reviewed_by, reviewed_at = now();

  perform kasa_private.add_event(d.parent_report_id::text, 'moderated', auth.uid(), null, null, null,
    jsonb_build_object('action', 'unlink_duplicate', 'other_report_id', d.id::text,
                       'reason', coalesce(nullif(left(trim(p_reason), 280), ''), 'A different problem, not the same spot')));
  perform kasa_private.add_event(d.id::text, 'moderated', auth.uid(), null, null, null,
    jsonb_build_object('action', 'unlink_duplicate', 'other_report_id', d.parent_report_id::text,
                       'reason', coalesce(nullif(left(trim(p_reason), 280), ''), 'A different problem, not the same spot')));
  return jsonb_build_object('unlinked', true, 'id', d.id::text);
end $$;

create or replace function public.kasa_admin_link_duplicate(p_report_id text, p_parent_id text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.reports;
  p public.reports;
  v_on_site boolean;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_report_id = p_parent_id then perform kasa_private.fail('KASA_BAD_ACTION', 'A report cannot join itself.'); end if;
  select * into d from public.reports where id::text = p_report_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  select * into p from public.reports where id::text = p_parent_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'The report to join was not found.'); end if;
  if coalesce(p.is_duplicate, false) then
    perform kasa_private.fail('KASA_BAD_ACTION', 'That report is itself a repeat. Join to the report it belongs to.');
  end if;
  if coalesce(d.is_duplicate, false) then
    perform kasa_private.fail('KASA_BAD_ACTION', 'This report is already joined to another one. Undo that first.');
  end if;
  if exists (select 1 from public.reports c where c.parent_report_id = d.id and coalesce(c.is_duplicate, false)) then
    perform kasa_private.fail('KASA_BAD_ACTION', 'Other reports are joined to this one, so it stays the original.');
  end if;

  update public.reports set is_duplicate = true, parent_report_id = p.id, updated_at = now() where id = d.id;
  v_on_site := d.accuracy_m is not null and d.accuracy_m <= kasa_private.cfg_num('max_gps_accuracy_m');
  insert into kasa_private.seen (report_id, user_id, on_site, distance_m)
  values (p.id, d.user_id, v_on_site, kasa_private.distance_m(p.lat, p.lng, d.lat, d.lng))
  on conflict do nothing;
  if found then
    update public.reports set upvotes = coalesce(upvotes, 0) + 1,
           seen_on_site = seen_on_site + (case when v_on_site then 1 else 0 end)
    where id = p.id;
  end if;
  insert into kasa_private.duplicate_reviews (report_id, reviewed_by) values (d.id::text, auth.uid())
  on conflict (report_id) do update set reviewed_by = excluded.reviewed_by, reviewed_at = now();
  perform kasa_private.add_event(p.id::text, 'moderated', auth.uid(), null, null, null,
    jsonb_build_object('action', 'link_duplicate', 'other_report_id', d.id::text,
                       'reason', coalesce(nullif(left(trim(p_reason), 280), ''), 'The same problem, reported again')));
  return jsonb_build_object('linked', true);
end $$;

-- Moderators can now delete repeat photos too (was admins only).
create or replace function public.kasa_admin_remove_photo(p_report_id text, p_kind text, p_ref text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r   public.reports;
  d   public.reports;
  v_url text;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short public reason.');
  end if;
  select * into r from public.reports where id::text = p_report_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;

  if p_kind = 'extra' then
    delete from kasa_private.report_photos where report_id = r.id and position::text = p_ref returning photo_url into v_url;
    if v_url is null then perform kasa_private.fail('KASA_NOT_FOUND', 'That photo is not on this report.'); end if;
  elsif p_kind = 'duplicate' then
    select * into d from public.reports where id::text = p_ref and parent_report_id = r.id and coalesce(is_duplicate, false) for update;
    if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That duplicate is not joined to this report.'); end if;
    v_url := d.photo_url;
    delete from public.reports where id = d.id;
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown photo kind.');
  end if;

  perform kasa_private.add_event(r.id::text, 'moderated', auth.uid(), null, null, null,
    jsonb_build_object('action', 'remove_photo', 'kind', p_kind, 'reason', left(trim(p_reason), 280)));
  return jsonb_build_object('removed', true, 'kind', p_kind);
end $$;

revoke all on function public.kasa_admin_confirm_duplicate(text) from public, anon;
revoke all on function public.kasa_admin_unlink_duplicate(text, text) from public, anon;
revoke all on function public.kasa_admin_link_duplicate(text, text, text) from public, anon;
grant execute on function public.kasa_admin_confirm_duplicate(text), public.kasa_admin_unlink_duplicate(text, text),
  public.kasa_admin_link_duplicate(text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
