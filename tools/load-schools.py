#!/usr/bin/env python3
"""Turns the district's UDISE+ school spreadsheet into SQL for public.schools.

    python3 tools/load-schools.py schools.csv > /tmp/schools.sql

Then run schools.sql in the Supabase SQL editor. Re-running with a newer
spreadsheet updates schools in place (by UDISE code) and never deletes any.

Save the spreadsheet as CSV first. Column names are matched loosely, so the
usual UDISE+ exports work as they are:
  UDISE code  (udise_code, udise, school_code, "UDISE Code")   11 digits, required
  name        (school_name, name)                             required
  latitude    (lat, latitude)                                 required
  longitude   (lng, lon, long, longitude)                     required
  block       (block, block_name)                             optional
  management  (management, school_management)                 optional
  category    (category, school_category)                     optional

Rows with a bad code or a location outside Purulia district are skipped and
listed on stderr, so you can fix them in the spreadsheet.
"""
import csv
import re
import sys

BBOX = (22.69, 23.71, 85.80, 86.92)  # min_lat, max_lat, min_lng, max_lng (the district, padded)

ALIASES = {
    'udise_code': ('udise_code', 'udise', 'udisecode', 'school_code', 'udise_code_', 'udise_school_code'),
    'name': ('school_name', 'name', 'schoolname'),
    'lat': ('lat', 'latitude'),
    'lng': ('lng', 'lon', 'long', 'longitude'),
    'block_name': ('block', 'block_name', 'blockname'),
    'management': ('management', 'school_management', 'managment'),
    'category': ('category', 'school_category'),
}


def key(h):
    return re.sub(r'[^a-z0-9]+', '_', h.strip().lower()).strip('_')


def q(v):
    return 'null' if v in (None, '') else "'" + v.replace("'", "''") + "'"


def main(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        cols = {key(h): h for h in reader.fieldnames or []}
        pick = {}
        for field, names in ALIASES.items():
            pick[field] = next((cols[n] for n in names if n in cols), None)
        missing = [f for f in ('udise_code', 'name', 'lat', 'lng') if not pick[f]]
        if missing:
            sys.exit(f'Missing column(s): {", ".join(missing)}. Found: {", ".join(reader.fieldnames or [])}')

        rows, skipped = [], 0
        for n, r in enumerate(reader, start=2):
            get = lambda f: (r.get(pick[f]) or '').strip() if pick[f] else ''
            code = re.sub(r'\D', '', get('udise_code'))
            try:
                lat, lng = float(get('lat')), float(get('lng'))
            except ValueError:
                lat = lng = None
            why = None
            if len(code) != 11:
                why = 'UDISE code is not 11 digits'
            elif not get('name'):
                why = 'no name'
            elif lat is None or not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lng <= BBOX[3]):
                why = 'location missing or outside Purulia district'
            if why:
                skipped += 1
                print(f'line {n}: skipped ({why}): {get("name") or code}', file=sys.stderr)
                continue
            rows.append(f"({q(code)}, {q(get('name')[:200])}, {lat:.6f}, {lng:.6f}, "
                        f"{q(get('block_name')[:80])}, {q(get('management')[:80])}, {q(get('category')[:80])})")

    print('begin;')
    for i in range(0, len(rows), 500):
        print('insert into public.schools (udise_code, name, lat, lng, block_name, management, category) values')
        print(',\n'.join(rows[i:i + 500]))
        print('on conflict (udise_code) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,')
        print('  block_name = excluded.block_name, management = excluded.management, category = excluded.category, updated_at = now();')
    print('commit;')
    print(f'{len(rows)} schools written, {skipped} skipped.', file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
