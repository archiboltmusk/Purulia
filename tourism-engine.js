(function(root){
'use strict';
const places=[
 {id:'ajodhya',name:'Ajodhya Hills',circuit:'ajodhya',kind:'nature',lat:23.2,lon:86.1,desc:'Sal forests, hill views and a slower kind of escape.',activity:'Ask a local guide for a short, permitted viewpoint walk.',steep:false,sky:'#d4cfb2',mount:'#53725b',accent:'#e8d8aa',symbol:'◯'},
 {id:'charida',name:'Charida',circuit:'ajodhya',kind:'culture',lat:23.115,lon:86.065,desc:'Meet the hands behind Purulia’s extraordinary Chhau masks.',activity:'Arrange a paid mask-making visit directly with an artisan.',steep:false,sky:'#d6b18f',mount:'#a75b3b',accent:'#f4d7a5',symbol:'✺'},
 {id:'turga',name:'Turga Falls',circuit:'ajodhya',kind:'nature',lat:23.184,lon:86.073,desc:'A waterfall stop that needs careful access and weather checks.',activity:'View only from permitted areas; expect steps and uneven ground.',steep:true,waterfall:true,sky:'#b9c8b5',mount:'#355e4c',accent:'#dee5d0',symbol:'≋'},
 {id:'baranti',name:'Baranti / Muradi Dam',circuit:'north',kind:'nature',lat:23.569,lon:86.861,desc:'Open water, quiet horizons and time to pause.',activity:'Choose a permitted lakeside viewpoint; confirm local access.',steep:false,sky:'#ddcba9',mount:'#748375',accent:'#efd99d',symbol:'◯'},
 {id:'panchakot',name:'Garh Panchakot',circuit:'north',kind:'culture',lat:23.605,lon:86.761,desc:'Heritage remains set against a wooded hill landscape.',activity:'Explore permitted heritage areas with local interpretation.',steep:false,sky:'#c5c9af',mount:'#5b7154',accent:'#d4a36e',symbol:'⌂'},
 {id:'joychandi',name:'Jaichandi Pahar',circuit:'north',kind:'nature',lat:23.546,lon:86.674,desc:'Rocky silhouettes and a climb for those comfortable with steps.',activity:'Consider the climb only in suitable weather and with fitness for steps.',steep:true,sky:'#ddc7ad',mount:'#8c7861',accent:'#f1dbb7',symbol:'△'},
 {id:'town',name:'Purulia town',circuit:'town',kind:'culture',lat:23.333,lon:86.366,desc:'A practical arrival base and a gentle first day.',activity:'Explore local food and markets; confirm walking conditions.',steep:false,sky:'#d7c7ac',mount:'#a47755',accent:'#eadbbd',symbol:'⌂'}
];
const labels={ajodhya:'Ajodhya & Charida',north:'Baranti & Garh Panchakot',town:'Purulia town'};
function validOptions(v){return !!v&&['ajodhya','north','town'].includes(v.circuit)&&Number.isInteger(v.days)&&v.days>=1&&v.days<=3&&Number.isInteger(v.party)&&v.party>=1&&v.party<=30&&['slow','full'].includes(v.pace)&&['standard','gentle'].includes(v.access)&&['mild','hot','rain'].includes(v.season)}
function quoteTotal(values,party){
 if(!Number.isInteger(party)||party<1||party>30)throw new TypeError('Travellers must be an integer from 1 to 30');
 let cents=0,missing=0;
 for(const raw of values){if(raw===''||raw===null||raw===undefined){missing++;continue}const n=Number(raw);if(!Number.isFinite(n)||n<0||n>10000000)throw new TypeError('Enter a valid non-negative quote');cents+=Math.round(n*100)}
 return {total:cents/100,perPerson:Math.round(cents/party)/100,missing};
}
// Durations below are explicit planning allowances, not measured travel times.
const stations={purulia:{name:'Purulia Junction',lat:23.323,lon:86.363},adra:{name:'Adra Junction',lat:23.496,lon:86.674},barabhum:{name:'Barabhum station',lat:23.045,lon:86.354}};
const refs={charida:'charidah',turga:'turga-falls',baranti:'muradi-dam-boronti',panchakot:'garh-panchakot',joychandi:'jaichandi-pahar'};
for(const p of places){
 p.source='https://purulia.gov.in/'+(refs[p.id]?'tourist-place/'+refs[p.id]+'/':'tourist-places/');
 p.referenceChecked=refs[p.id]?'2026-11-15':null;
 p.entranceVerified=false;p.facilitiesChecked=null;p.visitMinutes=p.id==='charida'?120:90;
}
const catalogueTools=typeof module==='object'&&module.exports?require('./tourism-catalogue.js'):root.PuruliaCatalogue;
const catalogue=catalogueTools.catalogue(places);
const mapPlaces=catalogue.filter(catalogueTools.located);
function minutes(time){if(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new TypeError('Enter a valid time');return Number(time.slice(0,2))*60+Number(time.slice(3));}
function distance(a,b){const r=x=>x*Math.PI/180;return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(r(b.lat-a.lat)/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(r(b.lon-a.lon)/2)**2)));}
function navigation(stops,station){
 const points=[station,...stops,station].filter(Boolean);if(points.length<2)return null;
 const query=p=>p.name+' Purulia West Bengal';
 const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');u.searchParams.set('origin',query(points[0]));u.searchParams.set('destination',query(points.at(-1)));u.searchParams.set('travelmode','driving');
 if(points.length>2)u.searchParams.set('waypoints',points.slice(1,-1).map(query).join('|'));return u.href;
}
function buildPlan(v){
 if(!validOptions(v))throw new TypeError('Invalid itinerary options');
 const station=stations[v.station||'purulia'];if(!station)throw new TypeError('Choose an arrival station');
 if(v.transport && v.transport!=='vehicle')throw new TypeError('This circuit planner requires a car or hired vehicle; public transport times are not available.');
 const arrival=minutes(v.arrival||'08:00'),departure=minutes(v.departure||'19:00');
 if(v.days===1&&departure<=arrival)throw new TypeError('Departure must be after arrival for a day trip');
 let eligible=places.filter(p=>p.circuit===v.circuit&&!(v.access==='gentle'&&p.steep)&&!(v.season==='rain'&&p.waterfall)&&!(v.season==='hot'&&p.steep));
 // Nearest-next order is geographic only. Road routing is requested separately.
 const ordered=[];let last=station;
 while(eligible.length){eligible.sort((a,b)=>distance(last,a)-distance(last,b));last=eligible.shift();ordered.push(last);}
 const limit=v.pace==='slow'||v.season==='hot'?2:3,days=Array.from({length:v.days},()=>[]),allowances=Array(v.days).fill(0),omitted=[];
 for(const p of ordered){let placed=false;
  for(let i=0;i<v.days;i++){
   const begin=i===0?Math.max(480,arrival):480,end=i===v.days-1?Math.min(1080,departure-60):1080;
   const candidate=[...days[i],p];
   // Reserve station transfers every day until an overnight base is confirmed.
   let previous=station,km=0;for(const x of candidate){km+=distance(previous,x);previous=x;}km+=distance(previous,station);
   const allowance=Math.ceil(km*1.5/30*60)+candidate.reduce((a,x)=>a+x.visitMinutes,0)+60;
   if(days[i].length<limit&&allowance<=end-begin){days[i].push(p);allowances[i]=allowance;placed=true;break;}
  }
  if(!placed)omitted.push(p.name);
 }
 const active=days.map((stops,i)=>({stops,day:i+1,allowance:allowances[i]})).filter(d=>d.stops.length);
 const notice=[v.season==='rain'?'Waterfalls omitted in rain.':v.season==='hot'?'Heat plan: no steep climbs.':'Confirm current access before departure.',
 'Time budgets use planning assumptions: 90–120 minutes per visit, 30 km/h over 1.5× straight-line distance, a 60-minute break and a 60-minute departure buffer. They are not road travel predictions.',
 active.length<v.days?'Only '+active.length+' of '+v.days+' days have scheduled visits; remaining days are unscheduled.':'',omitted.length?'Could not fit: '+omitted.join(', ')+'. Extend the trip or change arrival/departure.':''].filter(Boolean).join(' ');
 return {...v,station,days:active.map(d=>d.stops),dayNumbers:active.map(d=>d.day),allowances:active.map(d=>d.allowance),omitted,requestedDays:v.days,notice};
}

const api={places,mapPlaces,catalogue,catalogueTools,labels,stations,buildPlan,validOptions,quoteTotal,navigation,minutes,distance};if(typeof module==='object'&&module.exports)module.exports=api;else root.PuruliaTourism=api;
})(typeof globalThis!=='undefined'?globalThis:this);
