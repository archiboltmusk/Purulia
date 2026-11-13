/* UI uses textContent for source data and visitor input. No location permissions requested. */
'use strict';
const $=s=>document.querySelector(s),E=window.PuruliaTourism;
const keys=Object.keys(E.defaults),numeric=new Set(['days','party','hours','transfer']);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem('parishkar-tourism-'+key))??fallback}catch{return fallback}};
let lang=new URLSearchParams(location.search).get('lang')||read('language','bn');if(!['en','bn','hi'].includes(lang))lang='bn';
const t=(key,values)=>TourismWords.text(key,lang,values),name=p=>p.name[lang]||p.name.en;
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
function link(text,url){const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000)}
function save(k,v){try{localStorage.setItem('parishkar-tourism-'+k,JSON.stringify(v));return true}catch{toast(t('storage'));return false}}
function download(file,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=file;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function fillOptions(selector,rows,value){const select=$(selector);select.replaceChildren();for(const [id,text] of rows){const o=node('option',text);o.value=id;select.append(o)}if(rows.some(r=>r[0]===value))select.value=value}
let selectedId='ajodhya',mapCircuit='all',activePlan=null,providers=[],backendAvailable=false,providerError=false,selectedProvider=null,requestId=null;
let preferences=E.defaults;try{preferences=E.options(read('plan',E.defaults))}catch{}
try{const trip=new URLSearchParams(location.search).get('trip');if(trip)preferences=E.unpackTrip(trip)}catch{setTimeout(()=>toast(t('invalidLink')),0)}
let checks=read('checklist',[]);if(!Array.isArray(checks))checks=[];if(read('checklistVersion',1)!==2)checks=checks.map(n=>Number.isInteger(n)?n+1:null);checks=[...new Set(checks.filter(n=>Number.isInteger(n)&&n>=1&&n<=7))];save('checklistVersion',2);
let notes=read('issues',[]);if(!Array.isArray(notes))notes=[];notes=notes.filter(n=>n&&typeof n.id==='string'&&typeof n.location==='string'&&typeof n.detail==='string').slice(-200);
function translate(){
 document.documentElement.lang=lang;$('#language').value=lang;
 document.querySelectorAll('[data-t]').forEach(e=>e.textContent=t(e.dataset.t));
 document.querySelectorAll('[data-t-placeholder]').forEach(e=>e.placeholder=t(e.dataset.tPlaceholder));
 document.querySelectorAll('[data-t-title]').forEach(e=>e.title=t(e.dataset.tTitle));
 const circuit=$('#circuit').value||preferences.circuit,gateway=$('#gateway').value||preferences.gateway;
 fillOptions('#circuit',E.circuits.map(c=>[c.id,name(c)]),circuit);
 fillOptions('#map-circuit',[['all',t('allCircuits')],...E.circuits.map(c=>[c.id,name(c)])],mapCircuit);
 fillOptions('#gateway',E.gateways.map(g=>[g.id,name(g)]),gateway);
 renderPlaces();renderGuide();renderSchematic();renderChecklist();renderNotes();renderProviders();renderPlan();renderTemplate();renderQuoteFields();updateMap();
}
function visiblePlaces(){const q=$('#search').value.trim().toLocaleLowerCase(),kind=$('#place-kind').value;return E.places.filter(p=>(mapCircuit==='all'||p.circuit===mapCircuit)&&(kind==='all'||p.kind===kind)&&(!q||[...Object.values(p.name),...Object.values(p.experience)].join(' ').toLocaleLowerCase().includes(q)))}
function renderPlaces(){
 const root=$('#places'),rows=visiblePlaces();root.replaceChildren();$('#catalogue-count').textContent=rows.length+' / '+E.places.length;
 for(const p of rows){const card=node('article',undefined,'place');const body=node('div',undefined,'place-body');body.append(node('span',t(p.kind),'tag'),node('h3',name(p)),node('p',p.experience[lang]),node('small',t(p.coordinate?'area':'unlocated'),'note'));
 const button=node('button',t('show'));button.dataset.place=p.id;button.onclick=()=>selectPlace(p.id,true);body.append(button);card.append(body);root.append(card)}
 if(!rows.length)root.append(node('p',t('noPlaces'),'empty'));
}
function selectPlace(id,scroll=false){if(!E.places.some(p=>p.id===id))return;selectedId=id;renderGuide();updateMap();if(scroll)$('#place-guide').scrollIntoView({behavior:'smooth',block:'center'})}
function renderGuide(){
 const p=E.places.find(p=>p.id===selectedId)||E.places[0],root=$('#place-guide');root.replaceChildren();
 root.append(node('p',t(p.kind),'eyebrow'),node('h3',name(p)),node('p',t(p.coordinate?'area':'unlocated'),'note'),node('h4',t('unique')),node('p',p.experience[lang]),node('p',t('suggested'),'note'),node('p',t('visit',{n:p.visitMinutes})),node('p',t(p.steep?'steps':'gentleNote'),'note'),node('p',t('facilities'),'notice'));
 root.append(link(t('mapSearch'),'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(p.name.en+' Purulia West Bengal')));
 const sources=node('div',undefined,'source-strip');sources.append(link(t('source'),p.source));if(p.geometrySource)sources.append(link(t('geoSource'),p.geometrySource));root.append(sources,node('p',t('checked',{date:p.reviewedOn}),'note'));
}
function renderSchematic(){const root=$('#circuit-schematic');root.replaceChildren();const chosen=mapCircuit==='all'?E.circuits:E.circuits.filter(c=>c.id===mapCircuit);
 for(const c of chosen){const d=node('details');d.open=mapCircuit!=='all';d.style.setProperty('--route',c.colour);d.append(node('summary',name(c)));const ol=node('ol',undefined,'route-order');for(const id of c.stops){const p=E.places.find(p=>p.id===id),li=node('li'),b=node('button',name(p),'plain');b.onclick=()=>selectPlace(id);li.append(b);if(!p.coordinate)li.append(node('small',t('unlocated'),'note'));ol.append(li)}d.append(ol);root.append(d)}
 const refs=visiblePlaces();$('#map-count').textContent=t('mapCount',{pins:refs.filter(p=>p.coordinate).length,missing:refs.filter(p=>!p.coordinate).length});
}
function updateMap(){window.tourismMapState={lang,circuit:mapCircuit,ids:visiblePlaces().map(p=>p.id),selectedId,filtered:!!$('#search').value.trim()||$('#place-kind').value!=='all'};window.dispatchEvent(new Event('tourism:map'));}
window.addEventListener('tourism:select',e=>selectPlace(e.detail));
window.addEventListener('tourism:map-status',e=>{$('#map-status').textContent=t(e.detail)});
$('#search').addEventListener('input',()=>{renderPlaces();renderSchematic();updateMap()});$('#place-kind').onchange=()=>{renderPlaces();renderSchematic();updateMap()};$('#map-circuit').onchange=e=>{mapCircuit=e.target.value;renderPlaces();renderSchematic();updateMap()};
function formValues(){const v={};for(const k of keys)v[k]=numeric.has(k)?Number($('#'+k).value):$('#'+k).value;return E.options(v)}
for(const k of keys)if($('#'+k))$('#'+k).value=preferences[k];
function renderPlan(){
 activePlan=E.buildPlan(preferences);const root=$('#plan-output');root.replaceChildren();root.append(node('h3',name(activePlan.circuit)),node('p',t('provisional'),'notice'));
 if(activePlan.publicTransportUnconfirmed)root.append(node('p',t('publicWarning'),'notice'));
 for(const day of activePlan.days){const block=node('article',undefined,'day');block.append(node('h4',t('day',{n:day.number,time:day.start})));
  if(!day.stops.length)block.append(node('p',t('flex'),'note'));
  for(const [i,p] of day.stops.entries()){const stop=node('div',undefined,'stop'),body=node('div');body.append(node('strong',name(p)),node('p',p.experience[lang]));stop.append(node('span',String(i+1).padStart(2,'0')),body);block.append(stop)}
  if(day.stops.length)block.append(node('p',t('planned',{n:day.plannedMinutes}),'note'));
  const links=node('details');links.append(node('summary',t('routeLinks')));let previous=E.gateways.find(g=>g.id===preferences.gateway).name.en;
  for(const p of day.stops){const url=new URL('https://www.google.com/maps/dir/');url.searchParams.set('api','1');url.searchParams.set('origin',previous+' Purulia West Bengal');url.searchParams.set('destination',p.name.en+' Purulia West Bengal');links.append(link(previous+' → '+p.name.en,url.href));previous=p.name.en}
  if(day.stops.length){links.append(link(previous+' → '+name(E.gateways.find(g=>g.id===preferences.gateway)),'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(previous+' Purulia')+'&destination='+encodeURIComponent(E.gateways.find(g=>g.id===preferences.gateway).name.en+' Purulia')));block.append(links)}root.append(block);
 }
 if(activePlan.overflow.length)root.append(node('p',t('overflow',{names:activePlan.overflow.map(name).join(', ')}),'notice'));
 if(activePlan.excluded.length)root.append(node('p',t('excluded',{names:activePlan.excluded.map(x=>name(E.places.find(p=>p.id===x.id))).join(', ')}),'note'));
 root.append(node('p',t('routeDisclaimer'),'note'));updateTripLink();
}
$('#plan-form').onsubmit=e=>{e.preventDefault();try{preferences=formValues();save('plan',preferences);renderPlan();renderTemplate();mapCircuit=preferences.circuit;$('#map-circuit').value=mapCircuit;renderPlaces();renderSchematic();updateMap()}catch{toast(t('invalidLink'))}};
function updateTripLink(){const url=new URL(location.href);url.hash='planner';url.search='';url.searchParams.set('lang',lang);url.searchParams.set('trip',E.packTrip(preferences));$('#trip-link').value=url.href}
async function copy(value){try{await navigator.clipboard.writeText(value);toast(t('copied'));return true}catch{toast(t('copyFail'));return false}}
$('#share-trip').onclick=()=>copy($('#trip-link').value);$('#print-trip').onclick=()=>window.print();
function escaped(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('#download-trip').onclick=()=>{
 const h=s=>escaped(s),plan=activePlan;let body='<h1>'+h(name(plan.circuit))+'</h1><p>'+h(t('provisional'))+'</p><p>'+h(t('checked',{date:E.reviewedOn}))+'</p>';
 for(const d of plan.days){body+='<section><h2>'+h(t('day',{n:d.number,time:d.start}))+'</h2><ol>';for(const p of d.stops)body+='<li><h3>'+h(name(p))+'</h3><p>'+h(p.experience[lang])+'</p><p>'+h(t('facilities'))+'</p><p>'+h(t(p.coordinate?'area':'unlocated'))+'</p><a href="'+h(p.source)+'">'+h(t('source'))+'</a></li>';body+='</ol><p>'+h(t('planned',{n:d.plannedMinutes}))+'</p></section>'}
 body+='<h2>'+h(t('checklist'))+'</h2><ul>'+Array.from({length:7},(_,i)=>'<li>'+h(t('check'+(i+1)))+'</li>').join('')+'</ul><p>'+h(t('safety'))+'</p><p>'+h(t('routeDisclaimer'))+'</p>';
 download('purulia-trip-pack.html','<!doctype html><html lang="'+lang+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purulia trip pack</title><style>body{max-width:780px;margin:30px auto;padding:20px;font:17px/1.7 system-ui;color:#233e34}section{border-top:1px solid #ccc;margin-top:24px}a{overflow-wrap:anywhere}</style><body>'+body+'</body></html>','text/html');
};
const templateText={
 en:'Hello, I would like a {type} quote for [dates], {party} travellers, exploring {circuit}.\nPlease confirm availability, exact meeting point, capacity, accessibility, water/toilet arrangements, complete price including extras, cancellation terms and a backup plan.\nFor cultural visits, please agree the activity fee and photography permission directly. This is an enquiry, not a confirmed booking.',
 bn:'নমস্কার, [তারিখ]-এ {party} জনের জন্য {circuit} ঘোরার {type} পরিষেবার দাম জানতে চাই।\nসময়, সঠিক দেখা করার স্থান, ধারণক্ষমতা, চলাচলের সুবিধা, জল ও শৌচাগারের ব্যবস্থা, অতিরিক্ত খরচসহ পুরো দাম, বাতিলের শর্ত ও বিকল্প ব্যবস্থা জানাবেন।\nসাংস্কৃতিক ভ্রমণে কাজের পারিশ্রমিক ও ছবি তোলার অনুমতি সরাসরি ঠিক করব। এটি খোঁজের বার্তা, নিশ্চিত বুকিং নয়।',
 hi:'नमस्ते, [तारीख] को {party} यात्रियों के लिए {circuit} घूमने की {type} सेवा का भाव चाहिए।\nउपलब्धता, सही मिलने की जगह, क्षमता, सुलभता, पानी/शौचालय व्यवस्था, अतिरिक्त खर्च सहित पूरा भाव, रद्द करने की शर्तें और वैकल्पिक व्यवस्था बताएँ।\nसांस्कृतिक भ्रमण में गतिविधि शुल्क और फोटो की अनुमति सीधे तय करेंगे। यह पूछताछ है, पुष्ट बुकिंग नहीं।'};
function renderTemplate(){let s=templateText[lang];for(const [k,v] of Object.entries({type:t($('#request-type').value),party:preferences.party,circuit:name(E.circuits.find(c=>c.id===preferences.circuit))}))s=s.replaceAll('{'+k+'}',v);$('#request-text').value=s}
$('#request-type').onchange=renderTemplate;$('#copy-request').onclick=()=>copy($('#request-text').value);
function renderChecklist(){const root=$('#checklist');root.replaceChildren();for(let i=1;i<=7;i++){const label=node('label',undefined,'check'),input=node('input');input.type='checkbox';input.checked=checks.includes(i);input.onchange=()=>{checks=checks.filter(n=>n!==i);if(input.checked)checks.push(i);save('checklist',checks)};label.append(input,node('span',t('check'+i)));root.append(label)}}
function renderNotes(){const root=$('#issues');root.replaceChildren();if(!notes.length)root.append(node('p',t('emptyNotes'),'empty'));for(const n of [...notes].reverse()){const card=node('article',undefined,'issue'),del=node('button',t('delete'),'plain');card.append(node('strong',n.location),node('p',n.detail));del.onclick=()=>{notes=notes.filter(x=>x.id!==n.id);save('issues',notes);renderNotes()};card.append(del);root.append(card)}}
$('#issue-form').onsubmit=e=>{e.preventDefault();const location=$('#issue-location').value.trim(),detail=$('#issue-detail').value.trim();if(!location||!detail)return;notes.push({id:crypto.randomUUID(),created:new Date().toISOString(),location,detail});notes=notes.slice(-200);save('issues',notes);renderNotes();e.target.reset()};
$('#export-issues').onclick=()=>download('purulia-issue-drafts.json',JSON.stringify({private:true,submitted:false,notes},null,2));
const quotes=['transport','stay','food','experience','fees','reserve'];
function renderQuoteFields(){const values=quotes.map(k=>$('#quote-'+k)?.value||'');$('#quote-fields').replaceChildren();quotes.forEach((k,i)=>{const d=node('div'),label=node('label',t(k)+' · ₹'),input=node('input');label.htmlFor='quote-'+k;input.id='quote-'+k;input.type='number';input.min='0';input.max='10000000';input.step='.01';input.value=values[i];d.append(label,input);$('#quote-fields').append(d)});$('#budget-output').textContent=t('budgetIntro')}
$('#budget-form').onsubmit=e=>{e.preventDefault();try{const r=E.quoteTotal(quotes.map(k=>$('#quote-'+k).value),Number($('#budget-party').value)),money=n=>new Intl.NumberFormat(lang==='bn'?'bn-IN':lang==='hi'?'hi-IN':'en-IN',{style:'currency',currency:'INR'}).format(n);$('#budget-output').textContent=t('quoteResult',{total:money(r.total),each:money(r.perPerson),missing:r.missing})}catch{toast(t('budgetIntro'))}};
async function publicRPC(method,body={}){const c=window.KASA_CONFIG;if(!c?.SUPABASE_URL||!c?.SUPABASE_ANON_KEY)throw Error('unconfigured');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const r=await fetch(c.SUPABASE_URL+'/rest/v1/rpc/'+method,{method:'POST',headers:{apikey:c.SUPABASE_ANON_KEY,Authorization:'Bearer '+c.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('unavailable');const text=await r.text();if(text.length>200000)throw Error('too_large');return JSON.parse(text)}finally{clearTimeout(timer)}}
async function loadProviders(){try{const rows=await publicRPC('kasa_tourism_providers');if(!Array.isArray(rows))throw Error('invalid');providers=rows.filter(p=>E.isProviderCurrent(p));backendAvailable=true;providerError=false}catch{providers=[];providerError=true}renderProviders()}
function renderProviders(){const root=$('#provider-list');root.replaceChildren();$('#provider-status').textContent=t(providerError?'backendOff':backendAvailable?providers.length?'serviceIntro':'noProviders':'loading');for(const p of providers.filter(p=>E.isProviderCurrent(p))){const card=node('article',undefined,'service'),button=node('button',t('enquire'));card.append(node('p',t(p.kind),'tag'),node('h3',p.name),node('p',t('expiry',{date:p.verified_at.slice(0,10),until:p.verified_until.slice(0,10)}),'note'),link(t('contact'),p.contact_url),link(t('evidence'),p.evidence_url));button.onclick=()=>{selectedProvider=p;requestId=null;$('#enquiry-provider').textContent=p.name;$('#enquiry-box').hidden=false;$('#enquiry-party').value=preferences.party;$('#enquiry-box').scrollIntoView({behavior:'smooth',block:'center'})};card.append(button);root.append(card)}}
$('#enquiry-form').onsubmit=async e=>{e.preventDefault();if(!selectedProvider||!E.isProviderCurrent(selectedProvider))return;const button=$('#submit-enquiry');button.disabled=true;requestId=requestId||crypto.randomUUID();try{const client=await window.tourismClient();let {data,error}=await client.auth.getSession();if(error)throw error;if(!data.session){const auth=await client.auth.signInAnonymously();if(auth.error)throw auth.error}const result=await client.rpc('kasa_tourism_enquire',{p_request_id:requestId,p_provider:selectedProvider.id,p_date:$('#enquiry-date').value,p_party:Number($('#enquiry-party').value),p_message:$('#enquiry-message').value});if(result.error)throw result.error;$('#enquiry-status').textContent=t('enquirySent',{id:result.data.id});requestId=null;}catch{$('#enquiry-status').textContent=t('enquiryError')}finally{button.disabled=false}};
$('#my-enquiries').onclick=async()=>{const root=$('#enquiry-list');root.replaceChildren();try{const client=await window.tourismClient(),session=await client.auth.getSession();if(!session.data.session){root.textContent=t('noEnquiries');return}const result=await client.rpc('kasa_tourism_my_enquiries');if(result.error||!Array.isArray(result.data))throw Error('unavailable');if(!result.data.length)root.textContent=t('noEnquiries');for(const r of result.data){const p=node('article',undefined,'issue');p.append(node('strong',String(r.provider_name||r.provider_id)),node('p',String(r.status)),node('p',String(r.reply||'')));root.append(p)}}catch{root.textContent=t('backendOff')}};
$('#clear-data').onclick=()=>{if(confirm(t('clearConfirm'))){try{['plan','checklist','checklistVersion','issues','language'].forEach(k=>localStorage.removeItem('parishkar-tourism-'+k));location.href='tourism.html'}catch{toast(t('storage'))}}};
$('#language').onchange=e=>{lang=e.target.value;save('language',lang);translate()};
translate();for(const k of keys)if($('#'+k))$('#'+k).value=preferences[k];renderPlan();loadProviders();
window.tourismUI={selectPlace,refreshProviders:loadProviders};

setInterval(()=>{if(!document.hidden&&backendAvailable)loadProviders()},60000);
