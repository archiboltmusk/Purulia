"""Tourism privacy, idempotency, expiry and moderator checks. Synthetic data rolls back."""
import datetime as dt
import json
import sys
import uuid
import psycopg

conn = psycopg.connect(sys.argv[1], autocommit=True)
count = 0
def check(value, message):
    global count
    assert value, message
    count += 1

def act(uid=None):
    conn.execute('reset role')
    conn.execute("select set_config('request.jwt.claim.sub',%s,true),set_config('request.headers',%s,true)", (str(uid) if uid else '', json.dumps({'x-forwarded-for': '198.51.100.45'})))
    conn.execute('set local role ' + ('authenticated' if uid else 'anon'))

def denied(sql, args=()):
    try:
        with conn.transaction():
            conn.execute(sql, args)
    except psycopg.Error:
        return True
    return False

with conn.transaction():
    mod, owner, other = [uuid.uuid4() for _ in range(3)]
    for uid in [mod, owner, other]:
        conn.execute('insert into auth.users(id,created_at) values(%s,now())', (uid,))
    conn.execute("insert into public.admins(user_id,role) values(%s,'admin')", (mod,))
    act()
    check(denied('select * from kasa_private.tourism_providers'), 'Anonymous table read permitted')
    check(denied('select * from kasa_private.tourism_enquiries'), 'Anonymous private enquiry read permitted')
    check(denied('select public.kasa_admin_tourism_board()'), 'Anonymous admin read permitted')
    act(owner)
    check(denied('select public.kasa_admin_tourism_board()'), 'Non-moderator admin read permitted')
    act(mod)
    provider = conn.execute("select public.kasa_admin_tourism_save(null,'TEST provider','guide','https://example.org/contact','https://example.org/evidence','Documented provider consent for test only',now()-interval '1 hour',now()+interval '1 day',true)").fetchone()[0]['id']
    act()
    check(any(str(x[0]['id']) == provider for x in conn.execute('select * from public.kasa_tourism_providers()')), 'Published record missing')
    check(denied('select public.kasa_tourism_enquire(%s,%s,current_date,2,%s)', (uuid.uuid4(), provider, 'Synthetic test enquiry')), 'Anonymous enquiry permitted')
    act(owner)
    rid = uuid.uuid4()
    query = 'select public.kasa_tourism_enquire(%s,%s,current_date,2,%s)'
    result = conn.execute(query, (rid, provider, 'Synthetic test enquiry')).fetchone()[0]
    check(str(result['id']) == str(rid), 'Wrong enquiry identity')
    check(conn.execute(query, (rid, provider, 'Synthetic test enquiry')).fetchone()[0] == result, 'Retry not idempotent')
    check(denied(query, (rid, provider, 'Changed test enquiry')), 'Changed payload reused identity')
    check(len(conn.execute('select * from public.kasa_tourism_my_enquiries()').fetchall()) == 1, 'Owner cannot read enquiry')
    act(other)
    check(not conn.execute('select * from public.kasa_tourism_my_enquiries()').fetchall(), 'Enquiry leaked to another user')
    check(denied('select public.kasa_tourism_cancel_enquiry(%s)', (rid,)), 'Another user cancelled enquiry')
    act(mod)
    conn.execute("select public.kasa_admin_tourism_reply(%s,'answered','Synthetic response only')", (rid,))
    act(owner)
    check(conn.execute('select * from public.kasa_tourism_my_enquiries()').fetchone()[0]['reply'] == 'Synthetic response only', 'Reply unavailable')
    conn.execute('select public.kasa_tourism_cancel_enquiry(%s)', (rid,))
    check(conn.execute('select * from public.kasa_tourism_my_enquiries()').fetchone()[0]['status'] == 'cancelled', 'Cancellation failed')
    conn.execute('reset role')
    conn.execute("update kasa_private.tourism_providers set verified_at=now()-interval '2 days',verified_until=now()-interval '1 day' where id=%s", (provider,))
    act()
    check(not any(str(x[0]['id']) == provider for x in conn.execute('select * from public.kasa_tourism_providers()')), 'Expired record published')
    act(owner)
    check(denied(query, (uuid.uuid4(), provider, 'Synthetic expired provider enquiry')), 'Expired provider accepted enquiry')
    conn.execute('reset role')
    # No synthetic location, provider, user or enquiry survives the test.
    raise psycopg.Rollback()
print(f'{count} tourism database assertions passed')
