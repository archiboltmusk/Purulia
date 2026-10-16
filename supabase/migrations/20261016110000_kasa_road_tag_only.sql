-- Road tag only: drop the tender-candidate pieces added by 20261016100000.
-- No tender data was stored (the table was empty), so nothing is lost.
-- kasa_report_road keeps the road authority and names; no tender list.

drop function if exists public.kasa_admin_add_tender_candidate(jsonb);
drop function if exists public.kasa_admin_review_tender_candidate(bigint, text, bigint, text);

create or replace function public.kasa_report_road(p_report_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t kasa_private.road_tags%rowtype;
begin
  select * into t from kasa_private.road_tags where report_id::text = p_report_id;
  if not found or t.checked_at is null then
    return jsonb_build_object('checked', false);
  end if;
  return jsonb_build_object(
    'checked', true,
    'authority', t.authority,
    'authority_label', kasa_private.road_authority_label(t.authority),
    'road_name', t.road_name,
    'road_ref', t.road_ref,
    'network', t.network);
end $$;

revoke all on function public.kasa_report_road(text) from public;
grant execute on function public.kasa_report_road(text) to anon, authenticated;

drop table if exists kasa_private.tender_candidates;
