-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — readers correct the figures
--
-- Every figure on the site links to where it was published. When a reader
-- thinks one is wrong, out of date or missing its source, "Suggest a
-- correction" (source-fix.js) sends: which figure, what is right, a link
-- that shows it and how they know. Moderators check the link and fix the
-- page (status 'fixed') or reject it. Nothing on the site changes by itself.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.data_corrections (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  page        text,                                -- page address the reader was on
  what        text not null,                       -- the figure or line they mean
  correction  text not null,                       -- what is right, or what is missing
  source_url  text,                                -- link that shows it
  note        text,                                -- how they know
  email       text,
  ip_hash     text,
  status      text not null default 'pending' check (status in ('pending', 'fixed', 'rejected')),
  reviewed_at timestamptz
);
create index if not exists kasa_data_corrections_status_idx on kasa_private.data_corrections (status, created_at);
alter table kasa_private.data_corrections enable row level security;

create or replace function public.kasa_suggest_data_fix(p_what text, p_correction text, p_source_url text default null,
    p_note text default null, p_email text default null, p_page text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip    text := kasa_private.ip_hash();
  v_what  text := nullif(btrim(p_what), '');
  v_fix   text := nullif(btrim(p_correction), '');
  v_url   text := nullif(btrim(p_source_url), '');
  v_note  text := nullif(btrim(p_note), '');
  v_email text := nullif(btrim(p_email), '');
begin
  if v_what is null or length(v_what) > 1000 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Say which figure or line you mean.');
  end if;
  if v_fix is null or length(v_fix) < 3 or length(v_fix) > 2000 or length(coalesce(v_note, '')) > 1000 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Say what is right (2000 letters at most).');
  end if;
  if v_url is not null and (v_url !~* '^https?://[^\s/]+\.[^\s]+$' or length(v_url) > 500) then
    perform kasa_private.fail('KASA_BAD_FORM', 'The source must be a web link starting with http.');
  end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Check the email address.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_what, v_fix, v_note)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.data_corrections
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 20)
     or (select count(*) from kasa_private.data_corrections where status = 'pending') >= 500 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many sent right now. Please try again tomorrow, or email us.');
  end if;
  insert into kasa_private.data_corrections (page, what, correction, source_url, note, email, ip_hash)
  values (left(p_page, 300), v_what, v_fix, v_url, v_note, v_email, v_ip);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

create or replace function public.kasa_admin_data_fix_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'created_at', c.created_at, 'page', c.page, 'what', c.what,
             'correction', c.correction, 'source_url', c.source_url, 'note', c.note, 'email', c.email) order by c.created_at)
    from kasa_private.data_corrections c where c.status = 'pending'
  ), '[]'::jsonb);
end $$;

-- 'fixed' once the page is corrected (or the source added); 'reject' if the link does not show it.
create or replace function public.kasa_admin_review_data_fix(p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c kasa_private.data_corrections;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('fixed', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Fixed or reject.'); end if;
  update kasa_private.data_corrections
  set status = case p_action when 'fixed' then 'fixed' else 'rejected' end, reviewed_at = now()
  where id = p_id and status = 'pending' returning * into c;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That is not waiting any more.'); end if;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

revoke all on function public.kasa_suggest_data_fix(text, text, text, text, text, text) from public;
grant execute on function public.kasa_suggest_data_fix(text, text, text, text, text, text) to anon, authenticated;
revoke all on function public.kasa_admin_data_fix_queue() from public, anon;
grant execute on function public.kasa_admin_data_fix_queue() to authenticated;
revoke all on function public.kasa_admin_review_data_fix(bigint, text) from public, anon;
grant execute on function public.kasa_admin_review_data_fix(bigint, text) to authenticated;

commit;
