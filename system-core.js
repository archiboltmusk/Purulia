/* Shared, deterministic rules. No regulatory powers or clinical adjudication. */
(function(root){
'use strict';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function ensure(ok,message){if(!ok)throw new TypeError(message);}
function point(value){return !!value&&finite(value.lat)&&finite(value.lon)&&Math.abs(value.lat)<=90&&Math.abs(value.lon)<=180;}
function distance(a,b){if(!point(a)||!point(b))return null;const r=x=>x*Math.PI/180;return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(r(b.lat-a.lat)/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(r(b.lon-a.lon)/2)**2)));}
function factAt(facts,node,field,now=Date.now()){
 const latest=facts.filter(f=>f.node_id===node&&f.field===field&&Date.parse(f.valid_from)<=now)
  .sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at)||Date.parse(b.recorded_at)-Date.parse(a.recorded_at))[0];
 return latest?.decision==='approve'&&Date.parse(latest.valid_until)>now?latest:null;
}
function usable(node,facts,now=Date.now()){
 const coordinates=factAt(facts,node.id,'coordinates',now),access=factAt(facts,node.id,'access_status',now);
 return node.kind==='entrance'&&point(coordinates?.value)&&access?.value==='open';
}
function budgetQuote(items,party,nights){
 ensure(Number.isInteger(party)&&party>0&&party<=30,'Choose 1–30 travellers');ensure(Number.isInteger(nights)&&nights>=0&&nights<=30,'Choose 0–30 nights');
 let total=0;const missing=[];
 for(const item of items){
  if(!item||!Number.isInteger(item.paise)||item.paise<0||!['group','person','room_night','person_night'].includes(item.basis)){missing.push(item?.label||'Unquoted item');continue;}
  const quantity=item.basis==='person'?party:item.basis==='person_night'?party*nights:item.basis==='room_night'?item.rooms*nights:1;
  if(!Number.isInteger(quantity)||quantity<0){missing.push(item.label||'Rooms not specified');continue;}
  if(item.validUntil&&(!Number.isFinite(Date.parse(item.validUntil))||Date.parse(item.validUntil)<=Date.now())){missing.push(item.label+' (quote expired)');continue;}
  total+=item.paise*quantity;
 }
 ensure(Number.isSafeInteger(total),'Quote total is too large');return {totalPaise:total,perPersonPaise:Math.ceil(total/party),missing,complete:missing.length===0};
}
function validateMatrix(matrix,count){
 ensure(Array.isArray(matrix)&&matrix.length===count,'Road-time matrix is missing');
 ensure(matrix.every(row=>Array.isArray(row)&&row.length===count&&row.every(n=>n===null||(finite(n)&&n>=0))),'Road-time matrix is invalid');
}
// Optional-stop orienteering with time windows. Bounded beam search; no optimality claim.
function solveDay({stops,matrix,startMinute,endMinute,budgetPaise,mobility='standard',buffer=1.25,beamWidth=128}){
 ensure(Array.isArray(stops)&&stops.length<=12,'Choose up to 12 reviewed stops');validateMatrix(matrix,stops.length+2);
 ensure(stops.every(s=>s&&typeof s.id==='string'&&s.id.length>0)&&new Set(stops.map(s=>s.id)).size===stops.length,'Stops need unique identifiers');
 ensure(finite(startMinute)&&finite(endMinute)&&startMinute>=0&&endMinute<=1440&&startMinute<endMinute,'Invalid trip window');
 ensure(Number.isSafeInteger(budgetPaise)&&budgetPaise>=0,'A complete budget is required');ensure(finite(buffer)&&buffer>=1&&buffer<=3,'Invalid travel allowance');
 ensure(Number.isInteger(beamWidth)&&beamWidth>0&&beamWidth<=512,'Invalid solver limit');
 const eligible=stops.map((s,i)=>({...s,index:i+1})).filter(s=>s.reviewedAccess===true&&s.access==='open'&&s.expiresAt&&Date.parse(s.expiresAt)>Date.now()&&Number.isInteger(s.costPaise)&&s.costPaise>=0&&finite(s.visitMinutes)&&s.visitMinutes>0&&finite(s.openMinute)&&finite(s.closeMinute)&&s.openMinute<s.closeMinute&&(mobility!=='gentle'||s.gentle===true));
 const reason=s=>s.reviewedAccess!==true?'Entrance evidence is not reviewed':s.access!=='open'?'Access is not confirmed open':!s.expiresAt||Date.parse(s.expiresAt)<=Date.now()?'Access evidence expired':!Number.isInteger(s.costPaise)||s.costPaise<0?'Cost is unquoted':mobility==='gentle'&&s.gentle!==true?'Gentle access is unconfirmed':'No feasible road/time/budget combination';
 const leg=(a,b)=>matrix[a][b]===null?null:Math.ceil(matrix[a][b]/60*buffer);
 let frontier=[{at:0,time:startMinute,cost:0,value:0,visited:[],schedule:[]}],best=null;
 const score=s=>[s.value,s.visited.length,-s.returnMinute,-s.cost];
 const better=(a,b)=>!b||score(a).some((n,i)=>n!==score(b)[i]&&score(a).slice(0,i).every((x,j)=>x===score(b)[j])&&n>score(b)[i]);
 for(let depth=0;depth<=eligible.length;depth++){
  const next=[];
  for(const state of frontier){
   const home=leg(state.at,stops.length+1);
   if(home!==null&&state.time+home<=endMinute){const candidate={...state,returnMinute:state.time+home};if(better(candidate,best))best=candidate;}
   for(const stop of eligible){
    if(state.visited.includes(stop.id))continue;const travel=leg(state.at,stop.index);if(travel===null)continue;
    const arrival=Math.max(state.time+travel,stop.openMinute),leave=arrival+stop.visitMinutes,back=leg(stop.index,stops.length+1);
    if(leave>stop.closeMinute||back===null||leave+back>endMinute||state.cost+stop.costPaise>budgetPaise)continue;
    next.push({at:stop.index,time:leave,cost:state.cost+stop.costPaise,value:state.value+(finite(stop.value)?Math.max(0,stop.value):1),visited:[...state.visited,stop.id],schedule:[...state.schedule,{id:stop.id,arrival,leave,travelMinutes:travel}]});
   }
  }
  next.sort((a,b)=>b.value-a.value||b.visited.length-a.visited.length||a.time-b.time||a.cost-b.cost);frontier=next.slice(0,beamWidth);if(!frontier.length)break;
 }
 const visited=best?.visited||[];
 return {feasible:!!best&&visited.length>0,schedule:best?.schedule||[],returnMinute:best?.returnMinute??null,costPaise:best?.cost||0,omitted:stops.filter(s=>!visited.includes(s.id)).map(s=>({id:s.id,reason:reason(s)})),method:'Bounded beam search over road-time matrix; travel allowance is an assumption, not a statistical guarantee'};
}
function validatePlan(plan,versions,now=Date.now()){
 if(!plan||!Array.isArray(plan.dependencies)||!plan.dependencies.length)return {valid:false,reason:'No reviewed dependencies'};
 const changed=plan.dependencies.filter(d=>{const current=versions.find(v=>v.id===d.id);return !current||current.revision!==d.revision||current.usable!==true||!Number.isFinite(Date.parse(d.validUntil))||Date.parse(d.validUntil)<=now;});
 return {valid:changed.length===0,changed:changed.map(d=>d.id),reason:changed.length?'Access evidence changed or expired':'Dependencies remain current'};
}
function rankInterventions(items,{budgetPaise,crewMinutes}){
 ensure(Number.isSafeInteger(budgetPaise)&&budgetPaise>=0&&finite(crewMinutes)&&crewMinutes>=0,'Specify budget and crew capacity');
 const eligible=items.filter(i=>i.evidenceReviewed&&Number.isInteger(i.costPaise)&&i.costPaise>=0&&finite(i.crewMinutes)&&i.crewMinutes>0);
 eligible.sort((a,b)=>Number(b.urgent===true)-Number(a.urgent===true)||(b.blockedRoutes||0)-(a.blockedRoutes||0)||(b.basicServices||0)-(a.basicServices||0)||(b.daysWaiting||0)-(a.daysWaiting||0)||a.crewMinutes-b.crewMinutes||String(a.id).localeCompare(String(b.id)));
 const selected=[],deferred=[];let cost=0,crew=0;
 for(const i of eligible){if(cost+i.costPaise<=budgetPaise&&crew+i.crewMinutes<=crewMinutes){selected.push(i);cost+=i.costPaise;crew+=i.crewMinutes;}else deferred.push({id:i.id,reason:'Budget or crew capacity exceeded'});}
 for(const i of items.filter(i=>!eligible.includes(i)))deferred.push({id:i.id,reason:'Reviewed evidence, quote or crew estimate missing'});
 return {selected,deferred,costPaise:cost,crewMinutes:crew,policy:'Known urgent hazards, blocked reviewed circuits, basic services, waiting time, then crew effort. Greedy feasible selection; not an optimality or economic-impact claim.'};
}
const api={point,distance,factAt,usable,budgetQuote,validateMatrix,solveDay,validatePlan,rankInterventions};
if(typeof module==='object'&&module.exports)module.exports=api;else root.ParishkarSystem=api;
})(typeof globalThis!=='undefined'?globalThis:this);
