/* Reference points + schematic connections. This module never computes a road route. */
const engine=window.PuruliaTourism;
const status=key=>window.dispatchEvent(new CustomEvent('tourism:map-status',{detail:key}));
let map,ready=false,lastSelected=window.tourismMapState?.selectedId,lastCircuit=window.tourismMapState?.circuit;
function features(){
 const state=window.tourismMapState||{circuit:'all',ids:engine.places.map(p=>p.id),lang:'bn'};
 const geo=engine.geoJSON(state.circuit);
 geo.features=geo.features.filter(f=>f.geometry.type==='Point'?state.ids.includes(f.properties.id):!state.filtered);
 for(const f of geo.features)if(f.geometry.type==='Point')f.properties.name=engine.places.find(p=>p.id===f.properties.id).name[state.lang];
 return geo;
}
function update(){
 if(!ready)return;const data=features();map.getSource('tourism').setData(data);
 const state=window.tourismMapState,p=engine.places.find(p=>p.id===state?.selectedId);
 if(state.circuit!==lastCircuit){lastCircuit=state.circuit;const pts=data.features.filter(f=>f.geometry.type==='Point').map(f=>f.geometry.coordinates);if(pts.length){const bounds=pts.reduce((b,c)=>[[Math.min(b[0][0],c[0]),Math.min(b[0][1],c[1])],[Math.max(b[1][0],c[0]),Math.max(b[1][1],c[1])]],[[180,90],[-180,-90]]);map.fitBounds(bounds,{padding:45,maxZoom:12,duration:0})}}
 if(p?.coordinate&&lastSelected!==p.id){lastSelected=p.id;map.flyTo({center:[p.coordinate[1],p.coordinate[0]],zoom:11,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:700})}
}
status('mapLoading');
try{
 const gl=await import('./vendor/maplibre-gl-6.14.0/maplibre-gl.mjs');
 map=new gl.Map({container:'tourism-map',style:'https://tiles.openfreemap.org/styles/positron',center:[86.35,23.36],zoom:8.6,attributionControl:true});
 map.addControl(new gl.NavigationControl({showCompass:false}),'top-right');
 const timer=setTimeout(()=>{if(!ready)status('mapFallback')},12000);
 map.on('load',()=>{
  clearTimeout(timer);map.addSource('tourism',{type:'geojson',data:features()});
  map.addLayer({id:'circuit-lines',type:'line',source:'tourism',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['get','colour'],'line-width':4,'line-dasharray':[2,2],'line-opacity':.8}});
  map.addLayer({id:'tourism-stops',type:'circle',source:'tourism',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':7,'circle-color':'#c45d37','circle-stroke-color':'#ffffff','circle-stroke-width':2}});
  map.addLayer({id:'tourism-labels',type:'symbol',source:'tourism',filter:['==',['geometry-type'],'Point'],layout:{'text-field':['get','name'],'text-size':12,'text-offset':[0,1.2],'text-anchor':'top'},paint:{'text-color':'#193c32','text-halo-color':'#ffffff','text-halo-width':2}});
  map.on('click','tourism-stops',e=>{const id=e.features?.[0]?.properties?.id;if(engine.places.some(p=>p.id===id))window.dispatchEvent(new CustomEvent('tourism:select',{detail:id}))});
  map.on('mouseenter','tourism-stops',()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave','tourism-stops',()=>map.getCanvas().style.cursor='');
  ready=true;status('mapLoaded');update();
 });
 map.on('error',()=>{if(!ready)status('mapFallback')});
 window.addEventListener('tourism:map',update);
 window.addEventListener('pagehide',()=>map.remove(),{once:true});
}catch{status('mapFallback')}
