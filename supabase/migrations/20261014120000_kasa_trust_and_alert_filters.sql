-- Two additions:
-- 1. The moderation queue carries the facts a moderator weighs before trusting a report
--    (GPS accuracy, the nearest report of the same kind, the reporter's own record), so
--    admin.js can show one trust score with every reason behind it. Nothing here decides
--    anything: the score is a hint on the moderator's screen, never stored or published.
-- 2. Nearby alerts can be narrowed to some kinds of problem and a chosen distance.

create or replace function public.kasa_admin_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select r.id, r.created_at, r.category, r.severity, r.ward_no, r.description, r.landmark, r.photo_url,
               r.moderation_status, r.flags, r.moderation_labels,
               (select jsonb_agg(jsonb_build_object('reason', f.reason, 'note', f.note, 'at', f.created_at, 'suggested_category', f.suggested_category))
                  from kasa_private.flags f where f.report_id = r.id) as flag_reasons,
               jsonb_build_object(
                 'accuracy_m', round(r.accuracy_m::numeric),
                 'near_same_m', (select round(min(kasa_private.distance_m(o.lat, o.lng, r.lat, r.lng))::numeric)
                                 from public.reports o
                                 where o.id <> r.id and o.category = r.category and o.status <> 'resolved'
                                   and o.created_at > r.created_at - interval '90 days'
                                   and o.lat between r.lat - 0.002 and r.lat + 0.002
                                   and o.lng between r.lng - 0.002 and r.lng + 0.002
                                   and coalesce(o.moderation_status, 'approved') <> 'hidden'),
                 'reporter_public', (select count(*) from public.reports o
                                     where r.user_id is not null and o.user_id = r.user_id and o.id <> r.id
                                       and o.moderation_status = 'approved'),
                 'reporter_hidden', (select count(*) from public.reports o
                                     where r.user_id is not null and o.user_id = r.user_id and o.id <> r.id
                                       and o.moderation_status = 'hidden')
               ) as trust
        from public.reports r
        where r.moderation_status in ('review', 'flagged')
           or (r.moderation_status = 'approved' and exists (
                 select 1 from kasa_private.flags f
                 where f.report_id = r.id
                   and f.created_at > coalesce((select max(e.created_at) from kasa_private.events e
                                                where e.report_id::text = r.id::text and e.kind = 'moderated'),
                                               '-infinity'::timestamptz)))
        order by r.created_at desc limit 100) x), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(to_jsonb(y) order by y.needs_attention desc, y.created_at desc) from (
        select c.id, c.report_id, c.created_at, c.photo_url, round(c.distance_m::numeric) as distance_m,
               c.verify_count, c.dispute_count, c.quorum_reached_at, r.photo_url as original_photo_url,
               r.category, r.ward_no, r.description, c.needs_review, c.photo_meta,
               c.needs_review or exists (select 1 from kasa_private.votes hv
                                         where hv.claim_id = c.id and hv.needs_review and hv.voided_at is null) as needs_attention,
               (select jsonb_agg(jsonb_build_object('id', v.id, 'vote', v.vote, 'photo_url', v.photo_url,
                        'distance_m', round(v.distance_m::numeric), 'at', v.created_at,
                        'needs_review', v.needs_review, 'photo_meta', v.photo_meta) order by v.created_at)
                  from kasa_private.votes v where v.claim_id = c.id and v.voided_at is null) as votes
        from kasa_private.claims c join public.reports r on r.id = c.report_id
        where c.status = 'pending' order by c.created_at desc limit 100) y), '[]'::jsonb));
end $$;

-- Alert filters: null = every kind of problem.
alter table kasa_private.push_subs add column if not exists categories text[];

create or replace function public.kasa_push_prefs(p_endpoint text, p_categories text[], p_radius integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_cats text[];
begin
  if p_categories is not null then
    if cardinality(p_categories) > 30 or exists (select 1 from unnest(p_categories) c where c !~ '^[a-z_]{2,40}$') then
      perform kasa_private.fail('KASA_BAD_FORM', 'Unknown kind of problem.');
    end if;
    v_cats := case when cardinality(p_categories) = 0 then null else p_categories end;
  end if;
  update kasa_private.push_subs
     set categories = v_cats,
         radius_m = greatest(100, least(2000, coalesce(p_radius, radius_m)))
   where endpoint = p_endpoint and user_id = me.user_id;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Turn on alerts first.'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.kasa_push_prefs(text, text[], integer) from public, anon;
grant execute on function public.kasa_push_prefs(text, text[], integer) to authenticated;

create or replace function public.kasa_notify_targets(p_report_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
begin
  update public.reports set notified_at = now()
  where id::text = p_report_id and notified_at is null and moderation_status = 'approved'
    and not coalesce(is_duplicate, false) and status = 'open' and created_at > now() - interval '30 minutes'
  returning * into r;
  if not found then return jsonb_build_object('report', null, 'targets', '[]'::jsonb); end if;
  return jsonb_build_object(
    'report', jsonb_build_object('id', r.id, 'category', r.category, 'severity', r.severity, 'ward_no', r.ward_no, 'landmark', r.landmark),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                  'lang', s.lang, 'distance_m', round(kasa_private.distance_m(s.lat, s.lng, r.lat, r.lng)::numeric)))
      from (select * from kasa_private.push_subs s
            where s.user_id is distinct from r.user_id
              and (s.categories is null or r.category = any(s.categories))
              and kasa_private.distance_m(s.lat, s.lng, r.lat, r.lng) <= s.radius_m
            limit 500) s), '[]'::jsonb));
end $$;
revoke all on function public.kasa_notify_targets(text) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.kasa_notify_targets(text) to service_role';
exception when undefined_object then null; end $$;
