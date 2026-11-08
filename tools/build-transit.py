#!/usr/bin/env python3
"""Convert licensed India GTFS schedules into the travel contract. No network access.
Unsupported semantics fail closed; source identity and reuse permission need human review.
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
MODES = {'0': 'tram', '1': 'metro', '2': 'train', '3': 'bus', '4': 'ferry', '5': 'cable', '6': 'cable', '7': 'cable'}
WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def seconds(value):
    require(bool(re.fullmatch(r'\d{2}:\d{2}:\d{2}', value)), 'Missing/invalid exact stop time')
    h, m, s = map(int, value.split(':'))
    require(h < 48 and m < 60 and s < 60, 'Stop time out of range')
    return h * 3600 + m * 60 + s


def unique(rows, key):
    out = {}
    for row in rows:
        require(bool(row.get(key)) and row[key] not in out, 'Missing/duplicate ' + key)
        out[row[key]] = row
    return out


def build(path, source_id, source_url, license_url, start, days, retrieved_at):
    require(retrieved_at.tzinfo is not None and retrieved_at <= dt.datetime.now(dt.timezone.utc), "Retrieval timestamp must have a timezone and not be in the future")
    require(bool(re.fullmatch(r'[a-z0-9-]{1,60}', source_id)), 'Use a stable lowercase source ID')
    require(1 <= days <= 7, 'Export 1 to 7 service days')
    for url in [source_url, license_url]:
        require(urlparse(url).scheme == 'https' and bool(urlparse(url).netloc), 'Source and licence must use HTTPS')
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        require(len(names) == len(set(names)), 'Duplicate archive entries')
        require(sum(i.file_size for i in z.infolist()) < 200_000_000, 'GTFS archive too large')

        def table(name, required=False):
            if name not in names:
                require(not required, 'Missing ' + name)
                return []
            with z.open(name) as f:
                return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig', newline='')))

        # These features affect boarding/connection correctness; never silently discard them.
        for name in ['frequencies.txt', 'transfers.txt', 'pathways.txt', 'booking_rules.txt']:
            require(not table(name), name + ' is not supported; do not publish a partial conversion')
        agency_rows = table('agency.txt', True)
        if len(agency_rows) == 1 and not agency_rows[0].get('agency_id'):
            agency_rows[0]['agency_id'] = '__single__'
        agencies = unique(agency_rows, 'agency_id')
        require(all(a.get('agency_timezone') == 'Asia/Kolkata' for a in agencies.values()), 'India timezone only')
        stops = unique(table('stops.txt', True), 'stop_id')
        routes = unique(table('routes.txt', True), 'route_id')
        trips = unique(table('trips.txt', True), 'trip_id')
        calendars = unique(table('calendar.txt'), 'service_id')
        exceptions = {}
        for row in table('calendar_dates.txt'):
            key = (row['service_id'], row['date'])
            require(key not in exceptions and row['exception_type'] in ['1', '2'], 'Invalid calendar exception')
            exceptions[key] = row['exception_type']
        require(calendars or exceptions, 'No service calendar')
        calls = {}
        for row in table('stop_times.txt', True):
            require(row['trip_id'] in trips and row['stop_id'] in stops, 'Unknown trip/stop reference')
            require(row.get('pickup_type', '0') in ['', '0', '1'] and row.get('drop_off_type', '0') in ['', '0', '1'], 'On-demand boarding is not supported')
            require(not any(row.get(k) for k in ['start_pickup_drop_off_window', 'end_pickup_drop_off_window', 'location_group_id', 'location_id']), 'Flexible services are not supported')
            require(row.get('continuous_pickup', '1') in ['', '1'] and row.get('continuous_drop_off', '1') in ['', '1'], 'Continuous boarding is not supported')
            require(row.get('timepoint', '1') in ['', '1'], 'Estimated stop times are not supported')
            calls.setdefault(row['trip_id'], []).append(row)
        output, used = [], set()
        for tid, trip in trips.items():
            require(trip['route_id'] in routes, 'Unknown route')
            route = routes[trip['route_id']]
            require(route.get('continuous_pickup', '1') in ['', '1'] and route.get('continuous_drop_off', '1') in ['', '1'], 'Continuous boarding is not supported')
            require(route['route_type'] in MODES, 'Unsupported route type: ' + route['route_type'])
            aid = route.get('agency_id') or (next(iter(agencies)) if len(agencies) == 1 else '')
            require(aid in agencies, 'Unknown agency')
            require(tid in calls and len(calls[tid]) >= 2, 'Trip needs at least two timed calls')
            ordered = sorted(calls[tid], key=lambda c: int(c['stop_sequence']))
            require(len({int(c['stop_sequence']) for c in ordered}) == len(ordered), 'Duplicate stop sequence')
            previous = -1
            for c in ordered:
                a, d = seconds(c['arrival_time']), seconds(c['departure_time'])
                require(a >= previous and d >= a, 'Non-monotonic trip times')
                previous = d
            for offset in range(days):
                date = start + dt.timedelta(days=offset)
                key = date.strftime('%Y%m%d')
                cal = calendars.get(trip['service_id'])
                ex = exceptions.get((trip['service_id'], key))
                active = ex == '1' or (ex != '2' and cal and cal['start_date'] <= key <= cal['end_date'] and cal.get(WEEKDAYS[date.weekday()]) == '1')
                if not active:
                    continue
                midnight = dt.datetime.combine(date, dt.time(), IST)
                normalized = []
                for c in ordered:
                    used.add(c['stop_id'])
                    normalized.append({'stop_id': source_id + ':' + c['stop_id'], 'arrival': (midnight + dt.timedelta(seconds=seconds(c['arrival_time']))).isoformat(), 'departure': (midnight + dt.timedelta(seconds=seconds(c['departure_time']))).isoformat(), 'pickup': c.get('pickup_type') != '1', 'dropoff': c.get('drop_off_type') != '1'})
                output.append({'id': source_id + ':' + tid + ':' + key, 'source_id': source_id, 'name': route.get('route_short_name') or route.get('route_long_name') or trip.get('trip_headsign') or tid, 'operator': agencies[aid]['agency_name'], 'mode': MODES[route['route_type']], 'wheelchair': {'1': 'yes', '2': 'no'}.get(trip.get('wheelchair_accessible'), 'unknown'), 'calls': normalized})
        require(len(output) <= 50000, 'Too many trips; export fewer service days')
        normalized_stops = []
        for sid in sorted(used):
            s = stops[sid]
            require(bool(s.get('stop_name')), 'Missing stop name')
            lat, lon = float(s['stop_lat']), float(s['stop_lon'])
            require(-90 <= lat <= 90 and -180 <= lon <= 180, 'Invalid stop coordinates')
            normalized_stops.append({'id': source_id + ':' + sid, 'source_id': source_id, 'name': s['stop_name'], 'lat': lat, 'lon': lon})
        return {'schema_version': 1, 'timezone': 'Asia/Kolkata', 'sources': [{'id': source_id, 'name': ' / '.join(a['agency_name'] for a in agencies.values()), 'url': source_url, 'license_url': license_url, 'retrieved_at': retrieved_at.isoformat(), 'valid_from': dt.datetime.combine(start, dt.time(), IST).isoformat(), 'valid_until': dt.datetime.combine(start + dt.timedelta(days=days + 1), dt.time(), IST).isoformat(), 'sha256': digest}], 'stops': normalized_stops, 'trips': output, 'positions': []}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive', type=Path)
    p.add_argument('--source-id', required=True)
    p.add_argument('--source-url', required=True)
    p.add_argument('--license-url', required=True)
    p.add_argument('--start', type=dt.date.fromisoformat, required=True)
    p.add_argument('--retrieved-at', type=dt.datetime.fromisoformat, required=True, help='Actual feed download timestamp, including UTC offset')
    p.add_argument('--days', type=int, default=2)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    try:
        data = build(args.archive, args.source_id, args.source_url, args.license_url, args.start, args.days, args.retrieved_at)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # Atomic replacement: a bad build cannot truncate a previously working feed.
        with tempfile.NamedTemporaryFile('w', dir=args.output.parent, delete=False, encoding='utf-8') as f:
            temp = f.name
            json.dump(data, f, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        os.replace(temp, args.output)
    except (ValueError, KeyError, zipfile.BadZipFile) as e:
        p.exit(1, 'Transport import rejected: ' + str(e) + '\n')


if __name__ == '__main__':
    main()
