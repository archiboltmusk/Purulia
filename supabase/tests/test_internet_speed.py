"""Speed RPC boundary tests. Synthetic records in disposable CI databases only."""
from pathlib import Path
exec((Path(__file__).with_name('test_dispatch.py')).read_text().split('mod = uuid.uuid4()')[0])
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from datetime import datetime, timezone
users=[uuid.uuid4() for _ in range(6)]
for u in users:
 admin_sql("insert into auth.users(id,is_anonymous,email,email_confirmed_at) values(%s,false,%s,now())",(u,str(u)+'@example.invalid'))
anonymous=uuid.uuid4()
admin_sql('insert into auth.users(id)values(%s)',(anonymous,))
args=dict(p_lat=Decimal('23.3'),p_lng=Decimal('86.4'),p_download=20,p_upload=10,p_latency=30,p_kind='mobile')
check('anon cannot submit',err('submit_internet_speed',**args)=='permission denied for function submit_internet_speed')
check('anonymous authenticated account rejected',err('submit_internet_speed',anonymous,**args)=='Confirmed email sign-in required')
check('outside India rectangle rejected',err('submit_internet_speed',users[0],**{**args,'p_lat':0})=='Location outside supported bounds')
check('inside rectangle but outside India rejected',err('submit_internet_speed',users[0],**{**args,'p_lat':30,'p_lng':70})=='Approximate location is outside mapped India boundaries')
for field,value in [('p_download','NaN'),('p_upload','Infinity'),('p_kind',None),('p_download',0)]:
 check('invalid '+field+' '+str(value),err('submit_internet_speed',users[0],**{**args,field:value})=='Invalid measurement')
act(users[0])
try:
 db.execute("insert into public.internet_speed_tests(user_id,cell_lat,cell_lng,download_mbps,upload_mbps,latency_ms,connection_type)values(%s,23.3,86.4,1,1,1,'mobile')",(users[0],))
 check('direct writes rejected',False)
except psycopg.Error as e:check('direct writes rejected','permission denied' in str(e))
finally:reset()
check('first contribution works',err('submit_internet_speed',users[0],**args) is None)
check('repeat blocked',err('submit_internet_speed',users[0],**args)=='Wait 15 minutes between contributions')
check('raw records unreadable',not admin_sql("select has_table_privilege('anon','public.internet_speed_tests','select') or has_table_privilege('authenticated','public.internet_speed_tests','select')").fetchone()[0])
check('under five accounts suppressed',admin_sql('select count(*) from public.internet_speed_regions()').fetchone()[0]==0)
for u in users[1:5]:rpc('submit_internet_speed',u,**args)
rows=admin_sql('select * from public.internet_speed_regions()').fetchall()
check('five distinct contributors publish regional median',len(rows)==1 and rows[0][0]=='west-bengal' and rows[0][-1]==5 and rows[0][2]==20)
# Repeated submissions by one account must not bias either public median.
admin_sql("insert into public.internet_speed_tests(user_id,cell_lat,cell_lng,download_mbps,upload_mbps,latency_ms,connection_type,region,created_at) select %s,23.3,86.4,999,999,9,'mobile','west-bengal',now()-interval '1 day' from generate_series(1,20)",(users[0],))
check('same-account repeats cannot bias median',admin_sql('select download_mbps,contributors from public.internet_speed_regions()').fetchone()==(20,5))
check('cell threshold and median',admin_sql('select download_mbps,samples from public.internet_speed_cells()').fetchone()==(20,5))
rpc('delete_my_internet_speed',users[0])
check('delete removes only caller and suppresses below threshold',admin_sql('select count(*) from public.internet_speed_regions()').fetchone()[0]==0 and admin_sql('select count(*) from public.internet_speed_tests where user_id=%s',(users[1],)).fetchone()[0]==1)
check('deletion cannot reset contribution interval',err('submit_internet_speed',users[0],**args)=='Wait 15 minutes between contributions')
# Independent sessions racing for the same account must serialize.
def concurrent_submit(_):
 with psycopg.connect(DSN,autocommit=True) as c:
  c.execute('set role authenticated')
  c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(users[5]),))
  try:
   c.execute("select public.submit_internet_speed(23.3,86.4,20,10,30,'fixed')")
   return 'ok'
  except psycopg.Error as e:return e.diag.message_primary
with ThreadPoolExecutor(max_workers=2) as pool: outcome=list(pool.map(concurrent_submit,range(2)))
check('simultaneous contributions cannot bypass interval',sorted(outcome)==['Wait 15 minutes between contributions','ok'])
admin_sql('delete from public.internet_speed_tests where user_id=any(%s)',(users,))
admin_sql('delete from auth.users where id=any(%s)',(users+[anonymous],))
print(str(sum(ok for _,ok in results))+'/'+str(len(results))+' speed checks passed')
if not all(ok for _,ok in results):sys.exit(1)
