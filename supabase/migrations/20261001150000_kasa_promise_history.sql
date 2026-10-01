-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — every dated verdict on a promise stays on the record
--
-- A promise's status (in progress, delivered, broken) always needs its own
-- evidence link and date. Until now a newer verdict replaced the older one
-- on the page. Now each earlier verdict stays, with its date and evidence:
-- kasa_promises() returns them as 'history' (newest first, the current one
-- left out). Published update rows already hold most of them; a verdict a
-- moderator set by direct edit (or that came with the seed list) is copied
-- into a published update row just before it is replaced.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- Before a promise's verdict changes, keep the current one as a history row
-- unless a published update already records it.
create or replace function kasa_private.keep_promise_verdict(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.promises (who, role, promise, area, made_on, due_by, source_url, source_name, status, status_note,
                               status_source_url, status_date, update_of, review, reviewed_by, reviewed_at)
  select t.who, t.role, t.promise, t.area, t.made_on, t.due_by, t.source_url, t.source_name, t.status, t.status_note,
         t.status_source_url, t.status_date, t.id, 'published', auth.uid(), now()
  from public.promises t
  where t.id = p_id and t.update_of is null and t.status <> 'promised' and t.status_source_url is not null
    and not exists (select 1 from public.promises u
                    where u.update_of = t.id and u.review = 'published' and u.status = t.status
                      and u.status_source_url = t.status_source_url and u.status_date = t.status_date)
$$;
revoke all on function kasa_private.keep_promise_verdict(uuid) from public, anon, authenticated;

create or replace function public.kasa_promises()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'promises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'who', p.who, 'role', p.role, 'promise', p.promise, 'area', p.area,
        'made_on', p.made_on, 'due_by', p.due_by, 'source_url', p.source_url, 'source_name', p.source_name,
        'status', p.status, 'status_note', p.status_note, 'status_source_url', p.status_source_url,
        'status_date', p.status_date, 'updated_at', p.updated_at,
        'history', coalesce((
          select jsonb_agg(jsonb_build_object('status', h.status, 'status_date', h.status_date,
                   'status_source_url', h.status_source_url, 'status_note', h.status_note)
                 order by h.status_date desc, h.reviewed_at desc)
          from (select distinct on (u.status, u.status_source_url, u.status_date) u.*
                from public.promises u
                where u.update_of = p.id and u.review = 'published' and u.status <> 'promised'
                  and u.status_source_url is not null
                  and not (u.status = p.status and u.status_source_url = p.status_source_url
                           and u.status_date is not distinct from p.status_date)
                order by u.status, u.status_source_url, u.status_date, u.reviewed_at desc) h), '[]'::jsonb))
        order by p.made_on desc, p.created_at desc)
      from public.promises p where p.review = 'published' and p.update_of is null), '[]'::jsonb),
    'news', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'url', n.url, 'title', n.title, 'source', n.source,
        'published_at', n.published_at, 'who', n.who) order by n.published_at desc nulls last)
      from (select * from public.promise_news where not hidden
            order by published_at desc nulls last limit 80) n), '[]'::jsonb),
    'news_checked_at', (select max(fetched_at) from public.promise_news)
  )
$$;
revoke all on function public.kasa_promises() from public;
grant execute on function public.kasa_promises() to anon, authenticated;

create or replace function public.kasa_admin_promise_review(p_id uuid, p_action text, p_edits jsonb default '{}'::jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.promises;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('publish', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  select * into r from public.promises where id = p_id and review = 'pending' for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Already reviewed or not found.'); end if;

  if p_action = 'reject' then
    update public.promises set review = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
    where id = p_id;
    return jsonb_build_object('review', 'rejected');
  end if;

  p_edits := coalesce(p_edits, '{}'::jsonb);
  update public.promises set
    who = coalesce(p_edits ->> 'who', who), role = coalesce(p_edits ->> 'role', role),
    promise = coalesce(p_edits ->> 'promise', promise), area = coalesce(p_edits ->> 'area', area),
    made_on = coalesce((p_edits ->> 'made_on')::date, made_on), due_by = coalesce((p_edits ->> 'due_by')::date, due_by),
    source_url = coalesce(p_edits ->> 'source_url', source_url), source_name = coalesce(p_edits ->> 'source_name', source_name),
    status = coalesce(p_edits ->> 'status', status), status_note = coalesce(p_edits ->> 'status_note', status_note),
    status_source_url = coalesce(p_edits ->> 'status_source_url', status_source_url),
    status_date = coalesce((p_edits ->> 'status_date')::date, status_date),
    review = 'published', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note, updated_at = now()
  where id = p_id returning * into r;

  if r.update_of is not null then
    perform kasa_private.keep_promise_verdict(r.update_of);
    update public.promises set status = r.status, status_note = r.status_note, status_source_url = r.status_source_url,
      status_date = r.status_date, updated_at = now()
    where id = r.update_of;
  end if;
  return jsonb_build_object('review', 'published');
end $$;
revoke all on function public.kasa_admin_promise_review(uuid, text, jsonb, text) from public, anon;
grant execute on function public.kasa_admin_promise_review(uuid, text, jsonb, text) to authenticated;

create or replace function public.kasa_admin_promise_edit(p_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_fields ?| array['status', 'status_source_url', 'status_date'] then
    perform kasa_private.keep_promise_verdict(p_id);
  end if;
  update public.promises set
    who = coalesce(p_fields ->> 'who', who), role = coalesce(p_fields ->> 'role', role),
    promise = coalesce(p_fields ->> 'promise', promise), area = coalesce(p_fields ->> 'area', area),
    made_on = coalesce((p_fields ->> 'made_on')::date, made_on), due_by = coalesce((p_fields ->> 'due_by')::date, due_by),
    source_url = coalesce(p_fields ->> 'source_url', source_url), source_name = coalesce(p_fields ->> 'source_name', source_name),
    status = coalesce(p_fields ->> 'status', status), status_note = coalesce(p_fields ->> 'status_note', status_note),
    status_source_url = coalesce(p_fields ->> 'status_source_url', status_source_url),
    status_date = coalesce((p_fields ->> 'status_date')::date, status_date),
    review = case when p_fields ->> 'review' = 'rejected' then 'rejected' else review end,
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_id and review = 'published' and update_of is null;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Promise not found.'); end if;
  return jsonb_build_object('ok', true);
exception when check_violation then
  perform kasa_private.fail('KASA_NEED_EVIDENCE', 'A status other than "promised" needs an evidence link and date.');
end $$;
revoke all on function public.kasa_admin_promise_edit(uuid, jsonb) from public, anon;
grant execute on function public.kasa_admin_promise_edit(uuid, jsonb) to authenticated;

commit;
