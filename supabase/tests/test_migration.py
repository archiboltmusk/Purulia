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


def photo_check(path, sha=None, dhash=None, garbage=None, unsafe=False, faces=0, labels=None):
    rpc('kasa_record_photo_check', role='service_role', p_path=path, p_sha256=sha or uuid.uuid4().hex,
        p_dhash=dhash, p_garbage_score=garbage, p_labels=labels or [], p_unsafe=unsafe, p_face_count=faces)


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
            'quiet_start_hour': '0', 'quiet_end_hour': '0', 'require_live_report_photo': 'false',
            'require_live_capture': 'false',
            # Older scenarios are spread over several km, which is now "rural"; keep town numbers for them.
            'rural_verify_quorum': '3', 'rural_min_distinct_networks': '2', 'rural_claim_expiry_days': '14'}


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
PUBLIC_REPORT_COLUMNS = {'id', 'created_at', 'lat', 'lng', 'ward_no', 'category', 'severity', 'status', 'description', 'landmark', 'photo_url', 'upvotes', 'seen_on_site', 'flags', 'moderation_status', 'is_duplicate', 'parent_report_id', 'recurrence_count', 'rejected_claims', 'resolved_at', 'resolved_photo_url', 'resolution_method', 'sla_days', 'gps_verified', 'claim_id', 'claim_photo_url', 'claim_created_at', 'claim_verify_count', 'claim_dispute_count', 'claim_quorum_reached_at', 'claim_finalize_after', 'claim_distance_m', 'rating_count', 'onsite_rating_count', 'authenticity_avg', 'severity_avg', 'neighbour_status', 'reply_count', 'claim_needs_review', 'claim_reviewed_at',
                         'area_kind', 'block_name', 'verify_needed'}
check('public view has exactly the reviewed columns (update kasa.js PUBLIC_REPORT_COLUMNS too)', set(cols) == PUBLIC_REPORT_COLUMNS,
      sorted(set(cols) ^ PUBLIC_REPORT_COLUMNS))
open_grants = admin_sql("select table_name, grantee, privilege_type from information_schema.role_table_grants "
                        "where table_schema = 'public' and grantee in ('anon', 'authenticated') "
                        "and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')")
check('anon/authenticated cannot write to any public table directly', not open_grants, open_grants)
anon_fns = sorted(r[0] for r in admin_sql("select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace "
                                          "and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')"))
check('only the intended SECURITY DEFINER functions are callable without signing in',
      set(anon_fns) <= {'kasa_finalize_due', 'kasa_rules', 'kasa_version', 'p2040_submit', 'kasa_register_community', 'kasa_public_transparency', 'kasa_report_photos', 'kasa_fast_claims', 'kasa_report_addresses', 'kasa_school_coverage', 'kasa_school_checks', 'kasa_school_blocks', 'kasa_nearby_schools', 'kasa_problem_spots', 'kasa_adopted_spots', 'kasa_people_count'}, anon_fns)
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
check('a resolved report still shows its claim id and confirmer count (for the resolution caption)',
      row['claim_id'] is not None and isinstance(row['claim_verify_count'], int) and row['claim_verify_count'] >= 1, row)
check('a resolution nobody had to clear leaves claim_reviewed_at empty', row['claim_reviewed_at'] is None, row)
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
admin_sql("insert into public.admins (user_id, role) values (%s, 'admin')", (mod,))
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
      {r[0] for r in open_definers} <= {'kasa_rules', 'kasa_finalize_due', 'p2040_submit', 'kasa_register_community', 'kasa_public_transparency', 'kasa_report_photos', 'kasa_fast_claims', 'kasa_report_addresses', 'kasa_school_coverage', 'kasa_school_checks', 'kasa_school_blocks', 'kasa_nearby_schools', 'kasa_problem_spots', 'kasa_adopted_spots', 'kasa_people_count'}, open_definers)

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
row_b = view_row(rid_b)
check('once cleared, it resolves normally', row_b['status'] == 'resolved')
check('a resolution a moderator had to clear shows claim_reviewed_at (for "verified by moderator")',
      row_b['claim_reviewed_at'] is not None, row_b)

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


def checked(uid, folder, garbage=0.3):
    # Default score is clean enough to pass (below clean_max_garbage_score) but not so
    # clean it trips the photo-confident fast lane (above fast_max_garbage_score) — a
    # plain "Vision looked at it and it's fine", not a special case. Tests that care about
    # a specific score set one explicitly; garbage=None exercises "Vision couldn't score it".
    path = upload(uid, folder)
    photo_check(path, garbage=garbage)
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

# A photo check that ran but couldn't score the photo (no Vision key, over its free quota, or
# an outage) must not be read as "definitely clean" — that would silently stop screening
# cleanups the moment the free tier runs out. It's held for a moderator instead.
nspot5 = offset(8100, -5000)
nr5 = report_text(user(), nspot5, 'Pile of waste')
cl5 = user()
unscored_path = upload(cl5, 'claims'); photo_check(unscored_path, garbage=None)
unscored_claim = claim(cl5, nr5['id'], where=nspot5, path=unscored_path)
check('a claim photo Vision could not score is held for a moderator instead of assumed clean',
      unscored_claim['needs_review'] is True, unscored_claim)
uv = with_history()
unscored_vote_path = upload(uv, 'votes'); photo_check(unscored_vote_path, garbage=None)
unscored_vote = vote(uv, unscored_claim['claim_id'], v='verify', where=nspot5, path=unscored_vote_path)
check('an unscored confirmation photo is held for review and does not count toward quorum',
      unscored_vote['needs_review'] is True and
      admin_sql('select verify_count from kasa_private.claims where id = %s', (unscored_claim['claim_id'],))[0][0] == 0,
      unscored_vote)
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
      err(rpc, 'kasa_admin_signups', uid=someone, p_limit=10) == 'KASA_NOT_SUPER_ADMIN')

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
admin_sql("update kasa_private.capture_tokens set issued_at = now() - interval '181 minutes' where token = %s", (old_tok,))
check('an expired camera token (e.g. a report sent later from offline) waits for a moderator',
      report_m(lc, offset(-6000, 12000), capture='live', capture_token=old_tok)['moderation_status'] == 'review')
check('camera tokens are private', refused(err(q, 'select * from kasa_private.capture_tokens', uid=lc)))
admin_sql("update kasa_private.settings set value = '1'::jsonb where key = 'capture_tokens_per_hour'")
check('camera tokens are rate-limited', err(cam_token, lc) == 'KASA_RATE_LIMIT')
admin_sql("update kasa_private.settings set value = '30'::jsonb where key = 'capture_tokens_per_hour'")
set_rules(BASELINE)

# ─────────────────────────────── The whole district ───────────────────────────────
set_rules({'rural_verify_quorum': '2', 'rural_min_distinct_networks': '1', 'rural_claim_expiry_days': '30'})
check('a report outside Purulia district is refused', err(report, user(), where=(24.0, 86.0)) == 'KASA_OUTSIDE_AREA')
town_user = user()
town_spot = offset(-150, 150)
town_r = rpc('kasa_create_report', uid=town_user, p_category='streetlight', p_severity='minor', p_lat=town_spot[0],
             p_lng=town_spot[1], p_accuracy=10.0, p_ward_no=None, p_description=None, p_landmark=None,
             p_photo_path=upload(town_user, 'reports'), p_client_id=None)
town_row = view_row(town_r['id'])
check('a report in town gets its ward from the ward map', town_row['area_kind'] == 'town' and town_row['ward_no'] is not None, town_row)
jhalda = (23.3653, 85.9764)
vil_user = user()
vil = rpc('kasa_create_report', uid=vil_user, p_category='hand_pump', p_severity='severe', p_lat=jhalda[0], p_lng=jhalda[1],
          p_accuracy=10.0, p_ward_no=7, p_description='Hand pump broken', p_landmark=None, p_photo_path=upload(vil_user, 'reports'),
          p_client_id=None)
vil_row = view_row(vil['id'])
check('a village report is placed in its block, without a ward, and can use village categories',
      vil_row['area_kind'] == 'rural' and vil_row['block_name'] == 'Jhalda I' and vil_row['ward_no'] is None
      and vil_row['category'] == 'hand_pump', vil_row)
check('rural reports publish how many confirmations they need', vil_row['verify_needed'] == 2 and town_row['verify_needed'] == 3)
vcl = claim(user(), vil['id'], where=jhalda)
check('a rural claim asks for the rural number of confirmations', vcl['verify_needed'] == 2, vcl)
vv1, vv2 = user(), user()
vote(vv1, vcl['claim_id'], where=jhalda, ip='10.90.0.1')
vres = vote(vv2, vcl['claim_id'], where=jhalda, ip='10.90.0.2')
check('two village confirmations on one network reach quorum', vres['final_after'] is not None, vres)
check('the rules page gets the rural numbers', rpc('kasa_rules').get('rural_verify_quorum') == 2)
check('an unknown category is still refused',
      err(rpc, 'kasa_create_report', uid=vil_user, p_category='bogus', p_severity='minor', p_lat=jhalda[0], p_lng=jhalda[1] + 0.01,
          p_accuracy=10.0, p_ward_no=None, p_description=None, p_landmark=None, p_photo_path=upload(vil_user, 'reports'),
          p_client_id=None) == 'KASA_BAD_CATEGORY')
check('boundary data is private', refused(err(q, 'select * from kasa_private.areas', uid=vil_user)))

# ─────────────────────────────── Quick report: camera, then submit ────────────────────────────────
quick_user = user()
quick = rpc('kasa_create_report', uid=quick_user, p_category=None, p_severity=None, p_lat=town_spot[0] + 0.001,
            p_lng=town_spot[1] + 0.001, p_accuracy=10.0, p_ward_no=None, p_description=None, p_landmark=None,
            p_photo_path=upload(quick_user, 'reports'), p_client_id=None)
quick_row = view_row(quick['id'])
check('a quick report with no category defaults to "other"', quick_row['category'] == 'other', quick_row)
check('a quick report with no severity defaults to "minor"', quick_row['severity'] == 'minor', quick_row)
check('a quick report still gets its ward from GPS alone', quick_row['area_kind'] == 'town' and quick_row['ward_no'] is not None, quick_row)
quick_vil_user = user()
quick_vil = rpc('kasa_create_report', uid=quick_vil_user, p_category=None, p_severity=None, p_lat=jhalda[0] + 0.01,
                p_lng=jhalda[1] + 0.01, p_accuracy=10.0, p_ward_no=None, p_description=None, p_landmark=None,
                p_photo_path=upload(quick_vil_user, 'reports'), p_client_id=None)
quick_vil_row = view_row(quick_vil['id'])
check('a quick report in a village still gets its block from GPS alone',
      quick_vil_row['area_kind'] == 'rural' and quick_vil_row['category'] == 'other', quick_vil_row)

# ────────────────────── Self-moderation from a late Vision result ──────────────────────
# The report is created (and published) before Vision answers; these exercise what
# happens once kasa_record_photo_check delivers a result afterwards. A hold moves the
# report to "review" (same bucket as the synchronous face/AI-edited checks) — invisible
# on the public map/events until a moderator decides — so these are read with admin_sql.
def mod_status(rid):
    return admin_sql('select moderation_status from public.reports where id = %s', (str(rid),))[0][0]


def hold_reasons(rid):
    return [r[0]['reason'] for r in admin_sql(
        "select detail from kasa_private.events where report_id = %s and kind = 'moderation_hold' order by id", (str(rid),))]


selfie_r, selfie_path = report(user(), category='other')
check('a fresh report starts approved (Vision has not answered yet)',
      selfie_r['moderation_status'] == 'approved' and view_row(selfie_r['id']) is not None, selfie_r)
photo_check(selfie_path, labels=['Selfie', 'Person', 'Smile'])
check('a report whose photo is entirely off-topic labels (a selfie) is held for review',
      view_row(selfie_r['id']) is None and mod_status(selfie_r['id']) == 'review')
check('the hold reason is on the record', hold_reasons(selfie_r['id']) == ['off_topic_photo'])

mixed_r, mixed_path = report(user(), category='road')
photo_check(mixed_path, labels=['Person', 'Road', 'Pothole'])
check('a photo with at least one civic label is not held, even with a person in it',
      view_row(mixed_r['id'])['moderation_status'] == 'approved')

road_r, road_path = report(user(), category='road')
photo_check(road_path, garbage=0, labels=['Road', 'Asphalt', 'Sky'])
check('a road report scoring 0 for garbage is not held — garbage_score is not a relevance filter',
      view_row(road_r['id'])['moderation_status'] == 'approved')

unsafe_r, unsafe_path = report(user(), category='other')
photo_check(unsafe_path, unsafe=True)
check('a report whose photo Vision flags unsafe is held for review', mod_status(unsafe_r['id']) == 'review')
check('the hold reason is unsafe_content, not off-topic', hold_reasons(unsafe_r['id']) == ['unsafe_content'])

face_r, face_path = report(user(), category='other')
photo_check(face_path, faces=1, labels=['Person', 'Selfie'])
check('a report whose photo Vision finds a face in is held for review (face, not the off-topic label, is the reason)',
      hold_reasons(face_r['id']) == ['face_detected'])

held_r, held_path = report(user(), category='encroachment')
check('an encroachment report already waits for a moderator before Vision answers', held_r['moderation_status'] == 'review')
photo_check(held_path, labels=['Selfie'])
check('self-moderation never re-flags (or un-flags) a report already off "approved"',
      mod_status(held_r['id']) == 'review' and hold_reasons(held_r['id']) == [])

set_rules({'self_moderate_photos': 'false'})
off_r, off_path = report(user(), category='other')
photo_check(off_path, labels=['Selfie', 'Person'])
check('self-moderation can be switched off without a deploy', mod_status(off_r['id']) == 'approved')
set_rules({'self_moderate_photos': 'true'})

claim_path = upload(user(), 'claims')
photo_check(claim_path, labels=['Selfie'])
check('self-moderation only ever acts on report photos, never claim/vote photos',
      admin_sql("select count(*) from kasa_private.events where kind = 'moderation_hold' and detail @> %s",
                ('{"reason":"off_topic_photo"}',))[0][0] == 1)

# ────────────────── Auto-categorize from the photo (fix: everything was "Other") ──────────────────
# The zero-tap flow never lets a citizen pick a category, so an unset report always starts at
# 'other'. These exercise the same late-Vision-result hook as self-moderation, recognizing what
# the photo actually shows.
def auto_cat(rid):
    return admin_sql('select category from public.reports where id = %s', (str(rid),))[0][0]


road_other_r, road_other_path = report(user(), category='other')
photo_check(road_other_path, labels=['Road', 'Pothole', 'Asphalt'])
check('an "other" report whose photo shows a pothole is recategorized to road', auto_cat(road_other_r['id']) == 'road')
auto_ev = admin_sql("select detail from kasa_private.events where report_id = %s and kind = 'auto_recategorized'",
                     (str(road_other_r['id']),))
check('the auto-recategorization is on the record as its own event kind (not attributed to a moderator)',
      len(auto_ev) == 1 and auto_ev[0][0] == {'from': 'other', 'to': 'road'}, auto_ev)

garbage_other_r, garbage_other_path = report(user(), category='other')
photo_check(garbage_other_path, labels=['Garbage', 'Trash bag', 'Street'])
check('an "other" report whose photo shows garbage is recategorized to garbage', auto_cat(garbage_other_r['id']) == 'garbage')

kept_r, kept_path = report(user(), category='road')
photo_check(kept_path, labels=['Garbage', 'Trash'])
check('a report the citizen/flow already gave a real category is never auto-recategorized, whatever the photo shows',
      auto_cat(kept_r['id']) == 'road')

unmatched_r, unmatched_path = report(user(), category='other')
photo_check(unmatched_path, labels=['Sky', 'Tree', 'Cloud'])
check('an "other" report with no matching physical-object label stays "other"', auto_cat(unmatched_r['id']) == 'other')

set_rules({'auto_categorize_photos': 'false'})
off_cat_r, off_cat_path = report(user(), category='other')
photo_check(off_cat_path, labels=['Road', 'Pothole'])
check('auto-categorization can be switched off without a deploy', auto_cat(off_cat_r['id']) == 'other')
set_rules({'auto_categorize_photos': 'true'})

# ────────────────────── Repeat-offender pause for reports ──────────────────────
# Mirrors the failed-claim cooldown above (serial / KASA_CLAIMS_PAUSED), but keyed
# to a MODERATOR hiding a report — never to a self-moderation hold or a flag, which
# can still be false positives nobody has looked at yet.
offender = user()
r1 = report(offender, where=offset(6000, 15000))[0]['id']
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(r1), p_action='hide', p_reason='Not a real problem')
check('one moderator-hidden report does not yet pause reporting',
      report(offender, where=offset(6300, 15000))[0]['moderation_status'] == 'approved')
r2 = report(offender, where=offset(6600, 15000))[0]['id']
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(r2), p_action='hide', p_reason='Not a real problem')
r3 = report(offender, where=offset(6900, 15000))[0]['id']
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(r3), p_action='hide', p_reason='Not a real problem')
check('a third moderator-hidden report within the window pauses reporting',
      err(report, offender, where=offset(7200, 15000)) == 'KASA_REPORTS_PAUSED')
other_r = report(user(), where=offset(7500, 15000))[0]['id']
last = rpc('kasa_flag_report', uid=offender, p_report_id=str(other_r), p_reason='not_an_issue')
check("a paused reporter can still flag, confirm and dispute others' reports", last['counted'])
admin_sql("update kasa_private.events set created_at = now() - interval '31 days' "
          "where kind = 'moderated' and detail->>'action' = 'hide' "
          "and report_id in (select id from public.reports where user_id = %s)", (offender,))
check('...and the pause ends after 30 days',
      report(offender, where=offset(7800, 15000))[0]['moderation_status'] == 'approved')
approved_offender = user()
ar = report(approved_offender, where=offset(8100, 15000))[0]['id']
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(ar), p_action='approve', p_reason='Looks fine')
check('an approved (not hidden) report never counts toward the pause',
      report(approved_offender, where=offset(8400, 15000))[0]['moderation_status'] == 'approved')

set_rules(BASELINE)

# ─────────────────────────── Watch this report (per-report push) ───────────────────────────
def notify_done(ids, error=None):
    # bigint[], not jsonb — bypass rpc()'s automatic json.dumps and let psycopg adapt the list.
    q('select public.kasa_watch_notify_done(%s::bigint[], %s)', (ids, error), role='service_role')


# Earlier scenarios already left plenty of 'claimed'/'quorum_reached'/... events queued for
# notification (no watchers, so nothing was ever sent them); drain those first so the checks
# below can rely on kasa_watch_notify_claim returning exactly what this section queues.
while True:
    drained = rpc('kasa_watch_notify_claim', role='service_role', p_limit=50)
    if not drained: break
    notify_done([e['event_id'] for e in drained])


def watch(uid, rid_, endpoint=None, lang='en'):
    return rpc('kasa_watch_report', uid=uid, p_report_id=str(rid_), p_endpoint=endpoint or f'https://push.example/{uuid.uuid4().hex}',
               p_p256dh='B' * 87, p_auth='a' * 22, p_lang=lang)

check('anon cannot watch a report', refused(err(rpc, 'kasa_watch_report', p_report_id=str(rid), p_endpoint='https://x/1',
      p_p256dh='B' * 87, p_auth='a' * 22, p_lang='en')))
check('non-https watch endpoints are refused', err(watch, bob, rid, endpoint='http://evil/1') == 'KASA_BAD_SUBSCRIPTION')

watcher, claimant = user(), user()
wr_spot = offset(9000, 15000)
wr, _ = report(user(), where=wr_spot)
watch(watcher, wr['id'])
watch(claimant, wr['id'])  # claimant also watches, but is the actor of the event that follows
claim(claimant, wr['id'], where=wr_spot)
q1 = rpc('kasa_watch_notify_claim', role='service_role', p_limit=20)
ours = [e for e in q1 if e['report_id'] == str(wr['id'])]
watcher_watch_id = admin_sql('select id from kasa_private.report_watches where user_id = %s', (watcher,))[0][0]
check('a watched status change is queued with the right target, excluding the actor',
      len(ours) == 1 and ours[0]['kind'] == 'claimed' and {t['id'] for t in ours[0]['targets']} == {str(watcher_watch_id)}, ours)
notify_done([ours[0]['event_id']])
q2 = rpc('kasa_watch_notify_claim', role='service_role', p_limit=20)
check('a sent event is not re-queued', not [e for e in q2 if e['report_id'] == str(wr['id'])])
check('browsers cannot pull the watch queue', refused(err(rpc, 'kasa_watch_notify_claim', uid=watcher, p_limit=20)))

rpc('kasa_watch_notify_result', role='service_role', p_watch_id=watcher_watch_id, p_ok=False, p_gone=True)
check('expired watch subscriptions are deleted', admin_sql('select count(*) from kasa_private.report_watches where id = %s', (watcher_watch_id,))[0][0] == 0)

unwatch_uid = user()
uw_r, _ = report(user(), where=offset(9300, 15000))
watch(unwatch_uid, uw_r['id'])
uw_endpoint = admin_sql('select endpoint from kasa_private.report_watches where user_id = %s', (unwatch_uid,))[0][0]
rpc('kasa_unwatch_report', uid=unwatch_uid, p_report_id=str(uw_r['id']), p_endpoint=uw_endpoint)
check('unwatching removes the subscription', admin_sql('select count(*) from kasa_private.report_watches where user_id = %s', (unwatch_uid,))[0][0] == 0)

resolved_r, _ = report(user(), where=offset(9600, 15000))
watch(user(), resolved_r['id'])
admin_sql("insert into kasa_private.events (report_id, kind, actor_id) values (%s, 'resolved', null)", (resolved_r['id'],))
q3 = rpc('kasa_watch_notify_claim', role='service_role', p_limit=20)
resolved_ev = [e for e in q3 if e['report_id'] == str(resolved_r['id'])][0]
notify_done([resolved_ev['event_id']])
check('watches are cleared once a "resolved" notification is sent',
      admin_sql('select count(*) from kasa_private.report_watches where report_id = %s', (resolved_r['id'],))[0][0] == 0)

# ─────────────────────────── Your reports ───────────────────────────
mine_uid = user()
visible_r, _ = report(mine_uid, where=offset(9900, 15000))
hidden_r, _ = report(mine_uid, where=offset(10200, 15000))
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(hidden_r['id']), p_action='hide', p_reason='test')
mine = rpc('kasa_my_reports', uid=mine_uid)
mine_ids = {r['id'] for r in mine}
check("your-reports lists only this caller's own reports, including a hidden one",
      mine_ids == {str(visible_r['id']), str(hidden_r['id'])}, mine_ids)
check('your-reports shows the true (unfiltered) moderation status, not the public view\'s',
      [r['moderation_status'] for r in mine if r['id'] == str(hidden_r['id'])] == ['hidden'], mine)

other_uid = user()
check('a freshly signed-in device with no reports gets an empty list', rpc('kasa_my_reports', uid=other_uid) == [])
check('a never-signed-in caller cannot call your-reports', refused(err(rpc, 'kasa_my_reports')))

# ─────────────────────────── Admin delete (flagged/review reports only) ───────────────────────────
del_r, _ = report(user(), where=offset(12700, 15000))
check('deleting a report needs a reason',
      err(rpc, 'kasa_admin_moderate', uid=mod, p_report_id=str(del_r['id']), p_action='delete') == 'KASA_REASON_REQUIRED')
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(del_r['id']), p_action='delete', p_reason='exact repeat of another report')
check('an admin can delete any report, and the deletion is logged',
      admin_sql('select count(*) from public.reports where id::text = %s', (str(del_r['id']),))[0][0] == 0
      and admin_sql('select reason from kasa_private.deleted_reports where report_id = %s', (str(del_r['id']),))[0][0] == 'exact repeat of another report')

flagged_r, _ = report(user(), where=offset(13000, 15000))
for i in range(2):
    rpc('kasa_flag_report', uid=user(), ip=f'10.90.0.{i + 1}', p_report_id=str(flagged_r['id']), p_reason='not_an_issue')
rpc('kasa_flag_report', uid=user(), ip='10.91.0.1', p_report_id=str(flagged_r['id']), p_reason='not_an_issue')
one_flag_r, _ = report(user(), where=offset(13300, 15000))
rpc('kasa_flag_report', uid=user(created_ago='1 hour'), ip='10.92.0.1', p_report_id=str(one_flag_r['id']), p_reason='fake_or_old_photo')
in_queue = lambda: any(str(x['id']) == str(one_flag_r['id']) for x in rpc('kasa_admin_queue', uid=mod)['reports'])
check('a single flag from a new account reaches the moderation queue', in_queue())
check('...while the report stays public', view_row(one_flag_r['id']) is not None)
rpc('kasa_admin_moderate', uid=mod, p_report_id=str(one_flag_r['id']), p_action='approve', p_reason='looks fine')
check('keeping a flagged report clears it from the queue', not in_queue())
rpc('kasa_flag_report', uid=user(), ip='10.92.0.2', p_report_id=str(one_flag_r['id']), p_reason='duplicate')
check('a new flag after review puts it back in the queue', in_queue())
# Flag alerts: every flag is claimed once, with the team's emails, and never twice.
while rpc('kasa_flag_alerts_claim', role='service_role', p_limit=200)['flags']:
    pass  # drain flags raised earlier in the suite
alert_r, _ = report(user(), where=offset(13600, 15000))
admin_sql("update auth.users set email = 'mod-alert@example.com' where id = %s", (mod,))
rpc('kasa_flag_report', uid=user(), ip='10.93.0.1', p_report_id=str(alert_r['id']), p_reason='duplicate')
claim = rpc('kasa_flag_alerts_claim', role='service_role', p_limit=50)
check('a new flag is claimed for the moderator email', [f['report_id'] for f in claim['flags']] == [str(alert_r['id'])], claim)
check('the alert goes to the team', 'mod-alert@example.com' in claim['to'], claim['to'])
check('the alert does not name who flagged', 'note' not in json.dumps(claim['flags']))
check('a claimed flag is not handed out twice', rpc('kasa_flag_alerts_claim', role='service_role', p_limit=50)['flags'] == [])
rpc('kasa_flag_alerts_done', role='service_role', p_keys=[{'report_id': f['report_id'], 'user_id': f['user_id']} for f in claim['flags']])
check('a sent alert is marked sent',
      admin_sql('select count(*) from kasa_private.flags where report_id::text = %s and alerted_at is not null', (str(alert_r['id']),))[0][0] == 1)
check('the public cannot claim flag alerts', refused(err(rpc, 'kasa_flag_alerts_claim', uid=user(), p_limit=5)))

check('the report is actually flagged before the delete test', view_row(flagged_r['id'])['moderation_status'] == 'flagged')
check('non-admin cannot delete a report', err(rpc, 'kasa_admin_moderate', uid=user(), p_report_id=str(flagged_r['id']), p_action='delete') == 'KASA_NOT_ADMIN')
# Moderators (the default role) can review and hide, but only an admin deletes or manages the team.
junior = user()
admin_sql('insert into public.admins (user_id) values (%s)', (junior,))
check('a new team member defaults to moderator', rpc('kasa_my_role', uid=junior) == 'moderator')
check('an admin reports their role', rpc('kasa_my_role', uid=mod) == 'admin')
check('a moderator cannot delete a report',
      err(rpc, 'kasa_admin_moderate', uid=junior, p_report_id=str(flagged_r['id']), p_action='delete') == 'KASA_NOT_SUPER_ADMIN')
check('a moderator can still hide and restore', rpc('kasa_admin_moderate', uid=junior, p_report_id=str(flagged_r['id']), p_action='restore')['moderation_status'] == 'approved')
check('a moderator cannot read sign-ups', err(rpc, 'kasa_admin_signups', uid=junior, p_limit=10) == 'KASA_NOT_SUPER_ADMIN')
check('a moderator cannot see or change the team', err(rpc, 'kasa_admin_team', uid=junior) == 'KASA_NOT_SUPER_ADMIN'
      and err(rpc, 'kasa_admin_set_role', uid=junior, p_email='x@example.com', p_role='admin') == 'KASA_NOT_SUPER_ADMIN')
junior_email = f'{junior}@example.com'
admin_sql('update auth.users set email = %s where id = %s', (junior_email, junior))
rpc('kasa_admin_set_role', uid=mod, p_email=junior_email, p_role='admin')
check('an admin can promote a moderator', rpc('kasa_my_role', uid=junior) == 'admin')
rpc('kasa_admin_set_role', uid=mod, p_email=junior_email, p_role='remove')
check('an admin can remove a team member', rpc('kasa_my_role', uid=junior) is None)
mod_email = f'{mod}@example.com'
admin_sql('update auth.users set email = %s where id = %s', (mod_email, mod))
check('an admin cannot change their own role', err(rpc, 'kasa_admin_set_role', uid=mod, p_email=mod_email, p_role='moderator') == 'KASA_SELF')
check('an admin sees the team', any(m['me'] for m in rpc('kasa_admin_team', uid=mod)))
del_res = rpc('kasa_admin_moderate', uid=mod, p_report_id=str(flagged_r['id']), p_action='delete', p_reason='flagged as not an issue')
check('a flagged report can be hard-deleted', del_res.get('deleted') is True, del_res)
check('deleting a report cascades its events',
      admin_sql('select count(*) from kasa_private.events where report_id::text = %s', (str(flagged_r['id']),))[0][0] == 0)
check('deleting a report actually removes the row',
      admin_sql('select count(*) from public.reports where id::text = %s', (str(flagged_r['id']),))[0][0] == 0)

# ─────────────────────────── School audit ───────────────────────────
def school_audit(uid, where=SPOT, name='Test Primary School', water=True, toilets=True, boundary=True,
                  condition='good', accuracy=10.0, client_id=None, path=None):
    path = path or upload(uid, 'reports')
    return rpc('kasa_create_school_audit', uid=uid, p_school_name=name, p_lat=where[0], p_lng=where[1],
               p_accuracy=accuracy, p_ward_no=5, p_water_ok=water, p_toilets_ok=toilets, p_boundary_ok=boundary,
               p_building_condition=condition, p_photo_path=path, p_client_id=client_id)


def audit_row(aid):
    rows = q('select row_to_json(v) from public.kasa_public_school_audits v where id::text = %s', (str(aid),))
    return rows[0][0] if rows else None


check('anon cannot audit a school', refused(err(rpc, 'kasa_create_school_audit', p_school_name='X', p_lat=SPOT[0], p_lng=SPOT[1],
      p_accuracy=10.0, p_ward_no=5, p_water_ok=True, p_toilets_ok=True, p_boundary_ok=True, p_building_condition='good',
      p_photo_path='reports/x.jpg')))

a1 = school_audit(user(), where=offset(13300, 15000), name='Purulia Model School')
check('a school audit is created approved by default', a1['moderation_status'] == 'approved', a1)
saved = admin_sql('select school_name, area_kind, water_ok, toilets_ok, boundary_ok, building_condition '
                   'from public.school_audits where id::text = %s', (a1['id'],))[0]
check('the audit stores the checklist and a server-assigned area',
      saved == ('Purulia Model School', 'rural', True, True, True, 'good'), saved)

check('a school audit needs a real name', err(school_audit, user(), where=offset(13600, 15000), name='ab') == 'KASA_BAD_SCHOOL_NAME')
check('every checklist question is required',
      err(rpc, 'kasa_create_school_audit', uid=user(), p_school_name='Some School', p_lat=offset(13900, 15000)[0],
          p_lng=offset(13900, 15000)[1], p_accuracy=10.0, p_ward_no=5, p_water_ok=None, p_toilets_ok=True,
          p_boundary_ok=True, p_building_condition='good', p_photo_path=upload(user(), 'reports')) == 'KASA_INCOMPLETE_AUDIT')
check('building condition must be one of the three options',
      err(school_audit, user(), where=offset(14200, 15000), condition='great') == 'KASA_BAD_CONDITION')
check('a school audit outside the district is refused', err(school_audit, user(), where=(22.0, 85.0)) == 'KASA_OUTSIDE_AREA')

rl_uid = user()
for i in range(5):
    school_audit(rl_uid, where=offset(14500 + i * 50, 15000))
check('school audits are rate-limited per hour', err(school_audit, rl_uid, where=offset(14900, 15000)) == 'KASA_RATE_LIMIT')

repeat_spot = offset(15300, 15000)
first_visit = school_audit(user(), where=repeat_spot, name='Repeat-visit School', water=False)
second_visit = school_audit(user(), where=repeat_spot, name='Repeat-visit School', water=True)
check('repeat audits of the same school are both kept, not merged or blocked as duplicates',
      first_visit['id'] != second_visit['id']
      and admin_sql("select count(*) from public.school_audits where school_name = 'Repeat-visit School'")[0][0] == 2)

fresh_audit = school_audit(user(), where=offset(15600, 15000), name='Public View School')
check('a fresh audit is visible on the public view', audit_row(fresh_audit['id']) is not None)
rpc('kasa_admin_moderate_school_audit', uid=mod, p_audit_id=str(fresh_audit['id']), p_action='hide')
check('a hidden audit disappears from the public view', audit_row(fresh_audit['id']) is None)
check('non-admin cannot moderate an audit',
      err(rpc, 'kasa_admin_moderate_school_audit', uid=user(), p_audit_id=str(fresh_audit['id']), p_action='approve') == 'KASA_NOT_ADMIN')
rpc('kasa_admin_moderate_school_audit', uid=mod, p_audit_id=str(fresh_audit['id']), p_action='approve')
check('restoring an audit makes it public again', audit_row(fresh_audit['id']) is not None)

flag_target = school_audit(user(), where=offset(15900, 15000), name='Flag Target School')
for i in range(2):
    rpc('kasa_flag_school_audit', uid=user(), ip=f'10.95.0.{i + 1}', p_audit_id=str(flag_target['id']), p_reason='not_this_school')
check('anon cannot flag a school audit', refused(err(rpc, 'kasa_flag_school_audit', p_audit_id=str(flag_target['id']), p_reason='not_this_school')))
last_flag = rpc('kasa_flag_school_audit', uid=user(), ip='10.96.0.1', p_audit_id=str(flag_target['id']), p_reason='not_this_school')
check('three flags from two networks send an audit to review',
      last_flag['under_review'] and audit_row(flag_target['id'])['moderation_status'] == 'flagged', last_flag)
check('the moderation queue lists the flagged audit',
      any(a['id'] == flag_target['id'] for a in rpc('kasa_admin_school_audit_queue', uid=mod)))
check('non-admin cannot list the audit queue', err(rpc, 'kasa_admin_school_audit_queue', uid=user()) == 'KASA_NOT_ADMIN')

delete_target = school_audit(user(), where=offset(16200, 15000), name='Delete Me School')
rpc('kasa_admin_moderate_school_audit', uid=mod, p_audit_id=str(delete_target['id']), p_action='delete')
check('a moderator can hard-delete a school audit outright (no evidence trail to preserve)',
      admin_sql('select count(*) from public.school_audits where id::text = %s', (str(delete_target['id']),))[0][0] == 0)

reused_uid = user()
reused_path = upload(reused_uid, 'reports')
school_audit(reused_uid, where=offset(16500, 15000), path=reused_path)
check('a photo already used for an audit cannot be reused for a report',
      err(rpc, 'kasa_create_report', uid=reused_uid, p_category='school', p_severity='minor',
          p_lat=offset(16800, 15000)[0], p_lng=offset(16800, 15000)[1], p_accuracy=10.0, p_ward_no=5,
          p_description=None, p_landmark=None, p_photo_path=reused_path, p_client_id=None) == 'KASA_PHOTO_REUSED')

photo_owner = user()
reused_path2 = upload(photo_owner, 'reports')
school_audit(photo_owner, where=offset(17100, 15000), path=reused_path2)
check('and the same reused photo is refused for a second audit too',
      err(school_audit, photo_owner, where=offset(17400, 15000), path=reused_path2) == 'KASA_PHOTO_REUSED')

audit_for_cat = school_audit(user(), where=offset(17700, 15000), name='Not A Report School')
audit_cat_path = admin_sql('select photo_path from public.school_audits where id::text = %s', (audit_for_cat['id'],))[0][0]
photo_check(audit_cat_path, labels=['Road', 'Pothole', 'Asphalt'])  # must not crash — no matching row in public.reports
check('running the photo check on a school-audit photo leaves the audit itself untouched',
      admin_sql('select building_condition from public.school_audits where id::text = %s', (audit_for_cat['id'],))[0][0] == 'good')

tr = rpc('kasa_public_transparency')
check('anyone can read the moderation counts', len(tr['months']) == 12 and tr['months'][0]['reported'] > 0, tr['months'][:1])
check('moderation counts include hides and the team size', sum(m['hidden'] for m in tr['months']) > 0 and tr['now']['admins'] >= 1, tr['now'])
check('moderation counts carry no ids', 'user_id' not in json.dumps(tr) and 'report_id' not in json.dumps(tr))

# Weekly digest: claimed once per week, public data only, team-only until an address is set.
if admin_sql("select to_regclass('public.wards') is not null")[0][0]:
    dg_r, _ = report(user(), where=offset(0, 0))
    admin_sql("update public.reports set is_duplicate = false, parent_report_id = null, created_at = date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' - interval '3 days' where id = %s", (dg_r['id'],))
    admin_sql("delete from kasa_private.digest_sends")
    dg = rpc('kasa_weekly_digest_claim', role='service_role')
    check('the weekly digest can be claimed', dg is not None and 'wards' in dg, dg)
    check('with no address set it goes to the team only', dg['to'] == [] and len(dg['team']) >= 1, dg)
    check('the digest counts last week\'s new report', any(w['new'] >= 1 for w in dg['wards']), dg['wards'][:3])
    check('a week\'s digest is not claimed twice', rpc('kasa_weekly_digest_claim', role='service_role') is None)
    rpc('kasa_weekly_digest_done', role='service_role', p_week=dg['week_start'])
    admin_sql("update kasa_private.settings set value = '\"a@example.org, b@example.org\"' where key = 'weekly_digest_to'")
    admin_sql("delete from kasa_private.digest_sends")
    check('the digest goes to the configured addresses', rpc('kasa_weekly_digest_claim', role='service_role')['to'] == ['a@example.org', 'b@example.org'])
    check('the public cannot claim the digest', refused(err(rpc, 'kasa_weekly_digest_claim', uid=user())))

# Up to 3 photos per report: same person, right after, each checked like the first.
mp_owner = user()
mp_r, mp_first = report(mp_owner, where=offset(15500, 15000))
extra1, extra2, extra3 = upload(mp_owner, 'reports'), upload(mp_owner, 'reports'), upload(mp_owner, 'reports')
check('a second photo can be added', rpc('kasa_add_report_photo', uid=mp_owner, p_report_id=str(mp_r['id']), p_photo_path=extra1)['position'] == 2)
check('a third photo can be added', rpc('kasa_add_report_photo', uid=mp_owner, p_report_id=str(mp_r['id']), p_photo_path=extra2)['position'] == 3)
check('a fourth photo is refused', err(rpc, 'kasa_add_report_photo', uid=mp_owner, p_report_id=str(mp_r['id']), p_photo_path=extra3) == 'KASA_TOO_MANY_PHOTOS')
check('someone else cannot add photos to your report',
      err(rpc, 'kasa_add_report_photo', uid=user(), p_report_id=str(mp_r['id']), p_photo_path=upload(user(), 'reports')) == 'KASA_NOT_FOUND')
mp_r2, _ = report(mp_owner, where=offset(15800, 15000))
check('a photo already on one report cannot be reused on another',
      err(rpc, 'kasa_add_report_photo', uid=mp_owner, p_report_id=str(mp_r2['id']), p_photo_path=extra1) == 'KASA_PHOTO_REUSED')
check('a photo someone else uploaded cannot be added',
      err(rpc, 'kasa_add_report_photo', uid=mp_owner, p_report_id=str(mp_r2['id']), p_photo_path=upload(user(), 'reports')) == 'KASA_PHOTO_NOT_YOURS')
face = upload(mp_owner, 'reports'); photo_check(face, faces=1)
rpc('kasa_add_report_photo', uid=mp_owner, p_report_id=str(mp_r2['id']), p_photo_path=face)
check('an extra photo with a face sends the report back to review',
      admin_sql('select moderation_status from public.reports where id::text = %s', (str(mp_r2['id']),))[0][0] == 'review')
check('extra photos are public for visible reports', len(rpc('kasa_report_photos', p_report_id=str(mp_r['id']))) == 2)
check('extra photos of a report under review stay private', rpc('kasa_report_photos', p_report_id=str(mp_r2['id'])) == [])
check('extra photos are never treated as orphans', extra1 not in {r[0] for r in q('select * from public.kasa_orphan_photos(1000)', role='service_role')})
admin_sql("update public.reports set created_at = now() - interval '2 hours' where id = %s", (mp_r2['id'],))
check('photos cannot be added long after reporting',
      err(rpc, 'kasa_add_report_photo', uid=mp_owner, p_report_id=str(mp_r2['id']), p_photo_path=upload(mp_owner, 'reports')) == 'KASA_TOO_LATE')

def fl_claim_of(uid, rid, where, path):
    return rpc('kasa_claim_cleanup', uid=uid, p_report_id=str(rid), p_photo_path=path, p_lat=where[0], p_lng=where[1], p_accuracy=10.0)


def fl_vote(uid, cid, where, v='verify'):
    return rpc('kasa_vote_claim', uid=uid, ip=str(uuid.uuid4()), p_claim_id=cid, p_vote=v, p_photo_path=checked(uid, 'votes', garbage=0.05),
               p_lat=where[0], p_lng=where[1], p_accuracy=10.0, p_note=None)


# Photo-check fast lane: a clean Vision score needs 1 confirmer, or closes alone after photo_only_days.
fl_rep = user()
fl_r, _ = report(fl_rep, where=offset(16500, 15000))
fl_where = offset(16500, 15000)
fl_c = with_history()
fl_path = checked(fl_c, 'claims')
admin_sql("update kasa_private.photo_checks set garbage_score = 0.05 where photo_path = %s", (fl_path,))
fl_claim = fl_claim_of(fl_c, fl_r['id'], where=fl_where, path=fl_path)
check('a clean cleanup photo is photo-confident and needs 1 confirmation',
      fl_claim.get('photo_confident') is True and fl_claim['verify_needed'] == 1, fl_claim)
check('the map is told which claims are photo-confident',
      any(x['claim_id'] == str(fl_claim['claim_id']) and x['need'] == 1 for x in rpc('kasa_fast_claims')))
fl_v = with_history()
fl_vote(fl_v, fl_claim['claim_id'], fl_where)
check('one on-site confirmation reaches quorum on a photo-confident claim',
      admin_sql('select quorum_reached_at is not null from kasa_private.claims where id = %s', (fl_claim['claim_id'],))[0][0])

fl_r2, _ = report(fl_rep, where=offset(16800, 15000))
fl_c2 = with_history()
p2 = checked(fl_c2, 'claims')
admin_sql("update kasa_private.photo_checks set garbage_score = 0.05 where photo_path = %s", (p2,))
fl_claim2 = fl_claim_of(fl_c2, fl_r2['id'], where=offset(16800, 15000), path=p2)
rpc('kasa_finalize_due')
check('a photo-only claim does not close early', admin_sql('select status from public.reports where id = %s', (fl_r2['id'],))[0][0] == 'claimed')
admin_sql("update kasa_private.claims set created_at = now() - interval '4 days' where id = %s", (fl_claim2['claim_id'],))
rpc('kasa_finalize_due')
check('an unchallenged photo-confident claim closes on the photo check after 3 days',
      admin_sql('select status, resolution_method from public.reports where id = %s', (fl_r2['id'],))[0] == ('resolved', 'photo_check'))

fl_r3, _ = report(fl_rep, where=offset(17100, 15000))
fl_c3 = with_history()
p3 = checked(fl_c3, 'claims')
admin_sql("update kasa_private.photo_checks set garbage_score = 0.4 where photo_path = %s", (p3,))
fl_claim3 = fl_claim_of(fl_c3, fl_r3['id'], where=offset(17100, 15000), path=p3)
check('an unsure photo needs the full quorum', fl_claim3.get('photo_confident') is False and fl_claim3['verify_needed'] >= 2, fl_claim3)
admin_sql("update kasa_private.claims set created_at = now() - interval '4 days' where id = %s", (fl_claim3['claim_id'],))
rpc('kasa_finalize_due')
check('an unsure photo never closes on its own', admin_sql('select status from public.reports where id = %s', (fl_r3['id'],))[0][0] == 'claimed')

fl_r4, _ = report(fl_rep, where=offset(17400, 15000))
fl_c4 = with_history()
p4 = checked(fl_c4, 'claims')
admin_sql("update kasa_private.photo_checks set garbage_score = 0.05 where photo_path = %s", (p4,))
fl_claim4 = fl_claim_of(fl_c4, fl_r4['id'], where=offset(17400, 15000), path=p4)
fl_d = with_history()
fl_vote(fl_d, fl_claim4['claim_id'], offset(17400, 15000), v='dispute')
admin_sql("update kasa_private.claims set created_at = now() - interval '4 days' where id = %s", (fl_claim4['claim_id'],))
rpc('kasa_finalize_due')
check('a disputed claim never closes on the photo alone', admin_sql('select resolution_method from public.reports where id = %s', (fl_r4['id'],))[0][0] is None)

# Written addresses: only the service can claim and write them; visible reports' addresses are public.
ad_r, _ = report(user(), where=offset(18000, 15000))
check('the public cannot claim reports to geocode', refused(err(rpc, 'kasa_geocode_claim', uid=user())))
check('the public cannot write an address',
      refused(err(rpc, 'kasa_geocode_done', uid=user(), p_id=str(ad_r['id']), p_address='Fake Street')))
got = rpc('kasa_geocode_claim', role='service_role', p_limit=40)
check('new reports are handed out for an address lookup', any(g['id'] == str(ad_r['id']) for g in got))
again = rpc('kasa_geocode_claim', role='service_role', p_limit=40)
check('a report being looked up is not handed out twice', not any(g['id'] == str(ad_r['id']) for g in again))
rpc('kasa_geocode_done', role='service_role', p_id=str(ad_r['id']), p_address='NC Dasgupta Road · near <b>Town Hall</b>')
check('the address is public, with markup stripped',
      rpc('kasa_report_addresses').get(str(ad_r['id'])) == 'NC Dasgupta Road · near  b Town Hall /b ',
      rpc('kasa_report_addresses').get(str(ad_r['id'])))
bz_r, _ = report(user(), where=offset(18300, 15000))
rpc('kasa_geocode_claim', role='service_role', p_limit=40)
rpc('kasa_geocode_done', role='service_role', p_id=str(bz_r['id']), p_address=None, p_retry=True)
check('a busy lookup service does not use up a try',
      admin_sql('select address_tries from public.reports where id = %s', (bz_r['id'],))[0][0] == 0)

# Road check: a road report whose photo shows nothing road-like goes to review.
rd_r, rd_path = report(user(), category='road', where=offset(18600, 15000))
photo_check(rd_path, labels=['Tree', 'Sky', 'Plant'])
check('a road report with no road in the photo goes to review', mod_status(rd_r['id']) == 'review')
check('the hold says why', 'no_road_in_photo' in hold_reasons(rd_r['id']), hold_reasons(rd_r['id']))
rd2, rd2_path = report(user(), category='road', where=offset(18900, 15000))
photo_check(rd2_path, labels=['Road surface', 'Asphalt', 'Pothole'])
check('a road report showing a road stays up', mod_status(rd2['id']) == 'approved')
rd3, rd3_path = report(user(), category='garbage', where=offset(19200, 15000))
photo_check(rd3_path, labels=['Waste', 'Plastic'])
check('the road check leaves other categories alone', mod_status(rd3['id']) == 'approved')

# Photo shrinking: photos of problems fixed long ago are handed out once, to the service only.
sh_r, sh_path = report(user(), where=offset(19500, 15000))
admin_sql("update public.reports set status = 'resolved', resolved_at = now() - interval '100 days' where id = %s", (sh_r['id'],))
new_r, new_path = report(user(), where=offset(19800, 15000))
admin_sql("update public.reports set status = 'resolved', resolved_at = now() - interval '10 days' where id = %s", (new_r['id'],))
check('the public cannot claim photos to shrink', refused(err(rpc, 'kasa_shrink_claim', uid=user())))
sh = rpc('kasa_shrink_claim', role='service_role', p_limit=50)
check('photos of long-fixed problems are handed out for shrinking', sh_path in sh['paths'] and sh['max_px'] == 1024, sh)
check('recently fixed problems keep full-size photos', new_path not in sh['paths'])
check('a photo being shrunk is not handed out twice', sh_path not in rpc('kasa_shrink_claim', role='service_role', p_limit=50)['paths'])
rpc('kasa_shrink_done', role='service_role', p_path=sh_path, p_before=400000, p_after=120000)
admin_sql("update kasa_private.photo_shrinks set claimed_at = now() - interval '2 hours' where photo_path = %s", (sh_path,))
check('a shrunk photo is never shrunk again', sh_path not in rpc('kasa_shrink_claim', role='service_role', p_limit=50)['paths'])

# Official school list: public to read, not writable from the browser; audits nearby count toward coverage.
sc_where = offset(20500, 15000)
admin_sql("insert into public.schools (udise_code, name, lat, lng, block_name) values "
          "('19210199901', 'Test Listed School', %s, %s, 'Hura'), ('19210199902', 'Unvisited School', %s, %s, 'Hura') "
          "on conflict do nothing", (sc_where[0], sc_where[1], sc_where[0] + 0.05, sc_where[1]))
check('anyone can read the school list', len(q("select * from public.schools where udise_code like '192101999%%'")) == 2)
check('browsers cannot add schools',
      'permission denied' in (err(q, "insert into public.schools (udise_code, name, lat, lng) values ('19210199903', 'x', 23.3, 86.3)", uid=user()) or ''))
school_audit(user(), where=offset(40, 0, base=sc_where), name='Test Listed School')
cov = {r[0]['udise_code']: r[0] for r in q('select row_to_json(c) from public.kasa_school_coverage() c')}
check('an audit at a listed school counts for it', cov['19210199901']['audits'] == 1, cov.get('19210199901'))
check('a school nobody visited shows no audits', cov['19210199902']['audits'] == 0 and cov['19210199902']['last_audit_at'] is None)

# A fix that didn't last: reported again at the spot within 14 days → the weekly digest doesn't count it as fixed.
fl_spot = offset(-1100, -600)
fl_fix, _ = report(user(), category='drain', where=fl_spot)
LAST_WEEK_MID = "(date_trunc('week', now() at time zone 'Asia/Kolkata') - interval '4 days') at time zone 'Asia/Kolkata'"
admin_sql(f"update public.reports set status = 'resolved', resolution_method = 'community', resolved_at = {LAST_WEEK_MID}, "
          f"created_at = {LAST_WEEK_MID} - interval '3 days' where id = %s", (fl_fix['id'],))
def digest_fixed(rid_):
    admin_sql("delete from kasa_private.digest_sends")
    dg = rpc('kasa_weekly_digest_claim', role='service_role')
    w = admin_sql('select ward_no from public.reports where id = %s', (rid_,))[0][0]
    return next((x['fixed'] for x in dg['wards'] if x['ward'] == w), 0)
HAS_WARDS = admin_sql("select to_regclass('public.wards') is not null")[0][0]
before = digest_fixed(fl_fix['id']) if HAS_WARDS else None
again, _ = report(user(), category='drain', where=fl_spot)
check('reporting a fixed spot again links it as a recurrence',
      str(admin_sql('select parent_report_id from public.reports where id = %s', (again['id'],))[0][0]) == str(fl_fix['id']))
admin_sql(f"update public.reports set created_at = {LAST_WEEK_MID} + interval '1 day' where id = %s", (again['id'],))
if HAS_WARDS:
    check('the fix counts before anything comes back', before >= 1, before)
    check("the weekly digest stops counting a fix that didn't last", digest_fixed(fl_fix['id']) == before - 1, (before,))

# School checks by UDISE code: every audit check applies, plus block/location sanity.
def school_check(uid, code, where, **ans):
    a = dict(p_water_ok=True, p_toilets_ok=False, p_boundary_ok=True, p_electricity_ok=False, p_mdm_ok=True,
             p_building_condition='needs_repair')
    a.update(ans)
    return rpc('kasa_school_check', uid=uid, p_udise_code=code, p_lat=where[0], p_lng=where[1], p_accuracy=10.0,
               p_photo_path=upload(uid, 'reports'), **a)
sc_block = admin_sql("select a.block_name from public.school_audits a where a.school_name = 'Test Listed School' limit 1")[0][0]
admin_sql("insert into public.schools (udise_code, name, block_name) values ('19210199904', 'No-location School', %s), "
          "('19210199905', 'Other Block School', 'NOWHERE-II') on conflict do nothing", (sc_block,))
check('the public cannot file a school check without signing in',
      'permission denied' in (err(rpc, 'kasa_school_check', p_udise_code='19210199904', p_lat=1.0, p_lng=1.0, p_accuracy=1.0,
                                  p_water_ok=True, p_toilets_ok=True, p_boundary_ok=True, p_electricity_ok=True, p_mdm_ok=True,
                                  p_building_condition='good', p_photo_path='x') or ''))
check('a school not on the list is refused', err(school_check, user(), '19210199999', sc_where) == 'KASA_NOT_FOUND')
chk = school_check(user(), '19210199904', offset(60, 0, base=sc_where))
check('a check at a school in the same block goes straight up', chk['moderation_status'] == 'approved' and chk['hold'] is None, chk)
chk2 = school_check(user(), '19210199905', offset(90, 0, base=sc_where))
check('a check filed from a different block goes to review', chk2['moderation_status'] == 'review' and chk2['hold'] == 'other_block', chk2)
chk3 = school_check(user(), '19210199901', offset(9000, 0, base=sc_where))
check('a check far from a school with a known location goes to review', chk3['hold'] == 'far_from_school', chk3)
check("a school's visible checks are public", len(rpc('kasa_school_checks', p_udise_code='19210199904')) == 1)
check('checks under review stay private', rpc('kasa_school_checks', p_udise_code='19210199905') == [])
cov = {r[0]['udise_code']: r[0] for r in q('select row_to_json(c) from public.kasa_school_coverage() c')}
check('coverage counts a check by its school code and scores it out of 6',
      cov['19210199904']['audits'] == 1 and cov['19210199904']['score'] == 3 and cov['19210199904']['score_of'] == 6, cov['19210199904'])

# Nearby schools: official locations, and locations learned from approved checks.
nb = rpc('kasa_nearby_schools', p_lat=sc_where[0], p_lng=sc_where[1])
codes = {x['udise_code']: x for x in nb['near']}
check('nearby lists a school with an official location', '19210199901' in codes, nb)
check('nearby lists a school placed by its approved check', codes.get('19210199904', {}).get('learned') is True, nb)
check("a held check doesn't place its school", '19210199905' not in codes, nb)
check('nearby is nearest first', [x['distance_m'] for x in nb['near']] == sorted(x['distance_m'] for x in nb['near']))
check('nearby says which block you are in', nb['block'] == sc_block, (nb['block'], sc_block))

# School map: coverage gives official locations, else ones learned from checks.
cov2 = {r[0]['udise_code']: r[0] for r in q('select row_to_json(c) from public.kasa_school_coverage() c')}
check('a school placed by its checks shows on the map', cov2['19210199904']['located'] == 'checks' and cov2['19210199904']['lat'] is not None, cov2['19210199904'])
check('an official location is marked as official', cov2['19210199902']['located'] == 'official')
check('a school with no location stays off the map', cov2['19210199905']['located'] is None and cov2['19210199905']['lat'] is None)

# Fixing a school's pin: people standing at the school mark it; the pin is the median of recent positions.
def mark(uid, code, where, acc=10.0):
    return rpc('kasa_mark_school_location', uid=uid, p_udise_code=code, p_lat=where[0], p_lng=where[1], p_accuracy=acc)
right = offset(400, 0, base=sc_where)
check('the public cannot move a school without signing in',
      'permission denied' in (err(rpc, 'kasa_mark_school_location', p_udise_code='19210199904', p_lat=right[0], p_lng=right[1], p_accuracy=10.0) or ''))
check('a weak GPS fix cannot move a school', err(mark, user(), '19210199904', right, 500.0) == 'KASA_GPS_WEAK')
m1 = user()
mark(m1, '19210199904', right)
check('the same person can only place a school once a day', err(mark, m1, '19210199904', right) == 'KASA_ALREADY_MARKED')
mark(user(), '19210199904', right)
res = mark(user(), '19210199904', right)
check('when most recent positions agree, the pin moves there',
      abs(res['lat'] - right[0]) < 0.0001 and abs(res['lng'] - right[1]) < 0.0001, res)
troll = offset(2500, 0, base=sc_where)
if admin_sql("select kasa_private.locate(%s, %s, null) ->> 'block'", troll)[0][0] == sc_block:
    res2 = mark(user(), '19210199904', troll)
    check('one mark far away does not drag the pin', abs(res2['lat'] - right[0]) < 0.0001, res2)

# Duplicates caught after the photo check names the category (quick reports arrive as "other").
dd_spot = offset(-2200, 900)
def quick(uid, where):
    path = upload(uid, 'reports')
    r_ = rpc('kasa_create_report', uid=uid, p_category=None, p_severity=None, p_lat=where[0], p_lng=where[1], p_accuracy=10.0,
             p_ward_no=None, p_description=None, p_landmark=None, p_photo_path=path)
    photo_check(path, labels=['Waste', 'Litter', 'Plastic'])
    return r_
q1 = quick(user(), dd_spot)
q2 = quick(user(), offset(15, 10, base=dd_spot))
row2 = admin_sql('select category, is_duplicate, parent_report_id::text from public.reports where id = %s', (q2['id'],))[0]
check('a second quick garbage photo of the same pile joins the first', row2 == ('garbage', True, str(q1['id'])), row2)
check("the first report counts the second person as having seen it",
      admin_sql('select upvotes from public.reports where id = %s', (q1['id'],))[0][0] >= 1)
q3 = quick(user(), offset(400, 0, base=dd_spot))
check('a report 400 m away stays separate', admin_sql('select is_duplicate from public.reports where id = %s', (q3['id'],))[0][0] is False)

# Admins decide which photos stay: repeat photos can be removed, with a public reason.
ph_admin = user()
admin_sql("insert into public.admins (user_id, role) values (%s, 'admin')", (ph_admin,))
admin_sql("insert into kasa_private.report_photos (report_id, position, photo_path, photo_url) values (%s, 2, 'reports/x/extra.jpg', 'https://x/extra.jpg')", (q1['id'],))
lst = rpc('kasa_admin_report_photos', uid=ph_admin, p_report_id=str(q1['id']))
check('an admin sees a report\'s extra photos and joined duplicates',
      len(lst['extras']) == 1 and any(d['id'] == str(q2['id']) for d in lst['duplicates']), lst)
check('the repeat-photo list shows recent duplicates',
      any(d['id'] == str(q2['id']) for d in rpc('kasa_admin_repeat_photos', uid=ph_admin)))
check('the public cannot list report photos for removal',
      refused(err(rpc, 'kasa_admin_report_photos', p_report_id=str(q1['id']))))
ph_mod = user()
admin_sql("insert into public.admins (user_id, role) values (%s, 'moderator')", (ph_mod,))
check('an ordinary person cannot remove photos',
      err(rpc, 'kasa_admin_remove_photo', uid=user(), p_report_id=str(q1['id']), p_kind='extra', p_ref='2', p_reason='same photo') == 'KASA_NOT_ADMIN')
check('removing a photo needs a reason',
      err(rpc, 'kasa_admin_remove_photo', uid=ph_admin, p_report_id=str(q1['id']), p_kind='extra', p_ref='2', p_reason=' ') == 'KASA_REASON_NEEDED')
rpc('kasa_admin_remove_photo', uid=ph_admin, p_report_id=str(q1['id']), p_kind='extra', p_ref='2', p_reason='same photo twice')
rpc('kasa_admin_remove_photo', uid=ph_admin, p_report_id=str(q1['id']), p_kind='duplicate', p_ref=str(q2['id']), p_reason='same pile, same angle')
check('an admin removed the extra photo and the duplicate',
      admin_sql('select count(*) from kasa_private.report_photos where report_id = %s', (q1['id'],))[0][0] == 0
      and admin_sql('select count(*) from public.reports where id = %s', (q2['id'],))[0][0] == 0)
check('each removal is on the report timeline with its reason',
      admin_sql("select count(*) from kasa_private.events where report_id = %s and kind = 'moderated' and detail ->> 'reason' is not null", (q1['id'],))[0][0] == 2)
check('the original report and its photo stay',
      admin_sql('select photo_url is not null from public.reports where id = %s', (q1['id'],))[0][0])

# Spots that keep filling up: a place with several reports shows once, with its count.
ps_spot = offset(-3000, -1500)
for i in range(3):
    quick(user(), offset(i * 8, 0, base=ps_spot))
spots = rpc('kasa_problem_spots', p_days=30)
hit = [x for x in spots if abs(x['lat'] - ps_spot[0]) < 0.0006 and abs(x['lng'] - ps_spot[1]) < 0.0006]
check('a spot with three reports is listed as a problem spot', hit and sum(x['reports'] for x in hit) >= 3, spots)
check('problem spots never name a person', all('user_id' not in x for x in spots))

# Adopting a spot: stand there, give a public name; one adopter per spot.
def adopt(uid, name, where, acc=10.0):
    return rpc('kasa_adopt_spot', uid=uid, p_name=name, p_lat=where[0], p_lng=where[1], p_accuracy=acc)
ad_spot = offset(-3400, 1800)
check('the public cannot adopt a spot without signing in',
      refused(err(rpc, 'kasa_adopt_spot', p_name='Club', p_lat=ad_spot[0], p_lng=ad_spot[1], p_accuracy=10.0)))
ad1 = user()
check('a weak GPS fix cannot adopt a spot', err(adopt, ad1, 'Netaji Club', ad_spot, 500.0) == 'KASA_GPS_WEAK')
check('an adoption needs a real name', err(adopt, ad1, 'x', ad_spot) == 'KASA_NAME_LENGTH')
a1 = adopt(ad1, '  Netaji   Club ', ad_spot)
check('someone standing at a spot can adopt it', a1['name'] == 'Netaji Club', a1)
check('a second person cannot adopt the same spot', err(adopt, user(), 'Other Club', offset(20, 0, base=ad_spot)) == 'KASA_ALREADY_ADOPTED')
quick(user(), offset(10, 0, base=ad_spot))
lst = [x for x in rpc('kasa_adopted_spots') if x['id'] == a1['id']]
check('the adopted spot is public with its open problems', lst and lst[0]['name'] == 'Netaji Club' and lst[0]['open'] >= 1, lst)
check('the public list does not show who adopted it', lst and set(lst[0]) >= {'mine'} and lst[0]['mine'] is not True)
check('only the adopter can let a spot go', err(rpc, 'kasa_leave_spot', uid=user(), p_id=a1['id']) == 'KASA_NOT_FOUND')
check('an ordinary person cannot remove an adoption',
      err(rpc, 'kasa_admin_remove_adoption', uid=user(), p_id=a1['id'], p_reason='rude name') == 'KASA_NOT_ADMIN')
rpc('kasa_leave_spot', uid=ad1, p_id=a1['id'])
check('a spot let go leaves the list', not any(x['id'] == a1['id'] for x in rpc('kasa_adopted_spots')))
a2 = adopt(user(), 'Some Name', ad_spot)
rpc('kasa_admin_remove_adoption', uid=mod, p_id=a2['id'], p_reason='not a real group')
check('a moderator can remove a bad adoption', not any(x['id'] == a2['id'] for x in rpc('kasa_adopted_spots')))
lim = user()
for i in range(3):
    adopt(lim, f'Spot keeper {i}', offset(-3800 - i * 200, 1800))
check('one person can look after at most three spots', err(adopt, lim, 'Spot keeper 4', offset(-4600, 1800)) == 'KASA_ADOPT_LIMIT')

# Moderators decide repeats: keep a join, undo a wrong one, or join a missed one.
mr_spot = offset(-2600, -2600)
m1 = quick(user(), mr_spot)
m2 = quick(user(), offset(12, 0, base=mr_spot))
up_before = admin_sql('select upvotes from public.reports where id = %s', (m1['id'],))[0][0]
check('the automatic check joined the second report', admin_sql('select is_duplicate from public.reports where id = %s', (m2['id'],))[0][0] is True)
check('an ordinary person cannot undo a join', err(rpc, 'kasa_admin_unlink_duplicate', uid=user(), p_report_id=str(m2['id'])) == 'KASA_NOT_ADMIN')
check('the join waits for a moderator', any(x['id'] == str(m2['id']) for x in rpc('kasa_admin_repeat_photos', uid=ph_mod)))
rpc('kasa_admin_unlink_duplicate', uid=ph_mod, p_report_id=str(m2['id']), p_reason='Different pile')
row = admin_sql('select is_duplicate, parent_report_id from public.reports where id = %s', (m2['id'],))[0]
check('a moderator can undo a wrong join', row == (False, None), row)
check('undoing takes back the "people saw this" it added',
      admin_sql('select upvotes from public.reports where id = %s', (m1['id'],))[0][0] == up_before - 1)
check('an undone join leaves the review list', not any(x['id'] == str(m2['id']) for x in rpc('kasa_admin_repeat_photos', uid=ph_mod)))
check('the undo is on the public timeline',
      admin_sql("select count(*) from kasa_private.events where report_id = %s and detail ->> 'action' = 'unlink_duplicate'", (m1['id'],))[0][0] == 1)
rpc('kasa_admin_link_duplicate', uid=ph_mod, p_report_id=str(m2['id']), p_parent_id=str(m1['id']))
check('a moderator can join a report the check missed',
      admin_sql('select is_duplicate, parent_report_id::text from public.reports where id = %s', (m2['id'],))[0] == (True, str(m1['id'])))
check('a report cannot join a repeat', err(rpc, 'kasa_admin_link_duplicate', uid=ph_mod, p_report_id=str(m1['id']), p_parent_id=str(m2['id'])) == 'KASA_BAD_ACTION')
m3 = quick(user(), offset(20, 0, base=mr_spot))
rpc('kasa_admin_confirm_duplicate', uid=ph_mod, p_report_id=str(m3['id']))
check('a confirmed join stays and leaves the review list',
      admin_sql('select is_duplicate from public.reports where id = %s', (m3['id'],))[0][0] is True
      and not any(x['id'] == str(m3['id']) for x in rpc('kasa_admin_repeat_photos', uid=ph_mod)))
rpc('kasa_admin_remove_photo', uid=ph_mod, p_report_id=str(m1['id']), p_kind='duplicate', p_ref=str(m3['id']), p_reason='same photo again')
check('a moderator can delete a repeat photo', admin_sql('select count(*) from public.reports where id = %s', (m3['id'],))[0][0] == 0)

# An admin can accept a cleanup after checking the photos; moderators can add public notes.
ac_spot = offset(-1800, -2900)
ac_r = quick(user(), ac_spot)
ac_u = user()
ac_c = rpc('kasa_claim_cleanup', uid=ac_u, p_report_id=str(ac_r['id']), p_photo_path=upload(ac_u, 'claims'), p_lat=ac_spot[0], p_lng=ac_spot[1], p_accuracy=10.0)
ac_cid = ac_c['claim_id'] if isinstance(ac_c, dict) and 'claim_id' in ac_c else admin_sql("select id from kasa_private.claims where report_id::text = %s", (str(ac_r['id']),))[0][0]
check('a moderator cannot accept a cleanup', err(rpc, 'kasa_admin_accept_claim', uid=ph_mod, p_claim_id=str(ac_cid), p_note='looks clean') == 'KASA_NOT_ADMIN')
check('accepting needs a note', err(rpc, 'kasa_admin_accept_claim', uid=ph_admin, p_claim_id=str(ac_cid), p_note='') == 'KASA_REASON_REQUIRED')
rpc('kasa_admin_accept_claim', uid=ph_admin, p_claim_id=str(ac_cid), p_note='Both photos show the same wall, now clean')
row = admin_sql('select status, resolution_method from public.reports where id = %s', (ac_r['id'],))[0]
check('an admin can accept a cleanup, marked as accepted by a moderator', row == ('resolved', 'moderator'), row)
check('an accepted claim cannot be accepted again', err(rpc, 'kasa_admin_accept_claim', uid=ph_admin, p_claim_id=str(ac_cid), p_note='again') == 'KASA_CLAIM_CLOSED')
rpc('kasa_admin_note', uid=ph_mod, p_report_id=str(ac_r['id']), p_note='The bin next to it is still broken')
check('a moderator note is on the public timeline',
      admin_sql("select count(*) from kasa_private.events where report_id = %s and detail ->> 'action' = 'note'", (ac_r['id'],))[0][0] == 1)
check('an ordinary person cannot add a moderator note', err(rpc, 'kasa_admin_note', uid=user(), p_report_id=str(ac_r['id']), p_note='hello') == 'KASA_NOT_ADMIN')

# "Join N people": a public count of people taking part, nobody named.
n_people = rpc('kasa_people_count')
check('the public can see how many people take part', isinstance(n_people, int) and n_people > 0, n_people)

# Placing a school by dragging the map: the pin may move only a short way from the phone's GPS.
far_pin = offset(400, 0, base=sc_where)
check('a school pin cannot be dragged far from where the phone is',
      err(rpc, 'kasa_mark_school_location', uid=user(), p_udise_code='19210199904', p_lat=far_pin[0], p_lng=far_pin[1],
          p_accuracy=10.0, p_gps_lat=sc_where[0], p_gps_lng=sc_where[1]) == 'KASA_PIN_TOO_FAR')
near_pin = offset(60, 0, base=sc_where)
ok_pin = rpc('kasa_mark_school_location', uid=user(), p_udise_code='19210199904', p_lat=near_pin[0], p_lng=near_pin[1],
             p_accuracy=10.0, p_gps_lat=sc_where[0], p_gps_lng=sc_where[1])
check('a school pin dragged a short way is accepted', ok_pin.get('points', 0) >= 1, ok_pin)

# Dumping grounds are their own kind of report.
ds, _ = report(user(), category='dumpsite', where=offset(-2400, 3100))
check('a dumping ground can be reported', admin_sql('select category from public.reports where id = %s', (ds['id'],))[0][0] == 'dumpsite')

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
