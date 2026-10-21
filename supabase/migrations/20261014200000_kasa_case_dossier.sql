-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — source-backed case dossier export
--
-- A read-only, portable view of the records already published around one
-- report. It composes existing public facts instead of creating a second
-- source of truth. Private actor data, moderation notes, and unreviewed
-- links never enter the dossier. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_case_dossier(p_report_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
  a jsonb;
begin
  -- Reviewed public views make hidden reports indistinguishable from unknown ids.
  select coalesce(
    (select to_jsonb(v) from public.kasa_public_reports v where v.id::text = p_report_id limit 1),
    (select to_jsonb(v) from public.kasa_public_place_reports v where v.id::text = p_report_id limit 1)
  ) into r;
  if r is null then return null; end if;

  a := public.kasa_report_asset(p_report_id);
  return jsonb_build_object(
    'schema_version', '1.0',
    'generated_at', now(),
    'report', r,
    'relations', jsonb_build_object(
      'authorities', public.kasa_jurisdictions_at((r ->> 'lat')::double precision, (r ->> 'lng')::double precision),
      'asset', a,
      'works', case when a -> 'asset' ->> 'id' is not null then public.kasa_asset_works((a -> 'asset' ->> 'id')::bigint) end,
      'works_board', public.kasa_report_warranty(p_report_id),
      'official_dockets', public.kasa_report_dockets(p_report_id),
      'official_responses', coalesce((select jsonb_agg(jsonb_build_object(
        'responder_name', x.responder_name, 'responder_role', x.responder_role,
        'body', x.body, 'verified_note', x.verified_note, 'created_at', x.created_at) order by x.created_at)
        from public.kasa_public_replies x where x.report_id::text = p_report_id), '[]'::jsonb),
      'verification_events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'photo_url', x.photo_url, 'distance_m', x.distance_m,
        'detail', x.detail, 'created_at', x.created_at) order by x.created_at, x.id)
        from public.kasa_public_events x where x.report_id::text = p_report_id), '[]'::jsonb)
    ),
    'limitations', jsonb_build_array(
      'This is a collection of published records, not a finding of fault.',
      'A linked tender or contractor identifies a record connection; it does not establish wrongdoing.',
      'Only moderated, public report data and public response records are included.'
    )
  );
end $$;

revoke all on function public.kasa_case_dossier(text) from public;
grant execute on function public.kasa_case_dossier(text) to anon, authenticated;

commit;
