#!/usr/bin/env python3
"""Apply only the tourism migration to the Supabase project already configured by Parishkar."""
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261113120000_kasa_tourism_services.sql'

def target(dsn, project):
    p = urlparse(dsn)
    user = unquote(p.username or '')
    if p.scheme not in ('postgres', 'postgresql') or not p.password or p.path != '/postgres':
        raise ValueError('Password-authenticated Postgres URI required')
    direct = p.hostname == 'db.' + project + '.supabase.co' and user == 'postgres'
    pooled = bool(p.hostname and p.hostname.endswith('.pooler.supabase.com')) and user == 'postgres.' + project
    if not (direct or pooled) or set(parse_qs(p.query)) - {'sslmode', 'connect_timeout', 'application_name'}:
        raise ValueError('Database must match the configured project')
    return dsn

def main():
    if os.environ.get('GITHUB_REF') != 'refs/heads/main':
        print('Tourism backend setup only runs from main.'); return 1
    if not os.environ.get('SUPABASE_DB_URL'):
        print('Backend not applied: repository Actions secret SUPABASE_DB_URL is missing.'); return 1
    try:
        import psycopg
        config = (ROOT / 'config.js').read_text()
        url = re.search(r"SUPABASE_URL:\s*'([^']+)'", config).group(1)
        key = re.search(r"SUPABASE_ANON_KEY:\s*'([^']+)'", config).group(1)
        host = urlparse(url).hostname
        if not host or not re.fullmatch(r'[a-z0-9]+\.supabase\.co', host):
            raise ValueError('Invalid configured project')
        dsn = target(os.environ['SUPABASE_DB_URL'], host.split('.')[0])
        with psycopg.connect(dsn, sslmode='require', connect_timeout=15, prepare_threshold=None) as conn:
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout='30s'")
                cur.execute("set local lock_timeout='5s'")
                cur.execute("select to_regprocedure('kasa_private.is_admin()'),to_regprocedure('kasa_private.ip_hash()'),to_regprocedure('kasa_private.net_limit(text,integer,integer,text)')")
                if not all(cur.fetchone()):
                    raise ValueError('Existing backend prerequisites missing')
                sql = re.sub(r'^(begin|commit);\s*$', '', MIGRATION.read_text(), flags=re.MULTILINE)
                cur.execute(sql, prepare=False)
                for table in ['tourism_providers', 'tourism_enquiries']:
                    for role in ['anon', 'authenticated']:
                        cur.execute("select has_table_privilege(%s,%s,'select,insert,update,delete')", (role, 'kasa_private.' + table))
                        if cur.fetchone()[0]:
                            raise ValueError('Private table privileges are exposed')
                cur.execute("select has_function_privilege('anon','public.kasa_tourism_providers()','execute'),has_function_privilege('anon','public.kasa_tourism_enquire(uuid,uuid,date,integer,text)','execute')")
                if cur.fetchone() != (True, False):
                    raise ValueError('Tourism public RPC privileges are incorrect')
        request = Request(url + '/rest/v1/rpc/kasa_tourism_providers', data=b'{}', headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=10) as response:
            if not isinstance(json.loads(response.read(200000)), list):
                raise ValueError('Public provider API verification failed')
        print('Tourism backend applied; private-table privileges and public provider API verified.'); return 0
    except Exception:
        print('Tourism backend not confirmed. No connection details are logged. Check Supabase availability and rerun the idempotent setup.'); return 1

if __name__ == '__main__':
    sys.exit(main())
