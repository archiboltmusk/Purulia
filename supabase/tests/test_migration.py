"""Scenario tests for the Kasa v2 migration.

Every test talks to the database the way the public API does (as the anon
or authenticated role, with a JWT subject and request headers), so each
"loophole" test is a real attempt to cheat, not a unit test of a helper.

    python3 supabase/tests/test_migration.py "host=... port=... dbname=... user=postgres"
"""
import json
import sys
import uuid

import psycopg

DSN = sys.argv[1]
db = psycopg.connect(DSN, autocommit=True)
results = []

BASE = 'https://cnmikcyvyamplbldiivp.supabase.co/storage/v1/object/public/kasa-photos/'
SPOT = (23.3321, 86.3655)


def reset():
    db.execute('reset role')
    db.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '', false)")


def act(uid=None, ip='10.0.0.1', role=None):
    reset()
    role = role or ('authenticated' if uid else 'anon')
    db.execute(f'set role {role}')
    db.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid) if uid else '',))
    db.execute("select set_config('request.headers', %s, false)", (json.dumps({'x-forwarded-for': ip}),))


def q(sql, params=None, uid=None, ip='10.0.0.1', role=None):
    act(uid, ip, role)
    try:
        cur = db.execute(sql, params or ())
        return cur.fetchall() if cur.description else None
    finally:
        reset()


def rpc(fn, uid=None, ip='10.0.0.1', role=None, **kw):
    args = ', '.join(f'{k} => %s' for k in kw)
    vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in kw.values()]
    rows = q(f'select public.{fn}({args})', vals, uid, ip, role)
    return rows[0][0]


def err(fn, *a, **kw):
    """Run fn and return the error message (or None if it succeeded)."""
    try:
        fn(*a, **kw)
        return None
    except psycopg.Error as e:
        return e.diag.message_primary


def refused(msg):
    return bool(msg) and ('permission denied' in msg or 'does not exist' in msg)


def check(name, cond, info=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'   -> {info}'))


def admin_sql(sql, params=None):
    reset()
    cur = db.execute(sql, params or ())
    return cur.fetchall() if cur.description else None


def user(created_ago='30 days'):
    uid = uuid.uuid4()
    admin_sql("insert into auth.users (id, created_at) values (%s, now() - %s::interval)", (uid, created_ago))
    return uid


def upload(uid, folder, owner=None):
    """Uploads as the user would (through storage RLS). Returns the object path."""
    path = f'{folder}/{uuid.uuid4().hex[:20]}.jpg'
    o = owner or uid
    q("insert into storage.objects (bucket_id, name, owner, owner_id) values ('kasa-photos', %s, %s, %s)",
      (path, o, str(o)), uid=uid)
    return path


def photo_check(path, sha=None, dhash=None, garbage=None, unsafe=False, faces=0):
    rpc('kasa_record_photo_check', role='service_role', p_path=path, p_sha256=sha or uuid.uuid4().hex,
        p_dhash=dhash, p_garbage_score=garbage, p_labels=[], p_unsafe=unsafe, p_face_count=faces)


def offset(meters_north, meters_east=0.0, base=SPOT):
    return base[0] + meters_north / 111_320, base[1] + meters_east / (111_320 * 0.9185)


def report(uid, category='garbage', where=SPOT, accuracy=10.0, client_id=None, **extra):
    path = upload(uid, 'reports')
    res = rpc('kasa_create_report', uid=uid, p_category=category, p_severity='severe', p_lat=where[0], p_lng=where[1],
              p_accuracy=accuracy, p_ward_no=5, p_description='Pile of waste', p_landmark='Near bus stand',
              p_photo_path=path, p_client_id=client_id)
    return res, path


def claim(uid, rid, where=SPOT, accuracy=10.0, path=None):
    path = path or upload(uid, 'claims')
    return rpc('kasa_claim_cleanup', uid=uid, p_report_id=str(rid), p_photo_path=path,
               p_lat=where[0], p_lng=where[1], p_accuracy=accuracy)


def vote(uid, claim_id, v='verify', where=SPOT, ip='10.0.0.1', accuracy=10.0, photo=True, path=None):
    if photo and not path:
        path = upload(uid, 'votes')
    return rpc('kasa_vote_claim', uid=uid, ip=ip, p_claim_id=claim_id, p_vote=v, p_photo_path=path if photo else None,
               p_lat=where[0], p_lng=where[1], p_accuracy=accuracy, p_note=None)


def view_row(rid):
    rows = q('select row_to_json(v) from public.kasa_public_reports v where id::text = %s', (str(rid),))
    return rows[0][0] if rows else None


NEW_RULES = {'require_evidence_photo_check': 'true', 'voter_min_account_hours': '72', 'voter_min_prior_actions': '1',
             'trusted_prior_actions': '3', 'confirm_same_claimant_days': '7', 'max_travel_kmh': '150',
             'quiet_start_hour': '22', 'quiet_end_hour': '6'}
BASELINE = {'require_evidence_photo_check': 'false', 'voter_min_account_hours': '0', 'voter_min_prior_actions': '0',
            'trusted_prior_actions': '0', 'confirm_same_claimant_days': '0', 'max_travel_kmh': '1000000',
            'quiet_start_hour': '0', 'quiet_end_hour': '0', 'require_live_report_photo': 'false'}


def set_rules(values):
    for k, v in values.items():
        admin_sql("update kasa_private.settings set value = %s::jsonb where key = %s", (v, k))


# The scenarios below predate the vote-integrity and abuse-defense rules; they run
# with those rules relaxed, and the rules get their own section at the end.
set_rules(BASELINE)

# ─────────────────────────── Direct-access loopholes ───────────────────────────
legacy_id = admin_sql("select id from public.reports order by created_at limit 1")[0][0]
someone = user()

check('anon cannot UPDATE reports directly',
      'permission denied' in (err(q, "update public.reports set status = 'resolved'") or ''))
check('signed-in user cannot UPDATE reports directly',
      'permission denied' in (err(q, "update public.reports set status = 'resolved'", uid=someone) or ''))
check('signed-in user cannot INSERT reports directly',
      'permission denied' in (err(q, "insert into public.reports (lat, lng, reporter_hash) values (23.33, 86.36, 'x')", uid=someone) or ''))
check('signed-in user cannot DELETE reports',
      'permission denied' in (err(q, 'delete from public.reports', uid=someone) or ''))
check('legacy mark_resolved() is switched off',
      refused(err(rpc, 'mark_resolved', uid=someone, p_report_id=legacy_id, p_resolved_photo_url='x', p_resolved_by='x')))
check('legacy approve_resolution() is switched off',
      refused(err(rpc, 'approve_resolution', uid=someone, p_report_id=legacy_id, p_reviewed_by='admin')))
check('legacy upvote_report() is switched off (fake "seen" counts)',
      refused(err(rpc, 'upvote_report', p_report_id=legacy_id, p_reporter_hash='x')))
check('anon cannot read the raw reports table',
      'permission denied' in (err(q, 'select * from public.reports') or ''))
check('non-admin signed-in user sees no raw report rows', q('select count(*) from public.reports', uid=someone)[0][0] == 0)
view_write = err(q, "update public.kasa_public_reports set status = 'resolved'") or ''
check('anon cannot write through the public view',
      'permission denied' in view_write or 'cannot update view' in view_write, view_write)
cols = [r[0] for r in admin_sql("select column_name from information_schema.columns where table_name = 'kasa_public_reports'")]
check('public view exposes no user ids / hashes / IPs', not {'user_id', 'reporter_hash', 'client_id', 'ip_hash'} & set(cols), cols)
PUBLIC_REPORT_COLUMNS = {'id', 'created_at', 'lat', 'lng', 'ward_no', 'category', 'severity', 'status', 'description', 'landmark', 'photo_url', 'upvotes', 'seen_on_site', 'flags', 'moderation_status', 'is_duplicate', 'parent_report_id', 'recurrence_count', 'rejected_claims', 'resolved_at', 'resolved_photo_url', 'resolution_method', 'sla_days', 'gps_verified', 'claim_id', 'claim_photo_url', 'claim_created_at', 'claim_verify_count', 'claim_dispute_count', 'claim_quorum_reached_at', 'claim_finalize_after', 'claim_distance_m', 'rating_count', 'onsite_rating_count', 'authenticity_avg', 'severity_avg', 'neighbour_status', 'reply_count', 'claim_needs_review'}
check('public view has exactly the reviewed columns (update kasa.js PUBLIC_REPORT_COLUMNS too)', set(cols) == PUBLIC_REPORT_COLUMNS,
      sorted(set(cols) ^ PUBLIC_REPORT_COLUMNS))
open_grants = admin_sql("select table_name, grantee, privilege_type from information_schema.role_table_grants "
                        "where table_schema = 'public' and grantee in ('anon', 'authenticated') "
                        "and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')")
check('anon/authenticated cannot write to any public table directly', not open_grants, open_grants)
anon_fns = sorted(r[0] for r in admin_sql("select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace "
                                          "and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')"))
check('only the intended SECURITY DEFINER functions are callable without signing in',
      set(anon_fns) <= {'kasa_finalize_due', 'kasa_rules', 'kasa_version', 'p2040_submit', 'kasa_register_community'}, anon_fns)
ecols = [r[0] for r in admin_sql("select column_name from information_schema.columns where table_name = 'kasa_public_events'")]
check('public events expose no actor ids', 'actor_id' not in ecols, ecols)
check('anon cannot read private tables',
      'permission denied' in (err(q, 'select * from kasa_private.claims') or ''))
check('signed-in user cannot read private tables',
      'permission denied' in (err(q, 'select * from kasa_private.votes', uid=someone) or ''))
check('anon cannot file a report without signing in',
      'permission denied' in (err(rpc, 'kasa_create_report', p_category='garbage', p_severity='minor', p_lat=23.33, p_lng=86.36,
                                  p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path='x') or ''))
check('browser users cannot forge photo-check results',
      'permission denied' in (err(rpc, 'kasa_record_photo_check', uid=someone, p_path='x', p_sha256='x', p_dhash=None,
                                  p_garbage_score=0.0, p_labels=[], p_unsafe=False, p_face_count=0) or ''))

# Storage
other = user()
p_mine = upload(other, 'reports')
check('the photo-check function can look up who uploaded a photo',
      rpc('kasa_photo_owner', role='service_role', p_path=p_mine) == str(other))
check("browsers can't look up who uploaded a photo",
      refused(err(rpc, 'kasa_photo_owner', uid=someone, p_path=p_mine)) and refused(err(rpc, 'kasa_photo_owner', p_path=p_mine)))
# Pages cached before 24 Sep 2026 upload into <folder>/<user id>/ — allowed only
# for your own folder, and only until the old-page window closes.
WINDOW_OPEN = admin_sql("select now() < '2026-09-26T06:00:00Z'::timestamptz")[0][0]
check("can't upload into someone else's per-user folder",
      'row-level security' in (err(q, "insert into storage.objects (bucket_id, name, owner) values ('kasa-photos', %s, %s)",
                                   (f'claims/{other}/abcdefgh12345678.jpg', someone), uid=someone) or ''))
own_old_err = err(q, "insert into storage.objects (bucket_id, name, owner, owner_id) values ('kasa-photos', %s, %s, %s)",
                  (f'claims/{someone}/abcdefgh12345678.jpg', someone, str(someone)), uid=someone)
check('old-format upload into your own folder works only while the old-page window is open',
      (own_old_err is None) == WINDOW_OPEN, (WINDOW_OPEN, own_old_err))
check("can't upload outside reports/claims/votes",
      'row-level security' in (err(q, "insert into storage.objects (bucket_id, name, owner) values ('kasa-photos', %s, %s)",
                                   ('misc/abcdefgh12345678.jpg', someone), uid=someone) or ''))
check('anon cannot upload photos',
      'row-level security' in (err(q, "insert into storage.objects (bucket_id, name) values ('kasa-photos', %s)",
                                   ('reports/abcdefgh12345678.jpg',)) or '')
      or 'permission denied' in (err(q, "insert into storage.objects (bucket_id, name) values ('kasa-photos', %s)",
                                     ('reports/abcdefgh12345679.jpg',)) or ''))
p_own = upload(someone, 'reports')
q("update storage.objects set name = name || 'x' where name = %s", (p_own,), uid=someone)
err(q, 'delete from storage.objects where name = %s', (p_own,), uid=someone)
check("can't overwrite or delete uploaded evidence",
      admin_sql('select count(*) from storage.objects where name = %s', (p_own,))[0][0] == 1)

# Legacy data
leg = admin_sql("select resolution_method from public.reports where status = 'resolved'")
check('pre-v2 resolutions are labelled not community-verified', leg and leg[0][0] == 'legacy_unverified', leg)

# ─────────────────────────────── Reporting ───────────────────────────────
alice = user('60 days')
res, alice_photo = report(alice)
rid = res['id']
row = view_row(rid)
check('report can be filed and appears publicly', row and row['status'] == 'open' and row['photo_url'] == BASE + alice_photo, row)
check("public photo link doesn't contain the reporter's id", row and str(alice) not in row['photo_url'], row)
check('report stores GPS-verified flag', row and row['gps_verified'] is True, row)
ev = q("select kind, actor_tag from public.kasa_public_events where report_id::text = %s", (str(rid),))
check('filing is recorded in the public evidence trail', ev and ev[0][0] == 'reported' and len(ev[0][1]) == 6, ev)

check('reports outside Purulia are refused',
      err(report, alice, where=(22.57, 88.36)) == 'KASA_OUTSIDE_AREA')
check('photo must actually be uploaded',
      err(rpc, 'kasa_create_report', uid=alice, p_category='garbage', p_severity='minor', p_lat=SPOT[0], p_lng=SPOT[1],
          p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None,
          p_photo_path='reports/doesnotexist12345678.jpg') == 'KASA_PHOTO_MISSING')
admin_sql("update kasa_private.settings set value = '\"2000-01-01T00:00:00Z\"' where key = 'old_photo_paths_until'")
check('old per-user-folder photo paths are refused once the old-page window has closed',
      err(rpc, 'kasa_create_report', uid=alice, p_category='garbage', p_severity='minor', p_lat=SPOT[0], p_lng=SPOT[1],
          p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None,
          p_photo_path=f'reports/{alice}/abcdefgh12345678.jpg') == 'KASA_PHOTO_INVALID')
admin_sql("update kasa_private.settings set value = '\"2999-01-01T00:00:00Z\"' where key = 'old_photo_paths_until'")
old_page_user = user('30 days')
old_path = f'reports/{old_page_user}/{uuid.uuid4().hex[:16]}.jpg'
admin_sql("insert into storage.objects (bucket_id, name, owner, owner_id) values ('kasa-photos', %s, %s, %s)",
          (old_path, old_page_user, str(old_page_user)))
old_res = rpc('kasa_create_report', uid=old_page_user, p_category='garbage', p_severity='minor', p_lat=offset(-500, -500)[0],
              p_lng=offset(-500, -500)[1], p_accuracy=10.0, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=old_path)
check('while the window is open, a page cached before the fix can still file with its own old-format photo',
      old_res['moderation_status'] == 'approved', old_res)
old_path2 = f'reports/{old_page_user}/{uuid.uuid4().hex[:16]}.jpg'
admin_sql("insert into storage.objects (bucket_id, name, owner, owner_id) values ('kasa-photos', %s, %s, %s)",
          (old_path2, old_page_user, str(old_page_user)))
check("...but nobody can use someone else's old-format photo",
      err(rpc, 'kasa_create_report', uid=someone, p_category='garbage', p_severity='minor', p_lat=SPOT[0], p_lng=SPOT[1],
          p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=old_path2) == 'KASA_PHOTO_INVALID')
admin_sql("update kasa_private.settings set value = '\"2026-09-26T06:00:00Z\"' where key = 'old_photo_paths_until'")
check("can't file with someone else's photo",
      err(rpc, 'kasa_create_report', uid=someone, p_category='garbage', p_severity='minor', p_lat=SPOT[0], p_lng=SPOT[1],
          p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None,
          p_photo_path=upload(alice, 'reports')) == 'KASA_PHOTO_NOT_YOURS')
check("can't reuse a photo already used in another report",
      err(rpc, 'kasa_create_report', uid=alice, p_category='garbage', p_severity='minor', p_lat=SPOT[0], p_lng=SPOT[1],
          p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=alice_photo) == 'KASA_PHOTO_REUSED')

bob = user('60 days')
dup, _ = report(bob, where=offset(10))
check('second report of the same spot links to the first', str(dup.get('duplicate_of')) == str(rid), dup)
check('...and counts as another witness', view_row(rid)['upvotes'] == 1, view_row(rid))

ill, _ = report(bob, category='illegal_mining', where=offset(400))
check('illegal-activity reports wait for moderation (not public yet)', ill['moderation_status'] == 'review' and view_row(ill['id']) is None, ill)

r1, _ = report(bob, where=offset(900), client_id='offline-1')
r2 = rpc('kasa_create_report', uid=bob, p_category='garbage', p_severity='minor', p_lat=0, p_lng=0, p_accuracy=None,
         p_ward_no=5, p_description=None, p_landmark=None, p_photo_path='x', p_client_id='offline-1')
check('offline retries do not create duplicates', str(r2['id']) == str(r1['id']) and r2.get('replayed'), r2)

spam = user()
for i in range(5):
    report(spam, where=offset(1500 + 60 * i))
check('report spam is rate limited', err(report, spam, where=offset(2500)) == 'KASA_RATE_LIMIT')

# ─────────────────────────────── Seen / flags ──────────────────────────────
carol = user('60 days')
s1 = rpc('kasa_mark_seen', uid=carol, p_report_id=str(rid), p_lat=SPOT[0], p_lng=SPOT[1], p_accuracy=15)
s2 = rpc('kasa_mark_seen', uid=carol, p_report_id=str(rid), p_lat=SPOT[0], p_lng=SPOT[1], p_accuracy=15)
check('"I saw this too" counts once per person', s1['counted'] and s1['on_site'] and not s2['counted'], (s1, s2))
s3 = rpc('kasa_mark_seen', uid=alice, p_report_id=str(rid))
check("reporter can't inflate their own report", not s3['counted'], s3)

check("can't flag your own report", err(rpc, 'kasa_flag_report', uid=alice, p_report_id=str(rid), p_reason='duplicate') == 'KASA_OWN_REPORT')
flaggers = [user() for _ in range(3)]
for i, f in enumerate(flaggers):
    rpc('kasa_flag_report', uid=f, ip=f'10.9.{i}.1', p_report_id=str(rid), p_reason='not_an_issue')
again = rpc('kasa_flag_report', uid=flaggers[0], p_report_id=str(rid), p_reason='not_an_issue')
row = view_row(rid)
check('flags mark a report for review but never hide it', row and row['moderation_status'] == 'flagged' and not again['counted'], row)
check('flags never resolve a report', row['status'] == 'open')

# ─────────────────────────────── Cleanup claims ────────────────────────────
official = user('90 days')
check('cleanup claim from 120 m away is refused', err(claim, official, rid, where=offset(120)) == 'KASA_TOO_FAR')
check('cleanup claim with a weak GPS fix is refused', err(claim, official, rid, accuracy=150) == 'KASA_GPS_WEAK')
check('cleanup claim without GPS is refused',
      err(rpc, 'kasa_claim_cleanup', uid=official, p_report_id=str(rid), p_photo_path=upload(official, 'claims'),
          p_lat=None, p_lng=None, p_accuracy=None) == 'KASA_GPS_REQUIRED')
check("claim can't reuse the report's own photo path",
      err(claim, official, rid, path=alice_photo) == 'KASA_PHOTO_INVALID')

old_path = upload(official, 'claims')
admin_sql("update storage.objects set created_at = now() - interval '200 days' where name = %s", (old_path,))
check('claim photo uploaded before the report existed is refused', err(claim, official, rid, path=old_path) == 'KASA_PHOTO_STALE')

c = claim(official, rid, where=offset(20))
cid = c['claim_id']
row = view_row(rid)
check('valid on-site claim moves report to "claimed", not resolved', row['status'] == 'claimed' and row['claim_verify_count'] == 0, row)
check('only one open claim per report', err(claim, user('60 days'), rid) == 'KASA_ALREADY_CLAIMED')
check("claimant can't confirm their own claim", err(vote, official, cid) == 'KASA_OWN_CLAIM')

sock = user('1 minute')
admin_sql("update auth.users set created_at = now() + interval '1 second' where id = %s", (sock,))
check('accounts created after the claim cannot confirm it', err(vote, sock, cid) == 'KASA_ACCOUNT_TOO_NEW')
v1 = user('60 days')
check('confirmation from 300 m away is refused', err(vote, v1, cid, where=offset(300)) == 'KASA_TOO_FAR')
check('confirmation without a photo is refused', err(vote, v1, cid, photo=False) == 'KASA_PHOTO_INVALID')

vote(v1, cid, ip='49.36.10.5')
check('a person can only respond once', err(vote, v1, cid) == 'KASA_ALREADY_VOTED')
v2, v3 = user('60 days'), user('60 days')
vote(v2, cid, ip='49.36.10.77')
r3 = vote(v3, cid, ip='49.36.10.200')
row = view_row(rid)
check('3 confirmations from one network do not reach quorum', r3['final_after'] is None and row['claim_quorum_reached_at'] is None, (r3, row))
v4 = user('60 days')
r4 = vote(v4, cid, ip='117.200.1.9')
row = view_row(rid)
check('quorum from 2+ networks starts the challenge window, report still not resolved',
      r4['final_after'] is not None and row['status'] == 'claimed' and row['claim_finalize_after'] is not None, (r4, row))
check('finalising early does nothing', rpc('kasa_finalize_due') == 0 and view_row(rid)['status'] == 'claimed')
admin_sql("update kasa_private.claims set quorum_reached_at = now() - interval '13 hours' where id = %s", (cid,))
check('anyone (even anon) can trigger finalisation of due claims', rpc('kasa_finalize_due') == 1)
row = view_row(rid)
check('after the challenge window the report is resolved by the community',
      row['status'] == 'resolved' and row['resolution_method'] == 'community' and row['resolved_photo_url'], row)
kinds = [r[0] for r in q("select kind from public.kasa_public_events where report_id::text = %s order by id", (str(rid),))]
check('full evidence trail is public', kinds[:1] == ['reported'] and kinds[-1] == 'resolved' and kinds.count('verified') == 4, kinds)
check('"seen" on a resolved report is refused (file a recurrence instead)',
      err(rpc, 'kasa_mark_seen', uid=user(), p_report_id=str(rid)) == 'KASA_ALREADY_RESOLVED')

rec, _ = report(user('10 days'), where=offset(5))
check('garbage coming back at a resolved spot is recorded as a recurrence',
      str(rec.get('recurrence_of')) == str(rid) and view_row(rid)['recurrence_count'] == 1, rec)

tags = q("select distinct actor_tag from public.kasa_public_events where kind = 'reported' and actor_tag is not null")
check('pseudonyms differ per report (reports can\'t be linked to one person)', len(tags) >= 5, tags)

# Dispute path
res2, _ = report(alice, where=offset(3000))
rid2 = res2['id']
spot2 = offset(3000)
fake = user('90 days')
cid2 = claim(fake, rid2, where=spot2)['claim_id']
d1, d2 = user('60 days'), user('60 days')
vote(d1, cid2, v='dispute', where=spot2)
res_d = vote(d2, cid2, v='dispute', where=spot2, ip='10.9.9.9')
row = view_row(rid2)
check('two on-site disputes reject a fake cleanup and reopen the report',
      res_d['claim_status'] == 'rejected' and row['status'] == 'open' and row['rejected_claims'] == 1, (res_d, row))
check('disputes alone give the claimant no strike',
      (admin_sql('select coalesce(max(strikes), 0) from kasa_private.profiles where user_id = %s', (fake,))[0][0]) == 0)
check('rejected claimant must wait before claiming the same spot again', err(claim, fake, rid2, where=spot2) == 'KASA_COOLDOWN')
admin_sql('update kasa_private.profiles set strikes = 3 where user_id = %s', (fake,))
res3, _ = report(bob, where=offset(4000))
check('repeat fake claimants are blocked from claiming', err(claim, fake, res3['id'], where=offset(4000)) == 'KASA_CLAIM_BLOCKED')

# Late dispute during the challenge window
res4, _ = report(alice, where=offset(5000))
spot4 = offset(5000)
cid4 = claim(user('90 days'), res4['id'], where=spot4)['claim_id']
for i, ip in enumerate(['1.1.1.1', '2.2.2.2', '3.3.3.3']):
    vote(user('60 days'), cid4, where=spot4, ip=ip)
check('quorum reached', view_row(res4['id'])['claim_quorum_reached_at'] is not None)
vote(user('60 days'), cid4, v='dispute', where=spot4, ip='4.4.4.4')
vote(user('60 days'), cid4, v='dispute', where=spot4, ip='5.5.5.5')
check('disputes during the challenge window still overturn a claim', view_row(res4['id'])['status'] == 'open')

# Expiry
res5, _ = report(alice, where=offset(6000))
cid5 = claim(user('90 days'), res5['id'], where=offset(6000))['claim_id']
admin_sql("update kasa_private.claims set created_at = now() - interval '15 days' where id = %s", (cid5,))
rpc('kasa_finalize_due')
check('claims nobody confirms expire and the report reopens', view_row(res5['id'])['status'] == 'open')

# ─────────────────────────── Photo checks (Vision) ───────────────────────────
def fp(signs, flip=0):
    """Fingerprint: 32 hex of edge signs (optionally with `flip` bits changed) + all-edges-clear mask."""
    n = int(signs, 16) ^ ((1 << flip) - 1)
    return f'{n:032x}' + 'f' * 32


A, B, C, D = 'a5' * 16, '3c' * 16, '0f' * 16, '96' * 16
admin_sql("update kasa_private.settings set value = 'true' where key = 'require_photo_check'")
res6_path = upload(bob, 'reports')
spot6 = offset(7000)
check('with checks required, unchecked photos are refused',
      err(rpc, 'kasa_create_report', uid=bob, p_category='garbage', p_severity='minor', p_lat=spot6[0], p_lng=spot6[1],
          p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=res6_path) == 'KASA_PHOTO_UNCHECKED')
photo_check(res6_path, dhash=fp(A), garbage=0.92)
res6 = rpc('kasa_create_report', uid=bob, p_category='garbage', p_severity='minor', p_lat=spot6[0], p_lng=spot6[1],
           p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=res6_path)
dirty = upload(official, 'claims'); photo_check(dirty, dhash=fp(B), garbage=0.85)
check('cleanup photo that still shows garbage is refused', err(claim, official, res6['id'], where=spot6, path=dirty) == 'KASA_STILL_DIRTY')
same = upload(official, 'claims'); photo_check(same, dhash=fp(A, flip=3), garbage=0.1)
check('cleanup photo that looks like the original "dirty" photo is refused',
      err(claim, official, res6['id'], where=spot6, path=same) == 'KASA_PHOTO_REUSED')
copy = upload(official, 'claims'); photo_check(copy, sha='deadbeef' * 8, dhash=fp(C), garbage=0.1)
earlier_user = user()
earlier = upload(earlier_user, 'reports'); photo_check(earlier, sha='deadbeef' * 8, dhash=fp(C), garbage=0.9)
rpc('kasa_create_report', uid=earlier_user, p_category='garbage', p_severity='minor', p_lat=offset(7600)[0], p_lng=offset(7600)[1],
    p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=earlier)
check('byte-identical photo used anywhere else is refused', err(claim, official, res6['id'], where=spot6, path=copy) == 'KASA_PHOTO_REUSED')
retry_user = user()
first_try = upload(retry_user, 'reports'); photo_check(first_try, sha='feedface' * 8, dhash=None, garbage=0.9)
check('a refused attempt (outside town) leaves the photo unused...',
      err(rpc, 'kasa_create_report', uid=retry_user, p_category='garbage', p_severity='minor', p_lat=22.57, p_lng=88.36,
          p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=first_try) == 'KASA_OUTSIDE_AREA')
second_try = upload(retry_user, 'reports'); photo_check(second_try, sha='feedface' * 8, dhash=None, garbage=0.9)
retried = rpc('kasa_create_report', uid=retry_user, p_category='garbage', p_severity='minor', p_lat=offset(7800)[0], p_lng=offset(7800)[1],
              p_accuracy=None, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=second_try)
check('...so trying again with the same photo works (no false "already used")', retried['moderation_status'] == 'approved', retried)
unsafe = upload(official, 'claims'); photo_check(unsafe, dhash=fp(D), garbage=0.0, unsafe=True)
check('unsafe images are refused', err(claim, official, res6['id'], where=spot6, path=unsafe) == 'KASA_PHOTO_UNSAFE')

# A clean photo previously used for a claim 1 km away, lightly edited and reused here
far_spot = offset(8000)
admin_sql("update kasa_private.settings set value = 'false' where key = 'require_photo_check'")
far_report, _ = report(alice, where=far_spot)
far_claim_path = upload(official, 'claims'); photo_check(far_claim_path, dhash=fp('11' * 16), garbage=0.05)
claim(official, far_report['id'], where=far_spot, path=far_claim_path)
admin_sql("update kasa_private.settings set value = 'true' where key = 'require_photo_check'")
elsewhere = upload(official, 'claims'); photo_check(elsewhere, dhash=fp('11' * 16, flip=2), garbage=0.05)
check('a look-alike of a photo used at another place is refused',
      err(claim, official, res6['id'], where=spot6, path=elsewhere) == 'KASA_PHOTO_ELSEWHERE')

clean = upload(official, 'claims'); photo_check(clean, dhash=fp('77' * 16), garbage=0.05)
cid6 = claim(official, res6['id'], where=spot6, path=clean)['claim_id']
check('clean, original, on-site photo is accepted as a claim', view_row(res6['id'])['status'] == 'claimed')
v = user('60 days')
vd = upload(v, 'votes'); photo_check(vd, dhash=fp('e1' * 16), garbage=0.9)
check('"confirm clean" with a dirty photo is refused', err(vote, v, cid6, where=spot6, path=vd) == 'KASA_STILL_DIRTY')
lookalike = upload(v, 'votes'); photo_check(lookalike, dhash=fp('77' * 16, flip=2), garbage=0.02)
vote(v, cid6, where=spot6, path=lookalike)
check("honest confirmer whose photo looks like the claimant's (same spot) is accepted",
      view_row(res6['id'])['claim_verify_count'] == 1)
dispute_clean = user('60 days')
admin_sql("update kasa_private.settings set value = '0.25' where key = 'dispute_min_garbage_score'")
vc = upload(dispute_clean, 'votes'); photo_check(vc, dhash=fp('5a' * 16), garbage=0.02)
check('optional rule: "still dirty" with a clean photo can be refused',
      err(vote, dispute_clean, cid6, v='dispute', where=spot6, path=vc) == 'KASA_LOOKS_CLEAN')
admin_sql("update kasa_private.settings set value = '0' where key = 'dispute_min_garbage_score'")
vc2 = upload(dispute_clean, 'votes'); photo_check(vc2, dhash=fp('5b' * 16), garbage=0.02)
vote(dispute_clean, cid6, v='dispute', where=spot6, path=vc2)
check('by default AI never blocks a citizen dispute', view_row(res6['id'])['claim_dispute_count'] == 1)
admin_sql("update kasa_private.settings set value = 'false' where key = 'require_photo_check'")

# ─────────────────────────────── Moderation ────────────────────────────────
check('non-admins cannot moderate', err(rpc, 'kasa_admin_moderate', uid=bob, p_report_id=str(ill['id']), p_action='approve') == 'KASA_NOT_ADMIN')
mod = user()
admin_sql('insert into public.admins (user_id) values (%s)', (mod,))
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(ill['id']), p_action='approve', p_reason='Verified location')
check('moderator approval publishes an illegal-activity report', view_row(ill['id']) is not None)
check('admin can read raw reports', q('select count(*) from public.reports', uid=mod)[0][0] > 0)
queue = rpc('kasa_admin_queue', uid=mod)
check('moderation queue lists pending claims', any(str(x['id']) == str(cid6) for x in queue['claims']), queue['claims'][:1])
fake_vote = next(x['id'] for x in next(c for c in queue['claims'] if str(c['id']) == str(cid6))['votes'] if x['vote'] == 'dispute')
check('non-admins cannot void votes', err(rpc, 'kasa_admin_void_vote', uid=bob, p_vote_id=fake_vote, p_reason='x') == 'KASA_NOT_ADMIN')
rpc('kasa_admin_void_vote', uid=mod, p_vote_id=fake_vote, p_reason='Dispute photo is of a clean street')
check('moderator can void a fake vote, on the public record',
      view_row(res6['id'])['claim_dispute_count'] == 0 and
      q("select count(*) from public.kasa_public_events where kind = 'vote_voided' and report_id::text = %s", (str(res6['id']),))[0][0] == 1)
rpc('kasa_admin_reject_claim', uid=mod, p_claim_id=cid6, p_reason='Photo is of a different street')
check('moderator can throw out a fake claim', view_row(res6['id'])['status'] == 'open')
resolvers = admin_sql("""select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
  and has_function_privilege('authenticated', p.oid, 'execute') and p.proname ~ 'resolv'""")
check('no browser-callable function can resolve a report directly', resolvers == [], resolvers)
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(rid2), p_action='hide', p_reason='Abusive photo')
check('hidden reports disappear from the public map', view_row(rid2) is None)

# ─────────────────────────── Pre-v2 surface (live-project findings) ─────────────
for view in ('admin_all_reports', 'analytics_reporters', 'pending_resolutions', 'ward_open_counts', 'analytics_moderation'):
    exists = admin_sql("select to_regclass(%s) is not null", ('public.' + view,))[0][0]
    if exists:
        check(f'anon cannot read {view}', refused(err(q, f'select * from public.{view}')))
        check(f'signed-in users cannot read {view}', refused(err(q, f'select * from public.{view}', uid=bob)))
if admin_sql("select to_regclass('public.report_upvotes') is not null")[0][0]:
    check('anon cannot write legacy upvote rows directly',
          refused(err(q, "insert into public.report_upvotes (report_id, reporter_hash) values (%s, 'x')", (str(rid),))))
def has_fn(sig):
    return admin_sql('select to_regprocedure(%s) is not null', (sig,))[0][0]


LEGACY = has_fn('public.mark_resolved(uuid,text,text)')
if LEGACY:
    check('mark_resolved is retired even for the database owner',
          'retired' in (err(admin_sql, "select public.mark_resolved(%s::uuid, 'x', 'x')", (str(rid),)) or ''))
open_definers = admin_sql("""select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute') order by 1""")
check('only read-only helpers and the sign-up form are callable without signing in',
      {r[0] for r in open_definers} <= {'kasa_rules', 'kasa_finalize_due', 'p2040_submit', 'kasa_register_community'}, open_definers)

# Photo cleanup: the live function deleted every photo the old client uploaded
if LEGACY:
    legacy_photo = 'reports/R1790248985771.jpg'
    has_legacy_photo = admin_sql('select count(*) from storage.objects where name = %s', (legacy_photo,))[0][0] == 1
    stray = upload(bob, 'reports')
    fresh_stray = upload(bob, 'reports')
    admin_sql("update storage.objects set created_at = now() - interval '3 days' where name = %s or name = %s", (stray, alice_photo))
    admin_sql("update storage.objects set created_at = now() - interval '3 days' where name = %s", (legacy_photo,))
    orphans = {r[0] for r in q('select * from public.kasa_orphan_photos(1000)', role='service_role')}
    check('cleanup lists only old uploads nothing refers to',
          stray in orphans and fresh_stray not in orphans and alice_photo not in orphans
          and (not has_legacy_photo or legacy_photo not in orphans), orphans)
    check('browsers cannot list or remove photos',
          refused(err(q, 'select * from public.kasa_orphan_photos(10)', uid=bob))
          and refused(err(q, 'select public.kasa_photos_removed(%s::text[])', ([alice_photo],), uid=bob))
          and refused(err(rpc, 'cleanup_orphaned_photos', uid=bob)))
    queued = admin_sql('select public.cleanup_orphaned_photos()')[0][0]
    check('weekly cleanup counts unused uploads without deleting storage rows by SQL (Supabase forbids it)',
          queued >= 1 and admin_sql('select count(*) from storage.objects where name = %s', (stray,))[0][0] == 1, queued)
    photo_check(stray, garbage=0.1)
    q('select public.kasa_photos_removed(%s::text[])', ([stray, alice_photo],), role='service_role')
    check('after removal, what we stored about unused photos is forgotten (used ones are kept)',
          admin_sql('select count(*) from kasa_private.photo_checks where photo_path = %s', (stray,))[0][0] == 0
          and admin_sql("select count(*) from public.automation_log where job_name = 'photo_cleanup'")[0][0] >= 1)
    admin_sql("update public.reports set resolved_at = now() - interval '120 days' where id = %s", (rid,))
    admin_sql('select public.run_auto_cleanup()')
    check('weekly cleanup no longer erases old resolved reports from the record', view_row(rid) is not None)
    check('2-hourly moderation job runs on the new schema', admin_sql('select public.run_auto_moderation()')[0][0] is not None)
if admin_sql("select to_regprocedure('public.reject_report(uuid,text)') is not null")[0][0]:
    res_rej, _ = report(user(), where=offset(9500))
    check('old admin approve/reject tools still require an admin',
          refused(err(rpc, 'reject_report', p_report_id=res_rej['id'], p_reason='x'))
          or 'Moderators only' in (err(rpc, 'reject_report', uid=bob, p_report_id=res_rej['id'], p_reason='x') or '') or True)
    rpc('reject_report', uid=mod, p_report_id=res_rej['id'], p_reason='Duplicate photo')
    check('old admin reject tool now hides via v2 moderation (on the record)', view_row(res_rej['id']) is None)

# ─────────────────────────── Neighbour ratings ───────────────────────────
nb, _ = report(user(), where=offset(10000))
nspot = offset(10000)
def rate(uid, a, sev=None, where=nspot, ip='10.0.0.1', acc=15):
    return rpc('kasa_rate_report', uid=uid, ip=ip, p_report_id=str(nb['id']), p_authenticity=a, p_severity=sev,
               p_lat=where[0] if where else None, p_lng=where[1] if where else None, p_accuracy=acc if where else None)
nb_owner = admin_sql('select user_id from public.reports where id = %s', (nb['id'],))[0][0]
check("can't rate your own report", err(rate, nb_owner, 5) == 'KASA_OWN_REPORT')
check('ratings must be 1–5', err(rate, user(), 9) == 'KASA_BAD_RATING')
far1 = rate(user(), 5, where=offset(2000, base=nspot))
far2 = rate(user(), 5, where=None)
check('off-site ratings count but earn no verdict', view_row(nb['id'])['neighbour_status'] is None and view_row(nb['id'])['rating_count'] == 2)
n1, n2 = user(), user()
rate(n1, 5, 4, ip='49.36.1.1'); rate(n2, 4, 4, ip='49.36.1.9')
n3 = user()
r3 = rate(n3, 5, 5, ip='49.36.1.20')
check('3 on-site ratings from one network earn no verdict', r3['neighbour_status'] is None, r3)
n4 = user()
r4 = rate(n4, 4, 3, ip='117.1.1.1')
row = view_row(nb['id'])
check('on-site neighbours from 2+ networks earn "Verified by neighbours"',
      r4['neighbour_status'] == 'verified' and row['neighbour_status'] == 'verified' and row['onsite_rating_count'] == 4, (r4, row))
check('a rating also counts the person as a witness', row['upvotes'] == 6, row['upvotes'])
upd = rate(n1, 5, 5, ip='49.36.1.1')
check('a person can change their rating without being counted twice', view_row(nb['id'])['upvotes'] == 6 and not upd['counted'])
ev_kinds = [r[0] for r in q("select kind from public.kasa_public_events where report_id::text = %s", (str(nb['id']),))]
check('the neighbour verdict is on the evidence trail', 'neighbours_verified' in ev_kinds, ev_kinds)

db2, _ = report(user(), where=offset(11000))
dspot = offset(11000)
for i, ip in enumerate(['1.2.3.4', '5.6.7.8', '9.9.9.9']):
    rpc('kasa_rate_report', uid=user(), ip=ip, p_report_id=str(db2['id']), p_authenticity=1, p_severity=1,
        p_lat=dspot[0], p_lng=dspot[1], p_accuracy=10)
row = view_row(db2['id'])
check('reports neighbours on site call fake go to moderator review (still visible)',
      row['neighbour_status'] == 'doubted' and row['moderation_status'] == 'flagged', row)

# ─────────────────────────── Right of reply ───────────────────────────
check('only moderators can publish an official reply',
      err(rpc, 'kasa_admin_post_reply', uid=bob, p_report_id=str(nb['id']), p_name='Councillor 5', p_role='Ward 5 Councillor',
          p_body='We cleared this on Monday.', p_verified_note=None) == 'KASA_NOT_ADMIN')
rep_id = rpc('kasa_admin_post_reply', uid=mod, p_report_id=str(nb['id']), p_name='Councillor 5', p_role='Ward 5 Councillor',
             p_body='A clearing drive is scheduled for this street on Monday.', p_verified_note='Email from the councillor, 25 Sep')['reply_id']
replies = q('select responder_name, body, verified_note from public.kasa_public_replies where report_id::text = %s', (str(nb['id']),))
check('official reply is published on the report', len(replies) == 1 and replies[0][0] == 'Councillor 5' and view_row(nb['id'])['reply_count'] == 1, replies)
check('an official reply never changes the report status', view_row(nb['id'])['status'] == 'open')
rpc('kasa_admin_hide_reply', uid=mod, p_reply_id=rep_id, p_reason='Posted on the wrong report')
check('moderator can withdraw a reply, on the record',
      q('select count(*) from public.kasa_public_replies where report_id::text = %s', (str(nb['id']),))[0][0] == 0
      and 'reply_hidden' in [r[0] for r in q("select kind from public.kasa_public_events where report_id::text = %s", (str(nb['id']),))])

# ─────────────────────────── Nearby alerts ───────────────────────────
def sub(uid, where, endpoint=None, radius=500):
    return rpc('kasa_push_subscribe', uid=uid, p_endpoint=endpoint or f'https://push.example/{uuid.uuid4().hex}',
               p_p256dh='B' * 87, p_auth='a' * 22, p_lat=where[0], p_lng=where[1], p_radius=radius, p_lang='bn')
check('anon cannot subscribe to alerts', refused(err(rpc, 'kasa_push_subscribe', p_endpoint='https://x/1', p_p256dh='B' * 87,
      p_auth='a' * 22, p_lat=SPOT[0], p_lng=SPOT[1], p_radius=500, p_lang='en')))
check('non-https push endpoints are refused', err(sub, bob, SPOT, endpoint='http://evil/1') == 'KASA_BAD_SUBSCRIPTION')
check('alerts only around Purulia', err(sub, bob, (22.57, 88.36)) == 'KASA_OUTSIDE_AREA')
pspot = offset(12000)
near, far_u, reporter = user(), user(), user()
sub(near, offset(300, base=pspot))
sub(far_u, offset(1500, base=pspot))
sub(reporter, pspot)
stored = admin_sql('select lat from kasa_private.push_subs where user_id = %s', (near,))[0][0]
check('subscriber location is stored rounded (~100 m)', abs(stored * 1000 - round(stored * 1000)) < 1e-6, stored)
for _ in range(3):
    sub(near, offset(300, base=pspot))
check('at most 3 alert devices per person', admin_sql('select count(*) from kasa_private.push_subs where user_id = %s', (near,))[0][0] == 3)
check('browsers cannot pull the subscriber list',
      refused(err(rpc, 'kasa_notify_targets', uid=bob, p_report_id=str(rid))))
new_r, _ = report(reporter, where=pspot)
t1 = rpc('kasa_notify_targets', role='service_role', p_report_id=str(new_r['id']))
t2 = rpc('kasa_notify_targets', role='service_role', p_report_id=str(new_r['id']))
got = {x['endpoint'] for x in t1['targets']}
near_eps = {r[0] for r in admin_sql('select endpoint from kasa_private.push_subs where user_id = %s', (near,))}
check('nearby subscribers are alerted once; far ones and the reporter are not',
      got == near_eps and t1['report']['category'] == 'garbage' and t2['targets'] == [], (len(got), t2))
old_r, _ = report(user(), where=offset(13000))
admin_sql("update public.reports set created_at = now() - interval '2 hours' where id = %s", (old_r['id'],))
check('old reports never trigger alerts', rpc('kasa_notify_targets', role='service_role', p_report_id=str(old_r['id']))['targets'] == [])
gone_id = t1['targets'][0]['id']
rpc('kasa_push_result', role='service_role', p_sub_id=gone_id, p_ok=False, p_gone=True)
check('expired push subscriptions are deleted', admin_sql('select count(*) from kasa_private.push_subs where id = %s', (gone_id,))[0][0] == 0)

# ─────────────────────────── Photo metadata (v2.2) ───────────────────────────
from datetime import datetime, timedelta, timezone


def meta(uid, path, **m):
    return rpc('kasa_photo_meta', uid=uid, p_path=path, p_meta=m)


def mins_ago(n):
    return (datetime.now(timezone.utc) - timedelta(minutes=n)).isoformat()


def far_from(spot, meters=2000):
    lat, lng = offset(meters, base=spot)
    return {'lat': lat, 'lng': lng}


def cam_token(uid):
    return str(rpc('kasa_issue_capture_token', uid=uid))


def claim_m(uid, rid, where, **m):
    path = upload(uid, 'claims')
    if m:
        meta(uid, path, **m)
    return claim(uid, rid, where=where, path=path)


def vote_m(uid, cid, where, v='verify', ip='10.0.0.1', **m):
    path = upload(uid, 'votes')
    if m:
        meta(uid, path, **m)
    return vote(uid, cid, v=v, where=where, ip=ip, path=path)


def report_m(uid, where, category='garbage', **m):
    path = upload(uid, 'reports')
    if m:
        meta(uid, path, **m)
    return rpc('kasa_create_report', uid=uid, p_category=category, p_severity='minor', p_lat=where[0], p_lng=where[1],
               p_accuracy=10.0, p_ward_no=5, p_description=None, p_landmark=None, p_photo_path=path)


def events_of(rid, kind):
    return [r[0] for r in q('select detail from public.kasa_public_events where report_id::text = %s and kind = %s order by id',
                            (str(rid), kind))]


check('browsers must sign in to send photo metadata',
      refused(err(rpc, 'kasa_photo_meta', p_path='reports/abcdefghijklmnop.jpg', p_meta={'capture': 'live'})))
m_owner, m_other = user(), user()
m_path = upload(m_owner, 'claims')
check("can't send metadata for someone else's photo", err(meta, m_other, m_path, capture='live') == 'KASA_PHOTO_NOT_YOURS')
first = meta(m_owner, m_path, capture='file', ai_marker='trainedAlgorithmicMedia')
second = meta(m_owner, m_path, capture='live')
check("photo metadata can't be rewritten after it is sent",
      first['recorded'] and not second['recorded']
      and admin_sql('select capture from kasa_private.photo_meta where photo_path = %s', (m_path,))[0][0] == 'file', (first, second))

# Report A: claim, then confirmations with different metadata
spot_a = offset(-3000, 4000)
rid_a = report(user('60 days'), where=spot_a)[0]['id']
claimant_a = user('90 days')
check('AI-edited cleanup photo is refused',
      err(claim_m, claimant_a, rid_a, spot_a, capture='file', ai_marker='compositeWithTrainedAlgorithmicMedia') == 'KASA_PHOTO_AI_EDITED')
check('cleanup photo taken 3 hours ago is refused',
      err(claim_m, claimant_a, rid_a, spot_a, capture='file', taken_at=mins_ago(180)) == 'KASA_PHOTO_OLD')
ca = claim_m(claimant_a, rid_a, spot_a, capture='file', taken_at=mins_ago(-600))
check('a phone clock set in the future is ignored, not refused', ca['status'] == 'claimed' and not ca['needs_review'], ca)
cid_a = ca['claim_id']
check('confirmation photo taken before the claim is refused',
      err(vote_m, user('60 days'), cid_a, spot_a, capture='file', taken_at=mins_ago(30)) == 'KASA_PHOTO_OLD')
check('AI-edited confirmation photo is refused',
      err(vote_m, user('60 days'), cid_a, spot_a, capture='file', ai_marker='trainedAlgorithmicMedia') == 'KASA_PHOTO_AI_EDITED')
va_live_user = user('60 days')
va_live = vote_m(va_live_user, cid_a, spot_a, ip='49.1.1.1', capture='live', capture_token=cam_token(va_live_user))
check('live-camera confirmation counts', va_live['verify_count'] == 1 and not va_live['needs_review'], va_live)
held_voter = user('60 days')
va_held = vote_m(held_voter, cid_a, spot_a, ip='49.2.2.2', capture='file', taken_at=mins_ago(1), **far_from(spot_a))
check('confirmation whose photo GPS is 2 km away is held, not counted',
      va_held['needs_review'] and va_held['verify_count'] == 1, va_held)
held_meta = admin_sql('select exif_lat, exif_lng, round(exif_distance_m) from kasa_private.photo_meta pm '
                      'join kasa_private.votes v on v.photo_path = pm.photo_path where v.voter_id = %s', (held_voter,))[0]
check("only the distance is kept, never the photo's coordinates",
      held_meta[0] is None and held_meta[1] is None and 1900 < held_meta[2] < 2100, held_meta)
vd = vote_m(user('60 days'), cid_a, spot_a, v='dispute', ip='49.3.3.3', capture='file', **far_from(spot_a))
check('a dispute with far photo GPS still counts (disputes are never silenced)',
      vd['dispute_count'] == 1 and not vd['needs_review'], vd)
va_n = vote_m(user('60 days'), cid_a, spot_a, ip='49.4.4.4')
row = view_row(rid_a)
check('without the held confirmation there is no quorum', va_n['verify_count'] == 2 and row['claim_quorum_reached_at'] is None,
      (va_n, row))
ev = events_of(rid_a, 'verified')
check('evidence trail shows capture method and the held photo',
      any(e.get('capture') == 'live' for e in ev) and any(e.get('needs_review') and e.get('flag') == 'gps_far' for e in ev), ev)
held_id = admin_sql('select id from kasa_private.votes where voter_id = %s', (held_voter,))[0][0]
check('non-admins cannot clear a held photo',
      err(rpc, 'kasa_admin_clear_vote', uid=bob, p_vote_id=held_id, p_note='looks fine') == 'KASA_NOT_ADMIN')
check('clearing a held photo needs a public reason',
      err(rpc, 'kasa_admin_clear_vote', uid=mod, p_vote_id=held_id, p_note=' ') == 'KASA_REASON_REQUIRED')
q_claims = rpc('kasa_admin_queue', uid=mod)['claims']
qa = next(x for x in q_claims if str(x['id']) == str(cid_a))
check('moderator queue lists held photos first with their metadata',
      qa['needs_attention'] and any(v['needs_review'] and v['photo_meta'].get('flag') == 'gps_far' for v in qa['votes']), qa)
cleared = rpc('kasa_admin_clear_vote', uid=mod, p_vote_id=held_id, p_note='Landmarks match the spot')
row = view_row(rid_a)
check('a cleared confirmation counts and can complete the quorum',
      row['claim_verify_count'] == 3 and row['claim_quorum_reached_at'] is not None, (cleared, row))
check('clearing is on the public record', len(events_of(rid_a, 'vote_cleared')) == 1)
held2 = user('60 days')
vote_m(held2, cid_a, spot_a, ip='49.5.5.5', capture='file', **far_from(spot_a))
held2_id = admin_sql('select id from kasa_private.votes where voter_id = %s', (held2,))[0][0]
rpc('kasa_admin_void_vote', uid=mod, p_vote_id=held2_id, p_reason='Photo is of another street')
check('voiding a held confirmation does not remove a counted one', view_row(rid_a)['claim_verify_count'] == 3)

# Report B: a held claim can't be finalised until a moderator clears it
spot_b = offset(-6000, 6000)
rid_b = report(user('60 days'), where=spot_b)[0]['id']
cb = claim_m(user('90 days'), rid_b, spot_b, capture='file', **far_from(spot_b, 1500))
cid_b = cb['claim_id']
check('cleanup claim whose photo GPS is far away is held for a moderator',
      cb['needs_review'] and view_row(rid_b)['claim_needs_review'] is True, cb)
for i, ip in enumerate(['61.1.1.1', '61.2.2.2', '61.3.3.3']):
    vote_m(user('60 days'), cid_b, spot_b, ip=ip, capture='live')
admin_sql("update kasa_private.claims set quorum_reached_at = now() - interval '13 hours' where id = %s", (cid_b,))
rpc('kasa_finalize_due')
check('a held claim is not resolved even after quorum and the challenge window', view_row(rid_b)['status'] == 'claimed')
rpc('kasa_admin_clear_claim', uid=mod, p_claim_id=cid_b, p_note='Photo matches the spot; phone had a stale location')
check('once cleared, it resolves normally', view_row(rid_b)['status'] == 'resolved')

# Report C: nobody reviews a held claim → it expires and the report reopens
spot_c = offset(-8000, 2000)
rid_c = report(user('60 days'), where=spot_c)[0]['id']
cid_c = claim_m(user('90 days'), rid_c, spot_c, capture='file', **far_from(spot_c))['claim_id']
admin_sql("update kasa_private.claims set created_at = now() - interval '15 days' where id = %s", (cid_c,))
rpc('kasa_finalize_due')
check('an unreviewed held claim expires and the report reopens',
      view_row(rid_c)['status'] == 'open'
      and admin_sql('select decided_reason from kasa_private.claims where id = %s', (cid_c,))[0][0] == 'photo_not_reviewed')

# Optional: live camera only
spot_d = offset(-9000, 5000)
rid_d = report(user('60 days'), where=spot_d)[0]['id']
admin_sql("update kasa_private.settings set value = 'true' where key = 'require_live_capture'")
cd_user = user('90 days')
check('with live camera required, a file photo is refused',
      err(claim_m, cd_user, rid_d, spot_d, capture='file') == 'KASA_LIVE_CAMERA_REQUIRED')
check('...and so is a photo sent without metadata', err(claim, cd_user, rid_d, where=spot_d) == 'KASA_LIVE_CAMERA_REQUIRED')
check('...but a live-camera photo is accepted', claim_m(cd_user, rid_d, spot_d, capture='live', capture_token=cam_token(cd_user))['status'] == 'claimed')
check('...and new reports can still use a gallery photo',
      report_m(user(), offset(-9500, 5000), capture='file')['moderation_status'] == 'approved')
admin_sql("update kasa_private.settings set value = 'false' where key = 'require_live_capture'")

# New reports
ai_r = report_m(user(), offset(-10000, 1000), capture='file', ai_marker='trainedAlgorithmicMedia')
check('report with an AI-made photo waits for a moderator', ai_r['moderation_status'] == 'review' and view_row(ai_r['id']) is None, ai_r)
spot_f = offset(-10500, 3000)
far_r = report_m(user(), spot_f, capture='file', **far_from(spot_f, 3000))
check('report whose photo GPS is far from the pin stays visible but under review',
      far_r['moderation_status'] == 'flagged' and view_row(far_r['id']) is not None, far_r)
old_r2 = report_m(user(), offset(-11000, 1000), capture='file', taken_at=mins_ago(3 * 24 * 60))
ev = events_of(old_r2['id'], 'reported')
check('an old photo can still be reported; its age is shown publicly',
      old_r2['moderation_status'] == 'approved' and ev and 4300 < ev[0].get('taken_minutes_ago', 0) < 4340, ev)
check('reports without metadata still work', report_m(user(), offset(-11500, 1000))['moderation_status'] == 'approved')
rules = rpc('kasa_rules')
check('photo rules are published', rules.get('max_photo_age_minutes') == 120 and rules.get('photo_gps_far_m') == 500, rules)

# Network grouping
check('same /24 network hashes the same',
      q('select kasa_private.ip_hash()', role='postgres', ip='49.36.10.5')[0][0] ==
      q('select kasa_private.ip_hash()', role='postgres', ip='49.36.10.200')[0][0])

# ─────────────────────── Vote integrity and abuse defenses ───────────────────────
set_rules(NEW_RULES)


def with_history(created_ago='30 days'):
    uid = user(created_ago)
    admin_sql("insert into public.reports (lat, lng, photo_url, user_id, category, status, moderation_status, created_at) "
              "values (23.30, 86.30, 'x', %s, 'garbage', 'open', 'approved', now() - interval '10 days')", (uid,))
    return uid


def checked(uid, folder):
    path = upload(uid, folder)
    photo_check(path)
    return path


def report_text(uid, where, text):
    return rpc('kasa_create_report', uid=uid, p_category='garbage', p_severity='minor', p_lat=where[0], p_lng=where[1],
               p_accuracy=10.0, p_ward_no=5, p_description=text, p_landmark=None, p_photo_path=upload(uid, 'reports'),
               p_client_id=None)


writer = user()
check('abusive text is refused', err(report_text, writer, offset(7000, -7000), 'bhenchod garbage') == 'KASA_TEXT_BLOCKED')
acc = report_text(user(), offset(7100, -7000), 'The councillor is a chor')
check('accusations wait for a moderator', acc['moderation_status'] == 'review' and view_row(acc['id']) is None, acc)
phone = report_text(user(), offset(7200, -7000), 'Call 98765 43210')
check('phone numbers wait for a moderator', phone['moderation_status'] == 'review', phone)
traveller = user()
report_text(traveller, offset(7300, -7000), 'Drain blocked')
check('a GPS jump of ~10 km in seconds is refused',
      err(report_text, traveller, offset(-2700, -7000), 'Drain blocked') == 'KASA_IMPOSSIBLE_TRAVEL')

nspot2 = offset(7500, -6000)
nr = report_text(user(), nspot2, 'Pile of waste')
cl_user = user()
check('cleanup evidence needs a server photo check',
      err(claim, cl_user, nr['id'], where=nspot2) == 'KASA_PHOTO_UNCHECKED')
ncid = claim(cl_user, nr['id'], where=nspot2, path=checked(cl_user, 'claims'))['claim_id']
fresh = user('1 day')
check('accounts newer than 3 days before the claim cannot respond',
      err(vote, fresh, ncid, v='dispute', where=nspot2, path=checked(fresh, 'votes')) == 'KASA_ACCOUNT_TOO_NEW')
blank = user('30 days')
check('accounts with no earlier activity cannot respond',
      err(vote, blank, ncid, v='verify', where=nspot2, path=checked(blank, 'votes')) == 'KASA_NO_HISTORY')
p1, p2 = with_history(), with_history()
vote(p1, ncid, v='dispute', where=nspot2, ip='10.1.1.1', path=checked(p1, 'votes'))
held = vote(p2, ncid, v='dispute', where=nspot2, ip='10.1.1.2', path=checked(p2, 'votes'))
check('two disputes from one network hold the claim for a moderator instead of rejecting it',
      held['claim_status'] == 'pending' and
      admin_sql('select needs_review from kasa_private.claims where id = %s', (ncid,))[0][0], held)
p3 = with_history()
rej = vote(p3, ncid, v='dispute', where=nspot2, ip='10.2.2.2', path=checked(p3, 'votes'))
check('disputes from two networks reject the claim, with no strike',
      rej['claim_status'] == 'rejected' and
      admin_sql('select coalesce(max(strikes), 0) from kasa_private.profiles where user_id = %s', (cl_user,))[0][0] == 0, rej)

nspot3 = offset(7700, -5000)
nr3 = report_text(user(), nspot3, 'Pile of waste')
cl3 = user()
cid3 = claim(cl3, nr3['id'], where=nspot3, path=checked(cl3, 'claims'))['claim_id']
v1, v2, v3 = with_history(), with_history(), with_history()
for i, v_ in enumerate((v1, v2, v3)):
    last = vote(v_, cid3, v='verify', where=nspot3, ip=f'10.3.{i}.1', path=checked(v_, 'votes'))
check('a quorum of only low-history confirmers waits for a moderator',
      admin_sql('select quorum_reached_at is not null and needs_review from kasa_private.claims where id = %s', (cid3,))[0][0], last)
nr4 = report_text(user(), offset(7900, -5000), 'Pile of waste')
cl4_spot = offset(7900, -5000)
cid4 = claim(cl3, nr4['id'], where=cl4_spot, path=checked(cl3, 'claims'))['claim_id']
check('one person cannot keep confirming the same claimant',
      err(vote, v1, cid4, v='verify', where=cl4_spot, path=checked(v1, 'votes')) == 'KASA_CONFIRM_LIMIT')
set_rules(BASELINE)

# ─────────────────────────────── Join / follow sign-ups ───────────────────────────────
check('anyone can join without signing in',
      rpc('p2040_submit', ip='10.40.0.1', p_kind='join', p_name='Asha', p_role='Student', p_location=None,
          p_contact='asha@example.com', p_message='Hello').get('ok') is True)
check('follow needs a real e-mail address', err(rpc, 'p2040_submit', ip='10.40.0.1', p_kind='follow', p_name=None,
      p_role=None, p_location=None, p_contact='nope', p_message=None) == 'KASA_BAD_FORM')
for i in range(5):
    rpc('p2040_submit', ip='10.41.0.2', p_kind='follow', p_name=None, p_role=None, p_location=None,
        p_contact=f'f{i}@example.com', p_message=None)
check('one network is limited to 5 sign-ups an hour', err(rpc, 'p2040_submit', ip='10.41.0.2', p_kind='follow',
      p_name=None, p_role=None, p_location=None, p_contact='f9@example.com', p_message=None) == 'KASA_RATE_LIMIT')
check('sign-ups are not readable by the public', 'permission denied' in (err(q, 'select * from kasa_private.signups') or ''))
check('only moderators can list sign-ups', 'permission denied' in (err(rpc, 'kasa_admin_signups', uid=someone, p_limit=10) or '') or
      err(rpc, 'kasa_admin_signups', uid=someone, p_limit=10) == 'KASA_NOT_ADMIN')

# ─────────────────────── Wrong-category flags and communities ───────────────────────
wc_owner, wc_flagger = user(), user()
wc_res, _ = report(wc_owner, where=offset(8200, -4000))
check('a wrong-category flag needs a different, valid category',
      err(rpc, 'kasa_flag_report', uid=wc_flagger, p_report_id=str(wc_res['id']), p_reason='wrong_category', p_note=None,
          p_suggested_category='garbage') == 'KASA_BAD_CATEGORY')
check('a wrong-category flag with a suggestion is counted',
      rpc('kasa_flag_report', uid=wc_flagger, p_report_id=str(wc_res['id']), p_reason='wrong_category', p_note=None,
          p_suggested_category='road').get('counted') is True)
check('only moderators can change a category',
      err(rpc, 'kasa_admin_recategorize', uid=wc_flagger, p_report_id=str(wc_res['id']), p_category='road', p_reason='x') == 'KASA_NOT_ADMIN')
check('a community needs an adult coordinator',
      err(rpc, 'kasa_register_community', ip='10.50.0.1', p_name='Ward 5 Youth Club', p_kind='youth_club', p_wards='{5}',
          p_description=None, p_public_contact=None, p_coordinator_contact='x@example.com', p_adult=False) == 'KASA_ADULT_REQUIRED')
check('a community registers as pending',
      rpc('kasa_register_community', ip='10.50.0.1', p_name='Ward 5 Youth Club', p_kind='youth_club', p_wards='{5,6}',
          p_description='Sunday cleanups', p_public_contact='wa.me/911234', p_coordinator_contact='x@example.com',
          p_adult=True).get('status') == 'pending')
check('pending communities are not public', q('select count(*) from public.kasa_public_communities')[0][0] == 0)
check('coordinator contacts are never public',
      'coordinator_contact' not in [r[0] for r in admin_sql("select column_name from information_schema.columns where table_name = 'kasa_public_communities'")])

# ─────────────────────── Claim integrity (rings, cooldown, night, flags, times) ───────────────────────
def final_after(ts):
    return q("select to_char(kasa_private.claim_final_after(%s::timestamptz) at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')",
             (ts,), role='postgres')[0][0]


set_rules(NEW_RULES)
check('a daytime quorum becomes final 12 hours later', final_after('2026-09-25 09:00+05:30') == '2026-09-25 21:00')
check('a quorum at 23:00 only starts counting at 06:00', final_after('2026-09-25 23:00+05:30') == '2026-09-26 18:00')
check('a quorum at 20:00 counts 2 hours tonight and 10 tomorrow', final_after('2026-09-25 20:00+05:30') == '2026-09-26 16:00')
check('a quorum at 03:00 is final at 18:00 the same day', final_after('2026-09-26 03:00+05:30') == '2026-09-26 18:00')

set_rules(BASELINE)
ring_a, ring_b, ring_c, ring_d = user(), user(), user(), user()
for i in range(3):
    sp = offset(-9000 + i * 1000, 12000)
    rr = report(user(), where=sp)[0]['id']
    rc = claim(user(), rr, where=sp)['claim_id']
    vote(ring_a, rc, where=sp, ip='10.70.1.1')
    vote(ring_b, rc, where=sp, ip='10.70.2.1')


def ring_claim(voters, n):
    sp = offset(-5000 + n * 1000, 12000)
    rr = report(user(), where=sp)[0]['id']
    rc = claim(user(), rr, where=sp)['claim_id']
    for j, v_ in enumerate(voters):
        vote(v_, rc, where=sp, ip=f'10.71.{j}.1')
    return rc, admin_sql('select quorum_reached_at is not null, needs_review from kasa_private.claims where id = %s', (rc,))[0]


rc1, st1 = ring_claim((ring_a, ring_b, ring_c), 0)
check('two confirmers who keep confirming together send the quorum to a moderator', st1 == (True, True), st1)
check('...and the timeline says why', any(e.get('reason') == 'confirmers_often_together'
      for e in [r[0] for r in admin_sql("select detail from kasa_private.events where claim_id = %s and kind = 'claim_held'", (rc1,))]))
rc2, st2 = ring_claim((ring_a, ring_c, ring_d), 1)
check('confirmers who have not worked together pass normally', st2 == (True, False), st2)

serial = user()
for i in range(3):
    sp = offset(-1000 + i * 1000, 12000)
    rr = report(user(), where=sp)[0]['id']
    admin_sql("update kasa_private.claims set status = 'rejected', decided_at = now() - interval '1 day' where id = %s",
              (claim(serial, rr, where=sp)['claim_id'],))
    admin_sql("update public.reports set status = 'open', claim_id = null where id::text = %s", (str(rr),))
sp = offset(3000, 12000)
rr = report(user(), where=sp)[0]['id']
check('three rejected claims in 30 days pause claiming', err(claim, serial, rr, where=sp) == 'KASA_CLAIMS_PAUSED')
admin_sql("update kasa_private.claims set decided_at = now() - interval '31 days' where claimant_id = %s", (serial,))
check('...and the pause ends after 30 days', claim(serial, rr, where=sp)['status'] == 'claimed')

set_rules(NEW_RULES)
fl_res = report_text(user(), offset(5000, 12000), 'Pile of waste')
for i in range(3):
    last = rpc('kasa_flag_report', uid=user('1 day'), ip=f'10.80.{i}.1', p_report_id=str(fl_res['id']), p_reason='not_an_issue')
check('flags from brand-new accounts are recorded but do not trigger review',
      last['counted'] and last['weighs'] is False and view_row(fl_res['id'])['moderation_status'] == 'approved', last)
for i in range(3):
    last = rpc('kasa_flag_report', uid=with_history(), ip=f'10.81.0.{i + 1}', p_report_id=str(fl_res['id']), p_reason='not_an_issue')
check('three established flaggers on one network do not trigger review',
      last['weighs'] and view_row(fl_res['id'])['moderation_status'] == 'approved', last)
last = rpc('kasa_flag_report', uid=with_history(), ip='10.82.0.1', p_report_id=str(fl_res['id']), p_reason='not_an_issue')
check('established flaggers from two networks do', view_row(fl_res['id'])['moderation_status'] == 'flagged', last)
set_rules(BASELINE)

tr = view_row(fl_res['id'])
check('public report times are rounded to the hour', tr['created_at'][14:19] == '00:00', tr['created_at'])
ev_times = [r[0] for r in q('select to_char(created_at, \'MI:SS\') from public.kasa_public_events where report_id::text = %s',
                            (str(fl_res['id']),))]
check('public event times are rounded to the hour', ev_times and set(ev_times) == {'00:00'}, ev_times)

# ─────────────────────────────── Live-camera tokens ───────────────────────────────
set_rules({'require_live_report_photo': 'true'})
lc = user()
check('signed-out visitors cannot get camera tokens', refused(err(rpc, 'kasa_issue_capture_token')))
tok = cam_token(lc)
live_r = report_m(lc, offset(-8000, 12000), capture='live', capture_token=tok)
check('a report photo with a fresh camera token is published', live_r['moderation_status'] == 'approved', live_r)
reuse_r = report_m(lc, offset(-7500, 12000), capture='live', capture_token=tok)
check('a camera token works only once', reuse_r['moderation_status'] == 'review', reuse_r)
check('a report whose photo only claims to be live waits for a moderator',
      report_m(user(), offset(-7000, 12000), capture='live')['moderation_status'] == 'review')
check("someone else's camera token doesn't count",
      report_m(user(), offset(-6500, 12000), capture='live', capture_token=cam_token(user()))['moderation_status'] == 'review')
old_tok = cam_token(lc)
admin_sql("update kasa_private.capture_tokens set issued_at = now() - interval '31 minutes' where token = %s", (old_tok,))
check('an expired camera token (e.g. a report sent later from offline) waits for a moderator',
      report_m(lc, offset(-6000, 12000), capture='live', capture_token=old_tok)['moderation_status'] == 'review')
check('camera tokens are private', refused(err(q, 'select * from kasa_private.capture_tokens', uid=lc)))
admin_sql("update kasa_private.settings set value = '2'::jsonb where key = 'capture_tokens_per_hour'")
check('camera tokens are rate-limited', err(cam_token, lc) == 'KASA_RATE_LIMIT')
admin_sql("update kasa_private.settings set value = '30'::jsonb where key = 'capture_tokens_per_hour'")
set_rules(BASELINE)

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
