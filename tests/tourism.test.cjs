const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {buildPlan,quoteTotal,validOptions,places}=require('../tourism-engine.js');
const base={circuit:'ajodhya',days:2,party:2,pace:'slow',access:'standard',season:'mild'};
test('all combinations respect circuit, day capacity and exclusions',()=>{
 for(const circuit of ['ajodhya','north','town'])for(const days of [1,2,3])for(const pace of ['slow','full'])for(const access of ['standard','gentle'])for(const season of ['mild','rain','hot']){
  const plan=buildPlan({...base,circuit,days,pace,access,season});
  assert.equal(plan.days.length,days);
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
 assert.equal(plan.days.flat().length,1);assert.equal(plan.days[2].length,0);
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
