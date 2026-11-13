import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('tourism_setup',ROOT/'tools/tourism/apply-backend.py')
setup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class TargetTests(unittest.TestCase):
    def test_only_configured_project(self):
        for dsn in ['postgresql://postgres:password@db.correct.supabase.co/postgres','postgresql://postgres.correct:password@aws-0-region.pooler.supabase.com/postgres']:
            self.assertEqual(setup.target(dsn,'correct'),dsn)
    def test_reject_redirects_and_other_projects(self):
        for dsn in ['postgresql://postgres:password@db.other.supabase.co/postgres','postgresql://postgres:password@evil.test/postgres','postgresql://postgres:password@db.correct.supabase.co/postgres?host=evil.test','postgresql://postgres@db.correct.supabase.co/postgres']:
            with self.assertRaises(ValueError):setup.target(dsn,'correct')
    def test_main_guard_and_missing_credential(self):
        import os
        from unittest.mock import patch
        with patch.dict(os.environ,{'GITHUB_REF':'refs/heads/main'},clear=True):
            self.assertEqual(setup.main(),1)

if __name__=='__main__':unittest.main()
