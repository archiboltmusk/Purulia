const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../tourism-engine.js');
const W=require('../tourism-i18n.js');
const base=E.defaults;
test('complete official district catalogue, source provenance and translations',()=>{
 assert.equal(E.places.length,23);assert.equal(E.places.filter(p=>p.districtListed).length,14);
 assert.equal(new Set(E.places.map(p=>p.id)).size,E.places.length);
 for(const p of E.places){assert(E.safeURL(p.source));for(const lang of ['en','bn','hi']){assert(p.name[lang]);assert(p.experience[lang]);}if(p.coordinate){assert(E.safeURL(p.geometrySource));assert(p.coordinate[0]>=-90&&p.coordinate[0]<=90&&p.coordinate[1]>=-180&&p.coordinate[1]<=180)}else assert.equal(p.referenceType,'unlocated');assert.equal(p.access,'unconfirmed');assert(Object.values(p.facilities).every(v=>v==='unknown'))}
});
test('circuits reference unique existing places with matching district group',()=>{
 for(const c of E.circuits){assert.equal(new Set(c.stops).size,c.stops.length);for(const id of c.stops)assert(E.places.some(p=>p.id===id&&p.circuit===c.id));}
});
test('time-budget planner respects every preference combination without dropping records',()=>{
 for(const c of E.circuits)for(const days of [1,2,3])for(const pace of ['slow','full'])for(const access of ['standard','gentle'])for(const season of ['mild','hot','rain'])for(const interest of ['mixed','nature','culture']){
  const plan=E.buildPlan({...base,circuit:c.id,days,pace,access,season,interest});
  assert.equal(plan.days.length,days);const stops=plan.days.flatMap(d=>d.stops);
  assert.equal(new Set(stops.map(p=>p.id)).size,stops.length);
  assert.equal(stops.length+plan.excluded.length+plan.overflow.length,c.stops.length);
  for(const d of plan.days){assert(d.plannedMinutes<=d.capacity);assert(d.stops.length<=(pace==='slow'||season==='hot'?2:3));}
  for(const p of stops){if(access==='gentle'||season==='hot')assert(!p.steep);if(season==='rain')assert(!p.waterfall);if(interest!=='mixed')assert.equal(p.kind,interest)}
 }
});
test('late arrival and excessive transfer allowances do not produce impossible schedules',()=>{
 assert.equal(E.buildPlan({...base,arrival:'20:00',days:1}).days[0].stops.length,0);
 assert.equal(E.buildPlan({...base,transfer:240,days:1}).days[0].stops.length,0);
 assert(E.buildPlan({...base,transport:'public'}).publicTransportUnconfirmed);
});
test('invalid stored and shared options fail closed',()=>{
 for(const raw of [null,[],{},'bad',{...base,circuit:'bad'},{...base,party:0},{...base,party:1.5},{...base,days:99},{...base,hours:Infinity},{...base,arrival:'25:99'},{...base,gateway:'fake'}]){
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===0)continue;
  assert.equal(E.validOptions(raw),false);assert.throws(()=>E.buildPlan(raw));
 }
 assert.throws(()=>E.unpackTrip('{"version":900,"options":{}}'));
 assert.throws(()=>E.unpackTrip('x'.repeat(2001)));
 const round=E.unpackTrip(E.packTrip({...base,party:5,extra:'private text'}));assert.equal(round.party,5);assert(!Object.hasOwn(round,'extra'));
});
test('schematic geometry is not presented as navigable road geometry',()=>{
 const geo=E.geoJSON('all');assert.equal(geo.features.filter(f=>f.geometry.type==='Point').length,E.places.filter(p=>p.coordinate).length);
 for(const f of geo.features.filter(f=>f.geometry.type==='LineString')){assert.equal(f.properties.schematic,true);assert.equal(f.properties.navigable,false);assert(f.geometry.coordinates.length>=2)}
 assert.equal(E.geoJSON('central').features.length,0);
});
test('quotes use paise and distinguish absent from zero',()=>{
 assert.deepEqual(E.quoteTotal(['.1','.2','',0],3),{total:.3,perPerson:.1,missing:1});
 for(const q of [-1,Infinity,'bad',10000001])assert.throws(()=>E.quoteTotal([q],2));
 assert.throws(()=>E.quoteTotal([1],0));
});
test('expired, malformed and unsafe provider records stay hidden',()=>{
 const now=Date.now(),p={id:'id',name:'Test only',kind:'guide',contact_url:'https://example.org',evidence_url:'https://example.org/proof',verified_at:new Date(now-1000).toISOString(),verified_until:new Date(now+1000).toISOString()};
 assert(E.isProviderCurrent(p,now));assert(!E.isProviderCurrent({...p,verified_until:new Date(now-1).toISOString()},now));assert(!E.isProviderCurrent({...p,contact_url:'javascript:alert(1)'},now));assert(!E.isProviderCurrent({...p,verified_at:'bad'},now));
});
test('all static UI translation keys have complete Bengali and Hindi counterparts',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../tourism.html'),'utf8');
 for(const [,key] of html.matchAll(/data-t(?:-placeholder|-title)?="([^"]+)"/g)){assert(W.rows[key],key);assert(W.rows[key].every(s=>typeof s==='string'&&s.length));}
 assert.match(html,/kasa\.html\?d=purulia/);assert.match(html,/tourism-map.mjs/);assert.match(html,/tourism-operator.html/);
});
