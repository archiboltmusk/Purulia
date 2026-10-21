"""Scenario tests for municipal dispatch batches (migration 20261021120000).

Each check goes through the public RPCs as the anon, authenticated or moderator role.

    python3 supabase/tests/test_dispatch.py "host=... port=... dbname=... user=postgres"
"""
import json
import sys
import uuid

import psycopg

DSN = sys.argv[1]
db = psycopg.connect(DSN, autocommit=True)
results = []


def reset():
    db.execute('reset role')
    db.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '', false)")


def act(uid=None, role=None):
    reset()
    role = role or ('authenticated' if uid else 'anon')
    db.execute(f'set role {role}')
    db.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid) if uid else '',))
    db.execute("select set_config('request.headers', %s, false)", (json.dumps({'x-forwarded-for': '10.0.0.9'}),))


def rpc(fn, uid=None, **kw):
    act(uid)
    try:
        args = ', '.join(f'{k} => %s' for k in kw)
        vals = [json.dumps(v) if isinstance(v, dict) else v for v in kw.values()]
        cur = db.execute(f'select public.{fn}({args})', vals)
        return cur.fetchone()[0]
    finally:
        reset()


def err(fn, uid=None, **kw):
    try:
        rpc(fn, uid, **kw)
        return None
    except psycopg.Error as e:
        return e.diag.message_primary


def check(name, cond, info=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'   -> {info}'))


def admin_sql(sql, params=None):
    reset()
    return db.execute(sql, params or ())


mod = uuid.uuid4()
bob = uuid.uuid4()
admin_sql("insert into auth.users (id, created_at) values (%s, now())", (mod,))
admin_sql("insert into auth.users (id, created_at) values (%s, now())", (bob,))
admin_sql("insert into public.admins (user_id, role) values (%s, 'admin')", (mod,))


def make_order(state='approved', office='Dispatch Test Ward Office', lat=23.3321, lng=86.3655):
    rid = admin_sql(
        "insert into public.reports (lat, lng, status, moderation_status, photo_url) values (%s, %s, 'open', 'approved', 'x') returning id", (lat, lng)
    ).fetchone()[0]
    return admin_sql(
        'insert into kasa_private.partner_orders (report_id, office_key, state, approved_by) '
        'values (%s, %s, %s, %s) returning id', (rid, office, state, mod)
    ).fetchone()[0]


A = make_order()
B = make_order()
C = make_order(office='Other office')
D = make_order(state='in_progress')
E = make_order()
F = make_order()
G = make_order()
H = make_order()
I_ = make_order()
J = make_order()
K = make_order()
L = make_order()
M = make_order()

# Triage
check('a citizen cannot triage',
      err('kasa_admin_dispatch_triage', bob, p_order=A, p_status='triaged', p_machine='mini_tipper', p_band='small') == 'KASA_NOT_ADMIN')
check('triage needs a machine and a band',
      err('kasa_admin_dispatch_triage', mod, p_order=A, p_status='triaged', p_machine=None, p_band='small') == 'KASA_BAD_FORM')
check('triage refuses an unknown machine',
      err('kasa_admin_dispatch_triage', mod, p_order=A, p_status='triaged', p_machine='bulldozer', p_band='small') is not None)
check('an in-progress order cannot be triaged',
      err('kasa_admin_dispatch_triage', mod, p_order=D, p_status='triaged', p_machine='mini_tipper', p_band='small') == 'KASA_BAD_STATE')
for o in (A, B, C, E, F, G, H, I_, J, K, L):
    rpc('kasa_admin_dispatch_triage', mod, p_order=o, p_status='triaged', p_machine='mini_tipper', p_band='small')
check('a triaged order is recorded',
      admin_sql('select machine, band, status from kasa_private.dispatch_triage where order_id = %s', (A,)).fetchone()
      == ('mini_tipper', 'small', 'triaged'))
r = rpc('kasa_admin_dispatch_triage', mod, p_order=A, p_status='triaged', p_machine='tractor', p_band='large')
check('re-triaging replaces the earlier pick',
      admin_sql('select machine, band from kasa_private.dispatch_triage where order_id = %s', (A,)).fetchone()
      == ('tractor', 'large') and r['ok'] is True, r)
rpc('kasa_admin_dispatch_triage', mod, p_order=A, p_status='triaged', p_machine='mini_tipper', p_band='small')

# Out of jurisdiction
check('out of jurisdiction needs a note or a source',
      err('kasa_admin_dispatch_triage', mod, p_order=M, p_status='out_of_jurisdiction') == 'KASA_BAD_FORM')
check('a source must be https',
      err('kasa_admin_dispatch_triage', mod, p_order=M, p_status='out_of_jurisdiction',
          p_source_url='http://example.org/x') is not None)
rpc('kasa_admin_dispatch_triage', mod, p_order=M, p_status='out_of_jurisdiction',
    p_note='Railway margin, pillar number on the photo', p_source_url='https://example.org/railway-notice')
check('out of jurisdiction is stored with no machine',
      admin_sql('select status, machine from kasa_private.dispatch_triage where order_id = %s', (M,)).fetchone()
      == ('out_of_jurisdiction', None))

# Batches
check('a citizen cannot set a batch',
      err('kasa_admin_dispatch_batch_set', bob, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[A]) == 'KASA_NOT_ADMIN')
check('an untriaged order cannot join a batch',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[A, D]) is not None)
check('an order from another office cannot join this batch',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[A, C]) == 'KASA_BAD_STATE')
check('an out-of-jurisdiction order cannot join a batch',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[M]) == 'KASA_BAD_STATE')
check('a batch holds at most 10 stops',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[A, B, E, F, G, H, I_, J, K, L, M]) is not None)
check('an order cannot appear twice',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[A, A]) == 'KASA_BAD_FORM')
check('a batch slot must be am or pm',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='noon', p_order_ids=[A]) == 'KASA_BAD_FORM')

res = rpc('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[B, A])
check('the morning batch is saved with the supervisor order', res['ok'] is True and res['stops'] == 2, res)
board = rpc('kasa_admin_dispatch_board', mod, p_date='2026-10-22')
stops = [s for b in board['batches'] if b['slot'] == 'am' for s in b['stops']]
check('the board returns stops in the order chosen', [s['order_id'] for s in stops] == [B, A]
      and [s['seq'] for s in stops] == [1, 2], board)

check('an order cannot sit in a second open batch',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='pm', p_order_ids=[A]) == 'KASA_BAD_STATE')

rpc('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
    p_slot='am', p_order_ids=[B, A, E])
check('editing an open batch replaces its stops',
      admin_sql("select count(*) from kasa_private.dispatch_batch_stops s join kasa_private.dispatch_batches b "
                "on b.id = s.batch_id where b.office_key = 'Dispatch Test Ward Office' and b.slot = 'am' "
                "and b.batch_date = '2026-10-22'").fetchone()[0] == 3)

rpc('kasa_admin_dispatch_batch_close', mod, p_batch=admin_sql(
    "select id from kasa_private.dispatch_batches where office_key = 'Dispatch Test Ward Office' "
    "and slot = 'am' and batch_date = '2026-10-22'").fetchone()[0])
check('a closed batch refuses edits',
      err('kasa_admin_dispatch_batch_set', mod, p_office='Dispatch Test Ward Office', p_date='2026-10-22',
          p_slot='am', p_order_ids=[A]) == 'KASA_BAD_STATE')
check('closing an already closed batch is refused',
      err('kasa_admin_dispatch_batch_close', mod, p_batch=admin_sql(
          "select id from kasa_private.dispatch_batches where slot = 'am' and batch_date = '2026-10-22'"
          " limit 1").fetchone()[0]) == 'KASA_BAD_STATE')

waiting = {w['order_id'] for w in rpc('kasa_admin_dispatch_board', mod, p_date='2026-10-22')['waiting']}
check('orders in a closed batch are not waiting', A not in waiting and B not in waiting)
check('an approved order not yet in a batch is waiting', E in waiting or F in waiting, sorted(waiting))

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
