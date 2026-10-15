-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — "Reply from this leader" on every MLA and MP profile
--
-- Beside the record a profile shows (Lok Sabha work, affidavit link, MP fund),
-- the leader gets a place to answer. Anyone, usually their office, sends what
-- the leader said with the date and a link to where they said it. Nothing is
-- public until a moderator has opened that link; then kasa_rep_replies()
-- returns it, unedited, under the profile.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.rep_replies (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  rep_key     text not null,                       -- kasa.js profile key: ac:N, pc:N, mla:N, mp:<seat>, rs:i, min:i
  rep_name    text not null,
  reply       text not null,
  said_on     date not null,
  source_url  text not null,
  ip_hash     text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  review_note text
);
create index if not exists kasa_rep_replies_status_idx on kasa_private.rep_replies (status, created_at);
create index if not exists kasa_rep_replies_key_idx on kasa_private.rep_replies (rep_key, status);
alter table kasa_private.rep_replies enable row level security;

create or replace function public.kasa_submit_rep_reply(p_rep_key text, p_rep_name text, p_reply text, p_said_on date, p_source_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip    text := kasa_private.ip_hash();
  v_name  text := nullif(btrim(p_rep_name), '');
  v_reply text := nullif(btrim(p_reply), '');
  v_url   text := nullif(btrim(p_source_url), '');
begin
  if p_rep_key is null or p_rep_key !~ '^(ac|pc|mla|mp|rs|min):[A-Za-z0-9 .()&''-]{1,60}$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Open the leader''s profile first.');
  end if;
  if v_name is null or length(v_name) > 120 then perform kasa_private.fail('KASA_BAD_FORM', 'Open the leader''s profile first.'); end if;
  if v_reply is null or length(v_reply) < 10 or length(v_reply) > 1500 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Write what they said (10 to 1500 letters).');
  end if;
  if p_said_on is null or p_said_on > current_date or p_said_on < date '2000-01-01' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Add the date they said it.');
  end if;
  if v_url is null or v_url !~* '^https?://[^ ]+\.[^ ]+$' or length(v_url) > 300 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Add the link where they said it.');
  end if;
  if kasa_private.text_verdict(v_reply) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  perform kasa_private.net_limit('rep_reply', 5, 20, 'Too many replies sent from this network. Please try again later.');
  if (v_ip is not null and (select count(*) from kasa_private.rep_replies
                            where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10)
     or (select count(*) from kasa_private.rep_replies where created_at > now() - interval '1 day') >= 200 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many sent right now. Please try again tomorrow.');
  end if;
  insert into kasa_private.rep_replies (rep_key, rep_name, reply, said_on, source_url, ip_hash)
  values (p_rep_key, v_name, v_reply, p_said_on, v_url, v_ip);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- Approved replies for one profile, newest first, as sent (a moderator may only approve or reject).
create or replace function public.kasa_rep_replies(p_rep_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('reply', r.reply, 'said_on', r.said_on, 'source_url', r.source_url,
                                               'checked', r.reviewed_at::date) order by r.said_on desc, r.id desc), '[]'::jsonb)
  from kasa_private.rep_replies r
  where r.rep_key = p_rep_key and r.status = 'approved';
$$;

create or replace function public.kasa_admin_rep_reply_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'rep_key', r.rep_key, 'rep_name', r.rep_name,
             'reply', r.reply, 'said_on', r.said_on, 'source_url', r.source_url) order by r.created_at)
    from kasa_private.rep_replies r where r.status = 'pending'
  ), '[]'::jsonb);
end $$;

-- Approve only after opening the link and finding the leader saying this there.
create or replace function public.kasa_admin_review_rep_reply(p_id bigint, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r kasa_private.rep_replies;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Approve or reject.'); end if;
  update kasa_private.rep_replies
  set status = case p_action when 'approve' then 'approved' else 'rejected' end, reviewed_at = now(), review_note = left(p_note, 500)
  where id = p_id and status = 'pending' returning * into r;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That is not waiting any more.'); end if;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

revoke all on function public.kasa_submit_rep_reply(text, text, text, date, text) from public;
grant execute on function public.kasa_submit_rep_reply(text, text, text, date, text) to anon, authenticated;
revoke all on function public.kasa_rep_replies(text) from public;
grant execute on function public.kasa_rep_replies(text) to anon, authenticated;
revoke all on function public.kasa_admin_rep_reply_queue() from public, anon;
grant execute on function public.kasa_admin_rep_reply_queue() to authenticated;
revoke all on function public.kasa_admin_review_rep_reply(bigint, text, text) from public, anon;
grant execute on function public.kasa_admin_review_rep_reply(bigint, text, text) to authenticated;

commit;
