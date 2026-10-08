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

Where a vetted city file is more complete than the SBM upload, EXTRA swaps it in (the ward file then
carries its own `source`/`label`, shown on the ward card). `--extra` re-applies only EXTRA to the files
already built, without the SBM download:

    python3 -m pip install shapely
    python3 tools/build-in-wards.py --extra
"""
import json, re, subprocess, sys
from pathlib import Path
from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'data' / '.in-cache'
OUT = ROOT / 'places' / 'in' / 'wards'
REL = 'https://github.com/yashveeeeeeer/india-geodata/releases/download/urban%2Fboundaries/'
TOL = 0.0001                 # degrees, about 10 m
SKIP_STATES = {'19'}         # West Bengal

def rnd(c): return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
def clean(s): return re.sub(r'\s+', ' ', str(s or '')).strip()

def fetch(name, url=None):
    f = CACHE / name
    if not f.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sSfL', '-o', str(f), url or REL + name], check=True)
    return f

# City ward files from the two vetted repos, used only where they beat the SBM upload (checked
# 2026-10-08: the other cities in both repos match SBM's ward count or are older ward schemes).
DM = 'https://github.com/archiboltmusk/india-geodata/tree/main/data/urban/municipal-boundaries/'
DM_RAW = 'https://raw.githubusercontent.com/archiboltmusk/india-geodata/main/data/urban/municipal-boundaries/'
IS_RAW = 'https://raw.githubusercontent.com/archiboltmusk/INDIAN-SHAPEFILES/master/METROPOLITAN%20CITIES/'
EXTRA = {
    # SBM has only Mumbai's 24 administrative wards; this is the 227 electoral wards of the 2017 election.
    '802794': {'url': DM_RAW + 'mumbai/bmc_electoral_wards_2017', 'source': DM + 'mumbai',
               'label': 'BMC electoral wards, 2017 election (DataMeet, CC BY-SA 2.5 IN)',
               'ward': 'PRABHAG_NO', 'name': lambda p: 'Admin ward ' + p['WARD'] if p.get('WARD') else ''},
    # SBM has 145 of GHMC's 150 wards; this file has all 150 (same 2016 wards, median overlap 92%).
    '802918': {'url': IS_RAW + 'HYDERABAD.geojson', 'source': 'https://github.com/archiboltmusk/INDIAN-SHAPEFILES/blob/master/METROPOLITAN%20CITIES/HYDERABAD.geojson',
               'label': 'GHMC wards, 2016 (INDIAN-SHAPEFILES, MIT)',
               'ward': 'Ward_No', 'name': lambda p: clean(p.get('Name'))},
}

def apply_extra(towns):
    for ulb, e in EXTRA.items():
        if ulb not in towns: continue
        src = json.loads(fetch(f'extra-{ulb}.geojson', e['url']).read_text())
        feats, seen = [], set()
        for r in src['features']:
            if not r.get('geometry'): continue
            no = int(r['properties'][e['ward']])
            g, b = geom(shape(r['geometry']))
            if not g or no in seen: continue
            seen.add(no)
            p = {'ward': no}
            if e['name'](r['properties']): p['name'] = e['name'](r['properties'])
            feats.append({'type': 'Feature', 'bbox': b, 'properties': p, 'geometry': g})
        feats.sort(key=lambda f: f['properties']['ward'])
        (OUT / f'{ulb}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'source': e['source'], 'label': e['label'],
            'features': feats}, separators=(',', ':'), ensure_ascii=False))
        bs = [f['bbox'] for f in feats]
        towns[ulb].update(wards=len(feats), bbox=[round(x, 4) for x in (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))],
                          source=e['source'])
        print(towns[ulb]['name'], len(feats), 'wards from', e['label'])

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
    tj = ROOT / 'places' / 'in' / 'towns.json'
    if '--extra' in sys.argv:
        d = json.loads(tj.read_text())
        apply_extra(d['towns'])
        tj.write_text(json.dumps(d, separators=(',', ':'), ensure_ascii=False))
        return
    import geopandas as gpd
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
    apply_extra(towns)
    tj.write_text(json.dumps({
        'source': 'https://github.com/yashveeeeeeer/india-geodata/releases/tag/urban%2Fboundaries',
        'attribution': 'Town wards: Swachh Bharat Mission (Urban) GIS, as uploaded by each municipality, via india-geodata (CC0).',
        'towns': towns}, separators=(',', ':'), ensure_ascii=False))
    print(len(towns), 'towns,', sum(t['wards'] for t in towns.values()), 'wards')

if __name__ == '__main__':
    main()
