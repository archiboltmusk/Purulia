-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — "What's the problem?": three more problem types
--
-- No drinking water at a railway station or bus stand (water), a pond or
-- water body being filled (illegal_other: barred by section 17A of the West
-- Bengal Inland Fisheries Act 1984, a cognizable offence) and building work
-- with no sanctioned plan on display (illegal_construction). Every mapping
-- from 20261001160000 is kept. kasa_create_report already checks the pick
-- against kasa_private.subtype_category, so it is unchanged.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function kasa_private.subtype_category(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'household' then 'garbage'
    when 'construction' then 'garbage'
    when 'mixed' then 'garbage'
    when 'e_waste' then 'garbage'
    when 'biomedical' then 'garbage'
    when 'dirty_spot' then 'garbage'
    when 'garbage_dump' then 'dumpsite'
    when 'bin_full' then 'garbage'
    when 'vehicle_missed' then 'garbage'
    when 'not_swept' then 'garbage'
    when 'burning' then 'garbage'
    when 'dead_animal' then 'garbage'
    when 'toilet_dirty' then 'toilet'
    when 'toilet_no_water' then 'toilet'
    when 'toilet_no_power' then 'toilet'
    when 'toilet_blocked' then 'toilet'
    when 'toilet_locked' then 'toilet'
    when 'open_defecation' then 'toilet'
    when 'yellow_spot' then 'toilet'
    when 'drain_blocked' then 'drain'
    when 'sewer_overflow' then 'drain'
    when 'stagnant_water' then 'drain'
    when 'septic_overflow' then 'drain'
    when 'sludge_dumped' then 'drain'
    when 'open_manhole' then 'missing'
    when 'manhole_entry' then 'illegal_other'
    when 'dry_tap' then 'water'
    when 'water_leak' then 'water'
    when 'pump_broken' then 'hand_pump'
    when 'no_doctor' then 'health_centre'
    when 'no_medicine' then 'health_centre'
    when 'centre_closed' then 'health_centre'
    when 'pothole' then 'road'
    when 'light_out' then 'streetlight'
    when 'work_missing' then 'rural_jobs'
    when 'no_signboard' then 'rural_jobs'
    when 'no_drinking_water' then 'water'
    when 'water_body_filling' then 'illegal_other'
    when 'illegal_construction' then 'illegal_construction'
  end
$$;

alter table public.reports drop constraint if exists reports_waste_type_check;
alter table public.reports add constraint reports_waste_type_check
  check (waste_type is null or waste_type in (
    'household', 'construction', 'mixed', 'e_waste', 'biomedical', 'dirty_spot',
    'garbage_dump', 'bin_full', 'vehicle_missed', 'not_swept', 'burning', 'dead_animal',
    'toilet_dirty', 'toilet_no_water', 'toilet_no_power', 'toilet_blocked', 'toilet_locked', 'open_defecation',
    'yellow_spot', 'drain_blocked', 'sewer_overflow', 'stagnant_water', 'septic_overflow', 'sludge_dumped',
    'open_manhole', 'manhole_entry', 'dry_tap', 'water_leak', 'pump_broken', 'no_doctor',
    'no_medicine', 'centre_closed', 'pothole', 'light_out', 'work_missing', 'no_signboard',
    'no_drinking_water', 'water_body_filling', 'illegal_construction'));

commit;
