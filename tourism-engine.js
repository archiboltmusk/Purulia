(function(root){
'use strict';
const data=typeof module==='object'&&module.exports?require('./tourism-data.js'):root.PuruliaTourismData;
const {places,circuits,gateways}=data;
const enums={pace:['slow','full'],access:['standard','gentle'],season:['mild','hot','rain'],interest:['mixed','nature','culture'],transport:['car','hired','public']};
const defaults={circuit:'ajodhya',days:2,party:2,pace:'slow',access:'standard',season:'mild',interest:'mixed',transport:'hired',gateway:'town',arrival:'09:00',hours:7,transfer:45};
function options(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid trip');
 const v={...defaults};for(const k of Object.keys(defaults))if(Object.hasOwn(raw,k))v[k]=raw[k];
 if(!circuits.some(c=>c.id===v.circuit)||!gateways.some(g=>g.id===v.gateway))throw new TypeError('Invalid circuit or arrival base');
 for(const [k,values] of Object.entries(enums))if(!values.includes(v[k]))throw new TypeError('Invalid '+k);
 if(!Number.isInteger(v.days)||v.days<1||v.days>3||!Number.isInteger(v.party)||v.party<1||v.party>30)throw new TypeError('Invalid days or travellers');
 if(!Number.isFinite(v.hours)||v.hours<2||v.hours>10||!Number.isFinite(v.transfer)||v.transfer<0||v.transfer>240)throw new TypeError('Invalid time budget');
 if(typeof v.arrival!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.arrival))throw new TypeError('Invalid arrival time');
 return v;
}
function validOptions(v){try{options(v);return true}catch{return false}}
function buildPlan(raw){
 const v=options(raw),c=circuits.find(c=>c.id===v.circuit),excluded=[],eligible=[];
 for(const id of c.stops){const p=places.find(p=>p.id===id);let reason=null;
 if(v.access==='gentle'&&p.steep)reason='mobility';else if(v.season==='rain'&&p.waterfall)reason='rain';else if(v.season==='hot'&&p.steep)reason='heat';else if(v.interest!=='mixed'&&p.kind!==v.interest)reason='interest';
 if(reason)excluded.push({id,reason});else eligible.push(p);}
 const limit=v.pace==='slow'||v.season==='hot'?2:3,days=[];let cursor=0;
 for(let d=0;d<v.days;d++){
  const start=d===0?v.arrival:'08:00',startMinutes=Number(start.slice(0,2))*60+Number(start.slice(3)),capacity=Math.max(0,Math.min(v.hours*60,18*60-startMinutes));
  let used=30+2*v.transfer;const stops=[];
  while(cursor<eligible.length&&stops.length<limit){const p=eligible[cursor],needed=p.visitMinutes+(stops.length?v.transfer:0);if(used+needed>capacity)break;stops.push(p);used+=needed;cursor++;}
  days.push({number:d+1,start,stops,plannedMinutes:stops.length?used:0,capacity,breakMinutes:30,transferAllowance:v.transfer});
 }
 return {version:2,options:v,circuit:c,days,excluded,overflow:eligible.slice(cursor),provisional:true,publicTransportUnconfirmed:v.transport==='public'};
}
function quoteTotal(values,party){if(!Number.isInteger(party)||party<1||party>30)throw new TypeError('Invalid traveller count');let cents=0,missing=0;for(const raw of values){if(raw===''||raw===null||raw===undefined){missing++;continue}const n=Number(raw);if(!Number.isFinite(n)||n<0||n>10000000)throw new TypeError('Invalid quote');cents+=Math.round(n*100)}return {total:cents/100,perPerson:Math.round(cents/party)/100,missing}}
function geoJSON(circuitId){
 const selected=circuitId==='all'?circuits:circuits.filter(c=>c.id===circuitId),ids=new Set(selected.flatMap(c=>c.stops)),features=[];
 for(const p of places)if(ids.has(p.id)&&p.coordinate)features.push({type:'Feature',geometry:{type:'Point',coordinates:[p.coordinate[1],p.coordinate[0]]},properties:{id:p.id,circuit:p.circuit,name:p.name.en,referenceType:p.referenceType,geometrySource:p.geometrySource}});
 for(const c of selected){let segment=[];const flush=()=>{if(segment.length>1)features.push({type:'Feature',geometry:{type:'LineString',coordinates:segment},properties:{id:c.id,colour:c.colour,schematic:true,navigable:false}});segment=[]};for(const id of c.stops){const p=places.find(p=>p.id===id);if(!p.coordinate){flush();continue}segment.push([p.coordinate[1],p.coordinate[0]])}flush()}
 return {type:'FeatureCollection',features};
}
function packTrip(v){return JSON.stringify({version:2,options:options(v)})}
function unpackTrip(text){if(typeof text!=='string'||text.length>2000)throw new TypeError('Invalid shared trip');const p=JSON.parse(text);if(p.version!==2)throw new TypeError('Unsupported shared trip');return options(p.options)}
function isProviderCurrent(p,now=Date.now()){return !!p&&typeof p.id==='string'&&typeof p.name==='string'&&['driver','stay','guide','artisan'].includes(p.kind)&&typeof p.evidence_url==='string'&&safeURL(p.evidence_url)&&safeURL(p.contact_url)&&Number.isFinite(Date.parse(p.verified_at))&&Date.parse(p.verified_at)<=now&&Number.isFinite(Date.parse(p.verified_until))&&Date.parse(p.verified_until)>now}
function safeURL(v){try{return typeof v==='string'&&v.length<=2000&&new URL(v).protocol==='https:'}catch{return false}}
const api={...data,defaults,options,validOptions,buildPlan,quoteTotal,geoJSON,packTrip,unpackTrip,isProviderCurrent,safeURL};
if(typeof module==='object'&&module.exports)module.exports=api;else root.PuruliaTourism=api;
})(typeof globalThis!=='undefined'?globalThis:this);
