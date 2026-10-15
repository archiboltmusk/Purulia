#!/usr/bin/env python3
"""Build places/godseye.json: live, free-tier public data for every West Bengal district.

    NASA_FIRMS_MAP_KEY=... python3 tools/build-godseye.py

Sources (all free; each row carries its licence in godseye.json `sources`):
- Open-Meteo forecast API (no key; free for non-commercial use, fair-use limit): current
  temperature, humidity, rain at each district's centre.
- Open-Meteo air-quality API (no key; same terms): PM2.5, PM10 and US AQI at each centre.
- NASA FIRMS area API (free MAP_KEY from firms.modaps.eosdis.nasa.gov/api/map_key; NASA open
  data): VIIRS satellite fire hotspots over West Bengal in the last 7 days, counted inside
  each district polygon (nominal and high confidence only).

A source that fails, or has no key, keeps its last good values in the committed file, so one
bad day never blanks the page. Nothing is estimated: a district with no reading shows none.
"""
import csv, io, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'places', 'godseye.json')
DISTRICTS = os.path.join(ROOT, 'places', 'wb_districts.geojson')
UA = 'parishkar-godseye/1.0 (+https://archiboltmusk.github.io/Purulia/godseye.html)'
WB_BBOX = (85.8, 21.5, 89.9, 27.3)  # west, south, east, north: covers every WB district
FIRMS_DAYS = 7


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8')


def rings(geom):
    """Yield (polygon, ring) pairs: each polygon is a list of rings, first one the outer ring."""
    if geom['type'] == 'Polygon':
        yield geom['coordinates']
    elif geom['type'] == 'MultiPolygon':
        yield from geom['coordinates']


def inside(lng, lat, polygon):
    """Ray casting on the outer ring, minus any hole the point falls in."""
    def in_ring(ring):
        hit = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
        return hit
    return in_ring(polygon[0]) and not any(in_ring(h) for h in polygon[1:])


def centre(geom):
    """Mean of the outer-ring vertices of the largest part: an approximate district centre."""
    best = max(rings(geom), key=lambda p: len(p[0]))
    pts = best[0]
    return (round(sum(p[0] for p in pts) / len(pts), 4), round(sum(p[1] for p in pts) / len(pts), 4))


def load_districts():
    with open(DISTRICTS, encoding='utf-8') as f:
        g = json.load(f)
    out = []
    for feat in g['features']:
        p = feat['properties']
        lng, lat = centre(feat['geometry'])
        out.append({'slug': p['slug'], 'name': p['district'], 'geom': feat['geometry'], 'lng': lng, 'lat': lat})
    return out


def open_meteo(districts):
    """One batched call per endpoint: Open-Meteo takes comma-separated coordinates."""
    lats = ','.join(str(d['lat']) for d in districts)
    lngs = ','.join(str(d['lng']) for d in districts)
    q = urllib.parse.urlencode({'latitude': lats, 'longitude': lngs, 'timezone': 'Asia/Kolkata'})
    weather = json.loads(get('https://api.open-meteo.com/v1/forecast?' + q + '&current=temperature_2m,relative_humidity_2m,precipitation'))
    time.sleep(1)
    air = json.loads(get('https://air-quality-api.open-meteo.com/v1/air-quality?' +
                         urllib.parse.urlencode({'latitude': lats, 'longitude': lngs, 'timezone': 'Asia/Kolkata', 'current': 'pm2_5,pm10,us_aqi'})))
    weather = weather if isinstance(weather, list) else [weather]
    air = air if isinstance(air, list) else [air]
    res = {}
    for d, w, a in zip(districts, weather, air):
        wc, ac = w.get('current', {}), a.get('current', {})
        res[d['slug']] = {
            'weather': {'temp_c': wc.get('temperature_2m'), 'humidity_pct': wc.get('relative_humidity_2m'),
                        'rain_mm': wc.get('precipitation'), 'at': wc.get('time')},
            'air': {'pm2_5': ac.get('pm2_5'), 'pm10': ac.get('pm10'), 'us_aqi': ac.get('us_aqi'), 'at': ac.get('time')},
        }
    return res


def firms_fires(districts, key):
    w, s, e, n = WB_BBOX
    url = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/%s/VIIRS_SNPP_NRT/%s,%s,%s,%s/%d' % (key, w, s, e, n, FIRMS_DAYS)
    rows = list(csv.DictReader(io.StringIO(get(url, timeout=120))))
    counts = {d['slug']: {'fires_7d': 0, 'high_confidence_7d': 0} for d in districts}
    for r in rows:
        try:
            lng, lat = float(r['longitude']), float(r['latitude'])
        except (KeyError, ValueError):
            continue
        conf = (r.get('confidence') or '').lower()
        if conf == 'l':
            continue
        for d in districts:
            if any(inside(lng, lat, poly) for poly in rings(d['geom'])):
                counts[d['slug']]['fires_7d'] += 1
                if conf == 'h':
                    counts[d['slug']]['high_confidence_7d'] += 1
                break
    return counts


def load_previous():
    try:
        with open(OUT, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'districts': {}, 'status': {}}


SOURCES = [
    {'id': 'open-meteo-forecast', 'name': 'Open-Meteo forecast API', 'url': 'https://open-meteo.com/', 'key_required': False,
     'licence': 'Free for non-commercial use; CC BY 4.0 data', 'terms': 'Free tier, no key; fair-use limit on calls per day'},
    {'id': 'open-meteo-air', 'name': 'Open-Meteo air-quality API', 'url': 'https://open-meteo.com/en/docs/air-quality-api', 'key_required': False,
     'licence': 'Free for non-commercial use; CAMS data (Copernicus) under its own terms', 'terms': 'Free tier, no key; fair-use limit on calls per day'},
    {'id': 'nasa-firms', 'name': 'NASA FIRMS (VIIRS S-NPP near-real-time)', 'url': 'https://firms.modaps.eosdis.nasa.gov/', 'key_required': True,
     'licence': 'NASA open data, free to use with attribution', 'terms': 'Free MAP_KEY; transaction limit per 10 minutes; 7-day area window'},
]


def main():
    districts = load_districts()
    prev = load_previous()
    out = {'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'sources': SOURCES,
           'districts': {}, 'status': {}}
    for d in districts:
        out['districts'][d['slug']] = dict(prev.get('districts', {}).get(d['slug'], {}), name=d['name'], at=[d['lng'], d['lat']])

    try:
        for slug, v in open_meteo(districts).items():
            out['districts'][slug].update(v)
        out['status']['open-meteo'] = 'ok'
    except Exception as ex:  # keep last good values
        print('open-meteo failed:', ex, file=sys.stderr)
        out['status']['open-meteo'] = 'failed'

    key = os.environ.get('NASA_FIRMS_MAP_KEY', '').strip()
    if not key:
        out['status']['nasa-firms'] = 'no key'
    else:
        try:
            for slug, v in firms_fires(districts, key).items():
                out['districts'][slug].update(v)
            out['status']['nasa-firms'] = 'ok'
        except Exception as ex:
            print('firms failed:', type(ex).__name__, file=sys.stderr)
            out['status']['nasa-firms'] = 'failed'

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('wrote', OUT, out['status'])


if __name__ == '__main__':
    main()
