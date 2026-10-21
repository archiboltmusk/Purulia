#!/usr/bin/env python3
"""Offline checks for tools/build-openaq.py (no network, no key).

    python3 tests/test_build_openaq.py
"""
import importlib.util, os, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bo', os.path.join(HERE, '..', 'tools', 'build-openaq.py'))
bo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bo)


def loc(id_, lat, lng, params):
    return {'id': id_, 'name': f'S{id_}', 'provider': {'name': 'P'},
            'coordinates': {'latitude': lat, 'longitude': lng},
            'sensors': [{'id': id_ * 10 + i, 'parameter': {'name': p, 'units': 'µg/m³' if p == 'pm25' else 'ppb'}}
                        for i, p in enumerate(params)]}


class PickStation(unittest.TestCase):
    def test_nearest_with_pm25_wins(self):
        locs = [loc(1, 22.57, 88.36, ['no2']),           # nearest, but no PM2.5
                loc(2, 22.60, 88.40, ['pm25', 'o3']),   # PM2.5, farther
                loc(3, 22.80, 88.50, ['pm25'])]
        hit = bo.pick_station(locs, 22.57, 88.36)
        self.assertEqual(hit[0]['id'], 2)
        self.assertGreater(hit[1], 0)

    def test_none_without_pm25(self):
        self.assertIsNone(bo.pick_station([loc(1, 22.5, 88.3, ['no2'])], 22.5, 88.3))

    def test_missing_coordinates_skipped(self):
        bad = {'id': 9, 'sensors': [{'id': 90, 'parameter': {'name': 'pm25'}}], 'coordinates': {}}
        self.assertIsNone(bo.pick_station([bad], 22.5, 88.3))


class LatestPm25(unittest.TestCase):
    def test_takes_newest_pm25_only(self):
        sensors = [{'id': 5, 'parameter': {'name': 'pm25', 'units': 'µg/m³'}},
                   {'id': 6, 'parameter': {'name': 'no2', 'units': 'ppb'}}]
        results = [{'sensorsId': 5, 'value': 40.0, 'datetime': {'utc': '2026-10-15T08:00:00Z'}},
                   {'sensorsId': 5, 'value': 55.5, 'datetime': {'utc': '2026-10-15T09:00:00Z'}},
                   {'sensorsId': 6, 'value': 99.0, 'datetime': {'utc': '2026-10-15T10:00:00Z'}}]
        self.assertEqual(bo.latest_pm25(results, sensors),
                         {'value': 55.5, 'unit': 'µg/m³', 'utc': '2026-10-15T09:00:00Z'})

    def test_none_when_no_reading(self):
        sensors = [{'id': 5, 'parameter': {'name': 'pm25', 'units': 'µg/m³'}}]
        self.assertIsNone(bo.latest_pm25([{'sensorsId': 5, 'value': None, 'datetime': {'utc': 'x'}}], sensors))


class Centre(unittest.TestCase):
    def test_polygon_mean_is_lat_lng(self):
        geom = {'type': 'Polygon', 'coordinates': [[[88.0, 22.0], [88.2, 22.0], [88.2, 22.2], [88.0, 22.2], [88.0, 22.0]]]}
        lat, lng = bo.centre(geom)
        self.assertAlmostEqual(lat, 22.08, places=2)
        self.assertAlmostEqual(lng, 88.08, places=2)


class Distance(unittest.TestCase):
    def test_one_degree_latitude_is_about_111_km(self):
        self.assertAlmostEqual(bo.dist_km(22.0, 88.0, 23.0, 88.0), 111.2, delta=0.5)


if __name__ == '__main__':
    unittest.main()
