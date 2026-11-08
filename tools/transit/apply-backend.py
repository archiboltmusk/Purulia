#!/usr/bin/env python3
"""Manual Actions setup: apply only the transit passenger migration to the configured project."""
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261108160000_kasa_transit_passengers.sql'


def project_config():
    text = (ROOT / 'config.js').read_text()
    url = re.search(r"SUPABASE_URL:\s*'([^']+)'", text).group(1)
    key = re.search(r"SUPABASE_ANON_KEY:\s*'([^']+)'", text).group(1)
    host = urlparse(url).hostname
    if not host or not re.fullmatch(r'[a-z0-9]+\.supabase\.co', host):
        raise ValueError('Unsupported project configuration')
    return host.split('.')[0], url, key


def validate_target(dsn, project):
    p = urlparse(dsn)
    user = unquote(p.username or '')
    if p.scheme not in ['postgres', 'postgresql'] or not p.password or p.path != '/postgres':
        raise ValueError('A password-authenticated Postgres URI is required')
    direct = p.hostname == 'db.' + project + '.supabase.co' and user == 'postgres'
    pooled = bool(p.hostname and p.hostname.endswith('.pooler.supabase.com')) and user == 'postgres.' + project
    if not (direct or pooled):
        raise ValueError('Database does not match the configured project')
    # Reject connection-string overrides that could redirect away from the checked host.
    if set(parse_qs(p.query)) - {'sslmode', 'connect_timeout', 'application_name'}:
        raise ValueError('Unsupported database URI options')
    return dsn


def verify_rpc(url, key):
    request = Request(url + '/rest/v1/rpc/kasa_transit_status', data=b'{}', headers={
        'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'
    })
    for attempt in range(5):
        try:
            with urlopen(request, timeout=5) as response:
                data = json.loads(response.read(4096))
                if data.get('available') is True:
                    return True
        except Exception:
            pass  # Never print response bodies, credentials, DSN or exception text.
        if attempt < 4:
            time.sleep(1)
    return False


def main():
    if os.environ.get('GITHUB_REF') != 'refs/heads/main':
        print('Backend setup only runs from main.'); return 1
    if not os.environ.get('SUPABASE_DB_URL'):
        print('Add repository Actions secret SUPABASE_DB_URL before running setup.'); return 1
    applied = False
    try:
        import psycopg
        project, url, anon_key = project_config()
        dsn = validate_target(os.environ['SUPABASE_DB_URL'], project)
        with psycopg.connect(dsn, sslmode='require', connect_timeout=15, prepare_threshold=None) as conn:
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30s'")
                cur.execute("set local lock_timeout = '5s'")
                cur.execute("select to_regprocedure('kasa_private.net_limit(text,integer,integer,text)'), to_regprocedure('kasa_private.ip_hash()')")
                if not all(cur.fetchone()):
                    raise ValueError('Existing Parishkar backend prerequisites missing')
                cur.execute(MIGRATION.read_text(), prepare=False)
                cur.execute('select public.kasa_transit_status()')
                if cur.fetchone()[0].get('available') is not True:
                    raise ValueError('Status verification failed')
                for signature in ['kasa_transit_status()', 'kasa_transit_reports(text)', 'kasa_transit_withdraw(uuid)', 'kasa_transit_submit(uuid,text,double precision,double precision,double precision,timestamp with time zone)']:
                    cur.execute("select has_function_privilege('anon', %s, 'execute')", ('public.' + signature,))
                    if not cur.fetchone()[0]:
                        raise ValueError('RPC permission verification failed')
                cur.execute("select has_table_privilege('anon','kasa_private.transit_passengers','select')")
                if cur.fetchone()[0]:
                    raise ValueError('Private table is exposed')
                cur.execute("notify pgrst, 'reload schema'")
        applied = True
        if not verify_rpc(url, anon_key):
            print('Migration applied; public RPC verification is pending or failed. Rerun setup after checking Supabase API availability.'); return 1
        print('Transit passenger backend applied and public availability RPC verified.'); return 0
    except Exception:
        print('Backend setup was not confirmed. Connection details are not logged; rerunning this idempotent setup is safe.'); return 1


if __name__ == '__main__':
    sys.exit(main())
