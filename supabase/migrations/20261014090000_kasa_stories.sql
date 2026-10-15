-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — "Behind the numbers": one real story beside a district figure
--
-- A figure on data.html (anaemia, infant deaths, migration…) can carry a short
-- account of one person or place it stands for. Only stories already published
-- somewhere with the person's consent are taken: the sender gives that link and
-- confirms consent, a moderator opens the link before approving, and the text
-- is shown unedited with the link beside it. No photos are taken here.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.stories (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  district    text not null,                       -- place-facts.js slug, e.g. purulia
  stat_label  text not null,                       -- the figure it stands beside, as labelled on data.html
  story       text not null,
  place       text,                                -- village / block / town, as at the source
  source_url  text not null,
  consent     boolean not null check (consent),
  ip_hash     text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  reviewed_at timestamptz,
  review_note text
);
create index if not exists kasa_stories_status_idx on kasa_private.stories (status, created_at);
create index if not exists kasa_stories_district_idx on kasa_private.stories (district, status);
alter table kasa_private.stories enable row level security;

create or replace function public.kasa_submit_story(p_district text, p_stat_label text, p_story text, p_place text,
    p_source_url text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip    text := kasa_private.ip_hash();
  v_stat  text := nullif(btrim(p_stat_label), '');
  v_story text := nullif(btrim(p_story), '');
  v_place text := nullif(btrim(p_place), '');
  v_url   text := nullif(btrim(p_source_url), '');
begin
  if p_district is null or p_district !~ '^[a-z0-9-]{2,40}$' then perform kasa_private.fail('KASA_BAD_FORM', 'Pick a district.'); end if;
  if v_stat is null or length(v_stat) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Pick the figure this story stands beside.'); end if;
  if v_story is null or length(v_story) < 60 or length(v_story) > 1500 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Write the story (60 to 1500 letters).');
  end if;
  if v_place is not null and length(v_place) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Keep the place short.'); end if;
  if v_url is null or v_url !~* '^https?://[^ ]+\.[^ ]+$' or length(v_url) > 300 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Add the link where this story was published.');
  end if;
  if p_consent is not true then
    perform kasa_private.fail('KASA_BAD_FORM', 'Only stories the person agreed to share can go up.');
  end if;
  if kasa_private.text_verdict(v_story) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  perform kasa_private.net_limit('story', 5, 20, 'Too many stories sent from this network. Please try again later.');
  if (v_ip is not null and (select count(*) from kasa_private.stories
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10)
     or (select count(*) from kasa_private.stories where created_at > now() - interval '1 day') >= 200 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many sent right now. Please try again tomorrow.');
  end if;
  insert into kasa_private.stories (district, stat_label, story, place, source_url, consent, ip_hash)
  values (p_district, v_stat, v_story, v_place, v_url, true, v_ip);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- Approved stories for a district, newest first, as sent.
create or replace function public.kasa_stories(p_district text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'stat_label', s.stat_label, 'story', s.story, 'place', s.place,
                                               'source_url', s.source_url, 'checked', s.reviewed_at::date)
                            order by s.reviewed_at desc, s.id desc), '[]'::jsonb)
  from kasa_private.stories s
  where s.district = p_district and s.status = 'approved';
$$;

create or replace function public.kasa_admin_story_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at, 'district', s.district, 'stat_label', s.stat_label,
             'story', s.story, 'place', s.place, 'source_url', s.source_url, 'status', s.status) order by s.status desc, s.created_at)
    from kasa_private.stories s where s.status in ('pending', 'approved')
  ), '[]'::jsonb);
end $$;

-- Approve only after opening the link and finding the story there, told with the person's agreement.
-- Remove takes an approved story down (the person asked, or the source went away).
create or replace function public.kasa_admin_review_story(p_id bigint, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s kasa_private.stories;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'reject', 'remove') then perform kasa_private.fail('KASA_BAD_ACTION', 'Approve, reject or remove.'); end if;
  update kasa_private.stories
  set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'removed' end,
      reviewed_at = now(), review_note = left(p_note, 500)
  where id = p_id and status = case when p_action = 'remove' then 'approved' else 'pending' end
  returning * into s;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That is not waiting any more.'); end if;
  return jsonb_build_object('id', s.id, 'status', s.status);
end $$;

revoke all on function public.kasa_submit_story(text, text, text, text, text, boolean) from public;
grant execute on function public.kasa_submit_story(text, text, text, text, text, boolean) to anon, authenticated;
revoke all on function public.kasa_stories(text) from public;
grant execute on function public.kasa_stories(text) to anon, authenticated;
revoke all on function public.kasa_admin_story_queue() from public, anon;
grant execute on function public.kasa_admin_story_queue() to authenticated;
revoke all on function public.kasa_admin_review_story(bigint, text, text) from public, anon;
grant execute on function public.kasa_admin_review_story(bigint, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
