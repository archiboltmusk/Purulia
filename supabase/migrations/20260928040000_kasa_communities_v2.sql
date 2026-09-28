-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — volunteer communities, v2
--
-- Each listing now carries a square logo, a one-line "what you do", an
-- optional about, where the group works (all of the district, or chosen
-- town wards and CD blocks) and public links (WhatsApp, Instagram, Facebook,
-- X, LinkedIn, YouTube, Telegram, website). The coordinator's name and phone
-- stay in kasa_private and are only readable by moderators. Listings still
-- appear only after a moderator approves them.
--
-- The logo is a small square JPEG/PNG/WebP data URL cropped in the browser,
-- stored with the listing so nothing is public before approval.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table kasa_private.communities
  add column if not exists tagline          text,
  add column if not exists all_district     boolean not null default false,
  add column if not exists blocks           text[] not null default '{}',
  add column if not exists links            jsonb not null default '{}'::jsonb,
  add column if not exists logo             text,
  add column if not exists coordinator_name text;
alter table kasa_private.communities alter column kind drop not null;
alter table kasa_private.communities alter column wards set default '{}';

-- One https link per network; the host must belong to that network.
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
    if not hosts ? k then perform kasa_private.fail('KASA_BAD_FORM', 'Unknown kind of link.'); end if;
    if length(v) > 300 or v !~ '^https://[^\s"<>]+$'
       or lower(substring(v from '^https://([^/?#:]+)')) !~ (hosts ->> k) then
      perform kasa_private.fail('KASA_BAD_LINK', 'Check the ' || k || ' link: it must be a full https:// address.');
    end if;
    out := out || jsonb_build_object(k, v);
  end loop;
  return out;
end $$;

drop function if exists public.kasa_register_community(text, text, integer[], text, text, text, boolean);

create or replace function public.kasa_register_community(p_name text, p_tagline text, p_about text,
    p_all_district boolean, p_wards integer[], p_blocks text[], p_links jsonb, p_logo text,
    p_contact_name text, p_contact_phone text, p_adult boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip    text := kasa_private.ip_hash();
  v_name  text := nullif(trim(p_name), '');
  v_tag   text := nullif(trim(p_tagline), '');
  v_about text := nullif(trim(p_about), '');
  v_all   boolean := coalesce(p_all_district, false);
  v_wards integer[] := coalesce(p_wards, '{}');
  v_blocks text[] := coalesce(p_blocks, '{}');
  v_links jsonb;
  v_phone text := regexp_replace(coalesce(p_contact_phone, ''), '[^0-9]', '', 'g');
begin
  if v_name is null or length(v_name) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Give your community''s name.'); end if;
  if v_tag is null or length(v_tag) > 140 then perform kasa_private.fail('KASA_BAD_FORM', 'Say in one line what you do.'); end if;
  if length(coalesce(v_about, '')) > 800 then perform kasa_private.fail('KASA_TOO_LONG', 'That is too long. Please shorten it.'); end if;
  if v_all then
    v_wards := '{}'; v_blocks := '{}';
  else
    if cardinality(v_wards) + cardinality(v_blocks) = 0 then
      perform kasa_private.fail('KASA_BAD_FORM', 'Choose where your community works.');
    end if;
    if exists (select 1 from unnest(v_wards) w where w is null or w not between 1 and 23)
       or exists (select 1 from unnest(v_blocks) b
                  where not exists (select 1 from kasa_private.areas a where a.kind = 'block' and a.name = b)) then
      perform kasa_private.fail('KASA_BAD_FORM', 'Choose where your community works.');
    end if;
  end if;
  v_links := kasa_private.community_links(p_links);
  if v_links = '{}'::jsonb then perform kasa_private.fail('KASA_BAD_FORM', 'Add at least one link so people can reach you.'); end if;
  if p_logo is null or length(p_logo) > 200000
     or p_logo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Upload a logo.');
  end if;
  if nullif(trim(p_contact_name), '') is null or length(p_contact_name) > 120 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give your name (kept private).');
  end if;
  if v_phone ~ '^(91|0)[6-9][0-9]{9}$' then v_phone := right(v_phone, 10); end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give a 10-digit mobile number (kept private).');
  end if;
  if not coalesce(p_adult, false) then
    perform kasa_private.fail('KASA_ADULT_REQUIRED', 'The community must be registered by an adult (18 or older).');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, v_tag, v_about)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.communities
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 3)
     or (select count(*) from kasa_private.communities where created_at > now() - interval '1 day') >= 50 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many registrations right now. Please try again tomorrow.');
  end if;

  insert into kasa_private.communities (name, tagline, description, all_district, wards, blocks, links, logo,
                                        coordinator_name, coordinator_contact, ip_hash)
  values (v_name, v_tag, v_about, v_all,
          coalesce((select array_agg(distinct w order by w) from unnest(v_wards) w), '{}'),
          coalesce((select array_agg(distinct b order by b) from unnest(v_blocks) b), '{}'),
          v_links, p_logo, trim(p_contact_name), v_phone, v_ip);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

drop view if exists public.kasa_public_communities;
create view public.kasa_public_communities as
select c.id, c.name, c.tagline, c.description, c.all_district, c.wards, c.blocks, c.links, c.logo,
       coalesce(c.reviewed_at, c.created_at) as listed_at
from kasa_private.communities c
where c.status = 'approved';

create or replace function public.kasa_admin_communities() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(to_jsonb(c) - 'ip_hash' order by (c.status = 'pending') desc, c.created_at desc)
                   from kasa_private.communities c), '[]'::jsonb);
end $$;

revoke all on public.kasa_public_communities from public, anon, authenticated;
grant select on public.kasa_public_communities to anon, authenticated;
revoke all on function kasa_private.community_links(jsonb) from public, anon, authenticated;
revoke all on function public.kasa_register_community(text, text, text, boolean, integer[], text[], jsonb, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.kasa_register_community(text, text, text, boolean, integer[], text[], jsonb, text, text, text, boolean) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
