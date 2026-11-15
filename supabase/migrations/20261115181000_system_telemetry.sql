-- Device-owned signature verification happens at the Edge Function. Only its
-- service-role connection may commit verified packets. No actuation endpoints.
begin;
create table if not exists kasa_private.system_devices (
 id uuid primary key default gen_random_uuid(),key_id uuid not null default gen_random_uuid(),
 node_id uuid not null references kasa_private.system_nodes(id),name text not null,
 metric text not null check(metric in('flow_lps','water_level_m','pressure_kpa','rain_mm','temperature_c','power_kw','vibration_mms','tds_ppm')),
 unit text not null,public_key text not null check(length(public_key) between 40 and 50),source_url text not null check(source_url ~ '^https://'),
 calibration_until timestamptz not null,max_age_seconds integer not null default 300 check(max_age_seconds between 10 and 3600),
 min_value double precision not null,max_value double precision not null,
 active boolean not null default false,revoked boolean not null default false,public boolean not null default false,
 enrolled_by uuid not null,activated_by uuid,last_sequence bigint not null default 0,
 created_at timestamptz not null default now(),check(min_value between -1000000000000 and 1000000000000 and max_value between min_value and 1000000000000),check(activated_by is null or activated_by<>enrolled_by)
);
create table if not exists kasa_private.system_measurements (
 id bigint generated always as identity primary key,device_id uuid not null references kasa_private.system_devices(id),
 sequence bigint not null,measured_at timestamptz not null,received_at timestamptz not null default now(),
 value double precision not null check(value between -1000000000000 and 1000000000000),payload_hash text not null,
 signature_verified boolean not null default true,quality text not null check(quality in('in_range','outside_review_threshold','uncalibrated','stale')),
 unique(device_id,sequence)
);
create table if not exists kasa_private.system_sensor_alerts (
 id bigint generated always as identity primary key,measurement_id bigint not null unique references kasa_private.system_measurements(id),
 node_id uuid not null references kasa_private.system_nodes(id),state text not null default 'needs_review',created_at timestamptz not null default now()
);
alter table kasa_private.system_devices enable row level security;alter table kasa_private.system_measurements enable row level security;alter table kasa_private.system_sensor_alerts enable row level security;
revoke all on kasa_private.system_devices,kasa_private.system_measurements,kasa_private.system_sensor_alerts from public,anon,authenticated;
drop trigger if exists system_immutable on kasa_private.system_measurements;
create trigger system_immutable before update or delete on kasa_private.system_measurements for each row execute function kasa_private.system_append_only();
create or replace function public.kasa_system_device_key(p_device uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'key_id',key_id,'node_id',node_id,'metric',metric,'unit',unit,'public_key',public_key,'active',active,'revoked',revoked) from kasa_private.system_devices where id=p_device
$$;
create or replace function public.kasa_system_ingest_verified(p_device uuid,p_sequence bigint,p_measured_at timestamptz,p_value double precision,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d kasa_private.system_devices%rowtype;old kasa_private.system_measurements%rowtype;v_id bigint;quality text;begin
 select * into d from kasa_private.system_devices where id=p_device for update;
 if not found or not d.active or d.revoked then perform kasa_private.fail('KASA_DEVICE_UNTRUSTED','Device not active.');end if;
 if p_sequence is null or p_sequence<1 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_value is null or p_value not between -1000000000000 and 1000000000000 or p_measured_at is null or p_measured_at>now()+interval '2 minutes' or p_measured_at<now()-interval '24 hours' then perform kasa_private.fail('KASA_BAD_READING','Invalid packet.');end if;
 select * into old from kasa_private.system_measurements where device_id=d.id and sequence=p_sequence;
 if found then
  if old.payload_hash<>p_hash then perform kasa_private.fail('KASA_PACKET_REUSED','Sequence already used for different content.');end if;
  return jsonb_build_object('recorded',false,'id',old.id);
 end if;
 if p_sequence<=d.last_sequence then perform kasa_private.fail('KASA_OLD_SEQUENCE','Out-of-order packet.');end if;
 quality:=case when d.calibration_until<=now() then 'uncalibrated' when p_measured_at<now()-make_interval(secs=>d.max_age_seconds) then 'stale' when p_value<d.min_value or p_value>d.max_value then 'outside_review_threshold' else 'in_range' end;
 insert into kasa_private.system_measurements(device_id,sequence,measured_at,value,payload_hash,quality) values(d.id,p_sequence,p_measured_at,p_value,p_hash,quality) returning id into v_id;
 update kasa_private.system_devices set last_sequence=p_sequence where id=d.id;
 if quality='outside_review_threshold' then
  insert into kasa_private.system_sensor_alerts(measurement_id,node_id) values(v_id,d.node_id);
  perform kasa_private.system_emit(d.node_id,'sensor.review_requested',jsonb_build_object('measurement_id',v_id,'quality',quality));
 end if;
 return jsonb_build_object('recorded',true,'id',v_id,'quality',quality,'action','review_only');
end $$;
create or replace function public.kasa_system_telemetry(p_district text default 'purulia') returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('device',jsonb_build_object('id',d.id,'name',d.name,'node_id',d.node_id,'metric',d.metric,'unit',d.unit,'calibration_until',d.calibration_until,'max_age_seconds',d.max_age_seconds,'revoked',d.revoked),
 'reading',jsonb_build_object('measured_at',m.measured_at,'received_at',m.received_at,'value',m.value,'signature_verified',m.signature_verified,'quality',m.quality))),'[]'::jsonb)
 from kasa_private.system_devices d join kasa_private.system_nodes n on n.id=d.node_id
 join lateral(select * from kasa_private.system_measurements where device_id=d.id order by measured_at desc,sequence desc limit 1)m on true
 where d.public and d.active and not d.revoked and n.published and not n.sensitive and n.district=p_district
$$;
revoke all on function public.kasa_system_device_key(uuid),public.kasa_system_ingest_verified(uuid,bigint,timestamptz,double precision,text),public.kasa_system_telemetry(text) from public,anon,authenticated;
grant execute on function public.kasa_system_device_key(uuid),public.kasa_system_ingest_verified(uuid,bigint,timestamptz,double precision,text) to service_role;
grant execute on function public.kasa_system_telemetry(text) to anon,authenticated;
commit;
notify pgrst,'reload schema';
