#!/usr/bin/env python3
"""Block and gram panchayat outlines for every West Bengal district
except Purulia (which has its own purulia_*.geojson) and Kolkata (KMC wards).

    python3 -m pip install shapely
    python3 tools/build-wb-local.py "WEST BENGAL_VILLAGES.geojson"

Source: STATES/WEST BENGAL/WEST BENGAL_VILLAGES.geojson from
github.com/datta07/INDIAN-SHAPEFILES (MIT): Survey of India village and town
outlines carrying Local Government Directory codes (gp_code, block_lgd, dist_lgd).
- Gram panchayats: villages merged by LGD GP code.
- CD blocks: villages merged by LGD block code.
No municipalities: the layer's "(M)" polygons are single fragments (Asansol comes
out at 11 km², Siliguri at 2 km²), not town limits. Towns come from add-town.html.
Simplified to about 30 m, coordinates to 5 decimals, bbox on every feature.

Writes places/wb/<district-slug>.geojson (one small file per district, loaded by
the report map only when that district is in view) and places/wb/index.json.
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'places' / 'wb'
TOL = 0.0003                     # degrees, about 30 m
MIN_KM2 = 0.05                   # drop slivers left by merging
SKIP = {'purulia', 'kolkata'}

def clean(s): return re.sub(r'\s+', ' ', (s or '').replace('ÿ', ' ')).strip()
def rnd(c): return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]

def outline(geoms):
    g = unary_union([x.buffer(0) for x in geoms]).simplify(TOL, preserve_topology=True)
    polys = [g] if g.geom_type == 'Polygon' else [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
    polys = [p for p in polys if p.area * 111.32 * 102.4 >= MIN_KM2] or polys[:1]
    if not polys: return None
    m = mapping(unary_union(polys))
    coords = [m['coordinates']] if m['type'] == 'Polygon' else list(m['coordinates'])
    coords = [[list(r) for r in p] for p in coords]
    geom = {'type': 'Polygon', 'coordinates': rnd(coords[0])} if len(coords) == 1 \
           else {'type': 'MultiPolygon', 'coordinates': rnd(coords)}
    x0, y0, x1, y1 = unary_union(polys).bounds
    return geom, [round(x0, 5), round(y0, 5), round(x1, 5), round(y1, 5)]

districts = json.load(open(ROOT / 'places' / 'wb_districts.geojson'))['features']
slug_of = {f['properties']['lgd']: f['properties']['slug'] for f in districts}
name_of = {f['properties']['slug']: f['properties']['district'] for f in districts}

gps, blocks = defaultdict(list), defaultdict(list)
meta = {}
for f in json.load(open(sys.argv[1]))['features']:
    p = f['properties']
    d = slug_of.get(p.get('dist_lgd'))
    if not d or d in SKIP or not f.get('geometry'): continue
    g = shape(f['geometry'])
    if p.get('block_lgd'):
        blocks[(d, p['block_lgd'])].append(g)
        meta[('b', p['block_lgd'])] = clean(p.get('block_name'))
    if p.get('gp_code'):
        gps[(d, p['gp_code'])].append(g)
        meta[('g', p['gp_code'])] = (clean(p.get('gp_name')), clean(p.get('block_name')))

feats = defaultdict(list)
def add(d, props, geoms):
    o = outline(geoms)
    if o: feats[d].append({'type': 'Feature', 'bbox': o[1], 'properties': props, 'geometry': o[0]})
for (d, k), g in sorted(blocks.items(), key=lambda x: meta[('b', x[0][1])]):
    add(d, {'kind': 'block', 'block': meta[('b', k)], 'lgd': k}, g)
for (d, k), g in sorted(gps.items(), key=lambda x: meta[('g', x[0][1])]):
    gp, block = meta[('g', k)]
    add(d, {'kind': 'gp', 'gp': gp, 'block': block, 'lgd': k}, g)

ATTR = ('Block and gram panchayat outlines: Survey of India village '
        'boundaries with Local Government Directory codes, via INDIAN-SHAPEFILES (MIT). '
        'Simplified to about 30 m. Approximate.')
OUT.mkdir(parents=True, exist_ok=True)
index = {'source': 'https://github.com/datta07/INDIAN-SHAPEFILES', 'licence': 'MIT', 'attribution': ATTR, 'districts': {}}
for d in sorted(feats):
    fs = feats[d]
    xs = [f['bbox'] for f in fs]
    (OUT / f'{d}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'attribution': ATTR, 'features': fs},
                                                separators=(',', ':'), ensure_ascii=False))
    count = lambda k: sum(f['properties']['kind'] == k for f in fs)
    index['districts'][d] = {'name': name_of[d], 'bbox': [min(b[0] for b in xs), min(b[1] for b in xs),
                                                           max(b[2] for b in xs), max(b[3] for b in xs)],
                             'blocks': count('block'), 'gps': count('gp')}
(OUT / 'index.json').write_text(json.dumps(index, indent=1, ensure_ascii=False) + '\n')
for d, v in index['districts'].items():
    print(f"{d:20} {v['blocks']:3} blocks {v['gps']:4} GPs {(OUT / f'{d}.geojson').stat().st_size // 1024:5} KB")
