(function(){'use strict';
const $=id=>document.getElementById(id),C=window.ParishkarSystem,P=window.ParishkarPolicies,J=window.ParishkarJourney;
const cfg=window.KASA_CONFIG||{},sb=window.supabase?.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
let data={schema:1,nodes:[],facts:[],links:[],interventions:[]},kind='',position=null,lastPlan=null,dossier=null,busy=false,live=false,pickupChoice=null,planState='unknown',recoveryShown=[],returnOrigin=null;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const money=p=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(p/100);
const safeURL=u=>typeof u==='string'&&/^https:\/\//.test(u)?u:null;
const fact=(id,field)=>C.factAt(data.facts,id,field)?.value;
const reviewedPoint=n=>{const v=fact(n.id,'coordinates');return C.point(v)?v:null;};
const at=n=>reviewedPoint(n)||(C.point({lat:n.reference_lat,lon:n.reference_lon})?{lat:n.reference_lat,lon:n.reference_lon}:null);
const verifiedEntrance=n=>n.kind==='entrance'&&C.usable(n,data.facts);
const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.round(n%60)).padStart(2,'0');
const time=s=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw new TypeError('Choose valid start and return times');return Number(s.slice(0,2))*60+Number(s.slice(3));};
function message(root,text){root.replaceChildren(el('p',text,'notice'));}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function snapshotOK(d){return d?.schema===1&&['nodes','facts','links','interventions'].every(k=>Array.isArray(d[k]));}
function screen(id,replace=false){
 id=({nearby:'explore',cases:'help'})[id]||id;if(id==='improve'){location.href='system-tools.html';return;}if(!['explore','plan','go','help'].includes(id))id='explore';document.querySelectorAll('.screen').forEach(s=>s.hidden=s.id!==id);document.querySelectorAll('[data-screen]').forEach(b=>{if(b.dataset.screen===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});if(location.hash!=='#'+id)history[replace?'replaceState':'pushState'](null,'','#'+id);if(id==='go')renderGo();window.scrollTo({top:0,behavior:'instant'});}
document.querySelectorAll('[data-screen]').forEach(b=>b.onclick=e=>{e.preventDefault();screen(b.dataset.screen);});window.addEventListener('hashchange',()=>screen(location.hash.slice(1),true));screen(location.hash.slice(1),true);
function queryParts(){
 const raw=$('need-search').value.toLowerCase().trim();const inferred=/toilet|washroom|bathroom/.test(raw)?'toilet':/food|meal|eat|restaurant/.test(raw)?'food':/stay|hotel|lodg|room/.test(raw)?'stay':/shop|store|pharmacy/.test(raw)?'shop':/water|drink/.test(raw)?'water':/health|hospital|clinic/.test(raw)?'health':'';
 if(inferred&&$('service-evidence').value==='directory')$('service-evidence').value='checked';
 const query=inferred?raw.replace(/\b(need|a|an|the|near|me|toilet|washroom|bathroom|food|meal|eat|restaurant|stay|hotel|lodging|room|shop|store|pharmacy|water|drink|health|hospital|clinic)\b/g,'').trim():raw;
 return {query,type:kind||inferred};
}
const currentCheck=n=>J.serviceReady(n,data);
function renderServices(){
 const {query,type}=queryParts(),includeDirectory=$('service-evidence').value==='directory';
 let nodes=data.nodes.filter(n=>(!type||n.service_type===type)&&(!query||(n.name+' '+n.slug).toLowerCase().includes(query))&&(includeDirectory||currentCheck(n)));
 nodes=nodes.map(n=>({...n,distance:position&&at(n)?C.distance(position,at(n)):null})).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)||a.name.localeCompare(b.name));
 $('services').replaceChildren();$('service-count').textContent=nodes.length+' matching '+(includeDirectory?'directory entries':'recently checked services')+(data.limited?' · result limit reached':'');
 if(!nodes.length){const box=el('div',undefined,'empty');box.append(el('h2',includeDirectory?'No matching place.':'No recently checked option here.'),el('p','Try another place name, browse the travel guide, or use Help for your next step.'));const b=el('button','Include directory names');b.onclick=()=>{$('service-evidence').value='directory';renderServices();};if(!includeDirectory)box.append(b);else{const a=el('a','Open the travel guide ↗','button');a.href='tourism.html';box.append(a);}$('services').append(box);}
 for(const n of nodes.slice(0,100)){
  const card=el('article',undefined,'service-card'),current=currentCheck(n);card.append(el('span',n.service_type||'Place','badge'),el('h2',n.name));
  if(n.distance!==null)card.append(el('p',n.distance.toFixed(1)+' km straight-line distance','subtle'));
  const facts=el('ul',undefined,'facts'),open=fact(n.id,'open_status'),price=fact(n.id,'price');
  facts.append(el('li',open===true?'Recently reported open':open===false?'Recently reported closed':'Confirm access before visiting'));
  if(price)facts.append(el('li',money(price.paise)+' / '+price.basis.replaceAll('_',' ')+' · check inclusions'));
  if(n.service_type==='toilet')facts.append(el('li',fact(n.id,'toilet_usable')===true?'Usability recently checked':'Usability unconfirmed'));
  if(fact(n.id,'water')!==undefined)facts.append(el('li',fact(n.id,'water')?'Water reported available':'Water reported unavailable'));
  if(current)facts.append(el('li',fact(n.id,'step_free')===true?'Step-free access reported':'Step-free access unconfirmed'));card.append(facts);
  const checked=C.factAt(data.facts,n.id,'open_status');if(current&&checked)card.append(el('p','Checked '+new Date(checked.observed_at).toLocaleString('en-IN'),'subtle'));
  if(!current)card.append(el('p','Directory entry · facilities and price need confirmation.','subtle'));
  const coords=reviewedPoint(n),map=el('a',coords?'Open checked area point ↗':'Search map candidates ↗');map.target='_blank';map.rel='noopener';map.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(coords?coords.lat+','+coords.lon:n.name+' Purulia West Bengal');card.append(map);
  const contact=fact(n.id,'public_contact');if(contact?.consent===true&&/^\+?[0-9 -]{7,20}$/.test(contact.phone)){const a=el('a','Call provider');a.href='tel:'+contact.phone.replace(/[^+0-9]/g,'');card.append(a);}
  const evidence=el('details');evidence.append(el('summary','Sources and check dates'));const f=data.facts.filter(f=>f.node_id===n.id);
  if(!f.length)evidence.append(el('p','No current independently reviewed operating evidence.','subtle'));
  for(const x of f){const p=el('p',x.field.replaceAll('_',' ')+': observed '+new Date(x.observed_at).toLocaleString('en-IN')+' · valid until '+new Date(x.valid_until).toLocaleString('en-IN'),'subtle');if(safeURL(x.source_url)){const a=el('a','Source ↗');a.href=x.source_url;a.target='_blank';a.rel='noopener';p.append(' ',a);}evidence.append(p);}
  if(!f.length&&safeURL(n.source_url)){const a=el('a','Directory reference ↗');a.href=n.source_url;a.target='_blank';a.rel='noopener';evidence.append(a);}
  card.append(evidence);$('services').append(card);
 }
 renderStops();renderPickups();renderRecoveryOptions();renderGo();
 $('coverage').textContent=data.nodes.length?data.nodes.length+' directory places · '+data.nodes.filter(currentCheck).length+' services with current checks. Directory names do not confirm availability.':'Directory unavailable right now. Use the travel guide and contact providers before travelling.';
}
$('need-search').oninput=renderServices;$('service-evidence').onchange=renderServices;
$('need-chips').onclick=e=>{const b=e.target.closest('[data-kind]');if(!b)return;kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderServices();};
$('locate').onclick=()=>{if(!navigator.geolocation)return $('connection').textContent='Location is unavailable. Search by name instead.';$('locate').disabled=true;navigator.geolocation.getCurrentPosition(p=>{position={lat:p.coords.latitude,lon:p.coords.longitude};$('origin-lat').value=position.lat;$('origin-lon').value=position.lon;pickupChoice={name:'My current location',point:position,referenceOnly:false};$('pickup').value='gps';$('pickup-state').textContent='Using your current location. Agree your pickup with the driver.';$('locate').disabled=false;$('connection').textContent='Location used for this view. No location history is sent to Parishkar.';renderServices();},()=>{$('locate').disabled=false;$('connection').textContent='Location was not available. You can still search and enter a pickup point.';},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});};
function renderStops(){
 const old=new Set([...$('trip-stops').querySelectorAll('input:checked')].map(i=>i.value));$('trip-stops').replaceChildren();
 const entrances=data.nodes.filter(n=>verifiedEntrance(n)&&n.usable!==false);
 if(!entrances.length)$('trip-stops').append(el('p','Checked entrances are not available yet. Explore the travel guide and confirm access locally before setting off.','subtle'));
 for(const n of entrances){const label=el('label'),i=el('input');i.type='checkbox';i.value=n.id;i.checked=old.has(n.id);label.append(i,document.createTextNode(n.name));$('trip-stops').append(label);}
}
$('trip-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;const submit=e.target.querySelector('[type=submit]');submit.disabled=true;returnOrigin=lastPlan?.origin||returnOrigin;lastPlan=null;planState='unknown';renderGo();$('save-trip').hidden=true;
 try{
  const origin=readPickup();
  const ids=[...$('trip-stops').querySelectorAll('input:checked')].map(i=>i.value);if(!ids.length)throw new Error('Choose at least one reviewed entrance');
  const party=Number($('trip-party').value),budget=Math.round(Number($('trip-budget').value)*100);
  const base=C.budgetQuote(['transport','meals','stay','reserve'].map(k=>({label:k,paise:$('base-'+k).value===''?null:Math.round(Number($('base-'+k).value)*100),basis:'group'})),party,0);
  if(!base.complete)throw new Error('Missing group quotes: '+base.missing.join(', ')+'. Enter a confirmed zero when an item does not apply.');
  if(base.totalPaise>budget)throw new Error('The confirmed group costs already exceed the budget');
  const nodes=ids.map(id=>data.nodes.find(n=>n.id===id));if(nodes.some(n=>!n||!verifiedEntrance(n)))throw new Error('Access evidence changed. Reload and choose current entrances.');
  const expected=nodes.map(n=>({id:n.id,revision:n.revision}));
  await assertCurrent(expected);
  const stops=nodes.map(n=>{const p=fact(n.id,'price'),hours=fact(n.id,'hours'),access=C.factAt(data.facts,n.id,'access_status');let cost=null;if(p&&['group','person'].includes(p.basis))cost=p.paise*(p.basis==='person'?party:1);return {id:n.id,name:n.name,reviewedAccess:true,access:'open',expiresAt:access.valid_until,costPaise:cost,openMinute:hours?.openMinute,closeMinute:hours?.closeMinute,visitMinutes:fact(n.id,'visit_minutes'),gentle:fact(n.id,'step_free')===true,value:1};});
  const points=[origin,...nodes.map(reviewedPoint),origin];message($('trip-result'),'Calculating road travel times…');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response;
  try{response=await fetch('https://router.project-osrm.org/table/v1/driving/'+points.map(p=>p.lon+','+p.lat).join(';')+'?annotations=duration',{signal:controller.signal});}finally{clearTimeout(timer);}
  if(!response.ok)throw new Error('Road routing is unavailable. No estimated itinerary was substituted.');const matrix=await response.json();if(matrix.code!=='Ok')throw new Error('No usable road-time matrix');
  await assertCurrent(expected);
  const result=C.solveDay({stops,matrix:matrix.durations,startMinute:time($('trip-start').value),endMinute:time($('trip-end').value),budgetPaise:budget-base.totalPaise,mobility:$('trip-mobility').value,buffer:Number($('trip-buffer').value)});
  const root=$('trip-result');root.replaceChildren();if(!result.feasible)root.append(el('p','No itinerary fits the reviewed access, time, mobility and budget constraints.','notice'));
  for(const s of result.schedule){const n=nodes.find(n=>n.id===s.id);root.append(el('h3',clock(s.arrival)+' · '+n.name),el('p','Leave by '+clock(s.leave)+' · '+s.travelMinutes+' minutes travel allowance from the previous stop.'));}
  if(result.feasible)root.append(el('p','Return '+clock(result.returnMinute)+' · '+money(base.totalPaise+result.costPaise)+' confirmed group costs and quoted stop fees.','notice'));
  for(const o of result.omitted)root.append(el('p',(nodes.find(n=>n.id===o.id)?.name||o.id)+': '+o.reason,'subtle'));
  root.append(el('p',result.method+'. Excludes live traffic, unsourced closures and unquoted extras. This is not a booking.','subtle'));
  if(result.feasible){const dependencies=result.schedule.map(s=>{const n=nodes.find(n=>n.id===s.id),facts=data.facts.filter(f=>f.node_id===s.id);return {id:n.id,revision:n.revision,validUntil:new Date(Math.min(...facts.map(f=>Date.parse(f.valid_until)))).toISOString()};});lastPlan={version:2,createdAt:new Date().toISOString(),result,dependencies,origin:{...origin,name:pickupChoice?.name||'Agreed pickup point',referenceOnly:pickupChoice?.referenceOnly===true},stops:result.schedule.map(s=>{const n=nodes.find(n=>n.id===s.id);return {id:n.id,name:n.name,point:reviewedPoint(n)};}),party,groupBudgetPaise:budget,totalPaise:base.totalPaise+result.costPaise,returnBy:time($('trip-end').value)};$('save-trip').hidden=false;await checkPlan();const go=el('button','Open my day →');go.onclick=()=>screen('go');root.append(go);}
 }catch(err){message($('trip-result'),err.name==='AbortError'?'Road routing timed out. Try again; no fallback route was invented.':err.message);}
 finally{busy=false;submit.disabled=false;}
};
$('save-trip').onclick=()=>{if(!lastPlan)return;try{localStorage.setItem('parishkar_system_plan',JSON.stringify(lastPlan));$('plan-validity').textContent='Saved on this device. Access is rechecked when this page opens or returns online.';}catch{$('plan-validity').textContent='Device storage unavailable. Print the page if needed.';}};
async function assertCurrent(expected){
 if(!sb)throw new Error('Live access verification is unavailable');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let r;
 try{r=await sb.rpc('kasa_system_versions',{p_ids:expected.map(n=>n.id)}).abortSignal(controller.signal);}finally{clearTimeout(timer);}
 if(r.error||!Array.isArray(r.data))throw new Error('Live access verification failed. No itinerary was confirmed.');
 if(expected.some(n=>!r.data.some(v=>v.id===n.id&&v.revision===n.revision&&v.usable===true)))throw new Error('Access changed or expired. Refresh the page and recalculate.');
}
async function checkPlan(){
 if(!lastPlan||!sb)return;try{const {data:versions,error}=await sb.rpc('kasa_system_versions',{p_ids:lastPlan.dependencies.map(d=>d.id)});if(error||!Array.isArray(versions))throw new Error();const result=C.validatePlan(lastPlan,versions);planState=result.valid?'current':'changed';renderGo();$('plan-validity').textContent=result.valid?'Access dependencies are current. Check again before departure.':'This plan needs recalculation: access evidence changed or expired.';if(!result.valid)$('save-trip').hidden=true;}catch{planState='unknown';renderGo();$('save-trip').hidden=true;$('plan-validity').textContent='Could not recheck access. Treat the saved plan as unconfirmed.';}
}
$('dossier-form').onsubmit=e=>{
 e.preventDefault();const kind=$('case-kind').value,route=P.authority(kind==='service'?'service':'misconduct',$('case-scope').value);
 dossier={format:'Parishkar-private-dossier-v1',preparedAt:new Date().toISOString(),status:'Prepared only; not filed',kind,scope:$('case-scope').value,office:$('case-office').value.trim(),dateAndPlace:$('case-when').value.trim(),facts:$('case-facts').value.trim(),recordsHeld:$('case-evidence').value.trim(),route};
 const root=$('case-next');root.replaceChildren(el('h3',route.name),el('p',route.note),el('p','Your draft has not been sent to Parishkar or any authority.','notice'));
 if(route.url){const a=el('a','Read the official procedure ↗');a.href=route.url;a.target='_blank';a.rel='noopener';root.append(a);}
 if(kind==='workforce'){const a=el('a','NMC rules and regulations ↗');a.href='https://nmc.org.in/page/rules-regulations-rules-regulations-nmc';a.target='_blank';a.rel='noopener';root.append(el('p','This platform does not determine employment rights, accreditation sanctions or statutory working-hour limits.','subtle'),a);}
 $('export-private').hidden=false;
};
$('clear-dossier').onclick=()=>{$('dossier-form').reset();dossier=null;$('dossier-password').value='';$('export-private').hidden=true;message($('case-next'),'Private draft cleared. Nothing was submitted.');};
$('encrypt-dossier').onclick=async()=>{if(!dossier)return;const button=$('encrypt-dossier');button.disabled=true;try{const value=await window.ParishkarPrivate.encryptDossier(dossier,$('dossier-password').value);download(value,'parishkar-private-dossier.encrypted.json');$('dossier-password').value='';}catch(e){message($('case-next'),e.message);}finally{button.disabled=false;}};
$('save-reference').onclick=()=>{const value=$('official-reference').value.trim();if(!value)return;try{localStorage.setItem('parishkar_official_reference',JSON.stringify({reference:value,at:new Date().toISOString()}));$('reference-state').textContent='User-entered reference saved locally. Filing and receipt have not been independently verified.';}catch{$('reference-state').textContent='Device storage unavailable.';}};
function renderPickups(){
 const selected=$('pickup').value;const entries=J.pickups(data);$('pickup').querySelectorAll('[data-place]').forEach(o=>o.remove());
 for(const p of entries){const o=el('option',p.name+(p.referenceOnly?' · area point':''));o.value=p.id;o.dataset.place='1';$('pickup').append(o);}
 if([...$('pickup').options].some(o=>o.value===selected))$('pickup').value=selected;
}
function readPickup(){
 if($('pickup').value==='manual'){
  if($('origin-lat').value.trim()===''||$('origin-lon').value.trim()==='')throw new Error('Enter both exact coordinates, or choose a named pickup.');
  const p={lat:Number($('origin-lat').value),lon:Number($('origin-lon').value)};if(!C.point(p))throw new Error('Choose a valid pickup point');pickupChoice={name:'Agreed pickup point',point:p,referenceOnly:false};return p;
 }
 if(!pickupChoice||!C.point(pickupChoice.point))throw new Error('Choose a named pickup or allow your current location first.');return pickupChoice.point;
}
for(const id of ['origin-lat','origin-lon'])$(id).oninput=()=>{$('pickup').value='manual';pickupChoice=null;$('pickup-state').textContent='Using your edited exact point. Confirm the meeting arrangement.';};
$('pickup').onchange=()=>{
 const selected=$('pickup').value;pickupChoice=null;
 if(selected==='gps'){$('locate').click();return;}
 if(selected==='manual'){$('pickup-exact').open=true;$('pickup-state').textContent='Enter the exact point agreed with your driver.';return;}
 const p=J.pickups(data).find(p=>p.id===selected);if(!p)return;
 pickupChoice=p;$('origin-lat').value=p.point.lat;$('origin-lon').value=p.point.lon;
 $('pickup-state').textContent=p.referenceOnly?p.name+' is an approximate area point. Confirm the exact meeting point with your driver.':p.name+' · checked map point. Confirm your meeting arrangement.';
};
function mapLink(label,point,origin=null){const a=el('a',label,'button');a.target='_blank';a.rel='noopener';a.href=origin?'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(origin.lat+','+origin.lon)+'&destination='+encodeURIComponent(point.lat+','+point.lon)+'&travelmode=driving':'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(point.lat+','+point.lon);return a;}
function returnCard(root){
 root.replaceChildren();const origin=lastPlan?.origin||returnOrigin;if(!C.point(origin))return;
 root.append(el('h3','Keep your way back'),el('p','Return point: '+origin.name+(origin.referenceOnly?' · approximate area; confirm your meeting point.':'.')));
 root.append(mapLink('Open return point ↗',origin));root.append(el('p','A map link is not a booked ride. Confirm the vehicle, fare and pickup time directly.','subtle'));
}
function renderGo(){
 const root=$('go-plan');root.replaceChildren();if(!lastPlan?.result?.schedule?.length){root.append(el('h2','Start with a plan'),el('p','Your stops and return point will appear here once a day fits the current access, time and quoted costs.'));const b=el('button','Plan my day');b.onclick=()=>screen('plan');root.append(b);returnCard($('return-rescue'));return;}
 root.append(el('h2',planState==='current'?'Your route is checked for now.':'Recheck before setting off.'),el('p',planState==='current'?'Access checks are current. Availability can still change.':'Access changed, expired or could not be checked. Recalculate before relying on the stops.','notice'));
 if(Number.isSafeInteger(lastPlan.totalPaise))root.append(el('p',money(lastPlan.totalPaise)+' quoted group cost · planned return '+clock(lastPlan.result.returnMinute)));
 for(const s of lastPlan.result.schedule){const n=lastPlan.stops?.find(n=>n.id===s.id)||data.nodes.find(n=>n.id===s.id);root.append(el('h3',clock(s.arrival)+' · '+(n?.name||'Saved stop')),el('p','Leave by '+clock(s.leave)));if(planState==='current'&&C.point(n?.point))root.append(mapLink('Open stop on map ↗',n.point));}
 root.append(el('h3','Check the essentials'));
 for(const [type,label] of [['toilet','Working toilet'],['food','Meal within your budget'],['water','Water supply'],['transport','Return transport'],['stay','A room, if staying overnight']]){
  const b=el('button','Find '+label.toLowerCase());b.onclick=()=>{$('recovery-kind').value=type;updateRecoveryKind();screen('help');$('recovery-form').scrollIntoView({block:'start'});};root.append(b);
 }
 root.append(el('p','These are things to confirm, not services included in the itinerary.','subtle'));const back=el('div');returnCard(back);root.append(back);returnCard($('return-rescue'));
}
function renderRecoveryOptions(){const selected=$('recovery-exclude').value;$('recovery-exclude').replaceChildren();const none=el('option','None selected / not in the directory');none.value='';$('recovery-exclude').append(none);for(const n of data.nodes){const o=el('option',n.name);o.value=n.id;$('recovery-exclude').append(o);}if([...$('recovery-exclude').options].some(o=>o.value===selected))$('recovery-exclude').value=selected;}
function updateRecoveryKind(){$('recovery-rooms-label').hidden=$('recovery-kind').value!=='stay';}
$('recovery-kind').onchange=updateRecoveryKind;
$('recovery-form').onsubmit=async e=>{
 e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;const root=$('recovery-result');message(root,'Checking the latest alternatives…');
 try{
  await load();if(!live)throw new Error('Live checks are unavailable. No alternative can be confirmed. Use the guide to contact providers directly.');
  const type=$('recovery-kind').value,excluded=$('recovery-exclude').value,budget=$('recovery-budget').value,party=Number($('recovery-party').value),rooms=Number($('recovery-rooms').value);
  const candidates=J.recoveryCandidates(data,{type,party,rooms,budgetPaise:budget===''?null:Math.round(Number(budget)*100),excludedIds:excluded?[excluded]:[],origin:position||pickupChoice?.point||lastPlan?.origin});
  recoveryShown=candidates.slice(0,5).map(n=>({id:n.id,revision:n.revision}));root.replaceChildren();if(!candidates.length){root.append(el('h3','No recently checked alternative fits.'),el('p','We cannot confirm an option for these constraints. Contact your accommodation or transport provider, change the budget, or check the travel guide.','notice'));const guide=el('a','Open the travel guide ↗','button');guide.href='tourism.html';root.append(guide);}
  for(const n of candidates.slice(0,5)){
   const card=el('article',undefined,'service-card');card.append(el('h3',n.name),el('p',n.costPaise===null?'Price needs confirmation':money(n.costPaise)+' quoted group cost'+(type==='stay'?' for one night':'')));
   if(n.distance!==null)card.append(el('p',n.distance.toFixed(1)+' km straight-line','subtle'));
   const checked=C.factAt(data.facts,n.id,type==='attraction'?'access_status':'open_status');card.append(el('p','Checked '+new Date(checked.observed_at).toLocaleString('en-IN')+' · call before travelling.','subtle'));
   const contact=fact(n.id,'public_contact');if(contact?.consent===true&&/^\+?[0-9 -]{7,20}$/.test(contact.phone)){const a=el('a','Call to confirm','button primary');a.href='tel:'+contact.phone.replace(/[^+0-9]/g,'');card.append(a);}else card.append(el('p','No consented provider contact is published. A booking or available seat is not confirmed.','subtle'));
   card.append(mapLink('Open checked point ↗',n.point));
   if(type==='attraction'){const b=el('button','Use this stop and recalculate');b.onclick=()=>{for(const input of $('trip-stops').querySelectorAll('input')){if(input.value===excluded)input.checked=false;if(input.value===n.id)input.checked=true;}screen('plan');message($('trip-result'),'Alternative selected. Review the budget and return time, then calculate again.');};card.append(b);}
   root.append(card);
  }
  returnCard($('return-rescue'));
 }catch(err){message(root,err.message||'Alternatives could not be checked.');}finally{button.disabled=false;}
};

async function load(){
 try{
  if(!sb)throw new Error('Service connection unavailable');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let response;
  try{response=await sb.rpc('kasa_system_snapshot',{p_district:'purulia'}).abortSignal(controller.signal);}finally{clearTimeout(timer);}
  if(response.error||!snapshotOK(response.data))throw new Error('The service evidence backend is unavailable or not yet installed');data=response.data;live=true;
  $('connection').textContent='Public evidence refreshed '+new Date(data.at).toLocaleTimeString('en-IN')+'. Availability can change.';
  try{localStorage.setItem('parishkar_public_system_cache',JSON.stringify(data));}catch{}
 }catch(e){
  live=false;try{const cached=JSON.parse(localStorage.getItem('parishkar_public_system_cache'));if(snapshotOK(cached))data=cached;}catch{}
  $('connection').textContent='Local checks could not refresh. '+(data.nodes.length?'Showing saved public records; expired checks are excluded.':'Use the travel guide and confirm access directly before travelling.');
 }
 if(recoveryShown.length&&(!live||recoveryShown.some(old=>{const n=data.nodes.find(n=>n.id===old.id);return !n||n.revision!==old.revision||(n.kind==='entrance'?!verifiedEntrance(n)||n.usable===false:!currentCheck(n));}))){recoveryShown=[];message($('recovery-result'),'These alternatives need a fresh check. Search again before travelling.');}
 renderServices();await checkPlan();
}
try{const saved=JSON.parse(localStorage.getItem('parishkar_system_plan'));if(saved?.dependencies)lastPlan=saved;const reference=JSON.parse(localStorage.getItem('parishkar_official_reference'));if(reference?.reference)$('reference-state').textContent='Saved user-entered reference: '+reference.reference+' · not independently verified.';}catch{}
renderGo();load();setInterval(()=>{if(!document.hidden&&navigator.onLine)load();},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});window.addEventListener('online',load);
})();
