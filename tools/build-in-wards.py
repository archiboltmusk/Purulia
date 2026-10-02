#!/usr/bin/env python3
"""Town limits and ward maps for every town outside West Bengal that has them, for the report map.

    python3 -m pip install geopandas pyarrow
    python3 tools/build-in-wards.py

Source: SBM_Wards.parquet from the urban/boundaries release of
github.com/yashveeeeeeer/india-geodata (CC0): the Swachh Bharat Mission (Urban) GIS, where each
municipality uploads its ward map and the ministry approves it. Wards marked REJECTED are left out.
A ward map is what the town uploaded, which may predate its latest ward redrawing; the card says so.
West Bengal is left out (its towns come from AMRUT, tools/build-wb-towns.py).

Writes places/in/wards/<ulb-code>.geojson (one town's wards, about 10 m, loaded only when that
town is in view from zoom 11) and places/in/towns.json (each town: name, state, bbox, ward count).
Town outlines go into the state files (kind "town") via tools/build-in-map.py, which reads towns.json.
"""
import json, re
from pathlib import Path
import geopandas as gpd
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'data' / '.in-cache'
OUT = ROOT / 'places' / 'in' / 'wards'
REL = 'https://github.com/yashveeeeeeer/india-geodata/releases/download/urban%2Fboundaries/'
TOL = 0.0001                 # degrees, about 10 m
SKIP_STATES = {'19'}         # West Bengal

def rnd(c): return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
def clean(s): return re.sub(r'\s+', ' ', str(s or '')).strip()

def fetch(name):
    import subprocess
    f = CACHE / name
    if not f.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sSfL', '-o', str(f), REL + name], check=True)
    return f

def geom(g):
    g = g.buffer(0).simplify(TOL, preserve_topology=True)
    polys = [g] if g.geom_type == 'Polygon' else [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
    polys = [p for p in polys if not p.is_empty and p.area > 0]
    if not polys: return None, None
    m = mapping(polys[0]) if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': [mapping(p)['coordinates'] for p in polys]}
    m['coordinates'] = rnd(m['coordinates'])
    return m, [round(x, 5) for x in g.bounds]

def mode(col):
    m = col.map(clean)
    m = m[m != ''].mode()
    return m.iloc[0] if len(m) else ''

def ward_no(code, name):
    for s in (code, name):
        m = re.search(r'(\d+)\s*$', clean(s)) or re.fullmatch(r'\D*(\d+)\D*', clean(s))
        if m: return int(m.group(1))
    return None

def main():
    w = gpd.read_parquet(fetch('SBM_Wards.parquet'))
    w = w[(w.status != 'REJECTED') & ~w.statecode.astype(str).str.strip().isin(SKIP_STATES) & w.geometry.notna()]
    w['ulb'] = w.ulbcode.astype(str).str.strip()
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob('*.geojson'): f.unlink()
    towns = {}
    for ulb, grp in w.groupby('ulb'):
        if not ulb.isdigit(): continue
        name = mode(grp.ulbname)
        feats, seen = [], set()
        for _, r in grp.iterrows():
            g, b = geom(r.geometry)
            if not g: continue
            no, wname = ward_no(r.wardcode, r.wardname), clean(r.wardname)
            if no is None or no in seen: continue   # a ward drawn twice keeps its first shape
            seen.add(no)
            p = {'ward': no}
            if wname and not re.fullmatch(r'(ward\s*(no\.?)?\s*)?-?\s*0*' + str(no), wname, re.I) and not wname.lower().startswith(name.lower() + '-'):
                p['name'] = wname.title() if wname.isupper() else wname
            feats.append({'type': 'Feature', 'bbox': b, 'properties': p, 'geometry': g})
        if not feats: continue
        feats.sort(key=lambda f: f['properties']['ward'])
        (OUT / f'{ulb}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')))
        bs = [f['bbox'] for f in feats]
        bb = (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))
        towns[ulb] = {'name': name, 'district': mode(grp.districtname).title(), 'wards': len(feats), 'bbox': [round(x, 4) for x in bb]}
    (ROOT / 'places' / 'in' / 'towns.json').write_text(json.dumps({
        'source': 'https://github.com/yashveeeeeeer/india-geodata/releases/tag/urban%2Fboundaries',
        'attribution': 'Town wards: Swachh Bharat Mission (Urban) GIS, as uploaded by each municipality, via india-geodata (CC0).',
        'towns': towns}, separators=(',', ':'), ensure_ascii=False))
    print(len(towns), 'towns,', sum(t['wards'] for t in towns.values()), 'wards')

if __name__ == '__main__':
    main()
