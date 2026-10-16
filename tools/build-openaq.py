#!/usr/bin/env python3
"""Latest PM2.5 at the OpenAQ station nearest each West Bengal district centre.

    OPENAQ_API_KEY=... python3 tools/build-openaq.py

Writes places/air/openaq.json. The key is read from the environment only (GitHub secret
OPENAQ_API_KEY, see openaq-refresh.yml) and is sent to api.openaq.org in the X-API-Key
header; it is never written to the file or the page. The page reads the committed JSON,
so no visitor's browser calls OpenAQ.

A district with no PM2.5 station within 25 km, or a failed request, keeps its last good
entry. Without a key the script exits 1 and leaves the file alone.
"""
import json, math, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DISTRICTS = os.path.join(ROOT, 'places', 'wb_districts.geojson')
OUT = os.path.join(ROOT, 'places', 'air', 'openaq.json')
API = 'https://api.openaq.org/v3'
UA = 'ParishkarPurulia/1.0 (civic information; https://github.com/archiboltmusk/Purulia)'
RADIUS_M = 25000          # OpenAQ's maximum search radius
PAUSE_S = 1.1             # free key: 60 requests a minute
WHO_PM25_24H = 15         # WHO Global Air Quality Guidelines 2021, 24-hour mean, µg/m³


def dist_km(a_lat, a_lng, b_lat, b_lng):
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2
         + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lng - a_lng) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(h))


def centre(geom):
    """Mean of the outer-ring vertices of the largest part (approximate district centre)."""
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    ring = max((p[0] for p in polys), key=len)
    return (round(sum(p[1] for p in ring) / len(ring), 4), round(sum(p[0] for p in ring) / len(ring), 4))


def pm25_sensors(location):
    return [s for s in location.get('sensors', []) if (s.get('parameter') or {}).get('name') == 'pm25']


def pick_station(locations, lat, lng):
    """Nearest location that reports PM2.5, or None. Returns (location, km)."""
    best = None
    for loc in locations:
        c = loc.get('coordinates') or {}
        if c.get('latitude') is None or not pm25_sensors(loc):
            continue
        km = dist_km(lat, lng, c['latitude'], c['longitude'])
        if best is None or km < best[1]:
            best = (loc, km)
    return best


def latest_pm25(latest_results, sensors):
    """Latest PM2.5 value among the location's PM2.5 sensors, or None."""
    sensors = [s for s in sensors if (s.get('parameter') or {}).get('name') == 'pm25']
    ids = {s['id'] for s in sensors}
    hits = [r for r in latest_results if r.get('sensorsId') in ids and r.get('value') is not None]
    if not hits:
        return None
    r = max(hits, key=lambda r: str((r.get('datetime') or {}).get('utc', r.get('datetime', ''))))
    dt = r.get('datetime')
    utc = dt.get('utc') if isinstance(dt, dict) else dt
    unit = next((s['parameter'].get('units') for s in sensors if s['id'] == r['sensorsId']), 'µg/m³')
    return {'value': r['value'], 'unit': unit, 'utc': utc}


def get(path, key, params=None):
    url = f'{API}{path}' + (f'?{urllib.parse.urlencode(params)}' if params else '')
    req = urllib.request.Request(url, headers={'X-API-Key': key, 'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode('utf-8'))


def load_previous():
    try:
        with open(OUT, encoding='utf-8') as f:
            return {d['slug']: d for d in json.load(f).get('districts', [])}
    except (OSError, ValueError):
        return {}


def main():
    key = os.environ.get('OPENAQ_API_KEY', '').strip()
    if not key:
        print('OPENAQ_API_KEY not set; leaving places/air/openaq.json unchanged', file=sys.stderr)
        return 1
    with open(DISTRICTS, encoding='utf-8') as f:
        feats = json.load(f)['features']
    previous = load_previous()
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    out = []
    for feat in feats:
        p = feat['properties']
        lat, lng = centre(feat['geometry'])
        try:
            locs = get('/locations', key, {'coordinates': f'{lat},{lng}', 'radius': RADIUS_M, 'limit': 100}).get('results', [])
            time.sleep(PAUSE_S)
            hit = pick_station(locs, lat, lng)
            if hit is None:
                row = {'slug': p['slug'], 'name': p['district'], 'station': None, 'pm25': None}
            else:
                loc, km = hit
                sensors = pm25_sensors(loc)
                latest = get(f"/locations/{loc['id']}/latest", key).get('results', [])
                time.sleep(PAUSE_S)
                c = loc['coordinates']
                row = {'slug': p['slug'], 'name': p['district'],
                       'station': {'id': loc['id'], 'name': loc.get('name', ''), 'provider': (loc.get('provider') or {}).get('name', ''),
                                   'lat': c['latitude'], 'lng': c['longitude'], 'km': round(km, 1),
                                   'url': f"https://explore.openaq.org/locations/{loc['id']}"},
                       'pm25': latest_pm25(latest, sensors)}
            out.append(row)
        except Exception as ex:  # keep the last good entry for this district
            print(f"{p['district']}: {ex}; keeping last good value", file=sys.stderr)
            out.append(previous.get(p['slug'], {'slug': p['slug'], 'name': p['district'], 'station': None, 'pm25': None}))
            time.sleep(PAUSE_S)
    data = {'generated': now, 'source': 'OpenAQ API v3 (api.openaq.org)',
            'source_url': 'https://openaq.org/', 'who_pm25_24h': WHO_PM25_24H,
            'method': 'Nearest station with a PM2.5 sensor within 25 km of each district centre (mean of its boundary points); latest reading only, not a district average.',
            'districts': out}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'wrote {len(out)} districts')
    return 0


if __name__ == '__main__':
    sys.exit(main())
