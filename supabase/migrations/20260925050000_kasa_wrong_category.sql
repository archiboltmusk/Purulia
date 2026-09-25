-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — "wrong category" flag and moderator re-categorisation
--
-- A flag can now say the report is in the wrong category and suggest the
-- right one. Moderators see the suggestion in the queue and can change the
-- category; the change is recorded in the report's public history.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table kasa_private.flags add column if not exists suggested_category text;
alter table kasa_private.flags drop constraint if exists flags_reason_check;
alter table kasa_private.flags add constraint flags_reason_check check (reason in
  ('not_an_issue', 'wrong_category', 'wrong_location', 'duplicate', 'inappropriate', 'fake_or_old_photo', 'other'));

create or replace function kasa_private.valid_category(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing', 'encroachment',
               'illegal_construction', 'illegal_mining', 'illegal_other', 'other')
$$;

drop function if exists public.kasa_flag_report(text, text, text);
create or replace function public.kasa_flag_report(p_report_id text, p_reason text, p_note text default null,
    p_suggested_category text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
  r  public.reports;
begin
  select * into r from public.reports where id::text = p_report_id and moderation_status in ('approved', 'flagged') for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.user_id = me.user_id then perform kasa_private.fail('KASA_OWN_REPORT', 'You can''t flag your own report.'); end if;
  if p_reason is null or p_reason not in ('not_an_issue', 'wrong_category', 'wrong_location', 'duplicate', 'inappropriate',
                                          'fake_or_old_photo', 'other') then
    perform kasa_private.fail('KASA_BAD_REASON', 'Choose a reason.');
  end if;
  if p_reason = 'wrong_category' and (not coalesce(kasa_private.valid_category(p_suggested_category), false)
                                      or p_suggested_category = r.category) then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Choose the right category for this problem.');
  end if;
  if kasa_private.text_verdict(p_note) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  insert into kasa_private.flags (report_id, user_id, reason, note, suggested_category)
  values (r.id, me.user_id, p_reason, nullif(left(trim(coalesce(p_note, '')), 280), ''),
          case when p_reason = 'wrong_category' then p_suggested_category end)
  on conflict do nothing;
  if not found then return jsonb_build_object('counted', false, 'flags', r.flags); end if;

  update public.reports set flags = coalesce(flags, 0) + 1,
         moderation_status = case when coalesce(flags, 0) + 1 >= kasa_private.cfg_num('flag_review_threshold')
                                        and moderation_status = 'approved' then 'flagged' else moderation_status end
  where id = r.id returning * into r;
  perform kasa_private.add_event(r.id::text, 'flagged', me.user_id, null, null, null,
    jsonb_build_object('reason', p_reason) ||
    case when p_reason = 'wrong_category' then jsonb_build_object('suggested_category', p_suggested_category) else '{}'::jsonb end);
  return jsonb_build_object('counted', true, 'flags', r.flags, 'under_review', r.moderation_status = 'flagged');
end $$;

create or replace function public.kasa_admin_recategorize(p_report_id text, p_category text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reports;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if not coalesce(kasa_private.valid_category(p_category), false) then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Unknown category.');
  end if;
  if coalesce(trim(p_reason), '') = '' then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a public reason.'); end if;
  select * into r from public.reports where id::text = p_report_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.category = p_category then return jsonb_build_object('changed', false); end if;
  update public.reports set category = p_category, updated_at = now() where id = r.id;
  perform kasa_private.add_event(r.id::text, 'recategorized', null, null, null, null,
    jsonb_build_object('from', r.category, 'to', p_category, 'reason', left(p_reason, 200)));
  return jsonb_build_object('changed', true);
end $$;

-- The moderation queue now shows the category a flag suggested.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.kasa_admin_queue()'::regprocedure) into v_def;
  if position('suggested_category' in v_def) = 0 then
    execute replace(v_def, $o$jsonb_build_object('reason', f.reason, 'note', f.note, 'at', f.created_at)$o$,
                           $n$jsonb_build_object('reason', f.reason, 'note', f.note, 'at', f.created_at, 'suggested_category', f.suggested_category)$n$);
  end if;
end $$;

revoke all on function kasa_private.valid_category(text) from public, anon, authenticated;
revoke all on function public.kasa_flag_report(text, text, text, text) from public, anon;
grant execute on function public.kasa_flag_report(text, text, text, text) to authenticated;
revoke all on function public.kasa_admin_recategorize(text, text, text) from public, anon;
grant execute on function public.kasa_admin_recategorize(text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
