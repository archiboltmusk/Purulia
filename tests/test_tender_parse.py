#!/usr/bin/env python3
"""Offline checks for tools/tender_parse.py (saved fixture, no network).

    python3 tests/test_tender_parse.py
"""
import contextlib, importlib.util, io, json, os, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('tp', os.path.join(HERE, '..', 'tools', 'tender_parse.py'))
tp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tp)
SAMPLE = os.path.join(HERE, 'fixtures', 'tenders', 'sample.html')
SRC = 'https://example.gov.in/tenders'


def parsed(markup=None):
    if markup is None:
        with open(SAMPLE, encoding='utf-8') as f:
            markup = f.read()
    return tp.parse_text(tp.visible_text(markup), SRC, '2026-10-21T10:00:00Z')


class Parse(unittest.TestCase):
    def test_two_tenders_with_labelled_fields(self):
        rows = parsed()
        self.assertEqual([r['tender_id'] for r in rows], ['WBPWD/2026/0412', 'WBPWD/2026/0413'])
        self.assertEqual(rows[0]['title'], 'Resurfacing of Station Road, Purulia')
        self.assertEqual(rows[0]['organisation'], 'Public Works Department, Purulia Division')

    def test_every_row_carries_source_and_fetch_time(self):
        for r in parsed():
            self.assertEqual(r['source_url'], SRC)
            self.assertEqual(r['fetched_at'], '2026-10-21T10:00:00Z')

    def test_lakh_and_grouped_rupees(self):
        rows = parsed()
        self.assertEqual(rows[0]['value_inr'], 1_250_000)
        self.assertEqual(rows[1]['value_inr'], 125_000)

    def test_closing_date_iso_and_invalid_date_is_null(self):
        rows = parsed()
        self.assertEqual(rows[0]['closing_date'], '2026-11-03')
        self.assertIsNone(rows[1]['closing_date'])  # 31 Feb does not exist: null, not guessed

    def test_script_text_is_ignored(self):
        self.assertNotIn('ignored', json.dumps(parsed()))

    def test_no_tender_id_gives_no_rows(self):
        self.assertEqual(parsed('<p>Nothing here</p>'), [])


class Refusals(unittest.TestCase):
    def _fake(self, body, status=200):
        resp = mock.MagicMock()
        resp.status = status
        resp.read.return_value = body.encode('utf-8')
        resp.__enter__.return_value = resp
        return mock.patch('urllib.request.urlopen', return_value=resp)

    def test_captcha_page_is_refused(self):
        with self._fake('<html>Please solve the captcha</html>'), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(tp.main(['--url', SRC]), 1)
        self.assertIn('CAPTCHA', err.getvalue())

    def test_non_200_is_refused(self):
        with self._fake('nope', status=503), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(tp.main(['--url', SRC]), 1)

    def test_saved_file_needs_source_url(self):
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
            tp.main([SAMPLE])
        self.assertEqual(cm.exception.code, 2)


class Cli(unittest.TestCase):
    def test_saved_file_prints_rows_with_source(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(tp.main([SAMPLE, '--source-url', SRC]), 0)
        rows = json.loads(out.getvalue())
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r['source_url'] == SRC for r in rows))


if __name__ == '__main__':
    unittest.main()
