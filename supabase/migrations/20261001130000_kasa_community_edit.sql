-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — volunteer communities: districts + moderator edit
--
-- A community can now work across several West Bengal districts
-- (`districts`, slugs as in places/wb_district_facts.json; Purulia by
-- default). `all_district` now means "across the whole of every listed
-- district"; wards/blocks stay Purulia's.
--
-- Listings can also carry a public phone and email (`links.phone`,
-- `links.email`), and moderators can edit any listing after it is filed
-- (kasa_admin_update_community): name, line, about, districts, wards,
-- blocks, every link, logo and the private coordinator name/phone.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table kasa_private.communities
  add column if not exists districts text[] not null default '{purulia}';

-- Zimmedar India works across Bankura and Purulia (stated by the project owner, 2026-10-01).
update kasa_private.communities set districts = '{bankura,purulia}'
where name = 'Zimmedar India' and not ('bankura' = any(districts));

create or replace function kasa_private.community_districts(p text[]) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  ok constant text[] := array['alipurduar','bankura','birbhum','cooch-behar','dakshin-dinajpur','darjeeling','hooghly',
    'howrah','jalpaiguri','jhargram','kalimpong','kolkata','malda','murshidabad','nadia','north-24-parganas',
    'paschim-bardhaman','paschim-medinipur','purba-bardhaman','purba-medinipur','purulia','south-24-parganas','uttar-dinajpur'];
  v text[];
begin
  v := coalesce((select array_agg(distinct lower(trim(d)) order by lower(trim(d))) from unnest(p) d where nullif(trim(d), '') is not null), '{}');
  if cardinality(v) = 0 or not (v <@ ok) then perform kasa_private.fail('KASA_BAD_FORM', 'Choose the districts the community works in.'); end if;
  return v;
end $$;

-- One https link per network (host checked), plus a public phone and email.
create or replace function kasa_private.community_links(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  k text; v text; out jsonb := '{}'::jsonb;
  hosts constant jsonb := jsonb_build_object(
    'whatsapp',  '^(chat\.whatsapp\.com|wa\.me|(www\.)?whatsapp\.com)$',
    'instagram', '^(www\.)?instagram\.com$',
    'facebook',  '^((www|m|web)\.)?(facebook\.com|fb\.com|fb\.me)$',
    'x',         '^(www\.)?(x\.com|twitter\.com)$',
    'linkedin',  '^([a-z]{2,3}\.)?linkedin\.com$',
    'youtube',   '^((www|m)\.)?(youtube\.com|youtu\.be)$',
    'telegram',  '^(t\.me|telegram\.me)$',
    'website',   '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  for k, v in select key, trim(value) from jsonb_each_text(p) loop
    continue when v is null or v = '';
    if k = 'phone' then
      v := regexp_replace(v, '[^0-9]', '', 'g');
      if v ~ '^(91|0)[6-9][0-9]{9}$' then v := right(v, 10); end if;
      if v !~ '^([6-9][0-9]{9}|0[1-9][0-9]{8,10})$' then
        perform kasa_private.fail('KASA_BAD_LINK', 'Check the phone number: give a 10-digit mobile or a landline with STD code.');
      end if;
    elsif k = 'email' then
      v := lower(v);
      if length(v) > 120 or v !~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
        perform kasa_private.fail('KASA_BAD_LINK', 'Check the email address.');
      end if;
    else
      if not hosts ? k then perform kasa_private.fail('KASA_BAD_FORM', 'Unknown kind of link.'); end if;
      if length(v) > 300 or v !~ '^https://[^\s"<>]+$'
         or lower(substring(v from '^https://([^/?#:]+)')) !~ (hosts ->> k) then
        perform kasa_private.fail('KASA_BAD_LINK', 'Check the ' || k || ' link: it must be a full https:// address.');
      end if;
    end if;
    out := out || jsonb_build_object(k, v);
  end loop;
  return out;
end $$;

create or replace view public.kasa_public_communities as
select c.id, c.name, c.tagline, c.description, c.all_district, c.wards, c.blocks, c.links, c.logo,
       coalesce(c.reviewed_at, c.created_at) as listed_at, c.districts
from kasa_private.communities c
where c.status = 'approved';

create or replace function public.kasa_admin_update_community(p_id uuid, p_name text, p_tagline text, p_about text,
    p_all_district boolean, p_districts text[], p_wards integer[], p_blocks text[], p_links jsonb, p_logo text,
    p_contact_name text, p_contact_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name  text := nullif(trim(p_name), '');
  v_tag   text := nullif(trim(p_tagline), '');
  v_about text := nullif(trim(p_about), '');
  v_all   boolean := coalesce(p_all_district, false);
  v_dist  text[];
  v_wards integer[] := coalesce(p_wards, '{}');
  v_blocks text[] := coalesce(p_blocks, '{}');
  v_links jsonb;
  v_phone text := regexp_replace(coalesce(p_contact_phone, ''), '[^0-9]', '', 'g');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if v_name is null or length(v_name) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Give the community''s name.'); end if;
  if v_tag is null or length(v_tag) > 140 then perform kasa_private.fail('KASA_BAD_FORM', 'Say in one line what they do.'); end if;
  if length(coalesce(v_about, '')) > 800 then perform kasa_private.fail('KASA_TOO_LONG', 'That is too long. Please shorten it.'); end if;
  v_dist := kasa_private.community_districts(p_districts);
  if v_all then
    v_wards := '{}'; v_blocks := '{}';
  else
    if cardinality(v_wards) + cardinality(v_blocks) = 0 or not ('purulia' = any(v_dist)) then
      perform kasa_private.fail('KASA_BAD_FORM', 'Pick Purulia wards or blocks, or tick "whole district".');
    end if;
    if exists (select 1 from unnest(v_wards) w where w is null or w not between 1 and 23)
       or exists (select 1 from unnest(v_blocks) b
                  where not exists (select 1 from kasa_private.areas a where a.kind = 'block' and a.name = b)) then
      perform kasa_private.fail('KASA_BAD_FORM', 'Choose where the community works.');
    end if;
  end if;
  v_links := kasa_private.community_links(p_links);
  if v_links = '{}'::jsonb then perform kasa_private.fail('KASA_BAD_FORM', 'Keep at least one link so people can reach them.'); end if;
  if p_logo is not null and (length(p_logo) > 200000
     or p_logo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$') then
    perform kasa_private.fail('KASA_BAD_FORM', 'The logo must be a JPEG, PNG or WebP image.');
  end if;
  if v_phone ~ '^(91|0)[6-9][0-9]{9}$' then v_phone := right(v_phone, 10); end if;
  if v_phone <> '' and v_phone !~ '^[6-9][0-9]{9}$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give a 10-digit mobile number for the coordinator.');
  end if;

  update kasa_private.communities
  set name = v_name, tagline = v_tag, description = v_about, all_district = v_all, districts = v_dist,
      wards = coalesce((select array_agg(distinct w order by w) from unnest(v_wards) w), '{}'),
      blocks = coalesce((select array_agg(distinct b order by b) from unnest(v_blocks) b), '{}'),
      links = v_links, logo = coalesce(p_logo, logo),
      coordinator_name = coalesce(nullif(trim(p_contact_name), ''), coordinator_name),
      coordinator_contact = coalesce(nullif(v_phone, ''), coordinator_contact)
  where id = p_id;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Group not found.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on public.kasa_public_communities from public, anon, authenticated;
grant select on public.kasa_public_communities to anon, authenticated;
revoke all on function kasa_private.community_districts(text[]) from public, anon, authenticated;
revoke all on function kasa_private.community_links(jsonb) from public, anon, authenticated;
revoke all on function public.kasa_admin_update_community(uuid, text, text, text, boolean, text[], integer[], text[], jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.kasa_admin_update_community(uuid, text, text, text, boolean, text[], integer[], text[], jsonb, text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
