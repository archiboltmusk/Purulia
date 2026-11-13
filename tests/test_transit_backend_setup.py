import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('setup', ROOT / 'tools/transit/apply-backend.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)


class TargetTests(unittest.TestCase):
    def test_accepts_configured_direct_and_pooler(self):
        for dsn in ['postgresql://postgres:FAKE@db.testproject.supabase.co:5432/postgres', 'postgresql://postgres.testproject:FAKE@aws-0-test.pooler.supabase.com:6543/postgres?sslmode=require']:
            self.assertEqual(s.validate_target(dsn, 'testproject'), dsn)

    def test_rejects_wrong_project_and_host_overrides(self):
        for dsn in ['postgresql://postgres:FAKE@db.other.supabase.co/postgres', 'postgresql://postgres.other:FAKE@aws-0-test.pooler.supabase.com/postgres', 'postgresql://postgres:FAKE@db.testproject.supabase.co/postgres?host=evil.example', 'postgresql://postgres.testproject:FAKE@aws-0-test.pooler.supabase.com.evil.example/postgres', 'postgresql://postgres@db.testproject.supabase.co/postgres']:
            with self.subTest(dsn=dsn), self.assertRaises(ValueError):
                s.validate_target(dsn, 'testproject')

    def test_uses_existing_public_project_configuration(self):
        project, url, key = s.project_config()
        self.assertIn(project, url)
        self.assertTrue(key)
        self.assertTrue(s.MIGRATION.is_file())


if __name__ == '__main__':
    unittest.main()
