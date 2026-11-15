import * as maplibregl from './vendor/maplibre-gl-6.14.0/maplibre-gl.mjs';
const {mapPlaces:places,stations}=window.PuruliaTourism;
const status=document.getElementById('route-status'),button=document.getElementById('road-route');
let map,ready=false,points=[],controller=null,revision=0;const pins=new Map();
const feature=coordinates=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates}});
const empty=()=>({type:'FeatureCollection',features:[]});
function clearRequest(){revision++;controller?.abort();controller=null;button.disabled=false;}
function update(plan){
 clearRequest();
 const select=document.getElementById('route-day');
 select.replaceChildren();
 (plan?.days||[]).forEach((_,i)=>{const o=document.createElement('option');o.value=i;o.textContent='Day '+plan.dayNumbers[i];select.append(o);});
 select.disabled=!plan?.days.length;
 draw(plan,0);
}
function draw(plan,index){
 clearRequest();
 const stops=plan?.days[index]||[];points=stops.length?[plan.station,...stops,plan.station]:[];
 document.getElementById('route-stops').replaceChildren(...points.map((p,i)=>{const li=document.createElement('li');li.textContent=(p===plan.station?(i===0?'Start: ':'Return: '):i+'. ')+p.name;return li;}));
 status.textContent=points.length?'Dashed line: schematic stop order, not a road route. Calculate to see estimated driving distance and time.':'No scheduled visits. Browse the destinations or change the trip window.';
 button.disabled=points.length<2;
 if(!ready)return;
 for(const [id,pin] of pins){const i=stops.findIndex(p=>p.id===id);pin.textContent=i<0?'·':String(i+1);pin.style.opacity=i<0?'.65':'1';}
 map.getSource('circuit').setData(points.length?feature(points.map(p=>[p.lon,p.lat])):empty());
 map.setPaintProperty('circuit-line','line-dasharray',[2,2]);
 if(points.length)map.fitBounds(points.reduce((b,p)=>b.extend([p.lon,p.lat]),new maplibregl.LngLatBounds()),{padding:55,maxZoom:12});
}
const dayLabel=document.createElement('label');dayLabel.htmlFor='route-day';dayLabel.textContent='Show itinerary day';
const daySelect=document.createElement('select');daySelect.id='route-day';
button.before(dayLabel,daySelect);daySelect.onchange=()=>draw(window.getTourismPlan(),Number(daySelect.value));
window.addEventListener('tourism-plan',e=>update(e.detail));
window.addEventListener('tourism-focus',e=>{if(ready)map.flyTo({center:[e.detail.lon,e.detail.lat],zoom:11});});
button.addEventListener('click',async()=>{
 clearRequest();const request=revision;controller=new AbortController();const activeController=controller;
 const snapshot=points.map(p=>[p.lon,p.lat]);if(snapshot.length<2)return;
 button.disabled=true;status.textContent='Calculating driving route…';
 const timeout=setTimeout(()=>activeController.abort(),12000);
 try{
  const url='https://router.project-osrm.org/route/v1/driving/'+snapshot.map(c=>c.join(',')).join(';')+'?overview=full&geometries=geojson&steps=false';
  const response=await fetch(url,{signal:activeController.signal});if(!response.ok)throw new Error('Routing unavailable');
  const data=await response.json(),r=data.routes?.[0];
  if(data.code!=='Ok'||!r||!Number.isFinite(r.distance)||!Number.isFinite(r.duration)||r.geometry?.type!=='LineString'||!Array.isArray(r.geometry.coordinates)||r.geometry.coordinates.length<2||!r.geometry.coordinates.every(p=>p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])))throw new Error('No usable route');
  if(request!==revision)return;
  if(ready){map.getSource('circuit').setData({type:'Feature',properties:{},geometry:r.geometry});map.setPaintProperty('circuit-line','line-dasharray',[1,0]);}
  status.textContent=`OSRM driving estimate: ${(r.distance/1000).toFixed(1)} km · ${Math.ceil(r.duration/60)} minutes, excluding visits, traffic and closures. Approximate area pins; confirm entrances. Calculated ${new Date().toLocaleString('en-IN')}.`;
 }catch(e){if(request===revision)status.textContent='Road routing unavailable. The dashed line remains schematic; use the daily navigation link and confirm locally.';}
 finally{clearTimeout(timeout);if(request===revision){controller=null;button.disabled=false;}}
});
try{
 map=new maplibregl.Map({container:'circuit-map',center:[86.4,23.36],zoom:8,style:{version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}},layers:[{id:'osm',type:'raster',source:'osm'}]}});
 map.addControl(new maplibregl.NavigationControl());
 map.on('load',()=>{
  ready=true;map.addSource('circuit',{type:'geojson',data:empty()});map.addLayer({id:'circuit-line',type:'line',source:'circuit',paint:{'line-color':'#b44228','line-width':4,'line-dasharray':[2,2]}});
  places.forEach((p,i)=>{const pin=document.createElement('button');pin.className='tourism-pin';pins.set(p.id,pin);pin.textContent=String(i+1);pin.setAttribute('aria-label',p.name);new maplibregl.Marker({element:pin}).setLngLat([p.lon,p.lat]).setPopup(new maplibregl.Popup().setText(`${p.name} · Approximate area; entrance unverified`)).addTo(map);});
  Object.values(stations).forEach(p=>new maplibregl.Marker({color:'#193c32'}).setLngLat([p.lon,p.lat]).setPopup(new maplibregl.Popup().setText(p.name+' · Approximate station area')).addTo(map));
  draw(window.getTourismPlan(),Number(daySelect.value||0));
 });
}catch{status.textContent='Interactive map unavailable. The destination list and daily navigation links remain usable.';}
update(window.getTourismPlan());
