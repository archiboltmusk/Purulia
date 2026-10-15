// "What exactly is wrong", the same list as kasa.js ISSUE_GROUPS (key, icon, category the
// server files it under). Sent as p_waste_type; kasa_private.subtype_category decides the category.
// Labels: st("waste_" + key), group names: st("igrp_" + group).
export type Issue = [key: string, icon: string, category: string];
export const ISSUE_GROUPS: [group: string, icon: string, issues: Issue[]][] = [
  ["waste", "🗑️", [
    ["dirty_spot", "🗑️", "garbage"],
    ["garbage_dump", "🚛", "dumpsite"],
    ["bin_full", "🚮", "garbage"],
    ["vehicle_missed", "🚚", "garbage"],
    ["not_swept", "🧹", "garbage"],
    ["burning", "🔥", "garbage"],
    ["construction", "🧱", "garbage"],
    ["dead_animal", "🐾", "garbage"],
    ["household", "🏠", "garbage"],
    ["e_waste", "🔌", "garbage"],
    ["biomedical", "💉", "garbage"],
  ]],
  ["toilet", "🚻", [
    ["toilet_dirty", "🚽", "toilet"],
    ["toilet_no_water", "🚱", "toilet"],
    ["toilet_no_power", "🔦", "toilet"],
    ["toilet_blocked", "🪠", "toilet"],
    ["toilet_locked", "🔒", "toilet"],
    ["open_defecation", "💩", "toilet"],
    ["yellow_spot", "🟡", "toilet"],
  ]],
  ["drain", "🌊", [
    ["drain_blocked", "🌊", "drain"],
    ["sewer_overflow", "🌧️", "drain"],
    ["stagnant_water", "🦟", "drain"],
    ["septic_overflow", "🛢️", "drain"],
    ["sludge_dumped", "☣️", "drain"],
    ["open_manhole", "🕳️", "missing"],
    ["manhole_entry", "🦺", "illegal_other"],
  ]],
  ["service", "🚰", [
    ["dry_tap", "🚰", "water"],
    ["water_leak", "💦", "water"],
    ["pump_broken", "💧", "hand_pump"],
    ["no_doctor", "🩺", "health_centre"],
    ["no_medicine", "💊", "health_centre"],
    ["centre_closed", "🏥", "health_centre"],
    ["pothole", "🚧", "road"],
    ["light_out", "💡", "streetlight"],
    ["work_missing", "⛏", "rural_jobs"],
    ["no_signboard", "🪧", "rural_jobs"],
    ["no_drinking_water", "🚰", "water"],
  ]],
  ["land", "🏗️", [
    ["water_body_filling", "🪣", "illegal_other"],
    ["illegal_construction", "🏗️", "illegal_construction"],
  ]],
];

export const ISSUE_CATEGORY: Record<string, string> = Object.fromEntries(ISSUE_GROUPS.flatMap(([, , l]) => l.map(([k, , c]) => [k, c])));

// One-line legal or safety reminders, only where they change what the reporter should do.
export const ISSUE_NOTES: Record<string, string> = { manhole_entry: 'issue_note_manhole_entry', open_manhole: 'issue_note_open_manhole',
  no_drinking_water: 'issue_note_no_drinking_water', water_body_filling: 'issue_note_water_body_filling' };
