#!/usr/bin/env python3
"""Turns the district's UDISE+ school spreadsheet into SQL for public.schools.

    python3 tools/load-schools.py School_List.xlsx > /tmp/schools.sql   (or a .csv)

Then run schools.sql in the Supabase SQL editor. (Purulia's cleaned list of
26 Sep 2026 is kept in tools/data/ for reference.) Re-running with a newer
spreadsheet updates schools in place (by UDISE code) and never deletes any.

An .xlsx needs `pip install openpyxl`; a .csv needs nothing. The header row is
found automatically (title rows above it are skipped). Column names are matched
loosely, so the usual UDISE+ exports work as they are:
  UDISE code  (udise_code, udise, school_code, "UDISE Code")   11 digits, required
  name        (school_name, name)                             required
  latitude    (lat, latitude)                                 optional
  longitude   (lng, lon, long, longitude)                     optional
  block       (block, block_name)                             optional
  panchayat   (panchayat, gram_panchayat, gp)                 optional
  village     (village, village_name)                         optional
  management  (management, school_management)                 optional
  category    (category, school_category)                     optional

Official UDISE+ figures, when the export carries them, are stored in
schools.official and shown on the schools page next to what residents found
(give the data year with --year 2024-25, or an academic_year column):
  enrolment, teachers, classrooms                              whole numbers
  drinking_water, girls_toilet, boys_toilet, electricity,
  handwash, library, playground, ramp, boundary_wall           yes/no (functional where the export says so)

Rows with a bad code are skipped, and locations outside Purulia district are
dropped (the school is kept); both are listed on stderr so you can fix them.
A trailing "-<code>" some names carry is removed.
"""
import csv
import json
import re
import sys

BBOX = (22.69, 23.71, 85.80, 86.92)  # min_lat, max_lat, min_lng, max_lng (the district, padded)

ALIASES = {
    'udise_code': ('udise_code', 'udise', 'udisecode', 'school_code', 'udise_code_', 'udise_school_code'),
    'name': ('school_name', 'name', 'schoolname'),
    'lat': ('lat', 'latitude'),
    'lng': ('lng', 'lon', 'long', 'longitude'),
    'block_name': ('block', 'block_name', 'blockname'),
    'panchayat': ('panchayat', 'gram_panchayat', 'gp', 'panchayat_name'),
    'village': ('village', 'village_name'),
    'management': ('management', 'school_management', 'managment'),
    'category': ('category', 'school_category'),
    'year': ('academic_year', 'year', 'ac_year'),
}
# Official UDISE+ figures kept in schools.official. "Functional" columns win over plain availability.
OFFICIAL_NUM = {
    'enrolment': ('total_enrolment', 'enrolment', 'total_students', 'enrollment', 'total_enrollment'),
    'teachers': ('total_teachers', 'teachers', 'no_of_teachers', 'teacher_count'),
    'classrooms': ('total_classrooms', 'classrooms', 'no_of_classrooms', 'classroom_count'),
}
OFFICIAL_YN = {
    'drinking_water': ('functional_drinking_water', 'drinking_water_functional', 'drinking_water'),
    'girls_toilet': ('functional_girls_toilet', 'girls_toilet_functional', 'girls_toilet'),
    'boys_toilet': ('functional_boys_toilet', 'boys_toilet_functional', 'boys_toilet'),
    'electricity': ('functional_electricity', 'electricity_functional', 'electricity'),
    'handwash': ('handwash', 'hand_wash', 'hand_wash_facility', 'handwash_facility'),
    'library': ('library', 'library_book_bank_reading_corner', 'library_facility'),
    'playground': ('playground', 'play_ground'),
    'ramp': ('ramp', 'ramps'),
    'boundary_wall': ('boundary_wall', 'boundarywall'),
}


def yes_no(v):
    v = v.strip().lower()
    if re.match(r'^(1|y|yes|true)\b', v) or v.startswith('1-'):
        return True
    if re.match(r'^(0|2|n|no|false)\b', v) or v.startswith(('0-', '2-')):
        return False
    return None


def key(h):
    return re.sub(r'[^a-z0-9]+', '_', h.strip().lower()).strip('_')


def q(v):
    return 'null' if v in (None, '') else "'" + v.replace("'", "''") + "'"


def read_rows(path):
    """All rows as lists of strings, from .xlsx or .csv."""
    if path.lower().endswith(('.xlsx', '.xlsm')):
        try:
            import openpyxl
        except ImportError:
            sys.exit('Reading .xlsx needs openpyxl: pip install openpyxl (or save the sheet as CSV).')
        ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
        return [['' if v is None else str(v) for v in r] for r in ws.iter_rows(values_only=True)]
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.reader(f))


def main(path, year=None):
    raw = read_rows(path)
    # The header is the first row naming a UDISE code column and a name column.
    hi = next((i for i, r in enumerate(raw)
               if any(key(c) in ALIASES['udise_code'] for c in r) and any(key(c) in ALIASES['name'] for c in r)), None)
    if hi is None:
        sys.exit('No header row with a UDISE code column and a school name column was found.')
    cols = {key(h): j for j, h in enumerate(raw[hi]) if h}
    pick = {field: next((cols[n] for n in names if n in cols), None) for field, names in ALIASES.items()}
    opick = {field: next((cols[n] for n in names if n in cols), None)
             for field, names in {**OFFICIAL_NUM, **OFFICIAL_YN}.items()}

    rows, skipped, unplaced = [], 0, 0
    for n, r in enumerate(raw[hi + 1:], start=hi + 2):
        get = lambda f: (r[pick[f]] if pick[f] is not None and pick[f] < len(r) else '').strip()
        if not any(c.strip() for c in r):
            continue
        code = re.sub(r'\D', '', get('udise_code').split('.')[0])
        name = re.sub(r'\s*-\s*\d{6,}\s*$', '', get('name')).strip()
        if len(code) != 11 or not name:
            skipped += 1
            print(f'line {n}: skipped ({"no name" if len(code) == 11 else "UDISE code is not 11 digits"}): {get("name") or code}',
                  file=sys.stderr)
            continue
        try:
            lat, lng = float(get('lat')), float(get('lng'))
            if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lng <= BBOX[3]):
                print(f'line {n}: location outside Purulia district dropped: {name}', file=sys.stderr)
                raise ValueError
            loc = f'{lat:.6f}, {lng:.6f}'
        except ValueError:
            loc = 'null, null'
            unplaced += 1
        off = {}
        for field, j in opick.items():
            v = r[j].strip() if j is not None and j < len(r) else ''
            if not v:
                continue
            if field in OFFICIAL_NUM:
                if re.fullmatch(r'\d+(\.0+)?', v):
                    off[field] = int(float(v))
            elif yes_no(v) is not None:
                off[field] = yes_no(v)
        oyear = (get('year') or year or '')[:20]
        rows.append(f"({q(code)}, {q(name[:200])}, {loc}, {q(get('block_name')[:80])}, {q(get('panchayat')[:80])}, "
                    f"{q(get('village')[:120])}, {q(get('management')[:80])}, {q(get('category')[:80])}, "
                    f"{q(json.dumps(off)) + '::jsonb' if off else 'null'}, {q(oyear) if off else 'null'})")

    print('begin;')
    for i in range(0, len(rows), 500):
        print('insert into public.schools (udise_code, name, lat, lng, block_name, panchayat, village, management, category, official, official_year) values')
        print(',\n'.join(rows[i:i + 500]))
        print('on conflict (udise_code) do update set name = excluded.name,')
        print('  lat = coalesce(excluded.lat, public.schools.lat), lng = coalesce(excluded.lng, public.schools.lng),')
        print('  block_name = excluded.block_name, panchayat = excluded.panchayat, village = excluded.village,')
        print('  management = coalesce(excluded.management, public.schools.management),')
        print('  category = coalesce(excluded.category, public.schools.category),')
        print('  official = coalesce(excluded.official, public.schools.official),')
        print('  official_year = coalesce(excluded.official_year, public.schools.official_year), updated_at = now();')
    print('commit;')
    print(f'{len(rows)} schools written ({unplaced} without a location), {skipped} skipped.', file=sys.stderr)


if __name__ == '__main__':
    args = sys.argv[1:]
    yr = None
    if '--year' in args:
        i = args.index('--year')
        yr = args[i + 1] if i + 1 < len(args) else sys.exit('--year needs a value, e.g. --year 2024-25')
        del args[i:i + 2]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0], yr)
