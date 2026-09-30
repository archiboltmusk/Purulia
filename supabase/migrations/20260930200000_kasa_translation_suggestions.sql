-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — readers fix the Bengali wording
--
-- With "Suggest a better translation" switched on, a reader taps any Bengali
-- text on the site and sends a better version. Each suggestion names the
-- string it replaces: ns is the dictionary ('kasa' = kasa-i18n.js, otherwise
-- the page, e.g. 'ward' = ward-i18n.js) and key is the string's key there.
-- Nothing changes on the site until a moderator approves it; then
-- kasa_translations() returns the newest approved text for each string and
-- the pages use it in place of the built-in one.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.translation_suggestions (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  lang        text not null default 'bn' check (lang in ('bn')),
  ns          text not null,
  key         text not null,
  current     text not null,                       -- what the site showed
  suggested   text not null,
  note        text,
  page        text,
  ip_hash     text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz
);
create index if not exists kasa_translation_suggestions_status_idx on kasa_private.translation_suggestions (status, created_at);
create index if not exists kasa_translation_suggestions_key_idx on kasa_private.translation_suggestions (lang, ns, key, status);
alter table kasa_private.translation_suggestions enable row level security;

create or replace function public.kasa_suggest_translation(p_ns text, p_key text, p_current text, p_suggested text,
    p_note text default null, p_page text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := kasa_private.ip_hash();
  v_sug  text := nullif(btrim(p_suggested), '');
  v_note text := nullif(btrim(p_note), '');
begin
  if p_ns is null or p_ns !~ '^[a-z0-9-]{2,40}$' or p_key is null or p_key !~ '^[A-Za-z0-9_.-]{1,80}$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Tap the text you want to fix.');
  end if;
  if v_sug is null or length(v_sug) > 2000 or length(coalesce(p_current, '')) > 2000 or length(coalesce(v_note, '')) > 300 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Write the better version (2000 letters at most).');
  end if;
  if v_sug = btrim(coalesce(p_current, '')) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Change the text first.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_sug, v_note)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.translation_suggestions
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 30)
     or (select count(*) from kasa_private.translation_suggestions where status = 'pending') >= 1000 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many sent right now. Please try again tomorrow.');
  end if;
  insert into kasa_private.translation_suggestions (ns, key, current, suggested, note, page, ip_hash)
  values (p_ns, p_key, left(coalesce(p_current, ''), 2000), v_sug, v_note, left(p_page, 200), v_ip);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- Approved wording: { ns: { key: text } }, the newest approval for each string.
create or replace function public.kasa_translations(p_lang text default 'bn')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(ns, m), '{}'::jsonb)
  from (select ns, jsonb_object_agg(key, suggested) m
        from (select distinct on (ns, key) ns, key, suggested
              from kasa_private.translation_suggestions
              where lang = p_lang and status = 'approved'
              order by ns, key, reviewed_at desc) a
        group by ns) b;
$$;

create or replace function public.kasa_admin_translation_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at, 'lang', s.lang, 'ns', s.ns, 'key', s.key,
             'current', s.current, 'suggested', s.suggested, 'note', s.note, 'page', s.page) order by s.created_at)
    from kasa_private.translation_suggestions s where s.status = 'pending'
  ), '[]'::jsonb);
end $$;

-- Approve (optionally with the moderator's own edit of the text) or reject.
create or replace function public.kasa_admin_review_translation(p_id bigint, p_action text, p_text text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s kasa_private.translation_suggestions;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Approve or reject.'); end if;
  update kasa_private.translation_suggestions
  set status = case p_action when 'approve' then 'approved' else 'rejected' end,
      suggested = case when p_action = 'approve' and nullif(btrim(p_text), '') is not null then left(btrim(p_text), 2000) else suggested end,
      reviewed_at = now()
  where id = p_id and status = 'pending' returning * into s;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That is not waiting any more.'); end if;
  return jsonb_build_object('id', s.id, 'status', s.status);
end $$;

revoke all on function public.kasa_suggest_translation(text, text, text, text, text, text) from public;
grant execute on function public.kasa_suggest_translation(text, text, text, text, text, text) to anon, authenticated;
revoke all on function public.kasa_translations(text) from public;
grant execute on function public.kasa_translations(text) to anon, authenticated;
revoke all on function public.kasa_admin_translation_queue() from public, anon;
grant execute on function public.kasa_admin_translation_queue() to authenticated;
revoke all on function public.kasa_admin_review_translation(bigint, text, text) from public, anon;
grant execute on function public.kasa_admin_review_translation(bigint, text, text) to authenticated;

commit;
