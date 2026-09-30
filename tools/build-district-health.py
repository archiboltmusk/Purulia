#!/usr/bin/env python3
"""Build districts.json: NFHS-5 (2019-21) figures for every West Bengal district.

Source: NFHS-5 district and state fact sheets (IIPS / MoHFW, rchiips.org/nfhs).
Read from the machine-readable copy at github.com/pratapvardhan/NFHS-5, which
transcribes those fact sheets. Purulia's figures were checked against the ones
already on The Circle. Usage: python3 tools/build-district-health.py <districts.csv> <states.csv>
"""
import csv, json, sys

# indicator text (numbering differs between the district and state sheets) -> (key, higher_is_better)
PICK = [
    ('Women age 20-24 years married before age 18', 'child_marriage', False),
    ('Women with 10 or more years of schooling', 'women_10yrs', True),
    ('Mothers who had at least 4 antenatal care visits', 'anc4', True),
    ('Institutional births (%)', 'inst_births', True),
    ('Children under 5 years who are stunted', 'stunted', False),
    ('Children age 6-59 months who are anaemic', 'child_anaemia', False),
    ('All women age 15-49 years who are anaemic', 'women_anaemia', False),
    ('use an improved sanitation facility', 'sanitation', True),
    ('Households using clean fuel for cooking', 'clean_fuel', True),
    ('covered under a health insurance/financing scheme', 'insurance', True),
]

def num(v):
    try: return float(v)
    except ValueError: return None

def pick(ind):
    return next(((k, h) for t, k, h in PICK if t in ind), None)

dist_csv, state_csv = sys.argv[1], sys.argv[2]
out = {'source': 'NFHS-5 (2019-21) district fact sheets, IIPS / Ministry of Health and Family Welfare',
       'source_url': 'https://rchiips.org/nfhs/districtfactsheet_NFHS-5.shtml',
       'indicators': {k: {'higher_is_better': h} for _, k, h in PICK},
       'west_bengal': {}, 'india': {}, 'districts': {}}
for r in csv.DictReader(open(dist_csv, encoding='utf-8')):
    if r['State-Code'] != 'WB': continue
    p = pick(r['Indicator'])
    if p: out['districts'].setdefault(r['District'], {})[p[0]] = num(r['NFHS-5'])
for r in csv.DictReader(open(state_csv, encoding='utf-8')):
    p = pick(r['indicator'])
    if not p: continue
    if r['state'] == 'West Bengal': out['west_bengal'][p[0]] = num(r['nfhs5_total'])
    if r['state'] == 'India': out['india'][p[0]] = num(r['nfhs5_total'])
assert len(out['districts']) == 20, len(out['districts'])
assert out['districts']['Puruliya']['child_marriage'] == 37.0
assert out['west_bengal']['child_marriage'] == 41.6
assert all(len(v) == len(PICK) for v in [out['west_bengal'], out['india'], *out['districts'].values()])
json.dump(out, open('districts.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
print('districts.json:', len(out['districts']), 'districts')
