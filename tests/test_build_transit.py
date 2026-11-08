import csv
import datetime as dt
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('builder', ROOT / 'tools/build-transit.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class ImportTests(unittest.TestCase):
    def archive(self, extra=None):
        rows = {
            'agency.txt': [{'agency_id': 'x', 'agency_name': 'Synthetic agency', 'agency_timezone': 'Asia/Kolkata'}],
            'stops.txt': [{'stop_id': x, 'stop_name': x, 'stop_lat': '23', 'stop_lon': '86'} for x in ['a', 'b']],
            'routes.txt': [{'route_id': 'r', 'agency_id': 'x', 'route_type': '2', 'route_short_name': 'Test'}],
            'trips.txt': [{'trip_id': 't', 'route_id': 'r', 'service_id': 's'}],
            'stop_times.txt': [{'trip_id': 't', 'stop_id': x, 'stop_sequence': str(i), 'arrival_time': time, 'departure_time': time} for i, (x, time) in enumerate([('a', '23:50:00'), ('b', '24:30:00')])],
            'calendar_dates.txt': [{'service_id': 's', 'date': '20261108', 'exception_type': '1'}]
        }
        rows.update(extra or {})
        path = Path(self.tmp.name) / 'test.zip'
        with zipfile.ZipFile(path, 'w') as z:
            for name, table in rows.items():
                f = io.StringIO(); w = csv.DictWriter(f, fieldnames=list(table[0])); w.writeheader(); w.writerows(table); z.writestr(name, f.getvalue())
        return path

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def build(self, extra=None):
        return b.build(self.archive(extra), 'synthetic', 'https://example.org/gtfs', 'https://example.org/license', dt.date(2026, 11, 8), 1, dt.datetime.now(dt.timezone.utc))

    def test_overnight_and_js_contract(self):
        data = self.build()
        self.assertEqual(data['trips'][0]['calls'][1]['arrival'], '2026-11-09T00:30:00+05:30')
        result = subprocess.run(['node', '-e', "const T=require('./transit-core.js');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>T.validate(JSON.parse(s)));"], cwd=ROOT, input=json.dumps(data), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_removed_service(self):
        self.assertEqual(self.build({'calendar_dates.txt': [{'service_id': 's', 'date': '20261108', 'exception_type': '2'}]})['trips'], [])

    def test_calendar_weekday(self):
        cal = {'service_id': 's', 'start_date': '20260101', 'end_date': '20261231', **{day: '1' if day == 'sunday' else '0' for day in b.WEEKDAYS}}
        data = self.build({'calendar.txt': [cal], 'calendar_dates.txt': [{'service_id': 's', 'date': '20261109', 'exception_type': '2'}]})
        self.assertEqual(len(data['trips']), 1)

    def test_reject_unsupported_semantics(self):
        for name in ['frequencies.txt', 'transfers.txt', 'pathways.txt', 'booking_rules.txt']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.build({name: [{'unsupported': '1'}]})

    def test_reject_estimated_times(self):
        with self.assertRaises(ValueError):
            self.build({'stop_times.txt': [{'trip_id': 't', 'stop_id': 'a', 'stop_sequence': '1', 'arrival_time': '10:00:00', 'departure_time': '10:00:00', 'timepoint': '0'}, {'trip_id': 't', 'stop_id': 'b', 'stop_sequence': '2', 'arrival_time': '11:00:00', 'departure_time': '11:00:00', 'timepoint': '1'}]})


if __name__ == '__main__':
    unittest.main()
