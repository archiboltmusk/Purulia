const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {buildPlan,quoteTotal,validOptions,places}=require('../tourism-engine.js');
const base={circuit:'ajodhya',days:2,party:2,pace:'slow',access:'standard',season:'mild'};
test('all combinations respect circuit, day capacity and exclusions',()=>{
 for(const circuit of ['ajodhya','north','town'])for(const days of [1,2,3])for(const pace of ['slow','full'])for(const access of ['standard','gentle'])for(const season of ['mild','rain','hot']){
  const plan=buildPlan({...base,circuit,days,pace,access,season});
  assert(plan.days.length<=days);assert(plan.days.every(d=>d.length>0));assert.equal(plan.requestedDays,days);
  const limit=pace==='slow'||season==='hot'?2:3;
  assert(plan.days.every(d=>d.length<=limit));
  assert(plan.days.flat().every(p=>p.circuit===circuit));
  assert.equal(new Set(plan.days.flat().map(p=>p.id)).size,plan.days.flat().length);
  if(access==='gentle'||season==='hot')assert(plan.days.flat().every(p=>!p.steep));
  if(season==='rain')assert(plan.days.flat().every(p=>!p.waterfall));
 }
});
test('full mild Ajodhya visit retains all three stops',()=>assert.equal(buildPlan({...base,days:1,pace:'full'}).days.flat().length,3));
test('short itineraries do not add forced remote stops',()=>{
 const plan=buildPlan({...base,circuit:'town',days:3});
 assert.equal(plan.days.flat().length,1);assert.equal(plan.days.length,1);assert.match(plan.notice,/remaining days are unscheduled/);
});
test('malformed stored options cannot reach the planner',()=>{
 for(const input of [null,{},'bad',{...base,days:99},{...base,party:0},{...base,party:2.5},{...base,days:NaN},{...base,circuit:'missing'},{...base,access:'unknown'},{...base,pace:'unknown'},{...base,season:'unknown'}]){assert.equal(validOptions(input),false);assert.throws(()=>buildPlan(input),TypeError)}
});
test('quote calculator distinguishes missing and zero-valued quotes',()=>{
 assert.deepEqual(quoteTotal(['1000','','0',null,undefined,'50'],2),{total:1050,perPerson:525,missing:3});
 assert.deepEqual(quoteTotal(['','','','','',''],2),{total:0,perPerson:0,missing:6});
 assert.deepEqual(quoteTotal(['0','0','0','0','0','0'],2),{total:0,perPerson:0,missing:0});
});
test('money uses rounded paise and validates numeric input',()=>{
 assert.deepEqual(quoteTotal(['0.10','0.20'],3),{total:.3,perPerson:.1,missing:0});
 for(const n of [-1,Infinity,NaN,'bad',10000001])assert.throws(()=>quoteTotal([n],2),TypeError);
 for(const p of [0,31,1.5,NaN])assert.throws(()=>quoteTotal([100],p),TypeError);
});
test('destination identities are unique and geographic values are bounded',()=>{
 assert.equal(new Set(places.map(p=>p.id)).size,places.length);
 assert(places.every(p=>p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180));
});
test('integration has navigation, source and civic workflow links',()=>{
 const page=readFileSync(new URL('../tourism.html',`file://${__filename}`),'utf8');
 assert.match(page,/kasa\.html\?d=purulia/);assert.match(page,/https:\/\/purulia.gov.in\//);
 assert.match(page,/src="tourism-engine.js"/);assert.match(page,/src="tourism.js"/);
 assert.match(readFileSync(new URL('../index.html',`file://${__filename}`),'utf8'),/href="tourism.html"/);
});

test('late arrival, early return and transport validation',()=>{
 const short=buildPlan({...base,days:1,arrival:'17:00',departure:'18:00'});assert.equal(short.days.length,0);assert(short.omitted.length);
 for(const patch of [{arrival:'25:00'},{departure:'x'},{days:1,arrival:'15:00',departure:'14:00'},{station:'unknown'},{transport:'public'}])assert.throws(()=>buildPlan({...base,...patch}),TypeError);
 const delayed=buildPlan({...base,arrival:'22:00'});assert(delayed.dayNumbers.every(n=>n>1));
});
test('navigation includes station return and circuit waypoints',()=>{
 const {navigation,stations}=require('../tourism-engine.js');const u=new URL(navigation(places.filter(p=>p.circuit==='north'),stations.adra));
 assert.equal(u.searchParams.get('origin'),u.searchParams.get('destination'));assert.match(u.searchParams.get('waypoints'),/Baranti/);assert.equal(u.searchParams.get('travelmode'),'driving');
});

test('all 50 submitted lines survive, including duplicate numbering and the forest split',()=>{
 const {submitted}=require('../tourism-catalogue.js');assert.equal(submitted.length,51);assert.equal(new Set(submitted.map(p=>p.submission.group+':'+p.submission.number)).size,50);
 assert.equal(submitted.filter(p=>p.submission.number===40).length,2);assert.equal(submitted.filter(p=>p.submission.number===37).length,2);
 assert.equal(new Set(submitted.map(p=>p.id)).size,submitted.length);
});
test('catalogue never guesses coordinates or silently merges ambiguous names',()=>{
 const {catalogue,catalogueTools,places}=require('../tourism-engine.js');assert.equal(catalogue.length,56);
 assert.equal(catalogue.filter(catalogueTools.located).length,places.length+1);assert(catalogue.find(p=>p.id==='murguma-dam').coordinateSource);
 const unknown=catalogue.filter(p=>!catalogueTools.located(p));assert(unknown.every(p=>p.lat===null&&p.lon===null));
 assert.equal(catalogue.filter(p=>p.id==='turga').length,1);assert.equal(catalogue.filter(p=>p.id==='charida').length,1);
 for(const id of ['goja-dhalburu-group','gojaburu-peak','dholburu-gojaburu','ghalikocha-falls','gialikocha-village','matha-forest','duarsini-jungle'])assert(catalogue.some(p=>p.id===id));
 assert(catalogueTools.matches(catalogue.find(p=>p.id==='charida'),'Chorida Mukhosgram'));assert(catalogueTools.matches(catalogue.find(p=>p.id==='ukamburu-viewpoint'),'Suicide View Point'));
 assert(catalogue.filter(p=>p.referenceStatus==='reference_found').every(p=>p.sources?.length||p.source));
 assert(buildPlan(base).days.flat().every(p=>places.some(x=>x.id===p.id)));
});
