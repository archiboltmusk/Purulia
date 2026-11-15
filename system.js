(function(){'use strict';
const $=id=>document.getElementById(id),C=window.ParishkarSystem,P=window.ParishkarPolicies,T=window.ParishkarTwin;
const cfg=window.KASA_CONFIG||{},sb=window.supabase?.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
let data={schema:1,nodes:[],facts:[],links:[],interventions:[]},kind='',position=null,lastPlan=null,dossier=null,busy=false;
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
function screen(id){document.querySelectorAll('.screen').forEach(s=>s.hidden=s.id!==id);document.querySelectorAll('[data-screen]').forEach(b=>{if(b.dataset.screen===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});history.replaceState(null,'','#'+id);window.scrollTo({top:0,behavior:'instant'});}
document.querySelectorAll('[data-screen]').forEach(b=>b.onclick=()=>screen(b.dataset.screen));if(['nearby','plan','cases','improve'].includes(location.hash.slice(1)))screen(location.hash.slice(1));
function queryParts(){
 const raw=$('need-search').value.toLowerCase().trim();const inferred=/toilet|washroom|bathroom/.test(raw)?'toilet':/food|meal|eat|restaurant/.test(raw)?'food':/stay|hotel|lodg|room/.test(raw)?'stay':/shop|store|pharmacy/.test(raw)?'shop':/water|drink/.test(raw)?'water':/health|hospital|clinic/.test(raw)?'health':'';
 const query=inferred?raw.replace(/\b(need|a|an|the|near|me|toilet|washroom|bathroom|food|meal|eat|restaurant|stay|hotel|lodging|room|shop|store|pharmacy|water|drink|health|hospital|clinic)\b/g,'').trim():raw;
 return {query,type:kind||inferred};
}
function currentCheck(n){if(!reviewedPoint(n)||fact(n.id,'open_status')!==true)return false;return n.service_type==='toilet'?fact(n.id,'toilet_usable')===true:['food','stay','shop','transport'].includes(n.service_type)?!!fact(n.id,'price'):n.kind==='service';}
function renderServices(){
 const {query,type}=queryParts(),includeDirectory=$('service-evidence').value==='directory';
 let nodes=data.nodes.filter(n=>(!type||n.service_type===type)&&(!query||(n.name+' '+n.slug).toLowerCase().includes(query))&&(includeDirectory||currentCheck(n)));
 nodes=nodes.map(n=>({...n,distance:position&&at(n)?C.distance(position,at(n)):null})).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)||a.name.localeCompare(b.name));
 $('services').replaceChildren();$('service-count').textContent=nodes.length+' matching '+(includeDirectory?'directory entries':'recently checked services')+(data.limited?' · result limit reached':'');
 if(!nodes.length){const box=el('div',undefined,'empty');box.append(el('h2','No currently confirmed option here.'),el('p','We do not turn unknown availability into a recommendation. Check directory names or the existing local reports below.'));const b=el('button','Include directory names');b.onclick=()=>{$('service-evidence').value='directory';renderServices();};box.append(b);$('services').append(box);}
 for(const n of nodes.slice(0,100)){
  const card=el('article',undefined,'service-card'),current=currentCheck(n);card.append(el('span',n.service_type||'Place','badge'),el('h2',n.name));
  card.append(el('p',n.distance===null?'Distance unknown':n.distance.toFixed(1)+' km straight-line distance','subtle'));
  const facts=el('ul',undefined,'facts'),open=fact(n.id,'open_status'),price=fact(n.id,'price');
  facts.append(el('li',open===true?'Recently reported open':open===false?'Recently reported closed':'Opening status unconfirmed'));
  if(price)facts.append(el('li',money(price.paise)+' / '+price.basis.replaceAll('_',' ')+' · check inclusions'));
  if(n.service_type==='toilet')facts.append(el('li',fact(n.id,'toilet_usable')===true?'Usability recently checked':'Usability unconfirmed'));
  if(fact(n.id,'water')!==undefined)facts.append(el('li',fact(n.id,'water')?'Water reported available':'Water reported unavailable'));
  facts.append(el('li',fact(n.id,'step_free')===true?'Step-free access reported':'Step-free access unconfirmed'));card.append(facts);
  if(!current)card.append(el('p','Directory entry. Confirm access, facilities and price before travelling.','subtle'));
  const coords=reviewedPoint(n),map=el('a',coords?'Open checked area point ↗':'Search map candidates ↗');map.target='_blank';map.rel='noopener';map.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(coords?coords.lat+','+coords.lon:n.name+' Purulia West Bengal');card.append(map);
  const contact=fact(n.id,'public_contact');if(contact?.consent===true&&/^\+?[0-9 -]{7,20}$/.test(contact.phone)){const a=el('a','Call provider');a.href='tel:'+contact.phone.replace(/[^+0-9]/g,'');card.append(a);}
  const evidence=el('details');evidence.append(el('summary','Sources and check dates'));const f=data.facts.filter(f=>f.node_id===n.id);
  if(!f.length)evidence.append(el('p','No current independently reviewed operating evidence.','subtle'));
  for(const x of f){const p=el('p',x.field.replaceAll('_',' ')+': observed '+new Date(x.observed_at).toLocaleString('en-IN')+' · valid until '+new Date(x.valid_until).toLocaleString('en-IN'),'subtle');if(safeURL(x.source_url)){const a=el('a','Source ↗');a.href=x.source_url;a.target='_blank';a.rel='noopener';p.append(' ',a);}evidence.append(p);}
  if(!f.length&&safeURL(n.source_url)){const a=el('a','Directory reference ↗');a.href=n.source_url;a.target='_blank';a.rel='noopener';evidence.append(a);}
  card.append(evidence);$('services').append(card);
 }
 renderStops();renderInterventions();
}
$('need-search').oninput=renderServices;$('service-evidence').onchange=renderServices;
$('need-chips').onclick=e=>{const b=e.target.closest('[data-kind]');if(!b)return;kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderServices();};
$('locate').onclick=()=>{if(!navigator.geolocation)return $('connection').textContent='Location is unavailable. Search by name instead.';$('locate').disabled=true;navigator.geolocation.getCurrentPosition(p=>{position={lat:p.coords.latitude,lon:p.coords.longitude};$('origin-lat').value=position.lat;$('origin-lon').value=position.lon;$('locate').disabled=false;$('connection').textContent='Location used for this view. No location history is sent to Parishkar.';renderServices();},()=>{$('locate').disabled=false;$('connection').textContent='Location was not available. You can still search and enter a pickup point.';},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});};
function renderStops(){
 const old=new Set([...$('trip-stops').querySelectorAll('input:checked')].map(i=>i.value));$('trip-stops').replaceChildren();
 const entrances=data.nodes.filter(verifiedEntrance);
 if(!entrances.length)$('trip-stops').append(el('p','No entrances currently meet the reviewed access requirements. Operators can add and independently review evidence.','subtle'));
 for(const n of entrances.slice(0,12)){const label=el('label'),i=el('input');i.type='checkbox';i.value=n.id;i.checked=old.has(n.id);label.append(i,document.createTextNode(n.name));$('trip-stops').append(label);}
}
$('trip-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;const submit=e.target.querySelector('[type=submit]');submit.disabled=true;lastPlan=null;$('save-trip').hidden=true;
 try{
  const origin={lat:Number($('origin-lat').value),lon:Number($('origin-lon').value)};if(!C.point(origin))throw new Error('Choose a valid origin');
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
  if(result.feasible){const dependencies=result.schedule.map(s=>{const n=nodes.find(n=>n.id===s.id),facts=data.facts.filter(f=>f.node_id===s.id);return {id:n.id,revision:n.revision,validUntil:new Date(Math.min(...facts.map(f=>Date.parse(f.valid_until)))).toISOString()};});lastPlan={createdAt:new Date().toISOString(),result,dependencies};$('save-trip').hidden=false;await checkPlan();}
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
 if(!lastPlan||!sb)return;try{const {data:versions,error}=await sb.rpc('kasa_system_versions',{p_ids:lastPlan.dependencies.map(d=>d.id)});if(error||!Array.isArray(versions))throw new Error();const result=C.validatePlan(lastPlan,versions);$('plan-validity').textContent=result.valid?'Access dependencies are current. Check again before departure.':'This plan needs recalculation: access evidence changed or expired.';if(!result.valid)$('save-trip').hidden=true;}catch{$('save-trip').hidden=true;$('plan-validity').textContent='Could not recheck access. Treat the saved plan as unconfirmed.';}
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
function renderInterventions(){const root=$('intervention-list');root.replaceChildren();if(!data.interventions.length)root.append(el('p','No independently reviewed interventions are published yet.','subtle'));for(const i of data.interventions)root.append(el('h3',i.title),el('p',i.state+' · '+i.blockedRoutes+' affected reviewed circuits · '+(i.costPaise===null?'Quote missing':money(i.costPaise)),'subtle'));}
$('capacity-form').onsubmit=e=>{e.preventDefault();try{const r=C.rankInterventions(data.interventions,{budgetPaise:Math.round(Number($('crew-budget').value)*100),crewMinutes:Number($('crew-minutes').value)});const root=$('capacity-result');root.replaceChildren(el('p',r.selected.length+' interventions fit · '+money(r.costPaise)+' · '+r.crewMinutes+' crew minutes','notice'));for(const i of r.selected)root.append(el('p',i.title));for(const i of r.deferred)root.append(el('p',(data.interventions.find(x=>x.id===i.id)?.title||i.id)+': '+i.reason,'subtle'));root.append(el('p',r.policy,'subtle'));}catch(e){message($('capacity-result'),e.message);}};
const twinFields={water:[['inflowLps','Inflow litres/second'],['outflowLps','Outflow litres/second'],['storageLitres','Initial stored litres'],['capacityLitres','Storage capacity litres'],['durationMinutes','Duration minutes']],rain:[['rainMm','Event rainfall mm'],['catchmentM2','Catchment square metres'],['runoffCoefficient','Runoff fraction (0–1)'],['drainLps','Drain capacity litres/second'],['storageLitres','Available storage litres'],['durationMinutes','Duration minutes'],['blockedFraction','Blocked drainage fraction (0–1)']]};
function twinInputs(){const root=$('twin-inputs');root.replaceChildren();for(const [key,label] of twinFields[$('twin-model').value]){const l=el('label',label),i=el('input');i.id='twin-'+key;i.type='number';i.min='0';i.step='any';i.required=true;l.append(i);root.append(l);}}
$('twin-model').onchange=twinInputs;twinInputs();
$('twin-form').onsubmit=e=>{e.preventDefault();try{const kind=$('twin-model').value,input=Object.fromEntries(twinFields[kind].map(([k])=>[k,Number($('twin-'+k).value)])),r=kind==='water'?T.waterBalance(input):T.rainfallStorage(input);const root=$('twin-result');root.replaceChildren(el('p','Exploratory scenario · manual assumptions','badge'));for(const [k,v] of Object.entries(r))if(typeof v==='number')root.append(el('p',k.replace(/([A-Z])/g,' $1')+': '+Math.round(v).toLocaleString('en-IN')));root.append(el('p',r.assumptions,'notice'));}catch(e){message($('twin-result'),e.message);}};
for(const sector of P.sectors){const section=el('section',undefined,'sector');section.append(el('h3',sector.name),el('p','Available mechanisms: '+sector.available.join(' · ')),el('p','Policy proposals requiring separate authority and implementation: '+sector.proposals.join(' · '),'subtle'),el('p',sector.guard,'notice'));$('sector-rules').append(section);}
async function loadTelemetry(){
 const root=$('sensor-state');try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);let r;try{r=await sb.rpc('kasa_system_telemetry',{p_district:'purulia'}).abortSignal(controller.signal);}finally{clearTimeout(timer);}
 if(r.error||!Array.isArray(r.data))throw new Error();root.replaceChildren();if(!r.data.length)root.append(el('p','No authenticated public sensor feed is connected. Scenario inputs are manual assumptions.'));
 for(const {device,reading} of r.data){const state=T.readingState(reading,device);root.append(el('h3',device.name),el('p',reading.value+' '+device.unit+' · '+new Date(reading.measured_at).toLocaleString('en-IN')),el('p',state.state,state.usable?'subtle':'notice'));}
 }catch{root.textContent='Telemetry service unavailable. No live infrastructure status is asserted. Scenario inputs remain manual assumptions.';}
}
async function load(){
 try{
  if(!sb)throw new Error('Service connection unavailable');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let response;
  try{response=await sb.rpc('kasa_system_snapshot',{p_district:'purulia'}).abortSignal(controller.signal);}finally{clearTimeout(timer);}
  if(response.error||!snapshotOK(response.data))throw new Error('The service evidence backend is unavailable or not yet installed');data=response.data;
  $('connection').textContent='Public evidence refreshed '+new Date(data.at).toLocaleTimeString('en-IN')+'. Availability can change.';
  try{localStorage.setItem('parishkar_public_system_cache',JSON.stringify(data));}catch{}
 }catch(e){
  try{const cached=JSON.parse(localStorage.getItem('parishkar_public_system_cache'));if(snapshotOK(cached))data=cached;}catch{}
  $('connection').textContent='Live evidence unavailable. '+(data.nodes.length?'Showing saved public records; expired checks are excluded.':'Directory and planning claims remain unavailable until the evidence service is ready.');
 }
 renderServices();await checkPlan();await loadTelemetry();
}
try{const saved=JSON.parse(localStorage.getItem('parishkar_system_plan'));if(saved?.dependencies)lastPlan=saved;const reference=JSON.parse(localStorage.getItem('parishkar_official_reference'));if(reference?.reference)$('reference-state').textContent='Saved user-entered reference: '+reference.reference+' · not independently verified.';}catch{}
load();setInterval(()=>{if(!document.hidden&&navigator.onLine)load();},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});window.addEventListener('online',load);
})();
