-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — admins outrank moderators
--
-- public.admins gets a role: 'admin' or 'moderator'. Every existing member
-- becomes 'admin' so nobody loses access; new members default to 'moderator'.
--
-- Both roles keep everything kasa_private.is_admin() already allows (queue,
-- hide/restore/approve, reject claims, replies, recategorise, communities).
-- Only an admin can:
--   • permanently delete a report or school audit (moderators hide instead)
--   • read the sign-up list (people's names and phone numbers/emails)
--   • add, promote, demote or remove team members (kasa_admin_set_role)
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.admins add column if not exists role text;
update public.admins set role = 'admin' where role is null;
alter table public.admins alter column role set default 'moderator';
alter table public.admins alter column role set not null;
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('admin', 'moderator'));

create or replace function kasa_private.is_super_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return exists (select 1 from public.admins a where a.user_id = auth.uid() and a.role = 'admin');
end $$;
revoke all on function kasa_private.is_super_admin() from public, anon;
grant execute on function kasa_private.is_super_admin() to authenticated;

-- 'admin', 'moderator', or null — lets admin.html show only what the caller can do.
create or replace function public.kasa_my_role() returns text
language sql stable security definer set search_path = '' as $$
  select a.role from public.admins a where a.user_id = auth.uid()
$$;
revoke all on function public.kasa_my_role() from public, anon;
grant execute on function public.kasa_my_role() to authenticated;

create or replace function public.kasa_admin_moderate(p_report_id text, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reports;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'hide', 'restore', 'delete') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;

  if p_action = 'delete' then
    if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_SUPER_ADMIN', 'Only an admin can delete permanently. Hide it instead.'); end if;
    select * into r from public.reports where id::text = p_report_id and moderation_status in ('review', 'flagged') for update;
    if not found then
      perform kasa_private.fail('KASA_NOT_DELETABLE', 'Only a report already flagged or held for review can be deleted. Hide it instead.');
    end if;
    delete from public.reports where id = r.id;
    return jsonb_build_object('deleted', true);
  end if;

  update public.reports set moderation_status = case p_action when 'hide' then 'hidden' else 'approved' end, updated_at = now()
  where id::text = p_report_id returning * into r;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  perform kasa_private.add_event(r.id::text, 'moderated', null, null, null, null,
    jsonb_build_object('action', p_action, 'reason', p_reason));
  return jsonb_build_object('moderation_status', r.moderation_status);
end $$;

create or replace function public.kasa_admin_moderate_school_audit(p_audit_id text, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.school_audits;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'hide', 'restore', 'delete') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  if p_action = 'delete' then
    if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_SUPER_ADMIN', 'Only an admin can delete permanently. Hide it instead.'); end if;
    delete from public.school_audits where id::text = p_audit_id returning * into a;
    if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Audit not found.'); end if;
    return jsonb_build_object('deleted', true);
  end if;
  update public.school_audits set moderation_status = case p_action when 'hide' then 'hidden' else 'approved' end
  where id::text = p_audit_id returning * into a;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Audit not found.'); end if;
  return jsonb_build_object('moderation_status', a.moderation_status);
end $$;

create or replace function public.kasa_admin_signups(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_SUPER_ADMIN', 'Admins only.'); end if;
  return coalesce((select jsonb_agg(to_jsonb(s) - 'ip_hash' order by s.created_at desc)
                   from (select * from kasa_private.signups order by created_at desc
                         limit greatest(1, least(coalesce(p_limit, 200), 1000))) s), '[]'::jsonb);
end $$;

-- Team list (admins only).
create or replace function public.kasa_admin_team() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_SUPER_ADMIN', 'Admins only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', a.role, 'since', a.created_at,
                                                       'me', a.user_id = auth.uid()) order by a.role, a.created_at)
                   from public.admins a join auth.users u on u.id = a.user_id), '[]'::jsonb);
end $$;

-- Add / change / remove a team member by the email they signed up with.
-- p_role: 'admin', 'moderator', or 'remove'. An admin can't change their own
-- role, so the team always keeps at least one admin.
create or replace function public.kasa_admin_set_role(p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_SUPER_ADMIN', 'Admins only.'); end if;
  if p_role not in ('admin', 'moderator', 'remove') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown role.'); end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then perform kasa_private.fail('KASA_NOT_FOUND', 'No account with that email — they need to sign up first.'); end if;
  if v_uid = auth.uid() then perform kasa_private.fail('KASA_SELF', 'You can''t change your own role.'); end if;
  if p_role = 'remove' then
    delete from public.admins where user_id = v_uid;
  else
    insert into public.admins (user_id, role) values (v_uid, p_role)
    on conflict (user_id) do update set role = excluded.role;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kasa_admin_team() from public, anon;
grant execute on function public.kasa_admin_team() to authenticated;
revoke all on function public.kasa_admin_set_role(text, text) from public, anon;
grant execute on function public.kasa_admin_set_role(text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
