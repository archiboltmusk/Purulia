/* Visitor-facing decisions. Directory names never imply working services. */
(function(root){'use strict';
const C=typeof module==='object'&&module.exports?require('./system-core.js'):root.ParishkarSystem;
const value=(facts,id,field,now)=>C.factAt(facts,id,field,now)?.value;
function dependenciesOpen(n,data,now=Date.now(),seen=new Set()){
 if(seen.has(n.id))return false;const next=new Set(seen);next.add(n.id);
 return (data.links||[]).filter(l=>l.from_id===n.id&&['depends','access'].includes(l.kind)).every(l=>{const target=data.nodes.find(x=>x.id===l.to_id);return target&&value(data.facts,target.id,'access_status',now)==='open'&&dependenciesOpen(target,data,now,next);});
}
function serviceReady(n,data,now=Date.now()){
 if(n.kind!=='service'||!n.service_type||!C.point(value(data.facts,n.id,'coordinates',now))||value(data.facts,n.id,'open_status',now)!==true||!dependenciesOpen(n,data,now))return false;
 if(['closed','restricted'].includes(value(data.facts,n.id,'access_status',now)))return false;
 const hours=value(data.facts,n.id,'hours',now),minute=Math.floor((now/60000+330)%1440);
 if(hours&&(minute<hours.openMinute||minute>=hours.closeMinute))return false;
 if(n.service_type==='toilet'&&value(data.facts,n.id,'toilet_usable',now)!==true)return false;
 if(n.service_type==='water'&&value(data.facts,n.id,'water',now)!==true)return false;
 if(['food','stay','shop','transport'].includes(n.service_type)){const p=value(data.facts,n.id,'price',now);if(!p||!Number.isSafeInteger(p.paise)||p.paise<0||p.currency!=='INR')return false;}
 return true;
}
function pickups(data){return data.nodes.flatMap(n=>{const checked=value(data.facts,n.id,'coordinates',Date.now()),reference={lat:n.reference_lat,lon:n.reference_lon};const point=C.point(checked)?checked:C.point(reference)?reference:null;return point?[{id:n.id,name:n.name,point,referenceOnly:!C.point(checked)}]:[];}).sort((a,b)=>a.name.localeCompare(b.name));}
function recoveryCandidates(data,{type,party=1,rooms=1,budgetPaise=null,excludedIds=[],origin=null,now=Date.now()}){
 if(!Number.isInteger(party)||party<1||party>30||!Number.isInteger(rooms)||rooms<1||rooms>30||budgetPaise!==null&&(!Number.isSafeInteger(budgetPaise)||budgetPaise<0))throw new TypeError('Check travellers, rooms and the whole-group budget');
 return data.nodes.filter(n=>!excludedIds.includes(n.id)&&(type==='attraction'?n.kind==='entrance'&&n.usable!==false&&C.usable(n,data.facts,now)&&dependenciesOpen(n,data,now):n.service_type===type&&serviceReady(n,data,now))).flatMap(n=>{
  const p=value(data.facts,n.id,'price',now);let costPaise=null;
  if(p?.currency==='INR'&&Number.isSafeInteger(p.paise)&&p.paise>=0){const multiplier={group:1,person:party,room_night:rooms,person_night:party}[p.basis];if(multiplier)costPaise=p.paise*multiplier;}
  if(budgetPaise!==null&&(costPaise===null||costPaise>budgetPaise))return [];
  const point=value(data.facts,n.id,'coordinates',now);return [{...n,point,costPaise,distance:origin?C.distance(origin,point):null}];
 }).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)||(a.costPaise??Infinity)-(b.costPaise??Infinity)||a.name.localeCompare(b.name));
}
const api={serviceReady,dependenciesOpen,pickups,recoveryCandidates};if(typeof module==='object'&&module.exports)module.exports=api;else root.ParishkarJourney=api;
})(typeof globalThis!=='undefined'?globalThis:this);
