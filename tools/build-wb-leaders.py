#!/usr/bin/env python3
"""MLA and MP for every spot in West Bengal, for the report map's area card.

    python3 -m pip install shapely
    python3 tools/build-wb-leaders.py "WEST BENGAL_ASSEMBLY.geojson"

- Assembly constituency outlines: STATES/WEST BENGAL/WEST BENGAL_ASSEMBLY.geojson from
  github.com/datta07/INDIAN-SHAPEFILES (MIT); each carries AC_NO, PC_NO and district.
  Simplified to about 100 m -> places/wb_assembly.geojson.
- MLAs: winners in "Results by constituency" of the Wikipedia article
  "2026 West Bengal Legislative Assembly election".
- MPs: winners in "Results by constituency" of "2024 Indian general election in
  West Bengal", with seats since vacated listed in VACANT (cited).
Writes places/wb_leaders.json. Party is the one the person was elected on.
"""
import json, re, subprocess, sys, urllib.parse
from datetime import date
from pathlib import Path
from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parent.parent
TOL = 0.001  # degrees, about 100 m
MLA_PAGE = '2026 West Bengal Legislative Assembly election'
MP_PAGE = '2024 Indian general election in West Bengal'
VACANT = {18: {'since': '2024-09-25', 'why': 'Haji Nurul Islam died',
               'source': 'https://www.anandabazar.com/west-bengal/basirhat-mp-haji-nurul-islam-passed-away-dgtld/cid/1548310'}}
PARTY = {'Bharatiya Janata Party': 'BJP', 'All India Trinamool Congress': 'AITC', 'Trinamool Congress': 'AITC',
         'Indian National Congress': 'INC', 'Communist Party of India (Marxist)': 'CPI(M)',
         'Indian Secular Front': 'ISF', 'Janata Unnayan Party': 'JUP'}

def wiki(title):
    url = 'https://en.wikipedia.org/w/index.php?action=raw&title=' + urllib.parse.quote(title.replace(' ', '_'))
    return subprocess.run(['curl', '-sSf', url], capture_output=True, text=True, check=True).stdout

def text(s):
    s = re.sub(r'^\|?\s*(style="[^"]*"\s*\|)?', '', s.strip()).strip()
    m = re.search(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', s)
    return (m.group(1) if m else re.sub(r'<[^>]+>|\{\{[^}]*\}\}', '', s)).strip()

def party(s):
    m = re.search(r'party (?:name with )?colou?r\|([^}]+)\}\}', s, re.I)
    name = (m.group(1) if m else text(s)).strip()
    return PARTY.get(name, name)

def results(title, n, name_at, winner_at):
    lines = wiki(title).split('\n')
    lines = lines[next(i for i, l in enumerate(lines) if re.match(r'===\s*Results by constituency\s*===', l)):]
    out = {}
    for i, l in enumerate(lines):
        m = re.match(r'^!\s*(\d+)\s*$', l)
        if m and int(m.group(1)) not in out:
            name = re.sub(r'\s*\((SC|ST)\)', '', text(lines[i + name_at].split(']]')[0] + ']]'))
            out[int(m.group(1))] = {'name': name, 'person': text(lines[i + winner_at]), 'party': party(lines[i + winner_at + 1])}
        if len(out) == n: return out
    sys.exit(f'{title}: found {len(out)} of {n} seats')

mla = results(MLA_PAGE, 294, 1, 2)
mp = results(MP_PAGE, 42, 1, 3)
for no, v in VACANT.items(): mp[no].update(vacant=v)

src = json.load(open(sys.argv[1]))['features']
districts = [(f['properties']['slug'], shape(f['geometry'])) for f in json.load(open(ROOT / 'places' / 'wb_districts.geojson'))['features']]
# The Election Commission's district, except where that district has since been split:
# then the one of its parts that holds the constituency's interior point.
ECI = {'NORTH 24 PARGANAS': 'north-24-parganas', 'SOUTH 24 PARGANAS': 'south-24-parganas', 'MURSHIDABAD': 'murshidabad',
       'HUGLI': 'hooghly', 'NADIA': 'nadia', 'HAORA': 'howrah', 'PURBA MEDINAPUR': 'purba-medinipur', 'MALDAH': 'malda',
       'BANKURA': 'bankura', 'KOLKATA': 'kolkata', 'BIRBHUM': 'birbhum', 'KOCH BIHAR': 'cooch-behar',
       'UTTAR DINAJPUR': 'uttar-dinajpur', 'PURULIYA': 'purulia', 'DAKSHIN DINAJPUR *': 'dakshin-dinajpur'}
SPLIT = {'BARDDHAMAN': {'purba-bardhaman', 'paschim-bardhaman'}, 'PASCHIM MEDINAPUR': {'paschim-medinipur', 'jhargram'},
         'JALPAIGURI': {'jalpaiguri', 'alipurduar'}, 'DARJILING': {'darjeeling', 'kalimpong'}}
FIX = {274: 'purba-bardhaman'}  # Galsi: in Purba Bardhaman, though most of its area lies nearer Durgapur
def district_of(no, eci, g):
    if no in FIX: return FIX[no]
    if eci in ECI: return ECI[eci]
    pt, parts = g.representative_point(), [x for x in districts if x[0] in SPLIT[eci]]
    return min(parts, key=lambda x: x[1].distance(pt))[0]
feats = []
for f in sorted(src, key=lambda f: f['properties']['AC_NO']):
    p = f['properties']
    g = shape(f['geometry']).buffer(0).simplify(TOL, preserve_topology=True)
    rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]
    m = mapping(g)
    feats.append({'type': 'Feature', 'bbox': [round(x, 4) for x in g.bounds],
                  'properties': {'ac': p['AC_NO'], 'pc': p['PC_NO'], 'd': district_of(p['AC_NO'], p['DIST_NAME'], g)},
                  'geometry': {'type': m['type'], 'coordinates': rnd(m['coordinates'])}})
json.dump({'type': 'FeatureCollection',
           'attribution': 'Assembly constituency outlines: INDIAN-SHAPEFILES (MIT). Simplified to about 100 m. Approximate.',
           'features': feats}, open(ROOT / 'places' / 'wb_assembly.geojson', 'w'), separators=(',', ':'))
json.dump({'checked': date.today().isoformat(),
           'sources': {'mla': 'https://en.wikipedia.org/wiki/' + MLA_PAGE.replace(' ', '_'),
                       'mp': 'https://en.wikipedia.org/wiki/' + MP_PAGE.replace(' ', '_')},
           'ac': mla, 'pc': mp}, open(ROOT / 'places' / 'wb_leaders.json', 'w'), ensure_ascii=False, indent=0)
print(len(mla), 'MLAs,', len(mp), 'MPs,', (ROOT / 'places' / 'wb_assembly.geojson').stat().st_size // 1024, 'KB outlines')
