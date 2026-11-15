-- Shared place graph, temporal evidence, independent review and durable commands.
-- No medical records, biometrics, regulatory decisions or automated money movement.
begin;
create table if not exists kasa_private.system_nodes (
 id uuid primary key default gen_random_uuid(), slug text unique not null check(length(slug) between 2 and 120),
 name text not null check(length(name) between 2 and 200), district text not null default 'purulia',
 kind text not null check(kind in ('place','entrance','service','asset','path','organisation')),
 service_type text check(service_type in ('toilet','food','stay','shop','water','health','transport')),
 parent_id uuid references kasa_private.system_nodes(id), entity_id bigint references kasa_private.entities(id),
 reference_lat double precision, reference_lon double precision,
 source_url text check(source_url is null or source_url ~ '^https://'),
 published boolean not null default false, sensitive boolean not null default false,
 revision bigint not null default 1, created_by uuid, created_at timestamptz not null default now(),
 check((reference_lat is null and reference_lon is null) or (reference_lat is not null and reference_lon is not null and reference_lat between -90 and 90 and reference_lon between -180 and 180))
);
create index if not exists system_nodes_district_idx on kasa_private.system_nodes(district,published);
create table if not exists kasa_private.system_links (
 id uuid primary key default gen_random_uuid(), from_id uuid not null references kasa_private.system_nodes(id),
 to_id uuid not null references kasa_private.system_nodes(id),
 kind text not null check(kind in ('contains','access','depends','maintains')), mode text check(mode in ('walk','drive')),
 source_url text not null check(source_url ~ '^https://'), submitted_by uuid not null, reviewed_by uuid,
 published boolean not null default false, created_at timestamptz not null default now(),
 check(from_id<>to_id),check(not published or (reviewed_by is not null and reviewed_by<>submitted_by)),unique(from_id,to_id,kind)
);
create table if not exists kasa_private.system_observations (
 id uuid primary key default gen_random_uuid(), node_id uuid not null references kasa_private.system_nodes(id),
 field text not null check(field in ('coordinates','access_status','open_status','water','toilet_usable','step_free','price','hours','visit_minutes','public_contact','stock_count')),
 value jsonb not null, source_url text not null check(source_url ~ '^https://'),
 document_id bigint references kasa_private.documents(id), assertion_id bigint references kasa_private.assertions(id),
 observed_at timestamptz not null, valid_from timestamptz not null, valid_until timestamptz not null,
 submitted_by uuid not null, recorded_at timestamptz not null default now(),
 check(valid_until>valid_from),check(valid_from>=observed_at)
);
create index if not exists system_observations_node_idx on kasa_private.system_observations(node_id,field,observed_at desc,recorded_at desc);
create table if not exists kasa_private.system_reviews (
 id bigint generated always as identity primary key, observation_id uuid not null references kasa_private.system_observations(id),
 reviewer_id uuid not null, decision text not null check(decision in ('approve','reject','withdraw')),
 reason text not null check(length(reason) between 5 and 1000),created_at timestamptz not null default now()
);
create table if not exists kasa_private.system_interests (
 user_id uuid not null,node_id uuid not null references kasa_private.system_nodes(id),
 relation text not null check(relation in ('owner','operator','contractor','employee')),active boolean not null default true,
 primary key(user_id,node_id)
);
create table if not exists kasa_private.system_commands (
 actor_id uuid not null,request_id uuid not null,action text not null,payload_hash text not null,result jsonb,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
create table if not exists kasa_private.system_events (
 id bigint generated always as identity primary key,node_id uuid references kasa_private.system_nodes(id),
 kind text not null,payload jsonb not null,actor_id uuid,created_at timestamptz not null default now()
);
create table if not exists kasa_private.system_outbox (
 event_id bigint primary key references kasa_private.system_events(id), state text not null default 'pending' check(state in ('pending','leased','done','dead')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,
 last_error text,completed_at timestamptz
);
create table if not exists kasa_private.system_circuits (
 id uuid primary key default gen_random_uuid(),name text not null,access_ids uuid[] not null,
 published boolean not null default false,revision bigint not null default 1,checked_at timestamptz,
 validation_state text not null default 'unverified' check(validation_state in ('unverified','valid','invalid')),
 check(cardinality(access_ids) between 1 and 12)
);
create table if not exists kasa_private.system_interventions (
 id uuid primary key default gen_random_uuid(),node_id uuid not null references kasa_private.system_nodes(id),
 title text not null check(length(title) between 5 and 200),source_url text not null check(source_url ~ '^https://'),
 outcome_field text,outcome_value jsonb,
 cost_paise bigint check(cost_paise>=0),crew_minutes integer check(crew_minutes>0),urgent boolean not null default false,
 state text not null default 'proposed' check(state in ('proposed','reviewed','assigned','completed','accepted','recheck_due','reopened')),
 submitted_by uuid not null,reviewed_by uuid,worker_id uuid,accepted_by uuid,
 evidence_after timestamptz not null default now(),last_checked_at timestamptz,recheck_count integer not null default 0,
 completed_at timestamptz,accepted_at timestamptz,recheck_on timestamptz,revision bigint not null default 1,
 created_at timestamptz not null default now(),check(reviewed_by is null or reviewed_by<>submitted_by)
);
create or replace function kasa_private.system_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Append-only evidence: add a review or superseding observation';end $$;
do $$ declare t text;begin
 foreach t in array array['system_observations','system_reviews','system_events'] loop
  execute format('drop trigger if exists system_immutable on kasa_private.%I',t);
  execute format('create trigger system_immutable before update or delete on kasa_private.%I for each row execute function kasa_private.system_append_only()',t);
 end loop;
 foreach t in array array['system_nodes','system_links','system_observations','system_reviews','system_interests','system_commands','system_events','system_outbox','system_circuits','system_interventions'] loop
  execute format('alter table kasa_private.%I enable row level security',t);
  execute format('revoke all on kasa_private.%I from public,anon,authenticated',t);
 end loop;
end $$;
-- Select the latest ever-approved assertion first. Expiry or withdrawal must not
-- resurrect an older assertion, and a new rejected proposal cannot erase a valid one.
create or replace view kasa_private.system_fact_candidates as
select distinct on(o.node_id,o.field) o.*,r.decision,r.reviewer_id,r.created_at reviewed_at
from kasa_private.system_observations o
join lateral(select * from kasa_private.system_reviews where observation_id=o.id order by id desc limit 1) r on true
where o.valid_from<=now() and exists(select 1 from kasa_private.system_reviews where observation_id=o.id and decision='approve')
order by o.node_id,o.field,o.observed_at desc,o.recorded_at desc,o.id;
create or replace view kasa_private.system_current_facts as
select * from kasa_private.system_fact_candidates where decision='approve' and valid_until>now();
revoke all on kasa_private.system_fact_candidates,kasa_private.system_current_facts from public,anon,authenticated;
create or replace function kasa_private.system_emit(p_node uuid,p_kind text,p_payload jsonb) returns bigint
language plpgsql security definer set search_path='' as $$ declare v_id bigint;begin
 insert into kasa_private.system_events(node_id,kind,payload,actor_id) values(p_node,p_kind,p_payload,auth.uid()) returning id into v_id;
 insert into kasa_private.system_outbox(event_id) values(v_id);return v_id;
end $$;
create or replace function kasa_private.system_dependencies(p_node uuid) returns uuid[]
language sql stable security definer set search_path='' as $$
 with recursive d(id) as(select p_node union select l.to_id from kasa_private.system_links l join d on l.from_id=d.id where l.published and l.kind in('depends','access'))
 select array_agg(id) from d
$$;
create or replace function kasa_private.system_touch(p_node uuid) returns uuid[]
language plpgsql security definer set search_path='' as $$ declare ids uuid[];begin
 with recursive a(id) as(select p_node union select l.from_id from kasa_private.system_links l join a on l.to_id=a.id where l.published and l.kind in('depends','access')) select array_agg(id) into ids from a;
 update kasa_private.system_nodes set revision=revision+1 where id=any(ids);return ids;
end $$;
create or replace function kasa_private.system_usable(p_node uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from kasa_private.system_nodes n
 join kasa_private.system_current_facts a on a.node_id=n.id and a.field='access_status' and a.value='"open"'::jsonb
 join kasa_private.system_current_facts c on c.node_id=n.id and c.field='coordinates'
 where n.id=p_node and n.kind='entrance' and n.published and not n.sensitive
 and not exists(select 1 from unnest(kasa_private.system_dependencies(n.id)) dep
  where not exists(select 1 from kasa_private.system_nodes dn join kasa_private.system_current_facts f on f.node_id=dn.id and f.field='access_status' and f.value='"open"'::jsonb
    where dn.id=dep and dn.published and not dn.sensitive)))
$$;
create or replace function kasa_private.system_process_events(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$ declare q record;e record;n integer:=0;begin
 for q in select * from kasa_private.system_outbox where (state='pending' and available_at<=now()) or (state='leased' and lease_until<now()) order by event_id limit least(greatest(p_limit,1),200) for update skip locked loop
  update kasa_private.system_outbox set state='leased',attempts=attempts+1,lease_until=now()+interval '2 minutes' where event_id=q.event_id;
  begin
   select * into e from kasa_private.system_events where id=q.event_id;
   if e.node_id is not null then
    update kasa_private.system_circuits c set revision=revision+1,checked_at=now(),validation_state=
      case when not exists(select 1 from unnest(c.access_ids) a where not kasa_private.system_usable(a)) then 'valid' else 'invalid' end
      where e.node_id=any(c.access_ids) or exists(select 1 from jsonb_array_elements_text(coalesce(e.payload->'affected_ids','[]'::jsonb)) affected where affected::uuid=any(c.access_ids));
   end if;
   update kasa_private.system_outbox set state='done',completed_at=now(),lease_until=null,last_error=null where event_id=q.event_id;n:=n+1;
  exception when others then
   update kasa_private.system_outbox set state=case when attempts>=5 then 'dead' else 'pending' end,available_at=now()+interval '1 minute',lease_until=null,last_error=left(sqlerrm,500) where event_id=q.event_id;
  end;
 end loop;
 update kasa_private.system_interventions set state='recheck_due',revision=revision+1 where state='accepted' and recheck_on<=now();
 return n;
end $$;
-- Public projections contain approved facts only; no identities, proposed facts or private interests.
create or replace function public.kasa_system_snapshot(p_district text default 'purulia') returns jsonb
language sql stable security definer set search_path='' as $$
 with n as(select * from kasa_private.system_nodes where published and not sensitive and district=p_district order by name,id limit 1000)
 select jsonb_build_object('schema',1,'at',now(),'district',p_district,
 'limited',(select count(*)>1000 from kasa_private.system_nodes where published and not sensitive and district=p_district),
 'nodes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name,'kind',kind,'service_type',service_type,'parent_id',parent_id,'reference_lat',reference_lat,'reference_lon',reference_lon,'source_url',source_url,'revision',revision,'usable',kasa_private.system_usable(id))) from n),'[]'::jsonb),
 'facts',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'node_id',f.node_id,'field',f.field,'value',f.value,'source_url',f.source_url,'observed_at',f.observed_at,'recorded_at',f.recorded_at,'valid_from',f.valid_from,'valid_until',f.valid_until,'decision',f.decision)) from kasa_private.system_current_facts f join n on n.id=f.node_id),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'from_id',l.from_id,'to_id',l.to_id,'kind',l.kind,'mode',l.mode,'source_url',l.source_url)) from kasa_private.system_links l where l.published and l.from_id in(select id from n) and l.to_id in(select id from n)),'[]'::jsonb),
 'interventions',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'node_id',i.node_id,'title',i.title,'state',i.state,'costPaise',i.cost_paise,'crewMinutes',i.crew_minutes,'urgent',i.urgent,'evidenceReviewed',i.reviewed_by is not null,'daysWaiting',greatest(0,extract(day from now()-i.created_at)),'blockedRoutes',(select count(*) from kasa_private.system_circuits c where c.published and exists(select 1 from unnest(c.access_ids) a where i.node_id=any(kasa_private.system_dependencies(a)) and not kasa_private.system_usable(a))),'basicServices',case when n.service_type in('toilet','water','health') then 1 else 0 end,'source_url',i.source_url,'recheck_on',i.recheck_on)) from kasa_private.system_interventions i join n on n.id=i.node_id where i.reviewed_by is not null),'[]'::jsonb))
$$;
create or replace function public.kasa_system_versions(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'usable',kasa_private.system_usable(id))),'[]'::jsonb)
 from kasa_private.system_nodes where published and not sensitive and id=any(p_ids[1:100])
$$;
-- Validate structured public facts before they can enter a review queue.
create or replace function kasa_private.system_validate_fact(p_field text,p_value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$ declare n numeric;begin
 if p_field='coordinates' then return jsonb_typeof(p_value)='object' and jsonb_typeof(p_value->'lat')='number' and jsonb_typeof(p_value->'lon')='number' and p_value- 'lat' - 'lon'='{}'::jsonb and (p_value->>'lat')::numeric between -90 and 90 and (p_value->>'lon')::numeric between -180 and 180;
 elsif p_field='access_status' then return p_value in('"open"','"closed"','"restricted"','"unknown"');
 elsif p_field in('open_status','water','toilet_usable','step_free') then return jsonb_typeof(p_value)='boolean';
 elsif p_field='visit_minutes' then n:=(p_value#>>'{}')::numeric;return jsonb_typeof(p_value)='number' and n=trunc(n) and n between 1 and 480;
 elsif p_field='price' then return jsonb_typeof(p_value)='object' and p_value-'paise'-'basis'-'currency'='{}'::jsonb and (p_value->>'paise')::numeric>=0 and (p_value->>'paise')::numeric<=1000000000 and (p_value->>'paise')::numeric=trunc((p_value->>'paise')::numeric) and p_value->>'basis' in('group','person','room_night','person_night') and p_value->>'currency'='INR';
 elsif p_field='hours' then return jsonb_typeof(p_value)='object' and p_value-'openMinute'-'closeMinute'='{}'::jsonb and (p_value->>'openMinute')::integer between 0 and 1439 and (p_value->>'closeMinute')::integer between 1 and 1440 and (p_value->>'closeMinute')::integer>(p_value->>'openMinute')::integer;
 elsif p_field='public_contact' then return jsonb_typeof(p_value)='object' and p_value-'phone'-'consent'='{}'::jsonb and p_value->>'consent'='true' and p_value->>'phone' ~ '^\+?[0-9 -]{7,20}$';
 elsif p_field='stock_count' then return jsonb_typeof(p_value)='object' and p_value-'item'-'units'-'quantity'='{}'::jsonb and length(p_value->>'item') between 2 and 100 and length(p_value->>'units') between 1 and 30 and (p_value->>'quantity')::numeric between 0 and 10000000;
 end if;return false;
exception when others then return false;end $$;
create or replace function public.kasa_system_command(p_request uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();h text;previous kasa_private.system_commands%rowtype;r jsonb;v_id uuid;n kasa_private.system_nodes%rowtype;o kasa_private.system_observations%rowtype;i kasa_private.system_interventions%rowtype;v_field text;v_from timestamptz;v_until timestamptz;v_observed timestamptz;ttl interval;v_decision text;affected uuid[];v_node uuid;
begin
 if me is null then perform kasa_private.fail('KASA_SIGN_IN','Sign in to submit or review evidence.');end if;
 if p_action='admin_snapshot' then
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN','Moderators only.');end if;
  return jsonb_build_object('devices',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from(select * from kasa_private.system_devices order by created_at desc limit 100)d),
   'nodes',(select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) from(select * from kasa_private.system_nodes order by created_at desc limit 200)n),
   'observations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from(select * from kasa_private.system_observations order by recorded_at desc limit 200)o),
   'reviews',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from(select * from kasa_private.system_reviews order by id desc limit 300)r),
   'outbox',(select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from(select * from kasa_private.system_outbox order by event_id desc limit 100)q),
   'interventions',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from(select * from kasa_private.system_interventions order by created_at desc limit 200)i));
 end if;
 if p_request is null or p_data is null or jsonb_typeof(p_data)<>'object' or length(p_data::text)>20000 then perform kasa_private.fail('KASA_BAD_FORM','Invalid command.');end if;
 h:=encode(sha256(convert_to(p_action||p_data::text,'UTF8')),'hex');
 insert into kasa_private.system_commands(actor_id,request_id,action,payload_hash) values(me,p_request,p_action,h) on conflict do nothing;
 select * into previous from kasa_private.system_commands where actor_id=me and request_id=p_request for update;
 if previous.payload_hash<>h then perform kasa_private.fail('KASA_REQUEST_REUSED','This request key was used for different data.');end if;
 if previous.result is not null then return previous.result;end if;
 if p_action not in('observe','propose_intervention') and not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN','This operation requires a moderator.');end if;
 if p_action='node' then
  insert into kasa_private.system_nodes(slug,name,district,kind,service_type,parent_id,source_url,published,sensitive,created_by)
  values(p_data->>'slug',p_data->>'name',coalesce(p_data->>'district','purulia'),p_data->>'kind',nullif(p_data->>'service_type',''),nullif(p_data->>'parent_id','')::uuid,p_data->>'source_url',false,coalesce((p_data->>'sensitive')::boolean,false),me) returning id into v_id;
  r:=jsonb_build_object('id',v_id,'published',false);
 elsif p_action='publish_node' then
  select * into n from kasa_private.system_nodes where id=(p_data->>'id')::uuid for update;
  if not found or n.created_by=me or exists(select 1 from kasa_private.system_interests where user_id=me and active and node_id in(n.id,n.parent_id)) then perform kasa_private.fail('KASA_INDEPENDENT_REVIEW','A different moderator must publish this node.');end if;
  if n.source_url is null then perform kasa_private.fail('KASA_NEEDS_SOURCE','A public node needs a source reference.');end if;
  update kasa_private.system_nodes set published=true,revision=revision+1 where id=n.id;r:=jsonb_build_object('id',n.id,'published',true);perform kasa_private.system_emit(n.id,'node.published',r);
 elsif p_action='link' then
  insert into kasa_private.system_links(from_id,to_id,kind,mode,source_url,submitted_by) values((p_data->>'from_id')::uuid,(p_data->>'to_id')::uuid,p_data->>'kind',nullif(p_data->>'mode',''),p_data->>'source_url',me) returning id into v_id;r:=jsonb_build_object('id',v_id);
 elsif p_action='publish_link' then
  perform pg_advisory_xact_lock(hashtext('parishkar-system-graph-v1'));
  update kasa_private.system_links set published=true,reviewed_by=me where id=(p_data->>'id')::uuid and submitted_by<>me and not exists(select 1 from kasa_private.system_interests x where x.user_id=me and x.active and x.node_id in(system_links.from_id,system_links.to_id)) returning id into v_id;
  if v_id is null then perform kasa_private.fail('KASA_INDEPENDENT_REVIEW','Another moderator must publish this link.');end if;if exists(select 1 from kasa_private.system_links l where l.id=v_id and l.kind in('depends','access') and l.from_id=any(kasa_private.system_dependencies(l.to_id))) then perform kasa_private.fail('KASA_GRAPH_CYCLE','Required-access links cannot form a cycle.');end if;select from_id into v_node from kasa_private.system_links where id=v_id;affected:=kasa_private.system_touch(v_node);r:=jsonb_build_object('id',v_id,'affected_ids',to_jsonb(affected));perform kasa_private.system_emit(v_node,'link.published',r);
 elsif p_action='observe' then
  select * into n from kasa_private.system_nodes where id=(p_data->>'node_id')::uuid;
  if not found or (not n.published and not kasa_private.is_admin()) or n.sensitive and not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_FOUND','No public node to observe.');end if;
  perform kasa_private.net_limit('system_observe',30,100,'Too many observations. Try later.');
  v_field:=p_data->>'field';if kasa_private.system_validate_fact(v_field,p_data->'value') is not true then perform kasa_private.fail('KASA_BAD_FORM','This field requires a valid structured value.');end if;
  v_observed:=(p_data->>'observed_at')::timestamptz;v_from:=coalesce((p_data->>'valid_from')::timestamptz,v_observed);v_until:=(p_data->>'valid_until')::timestamptz;
  ttl:=case when v_field in('access_status','open_status') then interval '4 hours' when v_field in('water','toilet_usable','stock_count') then interval '24 hours' when v_field='price' then interval '7 days' when v_field in('hours','public_contact') then interval '30 days' else interval '180 days' end;
  if v_observed is null or v_from is null or v_until is null or v_observed>now()+interval '2 minutes' or v_from<v_observed or v_until<=v_from or v_until>v_observed+ttl or v_until<=now() then perform kasa_private.fail('KASA_BAD_TIME','Evidence times are missing, expired or outside the field review window.');end if;
  insert into kasa_private.system_observations(node_id,field,value,source_url,document_id,assertion_id,observed_at,valid_from,valid_until,submitted_by)
  values(n.id,v_field,p_data->'value',p_data->>'source_url',nullif(p_data->>'document_id','')::bigint,nullif(p_data->>'assertion_id','')::bigint,v_observed,v_from,v_until,me) returning id into v_id;r:=jsonb_build_object('id',v_id,'state','awaiting_review');
 elsif p_action='review' then
  select * into o from kasa_private.system_observations where id=(p_data->>'id')::uuid for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND','Observation not found.');end if;
  select * into n from kasa_private.system_nodes where id=o.node_id for update;v_decision:=p_data->>'decision';
  if v_decision='approve' and (o.submitted_by=me or exists(select 1 from kasa_private.system_interests where user_id=me and active and node_id in(n.id,n.parent_id))) then perform kasa_private.fail('KASA_CONFLICT','The author, owner, operator or contractor cannot approve this evidence.');end if;
  if v_decision='approve' and o.valid_until<=now() then perform kasa_private.fail('KASA_BAD_TIME','Evidence has expired.');end if;
  insert into kasa_private.system_reviews(observation_id,reviewer_id,decision,reason) values(o.id,me,v_decision,p_data->>'reason');
  affected:=kasa_private.system_touch(n.id);
  r:=jsonb_build_object('id',o.id,'decision',v_decision,'node_id',n.id,'revision',n.revision+1,'affected_ids',to_jsonb(affected));perform kasa_private.system_emit(n.id,'observation.reviewed',r);
 elsif p_action='interest' then
  insert into kasa_private.system_interests(user_id,node_id,relation,active) values((p_data->>'user_id')::uuid,(p_data->>'node_id')::uuid,p_data->>'relation',true)
   on conflict(user_id,node_id) do update set relation=excluded.relation,active=true;r:=jsonb_build_object('recorded',true);
 elsif p_action='circuit' then
  if jsonb_array_length(p_data->'access_ids') not between 1 and 12 then perform kasa_private.fail('KASA_BAD_FORM','Choose 1–12 entrances.');end if;
  if exists(select 1 from jsonb_array_elements_text(p_data->'access_ids') a where not kasa_private.system_usable(a::uuid)) then perform kasa_private.fail('KASA_ACCESS_UNKNOWN','Every entrance needs current independently reviewed access and coordinate evidence.');end if;
  insert into kasa_private.system_circuits(name,access_ids,published,validation_state,checked_at) values(p_data->>'name',array(select a::uuid from jsonb_array_elements_text(p_data->'access_ids') a),true,'valid',now()) returning id into v_id;r:=jsonb_build_object('id',v_id);
 elsif p_action='propose_intervention' then
  select * into n from kasa_private.system_nodes where id=(p_data->>'node_id')::uuid and published and not sensitive;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND','Public asset not found.');end if;
  perform kasa_private.net_limit('system_intervention',10,30,'Too many proposals. Try later.');
  insert into kasa_private.system_interventions(node_id,title,source_url,outcome_field,outcome_value,cost_paise,crew_minutes,urgent,submitted_by)
   values(n.id,p_data->>'title',p_data->>'source_url',p_data->>'outcome_field',p_data->'outcome_value',nullif(p_data->>'cost_paise','')::bigint,nullif(p_data->>'crew_minutes','')::integer,coalesce((p_data->>'urgent')::boolean,false),me) returning id into v_id;r:=jsonb_build_object('id',v_id,'state','proposed');
 elsif p_action='intervention_step' then
  select * into i from kasa_private.system_interventions where id=(p_data->>'id')::uuid for update;
  if not found or (p_data->>'revision')::bigint is distinct from i.revision then perform kasa_private.fail('KASA_STALE_VERSION','Reload the current intervention before deciding.');end if;
  v_decision:=p_data->>'step';
  if v_decision='review' and i.state='proposed' and me<>i.submitted_by and not exists(select 1 from kasa_private.system_interests where user_id=me and node_id=i.node_id and active) then
   if kasa_private.system_validate_fact(i.outcome_field,i.outcome_value) is not true then perform kasa_private.fail('KASA_NEEDS_OUTCOME','Define a typed, independently checkable outcome before review.');end if;
   update kasa_private.system_interventions set state='reviewed',reviewed_by=me where id=i.id;
  elsif v_decision='assign' and i.state in('reviewed','reopened') then
   if p_data->>'worker_id' is null then perform kasa_private.fail('KASA_BAD_FORM','Assign an accountable worker account.');end if;
   update kasa_private.system_interventions set state='assigned',worker_id=(p_data->>'worker_id')::uuid,evidence_after=clock_timestamp() where id=i.id;
  elsif v_decision='complete' and i.state='assigned' then
   if not exists(select 1 from kasa_private.system_observations where node_id=i.node_id and submitted_by=i.worker_id and recorded_at>i.evidence_after and observed_at>=i.evidence_after) then perform kasa_private.fail('KASA_NEEDS_EVIDENCE','The assigned worker must submit current evidence.');end if;
   update kasa_private.system_interventions set state='completed',completed_at=now() where id=i.id;
  elsif v_decision='accept' and i.state='completed' and me is distinct from i.worker_id and me<>i.submitted_by and not exists(select 1 from kasa_private.system_interests where user_id=me and node_id=i.node_id and active) then
   if not exists(select 1 from kasa_private.system_current_facts f where f.node_id=i.node_id and f.recorded_at>=i.completed_at and f.observed_at>=i.completed_at and f.field=i.outcome_field and f.value=i.outcome_value and f.reviewer_id=me and f.submitted_by is distinct from i.worker_id) then perform kasa_private.fail('KASA_NEEDS_EVIDENCE','Independent current outcome evidence is required after completion.');end if;
   update kasa_private.system_interventions set state='accepted',accepted_by=me,accepted_at=now(),recheck_on=now()+interval '7 days' where id=i.id;
  elsif v_decision='recheck' and i.state='recheck_due' and me is distinct from i.worker_id and me<>i.submitted_by and not exists(select 1 from kasa_private.system_interests where user_id=me and node_id=i.node_id and active) then
   if not exists(select 1 from kasa_private.system_current_facts f where f.node_id=i.node_id and f.recorded_at>=i.recheck_on and f.observed_at>=i.recheck_on and f.field=i.outcome_field and f.value=i.outcome_value and f.reviewer_id=me and f.submitted_by is distinct from i.worker_id) then perform kasa_private.fail('KASA_NEEDS_EVIDENCE','A fresh independent follow-up observation is required.');end if;
   update kasa_private.system_interventions set state='accepted',last_checked_at=now(),recheck_count=recheck_count+1,recheck_on=now()+interval '30 days' where id=i.id;
  elsif v_decision='reopen' and i.state in('accepted','recheck_due') and length(p_data->>'reason')>=10 then
   update kasa_private.system_interventions set state='reopened',accepted_at=null,recheck_on=null,evidence_after=clock_timestamp() where id=i.id;
  else perform kasa_private.fail('KASA_BAD_TRANSITION','This decision is not allowed for this state or reviewer.');end if;
  update kasa_private.system_interventions set revision=revision+1 where id=i.id;r:=jsonb_build_object('id',i.id,'revision',i.revision+1);perform kasa_private.system_emit(i.node_id,'intervention.changed',r);
 elsif p_action='device' then
  if p_data->>'public_key' !~ '^[A-Za-z0-9+/]{43}=$' then perform kasa_private.fail('KASA_BAD_KEY','Use a 32-byte Ed25519 public key in base64.');end if;
  insert into kasa_private.system_devices(node_id,name,metric,unit,public_key,source_url,calibration_until,min_value,max_value,public,enrolled_by)
   values((p_data->>'node_id')::uuid,p_data->>'name',p_data->>'metric',p_data->>'unit',p_data->>'public_key',p_data->>'source_url',(p_data->>'calibration_until')::timestamptz,(p_data->>'min_value')::double precision,(p_data->>'max_value')::double precision,coalesce((p_data->>'public')::boolean,false),me) returning id into v_id;r:=jsonb_build_object('id',v_id,'active',false);
 elsif p_action='activate_device' then
  update kasa_private.system_devices d set active=true,activated_by=me where d.id=(p_data->>'id')::uuid and d.enrolled_by<>me and d.calibration_until>now() and not d.revoked and not exists(select 1 from kasa_private.system_interests where user_id=me and node_id=d.node_id and active) returning d.id into v_id;
  if v_id is null then perform kasa_private.fail('KASA_INDEPENDENT_REVIEW','A different non-conflicted moderator must check the key binding and calibration.');end if;r:=jsonb_build_object('id',v_id,'active',true);
 elsif p_action='revoke_device' then
  update kasa_private.system_devices set revoked=true,active=false where id=(p_data->>'id')::uuid returning id into v_id;r:=jsonb_build_object('id',v_id,'revoked',true);perform kasa_private.system_emit(null,'device.revoked',r);
 elsif p_action='process_outbox' then r:=jsonb_build_object('processed',kasa_private.system_process_events(100));
 elsif p_action='retry_outbox' then
  update kasa_private.system_outbox set state='pending',attempts=0,available_at=now(),last_error=null where event_id=(p_data->>'event_id')::bigint and state='dead';r:=jsonb_build_object('retried',found);

 else perform kasa_private.fail('KASA_BAD_ACTION','Unsupported operation.');end if;
 update kasa_private.system_commands set result=r where actor_id=me and request_id=p_request;return r;
end $$;
revoke all on function public.kasa_system_snapshot(text),public.kasa_system_versions(uuid[]),public.kasa_system_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.kasa_system_snapshot(text),public.kasa_system_versions(uuid[]) to anon,authenticated;
grant execute on function public.kasa_system_command(uuid,text,jsonb) to authenticated;
revoke all on function kasa_private.system_dependencies(uuid),kasa_private.system_touch(uuid),kasa_private.system_process_events(integer),kasa_private.system_emit(uuid,text,jsonb),kasa_private.system_usable(uuid),kasa_private.system_validate_fact(text,jsonb) from public,anon,authenticated;
commit;
notify pgrst,'reload schema';
