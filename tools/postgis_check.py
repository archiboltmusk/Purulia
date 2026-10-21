#!/usr/bin/env python3
"""Read-only geometry checker for boundary data (GeoJSON files or a PostGIS table).

    python3 tools/postgis_check.py tests/fixtures/postgis/good.geojson
    PGCHECK_DSN='postgresql://readonly@host/db' python3 tools/postgis_check.py --table areas --column geom

Checks each geometry for: a known type, closed rings with at least 4 positions, lng/lat
inside the valid range, and no self-intersection (GeoJSON mode). Database mode runs only
SELECT statements inside a READ ONLY transaction and asks PostGIS for ST_IsValid,
ST_SRID and the reason for each invalid row. Nothing is written in either mode.

Exit 0 when every geometry passes, 1 when any fails, 2 on bad usage.
"""
import argparse, json, os, sys

TYPES = {'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'}


def _segments_cross(a, b, c, d):
    """True when segment ab properly crosses segment cd (shared endpoints do not count)."""
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    if a in (c, d) or b in (c, d):
        return False
    return (orient(a, b, c) > 0) != (orient(a, b, d) > 0) and (orient(c, d, a) > 0) != (orient(c, d, b) > 0)


def ring_problems(ring):
    out = []
    if len(ring) < 4:
        out.append('ring has fewer than 4 positions')
    if ring and ring[0] != ring[-1]:
        out.append('ring is not closed')
    for p in ring:
        if not (isinstance(p, list) and len(p) >= 2 and all(isinstance(v, (int, float)) for v in p[:2])):
            out.append('position is not a number pair')
            return out
        if not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90):
            out.append(f'position out of lng/lat range: {p[0]}, {p[1]}')
            return out
    segs = list(zip(ring, ring[1:]))
    for i in range(len(segs)):
        for j in range(i + 2, len(segs)):
            if i == 0 and j == len(segs) - 1:
                continue  # first and last segments share the closing vertex
            if _segments_cross(segs[i][0], segs[i][1], segs[j][0], segs[j][1]):
                out.append('ring crosses itself')
                return out
    return out


def geometry_problems(g):
    if not isinstance(g, dict) or g.get('type') not in TYPES:
        return [f'unknown geometry type: {g.get("type") if isinstance(g, dict) else g!r}']
    t, c = g['type'], g.get('coordinates')
    if t == 'Polygon':
        return [p for ring in c for p in ring_problems(ring)]
    if t == 'MultiPolygon':
        return [p for poly in c for ring in poly for p in ring_problems(ring)]
    return []  # points and lines: type check only; boundary files are polygons


def check_geojson(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    feats = data.get('features') if data.get('type') == 'FeatureCollection' else [data]
    bad = []
    for i, feat in enumerate(feats or []):
        g = feat.get('geometry') if isinstance(feat, dict) and 'geometry' in feat else feat
        probs = geometry_problems(g)
        if probs:
            name = (feat.get('properties') or {}).get('name', '') if isinstance(feat, dict) else ''
            bad.append((i, name, probs))
    return len(feats or []), bad


def check_table(dsn, table, column, limit):
    import psycopg  # imported here so GeoJSON mode needs no database driver
    from psycopg import sql
    q = sql.SQL(
        "SELECT ST_IsValid({c}), ST_IsValidReason({c}), ST_SRID({c}) FROM {t} LIMIT %s"
    ).format(c=sql.Identifier(column), t=sql.Identifier(table))
    bad, total = [], 0
    with psycopg.connect(dsn) as conn:
        conn.read_only = True  # every statement in this session is read-only
        with conn.cursor() as cur:
            cur.execute(q, (limit,))
            for valid, reason, srid in cur.fetchall():
                total += 1
                if not valid:
                    bad.append((total, reason, srid))
    return total, bad


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path', nargs='?', help='GeoJSON file to check')
    ap.add_argument('--table', help='PostGIS table (database mode, needs PGCHECK_DSN)')
    ap.add_argument('--column', default='geom')
    ap.add_argument('--limit', type=int, default=100000)
    args = ap.parse_args(argv)
    if bool(args.path) == bool(args.table):
        ap.error('give a GeoJSON path or --table, not both')
    if args.path:
        total, bad = check_geojson(args.path)
        for i, name, probs in bad:
            print(f'feature {i} {name}: ' + '; '.join(probs))
        label = args.path
    else:
        dsn = os.environ.get('PGCHECK_DSN', '')
        if not dsn:
            ap.error('set PGCHECK_DSN to a read-only connection string')
        total, bad = check_table(dsn, args.table, args.column, args.limit)
        for row, reason, srid in bad:
            print(f'row {row} srid {srid}: {reason}')
        label = args.table
    print(f'{label}: {total} checked, {len(bad)} failed')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
