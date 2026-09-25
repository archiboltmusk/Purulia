-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — volunteer communities
--
-- Cleanup groups (NSS units, puja committees, youth clubs, residents'
-- groups, NGOs) register themselves; a moderator approves them before they
-- appear. A group chooses what contact to publish; the coordinator's own
-- contact stays private, and the coordinator confirms they are an adult.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.communities (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  kind                text not null check (kind in ('nss', 'puja_committee', 'youth_club', 'residents', 'ngo', 'school_college', 'other')),
  wards               integer[] not null,
  description         text,
  public_contact      text,
  coordinator_contact text not null,
  status              text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  review_note         text,
  ip_hash             text,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz
);
create index if not exists communities_status_idx on kasa_private.communities (status, created_at desc);
alter table kasa_private.communities enable row level security;
revoke all on kasa_private.communities from anon, authenticated;

create or replace function public.kasa_register_community(p_name text, p_kind text, p_wards integer[], p_description text,
    p_public_contact text, p_coordinator_contact text, p_adult boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := kasa_private.ip_hash();
  v_name text := nullif(trim(p_name), '');
begin
  if v_name is null or length(v_name) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Give your group''s name.'); end if;
  if p_kind is null or p_kind not in ('nss', 'puja_committee', 'youth_club', 'residents', 'ngo', 'school_college', 'other') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose what kind of group this is.');
  end if;
  if p_wards is null or cardinality(p_wards) = 0 or cardinality(p_wards) > 23
     or exists (select 1 from unnest(p_wards) w where w not between 1 and 23) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose the wards where your group works.');
  end if;
  if nullif(trim(p_coordinator_contact), '') is null or length(p_coordinator_contact) > 200 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give the coordinator''s phone number or e-mail (kept private).');
  end if;
  if not coalesce(p_adult, false) then
    perform kasa_private.fail('KASA_ADULT_REQUIRED', 'The group must be registered by an adult coordinator (18 or older).');
  end if;
  if length(coalesce(p_description, '')) > 800 or length(coalesce(p_public_contact, '')) > 200 then
    perform kasa_private.fail('KASA_TOO_LONG', 'That is too long. Please shorten it.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, p_description, p_public_contact)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.communities
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 3)
     or (select count(*) from kasa_private.communities where created_at > now() - interval '1 day') >= 50 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many registrations right now. Please try again tomorrow.');
  end if;

  insert into kasa_private.communities (name, kind, wards, description, public_contact, coordinator_contact, ip_hash)
  values (v_name, p_kind, (select array_agg(distinct w order by w) from unnest(p_wards) w),
          nullif(trim(p_description), ''), nullif(trim(p_public_contact), ''), trim(p_coordinator_contact), v_ip);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

drop view if exists public.kasa_public_communities;
create view public.kasa_public_communities as
select c.id, c.name, c.kind, c.wards, c.description, c.public_contact, c.created_at
from kasa_private.communities c
where c.status = 'approved';

create or replace function public.kasa_admin_communities() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(to_jsonb(c) - 'ip_hash' order by (c.status = 'pending') desc, c.created_at desc)
                   from kasa_private.communities c), '[]'::jsonb);
end $$;

create or replace function public.kasa_admin_moderate_community(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'hide') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  update kasa_private.communities
  set status = case when p_action = 'approve' then 'approved' else 'hidden' end,
      review_note = left(nullif(trim(p_note), ''), 200), reviewed_at = now()
  where id = p_id;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Group not found.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on public.kasa_public_communities from public, anon, authenticated;
grant select on public.kasa_public_communities to anon, authenticated;
revoke all on function public.kasa_register_community(text, text, integer[], text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.kasa_register_community(text, text, integer[], text, text, text, boolean) to anon, authenticated;
revoke all on function public.kasa_admin_communities() from public, anon, authenticated;
grant execute on function public.kasa_admin_communities() to authenticated;
revoke all on function public.kasa_admin_moderate_community(uuid, text, text) from public, anon, authenticated;
grant execute on function public.kasa_admin_moderate_community(uuid, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
