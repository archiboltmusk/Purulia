-- Operator-only entry point. A facility can never be marked live for over 24 h.
begin;
create or replace function public.kasa_admin_set_antivenom_facility(p_id bigint, p_name text, p_lat double precision, p_lng double precision, p_phone text, p_address text, p_status text, p_source_url text, p_confirmed_at timestamptz, p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN','Moderators only.'); end if;
  if nullif(trim(p_name),'') is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_status not in ('available','unavailable') or p_source_url !~ '^https?://' or p_confirmed_at is null or p_expires_at is null or p_expires_at <= p_confirmed_at or p_expires_at > p_confirmed_at + interval '24 hours' then
    perform kasa_private.fail('KASA_BAD_FORM','Give a cited, time-limited facility confirmation.');
  end if;
  if p_id is null then
    insert into kasa_private.antivenom_facilities(name,lat,lng,phone,address,status,source_url,confirmed_at,expires_at) values (left(trim(p_name),160),p_lat,p_lng,nullif(left(trim(coalesce(p_phone,'')),30),''),nullif(left(trim(coalesce(p_address,'')),300),''),p_status,p_source_url,p_confirmed_at,p_expires_at) returning id into v_id;
  else
    update kasa_private.antivenom_facilities set name=left(trim(p_name),160),lat=p_lat,lng=p_lng,phone=nullif(left(trim(coalesce(p_phone,'')),30),''),address=nullif(left(trim(coalesce(p_address,'')),300),''),status=p_status,source_url=p_source_url,confirmed_at=p_confirmed_at,expires_at=p_expires_at where id=p_id returning id into v_id;
  end if;
  if v_id is null then perform kasa_private.fail('KASA_NOT_FOUND','Facility not found.'); end if;
  return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.kasa_admin_set_antivenom_facility(bigint,text,double precision,double precision,text,text,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function public.kasa_admin_set_antivenom_facility(bigint,text,double precision,double precision,text,text,text,text,timestamptz,timestamptz) to authenticated;
commit;
