#!/usr/bin/env python3
"""Offline checks for tools/postgis_check.py (fixtures only, no database).

    python3 tests/test_postgis_check.py
"""
import contextlib, importlib.util, io, os, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('pc', os.path.join(HERE, '..', 'tools', 'postgis_check.py'))
pc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pc)
FIX = os.path.join(HERE, 'fixtures', 'postgis')


def run(argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = pc.main(argv)
    return code, out.getvalue()


class GeoJSONMode(unittest.TestCase):
    def test_good_fixture_passes(self):
        code, out = run([os.path.join(FIX, 'good.geojson')])
        self.assertEqual(code, 0)
        self.assertIn('2 checked, 0 failed', out)

    def test_bad_fixture_reports_each_problem(self):
        code, out = run([os.path.join(FIX, 'bad.geojson')])
        self.assertEqual(code, 1)
        self.assertIn('ring is not closed', out)
        self.assertIn('ring crosses itself', out)
        self.assertIn('out of lng/lat range', out)
        self.assertIn('unknown geometry type', out)
        self.assertIn('4 checked, 4 failed', out)

    def test_shared_vertex_is_not_a_crossing(self):
        square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
        self.assertEqual(pc.ring_problems(square), [])

    def test_database_mode_needs_dsn(self):
        os.environ.pop('PGCHECK_DSN', None)
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
            pc.main(['--table', 'areas'])
        self.assertEqual(cm.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
