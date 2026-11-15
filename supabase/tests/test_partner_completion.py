"""Partner completion and independent evidence scenarios through the public RPCs."""
import json,sys,uuid
import psycopg
from pathlib import Path
# Reuse the existing harness definitions without its scenario setup.
exec((Path(__file__).with_name('test_dispatch.py')).read_text().split('mod = uuid.uuid4()')[0])
mod,worker,outsider,verifier=[uuid.uuid4() for _ in range(4)]
for u in [mod,worker,outsider,verifier]:admin_sql('insert into auth.users(id) values (%s)',(u,))
admin_sql("insert into public.admins(user_id,role) values (%s,'admin')",(mod,))
rpc('kasa_admin_partner_add_worker',mod,p_user=worker,p_firm='Test team')
rid=admin_sql("insert into public.reports(lat,lng,status,moderation_status,photo_path,accuracy_m,photo_url,moderation_labels) values (23.3321,86.3655,'open','approved','reports/partnerTestOriginalPhoto.jpg',10,'x','{\"photo\":{\"capture\":\"live\"}}') returning id").fetchone()[0]
oid=rpc('kasa_admin_partner_approve',mod,p_report=rid,p_office='Evidence test office',p_sla_days=7)['order_id']
rpc('kasa_admin_partner_assign',mod,p_order=oid,p_worker=worker,p_order_no='TEST-1')
rpc('kasa_partner_worker_step',worker,p_order=oid,p_action='start')
check('worker cannot complete without evidence',err('kasa_partner_worker_step',worker,p_order=oid,p_action='complete')=='KASA_NEEDS_PHOTO')
check('officer cannot bypass photo requirement',err('kasa_admin_partner_step',mod,p_order=oid,p_action='complete')=='KASA_NEEDS_PHOTO')
check('outsider cannot read work photos',err('kasa_partner_order_photos',outsider,p_order=oid)=='KASA_NOT_ALLOWED')
check('ordinary account cannot upload partner files',rpc('kasa_partner_can_upload',outsider) is False)
check('registered worker may upload partner files',rpc('kasa_partner_can_upload',worker) is True)

def add_photo():
 token=rpc('kasa_issue_capture_token',worker)
 path='partner/'+uuid.uuid4().hex+'.jpg'
 # Exercise the real INSERT policy as an authenticated worker.
 act(worker)
 try:db.execute("insert into storage.objects(bucket_id,name,owner_id) values ('kasa-photos',%s,%s)",(path,str(worker)))
 finally:reset()
 meta={'capture':'live','capture_token':str(token),'taken_at':admin_sql('select now()::text').fetchone()[0],'lat':23.3321,'lng':86.3655,'accuracy':10}
 return rpc('kasa_partner_add_work_photo',worker,p_order=oid,p_path=path,p_meta=meta)['photo_id']
pid=add_photo()
check('assigned worker can view their recorded evidence',len(rpc('kasa_partner_order_photos',worker,p_order=oid))==1)
rpc('kasa_partner_worker_step',worker,p_order=oid,p_action='complete')
check('signoff requires officer photo approval',err('kasa_admin_partner_step',mod,p_order=oid,p_action='signoff')=='KASA_NEEDS_PHOTO')
rpc('kasa_admin_partner_photo_review',mod,p_photo=pid,p_decision='approve')
rpc('kasa_admin_partner_step',mod,p_order=oid,p_action='signoff')
def state():return admin_sql('select state from kasa_private.partner_orders where id=%s',(oid,)).fetchone()[0]
check('original report provenance does not imply resolution',state()=='completed')
# Independent community resolution is a separate, existing workflow.
claim=admin_sql("insert into kasa_private.claims(report_id,claimant_id,photo_path,photo_url,lat,lng,accuracy_m,distance_m,status) values (%s,%s,%s,'x',23.3321,86.3655,10,0,'accepted') returning id",(rid,outsider,'claims/'+uuid.uuid4().hex+'.jpg')).fetchone()[0]
admin_sql("insert into kasa_private.votes(claim_id,voter_id,vote,lat,lng,accuracy_m,distance_m) values (%s,%s,'verify',23.3321,86.3655,10,0)",(claim,verifier))
admin_sql("update public.reports set status='resolved',resolution_method='community',resolved_at=now() where id=%s",(rid,))
rpc('kasa_admin_partner_step',mod,p_order=oid,p_action='sync')
check('current independent community resolution allows verification',state()=='verified')
rpc('kasa_partner_reopen',outsider,p_order=oid,p_reason='The work has failed again at the same location.')
check('reopened work cannot reuse old approved photo',err('kasa_admin_partner_step',mod,p_order=oid,p_action='signoff')=='KASA_NEEDS_PHOTO')
rpc('kasa_admin_partner_step',mod,p_order=oid,p_action='send_back',p_note='Repeat work with new evidence')
check('officer send-back reopens citizen report for fresh claims',admin_sql('select status from public.reports where id=%s',(rid,)).fetchone()[0]=='open')
check('sent-back worker must take a new photo',err('kasa_partner_worker_step',worker,p_order=oid,p_action='complete')=='KASA_NEEDS_PHOTO')
new=add_photo();rpc('kasa_partner_worker_step',worker,p_order=oid,p_action='complete')
rpc('kasa_admin_partner_photo_review',mod,p_photo=new,p_decision='approve')
rpc('kasa_admin_partner_photo_review',mod,p_photo=new,p_decision='reject',p_note='Work incomplete')
check('rejecting an approved photo revokes signoff eligibility',err('kasa_admin_partner_step',mod,p_order=oid,p_action='signoff')=='KASA_NEEDS_PHOTO')
rpc('kasa_admin_partner_photo_review',mod,p_photo=new,p_decision='approve')
rpc('kasa_admin_partner_step',mod,p_order=oid,p_action='signoff')
check('old citizen verification cannot close a new work cycle',state()=='completed')
admin_sql("insert into public.admins(user_id,role) values (%s,'admin')",(worker,))
check('worker cannot approve their own photo even with moderator role',err('kasa_admin_partner_photo_review',worker,p_photo=new,p_decision='approve')=='KASA_SELF_REVIEW')
photos=rpc('kasa_partner_order_photos',mod,p_order=oid)
check('historical evidence remains available and labelled',any(not p['current'] for p in photos) and any(p['current'] for p in photos))
print(f'\n{sum(v for _,v in results)}/{len(results)} passed')
sys.exit(0 if all(v for _,v in results) else 1)
