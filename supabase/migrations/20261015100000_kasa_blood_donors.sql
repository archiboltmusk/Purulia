-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — Blood donor register (consented, moderated)
--
-- A person who chooses to be listed as a donor sends: name, blood group,
-- district, place and phone. Phone is stored privately and is shown publicly
-- only if the person ticks a separate opt-in. Nothing is listed until a
-- moderator approves it. Only approved rows are ever returned to the public.
--
-- Safe to re-run. NOT applied to the live project: apply only after the
-- user confirms this migration by name.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.blood_donors (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  name          text not null,
  blood_group   text not null check (blood_group in ('O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-')),
  district      text not null,                      -- place-facts.js slug, e.g. purulia
  place         text,                               -- village / block / town
  phone         text not null,                      -- private; never returned unless show_phone and approved
  show_phone    boolean not null default false,     -- separate opt-in, unticked by default
  consent       boolean not null check (consent),   -- agreed to be listed and to be contacted for blood
  ip_hash       text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  reviewed_at   timestamptz,
  review_note   text
);
create index if not exists kasa_blood_donors_status_idx on kasa_private.blood_donors (status, created_at);
create index if not exists kasa_blood_donors_search_idx on kasa_private.blood_donors (status, blood_group, district);
alter table kasa_private.blood_donors enable row level security;

create or replace function public.kasa_register_blood_donor(p_name text, p_blood_group text, p_district text,
    p_place text, p_phone text, p_show_phone boolean, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip    text := kasa_private.ip_hash();
  v_name  text := nullif(btrim(p_name), '');
  v_place text := nullif(btrim(p_place), '');
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s+-]', '', 'g');
  v_id    bigint;
begin
  if v_name is null or length(v_name) > 80 then perform kasa_private.fail('KASA_BAD_FORM', 'Enter your name.'); end if;
  if p_blood_group is null or p_blood_group not in ('O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Pick your blood group.');
  end if;
  if p_district is null or p_district !~ '^[a-z0-9-]{2,40}$' then perform kasa_private.fail('KASA_BAD_FORM', 'Pick a district.'); end if;
  if v_place is not null and length(v_place) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Keep the place short.'); end if;
  if v_phone ~ '^(91)?[6-9][0-9]{9}$' then v_phone := right(v_phone, 10); end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then perform kasa_private.fail('KASA_BAD_FORM', 'Enter a 10-digit mobile number.'); end if;
  if p_consent is not true then
    perform kasa_private.fail('KASA_BAD_FORM', 'Tick the consent box to be listed.');
  end if;
  perform kasa_private.net_limit('blood_donor', 5, 20, 'Too many sign-ups from this network. Please try again later.');
  if (v_ip is not null and (select count(*) from kasa_private.blood_donors
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 3)
  then
    perform kasa_private.fail('KASA_RATE', 'You have sent enough today. Please try again tomorrow.');
  end if;
  insert into kasa_private.blood_donors (name, blood_group, district, place, phone, show_phone, consent, ip_hash)
  values (v_name, p_blood_group, p_district, v_place, v_phone, coalesce(p_show_phone, false), true, v_ip)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

create or replace function public.kasa_blood_donors(p_blood_group text default null, p_district text default null)
returns table (id bigint, name text, blood_group text, district text, place text, phone text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.name, d.blood_group, d.district, d.place,
         case when d.show_phone then d.phone else null end
  from kasa_private.blood_donors d
  where d.status = 'approved'
    and (p_blood_group is null or d.blood_group = p_blood_group)
    and (p_district is null or d.district = p_district)
  order by d.reviewed_at desc nulls last, d.id desc
  limit 50
$$;

create or replace function public.kasa_admin_blood_donor_queue()
returns table (id bigint, created_at timestamptz, name text, blood_group text, district text, place text,
               phone text, show_phone boolean, status text)
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return query
    select d.id, d.created_at, d.name, d.blood_group, d.district, d.place, d.phone, d.show_phone, d.status
    from kasa_private.blood_donors d
    where d.status = 'pending'
    order by d.created_at
    limit 200;
end $$;

create or replace function public.kasa_admin_review_blood_donor(p_id bigint, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d kasa_private.blood_donors;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'reject', 'remove') then perform kasa_private.fail('KASA_BAD_ACTION', 'Approve, reject or remove.'); end if;
  update kasa_private.blood_donors
  set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'removed' end,
      reviewed_at = now(), review_note = left(p_note, 500)
  where id = p_id and status = case when p_action = 'remove' then 'approved' else 'pending' end
  returning * into d;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That is not waiting any more.'); end if;
  return jsonb_build_object('id', d.id, 'status', d.status);
end $$;

revoke all on function public.kasa_register_blood_donor(text, text, text, text, text, boolean, boolean) from public;
grant execute on function public.kasa_register_blood_donor(text, text, text, text, text, boolean, boolean) to anon, authenticated;
revoke all on function public.kasa_blood_donors(text, text) from public;
grant execute on function public.kasa_blood_donors(text, text) to anon, authenticated;
revoke all on function public.kasa_admin_blood_donor_queue() from public, anon;
grant execute on function public.kasa_admin_blood_donor_queue() to authenticated;
revoke all on function public.kasa_admin_review_blood_donor(bigint, text, text) from public, anon;
grant execute on function public.kasa_admin_review_blood_donor(bigint, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
