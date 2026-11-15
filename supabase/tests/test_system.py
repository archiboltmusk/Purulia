"""Public boundary and cross-system state scenarios; no real people or devices."""
from pathlib import Path
exec((Path(__file__).with_name('test_dispatch.py')).read_text().split('mod = uuid.uuid4()')[0])
from datetime import datetime,timedelta,timezone
mods=[uuid.uuid4() for _ in range(4)]
a,b,worker,observer=mods
for u in mods:
 admin_sql('insert into auth.users(id)values(%s)',(u,))
 admin_sql("insert into public.admins(user_id,role)values(%s,'admin')",(u,))
def cmd(action,data,who=a,key=None):return rpc('kasa_system_command',who,p_request=key or uuid.uuid4(),p_action=action,p_data=data)
def bad(action,data,who=a,key=None):return err('kasa_system_command',who,p_request=key or uuid.uuid4(),p_action=action,p_data=data)
def node(kind):
 r=cmd('node',{'slug':'test-'+uuid.uuid4().hex,'name':'Synthetic '+kind,'kind':kind,'source_url':'https://purulia.gov.in/'})
 cmd('publish_node',{'id':r['id']},b);return r['id']
def observe(n,field,value,who=observer):
 now=datetime.now(timezone.utc)
 return cmd('observe',{'node_id':n,'field':field,'value':value,'source_url':'https://purulia.gov.in/','observed_at':now.isoformat(),'valid_until':(now+timedelta(hours=1)).isoformat()},who)['id']
def approve(id,who=b):return cmd('review',{'id':id,'decision':'approve','reason':'Independent synthetic check'},who)
def current(n):return [f for f in rpc('kasa_system_snapshot')['facts'] if f['node_id']==n]
entrance,asset,other=node('entrance'),node('asset'),node('entrance')
check('directory seeded without operational claims',len(rpc('kasa_system_snapshot')['nodes'])>=56)
check('anonymous cannot mutate',err('kasa_system_command',p_request=uuid.uuid4(),p_action='node',p_data={})=='permission denied for function kasa_system_command')
check('draft cannot be self published',bad('publish_node',{'id':cmd('node',{'slug':'draft-'+uuid.uuid4().hex,'name':'Draft synthetic','kind':'asset'})['id']})=='KASA_INDEPENDENT_REVIEW')
for n in [entrance,other]:
 approve(observe(n,'coordinates',{'lat':23.3,'lon':86.3}));approve(observe(n,'access_status','open'))
approve(observe(asset,'access_status','open'))
o=observe(entrance,'water',True,a)
check('author cannot approve own observation',bad('review',{'id':o,'decision':'approve','reason':'Self approval attempt'},a)=='KASA_CONFLICT')
cmd('interest',{'user_id':str(a),'node_id':entrance,'relation':'operator'})
o=observe(entrance,'water',True)
check('known operator cannot approve evidence',bad('review',{'id':o,'decision':'approve','reason':'Operator review attempt'},a)=='KASA_CONFLICT')
key=uuid.uuid4();payload={'id':o,'decision':'approve','reason':'Independent repeat-safe check'}
first=cmd('review',payload,b,key)
for _ in range(100):check_result=cmd('review',payload,b,key)
check('100 identical commands produce one review',admin_sql('select count(*) from kasa_private.system_reviews where observation_id=%s',(o,)).fetchone()[0]==1)
check('request key cannot change payload',bad('review',{**payload,'reason':'Changed request payload'},b,key)=='KASA_REQUEST_REUSED')
link=cmd('link',{'from_id':entrance,'to_id':asset,'kind':'depends','source_url':'https://purulia.gov.in/'})['id'];cmd('publish_link',{'id':link},b)
cycle=cmd('link',{'from_id':asset,'to_id':entrance,'kind':'depends','source_url':'https://purulia.gov.in/'})['id']
check('required dependency cycles rejected',bad('publish_link',{'id':cycle},b)=='KASA_GRAPH_CYCLE')
circuit=cmd('circuit',{'name':'Synthetic test circuit','access_ids':[entrance]})
before=rpc('kasa_system_versions',p_ids=[uuid.UUID(entrance),uuid.UUID(other)])
closed=observe(asset,'access_status','closed');approve(closed)
after=rpc('kasa_system_versions',p_ids=[uuid.UUID(entrance),uuid.UUID(other)])
x={r['id']:r for r in before};y={r['id']:r for r in after}
check('shared asset closure invalidates entrance immediately',not y[entrance]['usable'] and y[entrance]['revision']>x[entrance]['revision'])
check('unrelated entrance stays valid without revision churn',y[other]==x[other])
cmd('process_outbox',{})
check('outbox updates dependent public circuit',admin_sql('select validation_state from kasa_private.system_circuits where id=%s',(circuit['id'],)).fetchone()[0]=='invalid')
check('completed outbox is repeat safe',cmd('process_outbox',{})['processed']==0)
cmd('review',{'id':closed,'decision':'withdraw','reason':'Withdraw latest evidence'},b)
check('withdrawal does not resurrect old open fact',not [f for f in current(asset) if f['field']=='access_status'])
check('partial price is rejected',bad('observe',{'node_id':asset,'field':'price','value':{'basis':'person'},'source_url':'https://purulia.gov.in/'},observer)=='KASA_BAD_FORM')
# Interventions cannot reuse evidence from a previous work cycle.
i=cmd('propose_intervention',{'node_id':other,'title':'Synthetic repair only','source_url':'https://purulia.gov.in/','outcome_field':'water','outcome_value':True,'cost_paise':100,'crew_minutes':60},observer)['id']
def step(name,rev,**extra):return cmd('intervention_step',{'id':i,'revision':rev,'step':name,**extra},b)
step('review',1);step('assign',2,worker_id=str(worker))
check('completion requires worker evidence',bad('intervention_step',{'id':i,'revision':3,'step':'complete'},b)=='KASA_NEEDS_EVIDENCE')
observe(other,'water',True,worker);step('complete',3)
check('acceptance requires independent post-completion outcome',bad('intervention_step',{'id':i,'revision':4,'step':'accept'},b)=='KASA_NEEDS_EVIDENCE')
approve(observe(other,'water',False))
check('contradictory outcome cannot pass acceptance',bad('intervention_step',{'id':i,'revision':4,'step':'accept'},b)=='KASA_NEEDS_EVIDENCE')
approve(observe(other,'water',True));step('accept',4)
step('reopen',5,reason='Synthetic follow-up failure observed');step('assign',6,worker_id=str(worker))
check('reopened repair cannot reuse previous worker evidence',bad('intervention_step',{'id':i,'revision':7,'step':'complete'},b)=='KASA_NEEDS_EVIDENCE')
# Service role is a trust boundary: users cannot submit "verified" sensor packets.
check('anonymous cannot read device keys',err('kasa_system_device_key',p_device=uuid.uuid4())=='permission denied for function kasa_system_device_key')
check('authenticated cannot forge verified reading',err('kasa_system_ingest_verified',observer,p_device=uuid.uuid4(),p_sequence=1,p_measured_at=datetime.now(timezone.utc),p_value=1.0,p_hash='a'*64)=='permission denied for function kasa_system_ingest_verified')
device=cmd('device',{'node_id':asset,'name':'Synthetic device','metric':'flow_lps','unit':'L/s','public_key':'A'*43+'=','source_url':'https://purulia.gov.in/','calibration_until':(datetime.now(timezone.utc)+timedelta(days=7)).isoformat(),'min_value':0,'max_value':10})['id']
check('device enrolment requires second moderator',bad('activate_device',{'id':device})=='KASA_INDEPENDENT_REVIEW')
cmd('activate_device',{'id':device},b)
def ingest(seq,value,hash):return admin_sql('select public.kasa_system_ingest_verified(%s,%s,now(),%s,%s)',(device,seq,value,hash)).fetchone()[0]
check('verified ingest records one packet',ingest(1,5,'a'*64)['recorded'])
check('identical replay is idempotent',not ingest(1,5,'a'*64)['recorded'])
try:ingest(1,6,'b'*64);reused=False
except psycopg.Error:reused=True
check('sequence cannot be reused for changed payload',reused)
check('out-of-range sensor requests review only',ingest(2,20,'c'*64)['action']=='review_only')
cmd('revoke_device',{'id':device})
try:ingest(3,5,'d'*64);revoked=False
except psycopg.Error:revoked=True
check('revocation prevents subsequent ingest',revoked)
print(f'{sum(v for _,v in results)}/{len(results)} system scenarios passed')
if not all(v for _,v in results):sys.exit(1)
