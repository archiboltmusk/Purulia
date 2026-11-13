-- Tourism catalogue remains static. Only consented service records and private enquiries live here.
-- Additive and idempotent; no existing report/auth permissions are changed.
begin;
create table if not exists kasa_private.tourism_providers (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 2 and 160),
 kind text not null check(kind in ('driver','stay','guide','artisan')),
 contact_url text not null check(contact_url ~ '^https://' and length(contact_url)<=2000),
 evidence_url text not null check(evidence_url ~ '^https://' and length(evidence_url)<=2000),
 consent_note text not null check(length(consent_note) between 10 and 1000),
 verified_at timestamptz not null,
 verified_until timestamptz not null check(verified_until>verified_at and verified_until<=verified_at+interval '30 days'),
 published boolean not null default false,
 reviewed_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create table if not exists kasa_private.tourism_enquiries (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 provider_id uuid not null references kasa_private.tourism_providers(id),
 trip_date date not null,
 party integer not null check(party between 1 and 30),
 message text not null check(length(message) between 10 and 2000),
 status text not null default 'received' check(status in ('received','reviewing','answered','cancelled')),
 reply text check(length(reply)<=2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table kasa_private.tourism_providers enable row level security;
alter table kasa_private.tourism_enquiries enable row level security;
revoke all on kasa_private.tourism_providers,kasa_private.tourism_enquiries from public,anon,authenticated;
create index if not exists tourism_enquiries_owner on kasa_private.tourism_enquiries(owner_id,created_at desc);

create or replace function public.kasa_tourism_providers() returns setof jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',id,'name',name,'kind',kind,'contact_url',contact_url,'evidence_url',evidence_url,'verified_at',verified_at,'verified_until',verified_until)
 from kasa_private.tourism_providers
 where published and verified_at<=now() and verified_until>now()
 order by name limit 200;
$$;

create or replace function public.kasa_tourism_enquire(p_request_id uuid,p_provider uuid,p_date date,p_party integer,p_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); existing kasa_private.tourism_enquiries;
begin
 if uid is null then raise exception 'Sign in before submitting an enquiry'; end if;
 if p_request_id is null or p_provider is null or p_date is null or p_date<current_date or p_date>current_date+365 or p_party is null or p_party not between 1 and 30 or p_message is null or length(trim(p_message)) not between 10 and 2000 then raise exception 'Invalid enquiry'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tourism:'||p_request_id::text,0));
 select * into existing from kasa_private.tourism_enquiries where id=p_request_id;
 if found then
  if existing.owner_id<>uid then raise exception 'Request reference unavailable'; end if;
  if existing.provider_id<>p_provider or existing.trip_date<>p_date or existing.party<>p_party or existing.message<>trim(p_message) then raise exception 'Use a new reference for changed enquiry details'; end if;
  return jsonb_build_object('id',existing.id,'status',existing.status);
 end if;
 if not exists(select 1 from kasa_private.tourism_providers where id=p_provider and published and verified_at<=now() and verified_until>now()) then raise exception 'Provider record unavailable or expired'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tourism-owner:'||uid::text,0));
 if (select count(*) from kasa_private.tourism_enquiries where owner_id=uid and created_at>now()-interval '1 hour')>=5 then raise exception 'Enquiry limit reached'; end if;
 if kasa_private.ip_hash() is null then raise exception 'Network identity unavailable'; end if;
 perform kasa_private.net_limit('tourism_enquiry',20,100,'Too many enquiries from this network');
 insert into kasa_private.tourism_enquiries(id,owner_id,provider_id,trip_date,party,message) values(p_request_id,uid,p_provider,p_date,p_party,trim(p_message));
 return jsonb_build_object('id',p_request_id,'status','received');
end $$;

create or replace function public.kasa_tourism_my_enquiries() returns setof jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',e.id,'provider_id',e.provider_id,'provider_name',p.name,'trip_date',e.trip_date,'party',e.party,'status',e.status,'reply',e.reply,'created_at',e.created_at)
 from kasa_private.tourism_enquiries e join kasa_private.tourism_providers p on p.id=e.provider_id
 where e.owner_id=auth.uid() order by e.created_at desc limit 100;
$$;

create or replace function public.kasa_tourism_cancel_enquiry(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 update kasa_private.tourism_enquiries set status='cancelled',updated_at=now() where id=p_id and owner_id=auth.uid();
 if not found then raise exception 'Enquiry unavailable'; end if;
 return jsonb_build_object('cancelled',true);
end $$;

create or replace function public.kasa_admin_tourism_save(p_id uuid,p_name text,p_kind text,p_contact text,p_evidence text,p_consent text,p_verified_at timestamptz,p_verified_until timestamptz,p_published boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved uuid;
begin
 if not kasa_private.is_admin() then raise exception 'Moderators only'; end if;
 if p_name is null or length(trim(p_name)) not between 2 and 160 or p_kind is null or p_kind not in ('driver','stay','guide','artisan') or p_contact is null or p_contact !~ '^https://' or length(p_contact)>2000 or p_evidence is null or p_evidence !~ '^https://' or length(p_evidence)>2000 or p_consent is null or length(trim(p_consent)) not between 10 and 1000 or p_verified_at is null or p_verified_at>now() or p_verified_until is null or (p_published and p_verified_until<=now()) or p_verified_until<=p_verified_at or p_verified_until>p_verified_at+interval '30 days' or p_published is null then raise exception 'Provide consent, public evidence and a valid dated verification'; end if;
 if p_id is null then
  insert into kasa_private.tourism_providers(name,kind,contact_url,evidence_url,consent_note,verified_at,verified_until,published,reviewed_by) values(trim(p_name),p_kind,p_contact,p_evidence,trim(p_consent),p_verified_at,p_verified_until,p_published,auth.uid()) returning id into saved;
 else
  update kasa_private.tourism_providers set name=trim(p_name),kind=p_kind,contact_url=p_contact,evidence_url=p_evidence,consent_note=trim(p_consent),verified_at=p_verified_at,verified_until=p_verified_until,published=p_published,reviewed_by=auth.uid(),updated_at=now() where id=p_id returning id into saved;
 end if;
 if saved is null then raise exception 'Provider unavailable'; end if;
 return jsonb_build_object('id',saved);
end $$;

create or replace function public.kasa_admin_tourism_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if not kasa_private.is_admin() then raise exception 'Moderators only'; end if;
 return jsonb_build_object('providers',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (select * from kasa_private.tourism_providers order by updated_at desc limit 200)p),'enquiries',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from (select id,provider_id,trip_date,party,message,status,reply,created_at from kasa_private.tourism_enquiries order by created_at desc limit 200)e));
end $$;

create or replace function public.kasa_admin_tourism_reply(p_id uuid,p_status text,p_reply text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not kasa_private.is_admin() then raise exception 'Moderators only'; end if;
 if p_status is null or p_status not in ('reviewing','answered') or p_reply is null or length(trim(p_reply)) not between 1 and 2000 then raise exception 'A valid status and reply are required'; end if;
 update kasa_private.tourism_enquiries set status=p_status,reply=trim(p_reply),updated_at=now() where id=p_id and status<>'cancelled';
 if not found then raise exception 'Enquiry unavailable'; end if;
 return jsonb_build_object('updated',true);
end $$;

revoke all on function public.kasa_tourism_providers() from public;
revoke all on function public.kasa_tourism_enquire(uuid,uuid,date,integer,text) from public,anon;
revoke all on function public.kasa_tourism_my_enquiries() from public,anon;
revoke all on function public.kasa_tourism_cancel_enquiry(uuid) from public,anon;
revoke all on function public.kasa_admin_tourism_save(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) from public,anon;
revoke all on function public.kasa_admin_tourism_board() from public,anon;
revoke all on function public.kasa_admin_tourism_reply(uuid,text,text) from public,anon;
grant execute on function public.kasa_tourism_providers() to anon,authenticated;
grant execute on function public.kasa_tourism_enquire(uuid,uuid,date,integer,text),public.kasa_tourism_my_enquiries(),public.kasa_tourism_cancel_enquiry(uuid) to authenticated;
grant execute on function public.kasa_admin_tourism_save(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean),public.kasa_admin_tourism_board(),public.kasa_admin_tourism_reply(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
