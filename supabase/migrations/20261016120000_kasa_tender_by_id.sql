-- Tenders by ID: a moderator adds one tender at a time from its portal record
-- (all fields the portal gives, each with its link). Nothing is scraped or
-- scheduled. A tender shows against a road only as an unconfirmed candidate
-- until a moderator confirms the road match. Warranty only if the record states it.
--
-- Restores the tender candidate RPCs and the tender-aware kasa_report_road
-- (replaces the road-only version that 20261016100000 left live).

create or replace function public.kasa_report_road(p_report_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t kasa_private.road_tags%rowtype;
  v_tenders jsonb;
begin
  select * into t from kasa_private.road_tags where report_id::text = p_report_id;
  if not found or t.checked_at is null then
    return jsonb_build_object('checked', false);
  end if;
  select coalesce(jsonb_agg(x order by x.status, x.published_at desc nulls last), '[]'::jsonb) into v_tenders
  from (
    select c.status, c.published_at, jsonb_build_object(
      'tender_id', c.tender_id, 'title', c.title, 'status', c.status,
      'published_at', c.published_at, 'bid_closes_at', c.bid_closes_at,
      'tender_value_inr', c.tender_value_inr, 'period_days', c.period_days,
      'source_url', c.source_url,
      'warranty_months', c.warranty_months, 'warranty_source_url', c.warranty_source_url) as x
    from kasa_private.tender_candidates c
    where c.status in ('candidate', 'confirmed')
      and (c.way_id = t.way_id
           or (t.road_ref is not null and c.title ilike '%' || t.road_ref || '%')
           or (length(coalesce(t.road_name, '')) >= 8 and c.title ilike '%' || t.road_name || '%'))
    order by c.published_at desc nulls last
    limit 5) s;
  return jsonb_build_object(
    'checked', true,
    'authority', t.authority,
    'authority_label', kasa_private.road_authority_label(t.authority),
    'road_name', t.road_name,
    'road_ref', t.road_ref,
    'network', t.network,
    'tenders', v_tenders);
end $$;

revoke all on function public.kasa_report_road(text) from public;
grant execute on function public.kasa_report_road(text) to anon, authenticated;

create or replace function public.kasa_admin_add_tender_candidate(p_row jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  insert into kasa_private.tender_candidates (tender_id, reference_number, title, organisation_chain, town,
    published_at, bid_closes_at, bid_opens_at, tender_value_inr, emd_inr, period_days, source_url,
    warranty_months, warranty_source_url)
  values (p_row->>'tender_id', p_row->>'reference_number', p_row->>'title', p_row->>'organisation_chain',
    p_row->>'town', (p_row->>'published_at')::timestamptz, (p_row->>'bid_closes_at')::timestamptz,
    (p_row->>'bid_opens_at')::timestamptz, p_row->>'tender_value_inr', p_row->>'emd_inr',
    (p_row->>'period_days')::integer, p_row->>'source_url', (p_row->>'warranty_months')::smallint,
    p_row->>'warranty_source_url')
  on conflict (tender_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kasa_admin_review_tender_candidate(p_id bigint, p_action text,
    p_way_id bigint default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(left(trim(coalesce(p_note, '')), 280), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action = 'confirm' then
    if p_way_id is null or not exists (select 1 from kasa_private.road_tags where way_id = p_way_id) then
      perform kasa_private.fail('KASA_NOT_FOUND', 'That road is not on any report.');
    end if;
    update kasa_private.tender_candidates set status = 'confirmed', way_id = p_way_id,
      review_note = v_note, reviewed_at = now() where id = p_id and status = 'candidate';
  elsif p_action = 'reject' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.tender_candidates set status = 'rejected', way_id = null,
      review_note = v_note, reviewed_at = now() where id = p_id and status in ('candidate', 'confirmed');
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Confirm or reject.');
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such tender waiting.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kasa_admin_add_tender_candidate(jsonb),
  public.kasa_admin_review_tender_candidate(bigint, text, bigint, text) from public, anon;
grant execute on function public.kasa_admin_add_tender_candidate(jsonb),
  public.kasa_admin_review_tender_candidate(bigint, text, bigint, text) to authenticated;
