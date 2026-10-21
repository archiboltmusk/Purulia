-- Border fixes approved before 20261015130000_kasa_boundary_fix_apply went live only changed the submission's status,
-- so the map kept the old ward outline. Apply each such approved ward fix now, oldest first, dated by its review.
-- Idempotent: a submission that already has a boundary_changes row is skipped.
do $$
declare s record; w record; ok boolean;
begin
  for s in select * from kasa_private.place_submissions p
           where p.status = 'approved' and p.fix_of is not null and p.fix_of not like 'area:%' and p.ward_count > 0
             and jsonb_typeof(p.wards) = 'array'
             and not exists (select 1 from kasa_private.boundary_changes c where c.submission_id = p.id)
           order by p.id loop
    if s.fix_of <> 'purulia' and not exists (select 1 from kasa_private.places where slug = s.fix_of) then continue; end if;
    ok := true;
    for w in select x -> 'polygons' as polygons from jsonb_array_elements(s.wards) x loop
      if not kasa_private.polygons_valid(w.polygons) then ok := false; end if;
    end loop;
    if not ok then continue; end if;
    for w in select (x ->> 'ward')::integer as ward, x -> 'polygons' as polygons from jsonb_array_elements(s.wards) x loop
      perform kasa_private.apply_ward_fix(s.id, s.fix_of, w.ward, w.polygons, s.map_source);
    end loop;
    update kasa_private.boundary_changes set applied_at = coalesce(s.reviewed_at, applied_at) where submission_id = s.id;
  end loop;
end $$;
