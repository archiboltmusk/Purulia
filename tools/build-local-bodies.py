#!/usr/bin/env python3
"""Builds purulia_gps.geojson (gram panchayats) and purulia_towns.geojson (the
district's other municipalities) from open government boundary files.

    python3 -m pip install duckdb shapely
    python3 tools/build-local-bodies.py DIR

DIR holds two files from the india-geodata releases (CC0), downloaded once:
  LGD_Panchayats.parquet  github.com/yashveeeeeeer/india-geodata/releases/tag/admin/panchayats
                          (Local Government Directory, Ministry of Panchayati Raj)
  SOI_Villages.parquet    github.com/yashveeeeeeer/india-geodata/releases/tag/admin/villages
                          (Survey of India village and town outlines)

Gram panchayats: the LGD rows for Purulia are pieces of each GP; they are merged
by LGD GP code, slivers under 0.2 km² that lie apart from the GP are dropped, and
each GP is given the CD block it mostly lies in. Towns: Jhalda (M) and
Raghunathpur (M) outlines from the Survey of India layer (Purulia town already
has ward outlines). Outlines are simplified to about 30 m. No ward outlines
exist in any open source for Jhalda or Raghunathpur, so those two towns have none.
"""
import json
import sys
from pathlib import Path

import duckdb
from shapely import wkb
from shapely.geometry import mapping, MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
TOL = 0.0003          # degrees, about 30 m
KM2 = 111.32 * 102.4  # km² per square degree at 23.3° N

db = duckdb.connect()
db.sql('install spatial; load spatial')

# LGD block names -> the names used in purulia_blocks.geojson
BLOCKS = {
    'ARSHA': 'Arsha', 'BAGMUNDI': 'Bagmundi', 'BALARAMPUR': 'Balarampur', 'BARABAZAR': 'Barabazar',
    'BUNDWAN': 'Bundwan', 'HURA': 'Hura', 'JAIPUR': 'Jaipur', 'JHALDA-I': 'Jhalda I', 'JHALDA-II': 'Jhalda II',
    'KASHIPUR': 'Kashipur', 'MANBAZAR-I': 'Manbazar I', 'MANBAZAR-II': 'Manbazar II', 'NETURIA': 'Neturia',
    'PARA': 'Para', 'PUNCHA': 'Puncha', 'PURULIA-I': 'Purulia I', 'PURULIA-II': 'Purulia II',
    'RAGHUNATH PUR-I': 'Raghunathpur I', 'RAGHUNATHPUR-II': 'Raghunathpur II', 'SANTURI': 'Santuri'
}


def title(s):
    return '-'.join(w.capitalize() for w in s.strip().split('-'))


def title_words(s):
    return ' '.join(title(w) for w in s.split())


def rounded(geom):
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    out = []
    for p in polys:
        rings = [p.exterior] + list(p.interiors)
        out.append([[[round(x, 4), round(y, 4)] for x, y in r.coords] for r in rings])
    return {'type': 'MultiPolygon', 'coordinates': out} if len(out) > 1 else {'type': 'Polygon', 'coordinates': out[0]}


def clean(geom, min_km2):
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    polys = sorted(polys, key=lambda p: -p.area)
    keep = [polys[0]] + [p for p in polys[1:] if p.area * KM2 >= min_km2]
    g = MultiPolygon(keep) if len(keep) > 1 else keep[0]
    return g.simplify(TOL, preserve_topology=True).buffer(0)


rows = db.sql(f"""
    select gpcode, gpname, blkname, st_aswkb(geometry) g
    from '{SRC / 'LGD_Panchayats.parquet'}'
    where dtname = 'Purulia' and gpcode <> ''
""").fetchall()
gps = {}
for code, name, blk, g in rows:
    e = gps.setdefault(code, {'name': name, 'parts': [], 'blocks': {}})
    geom = wkb.loads(bytes(g)).buffer(0)
    e['parts'].append(geom)
    e['blocks'][blk] = e['blocks'].get(blk, 0) + geom.area

features = []
for code, e in sorted(gps.items(), key=lambda kv: (BLOCKS[max(kv[1]['blocks'], key=kv[1]['blocks'].get)], kv[1]['name'])):
    block = BLOCKS[max(e['blocks'], key=e['blocks'].get)]
    geom = clean(unary_union(e['parts']), 0.2)
    features.append({'type': 'Feature', 'properties': {'gp': title_words(e['name']), 'block': block, 'lgd': int(code)},
                     'geometry': rounded(geom)})

(ROOT / 'purulia_gps.geojson').write_text(json.dumps({
    'type': 'FeatureCollection',
    'attribution': 'Gram panchayat boundaries: Local Government Directory (Ministry of Panchayati Raj), via india-geodata (CC0). Simplified to about 30 m. Approximate.',
    'features': features
}, separators=(',', ':')) + '\n')

towns = []
for name, code in (('Jhalda', '801736'), ('Raghunathpur', '801737')):
    (g,) = db.sql(f"""
        select st_aswkb(geometry) from '{SRC / 'SOI_Villages.parquet'}'
        where DISTRICT = 'Puruliya' and Vill_LGD = '{code}'
    """).fetchone()
    geom = clean(wkb.loads(bytes(g)).buffer(0), 0.05)
    towns.append({'type': 'Feature', 'properties': {'town': name, 'body': name + ' Municipality', 'census2011': int(code)},
                  'geometry': rounded(geom)})

(ROOT / 'purulia_towns.geojson').write_text(json.dumps({
    'type': 'FeatureCollection',
    'attribution': 'Municipality outlines: Survey of India village and town boundaries, via india-geodata (CC0). Simplified to about 30 m. Approximate.',
    'features': towns
}, separators=(',', ':')) + '\n')

print(f'{len(features)} gram panchayats, {len(towns)} towns', file=sys.stderr)
