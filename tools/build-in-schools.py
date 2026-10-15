#!/usr/bin/env python3
"""Every India school on the UDISE+ school list, as static files for the schools page.

Source: India Data Portal copy of "Basic Details of Schools" (Ministry of Education UDISE+,
retrieved from src.udiseplus.gov.in, 12 Jan 2022, ODC-By):
https://ckan.indiadataportal.com/dataset/f1b2fdba-3b56-47ca-bfc6-819fc64b712a

Writes places/schools/<state-slug>/<district-slug>.json, one file per district, each a list of
compact rows: [udise_code, name, lat, lng, block, village, management, category]. Districts over
ASSET_LIMIT bytes are split into <district>-2.json, -3.json (Cloudflare's 25 MiB asset limit).
Writes places/schools/index.json with the source, snapshot date, and row counts per state.

Usage: python3 tools/build-in-schools.py [--out places/schools]
"""
import argparse, json, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict

RESOURCE = '457fddf1-982f-4c85-855d-5095578accc1'
API = 'https://ckan.indiadataportal.com/api/3/action/datastore_search'
FIELDS = ['udise_school_code', 'school_name', 'latitude', 'longitude', 'state_name', 'district_name',
          'subdistrict_name', 'village_name', 'management', 'school_category']
PAGE = 5000
ASSET_LIMIT = 20 * 1024 * 1024
SNAPSHOT = '2022-01-12'
SOURCE_URL = 'https://ckan.indiadataportal.com/dataset/f1b2fdba-3b56-47ca-bfc6-819fc64b712a'


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'unknown'


def fetch_all():
    offset, total = 0, None
    while total is None or offset < total:
        q = urllib.parse.urlencode({'resource_id': RESOURCE, 'sort': '_id', 'limit': PAGE,
                                    'offset': offset, 'fields': ','.join(FIELDS)})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(f'{API}?{q}', timeout=120) as r:
                    res = json.load(r)['result']
                break
            except Exception as e:  # network blip: back off and retry
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
                print('retry', offset, e, file=sys.stderr)
        total = res['total']
        for rec in res['records']:
            yield rec
        offset += PAGE
        print(f'{min(offset, total)}/{total}', file=sys.stderr)


def row(rec):
    def num(v):
        try:
            return round(float(v), 6)
        except (TypeError, ValueError):
            return None
    return [rec['udise_school_code'] or '', rec['school_name'] or '', num(rec['latitude']), num(rec['longitude']),
            rec['subdistrict_name'] or '', rec['village_name'] or '', rec['management'] or '', rec['school_category'] or '']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='places/schools')
    args = ap.parse_args()

    groups = defaultdict(list)  # (state-slug, district-slug) -> rows
    states = {}
    for rec in fetch_all():
        st, dt = rec['state_name'] or 'Unknown', rec['district_name'] or 'Unknown'
        key = (slug(st), slug(dt))
        groups[key].append(row(rec))
        states.setdefault(key[0], {'name': st, 'schools': 0})['schools'] += 1

    index = {'source': SOURCE_URL, 'source_name': 'India Data Portal, UDISE+ Basic Details of Schools',
             'snapshot': SNAPSHOT, 'columns': ['udise_code', 'name', 'lat', 'lng', 'block', 'village', 'management', 'category'],
             'states': {}, 'files': {}}
    for (st, dt), rows in sorted(groups.items()):
        d = os.path.join(args.out, st)
        os.makedirs(d, exist_ok=True)
        part, chunk, chunks = 1, [], []
        for r in rows:
            chunk.append(r)
            if len(json.dumps(chunk, ensure_ascii=False, separators=(',', ':'))) > ASSET_LIMIT:
                chunk.pop()
                chunks.append(chunk)
                chunk = [r]
        chunks.append(chunk)
        for i, c in enumerate(chunks, 1):
            name = f'{dt}.json' if i == 1 else f'{dt}-{i}.json'
            with open(os.path.join(d, name), 'w', encoding='utf-8') as f:
                json.dump(c, f, ensure_ascii=False, separators=(',', ':'))
            index['files'][f'{st}/{name}'] = len(c)
    for st, info in states.items():
        index['states'][st] = {'name': info['name'], 'schools': info['schools']}
    with open(os.path.join(args.out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f"{sum(states[s]['schools'] for s in states)} schools in {len(states)} states", file=sys.stderr)


if __name__ == '__main__':
    main()
