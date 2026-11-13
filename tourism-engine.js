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
function buildPlan(v){if(!validOptions(v))throw new TypeError('Invalid itinerary options');let eligible=places.filter(p=>p.circuit===v.circuit&&!(v.access==='gentle'&&p.steep)&&!(v.season==='rain'&&p.waterfall)&&!(v.season==='hot'&&p.steep));const limit=v.pace==='slow'||v.season==='hot'?2:3;let days=Array.from({length:v.days},()=>[]);eligible.forEach((p,i)=>{const day=Math.floor(i/limit);if(day<days.length)days[day].push(p)});return {...v,days,notice:v.season==='rain'?'Rain plan: waterfalls omitted. Confirm road and site access before leaving.':v.season==='hot'?'Heat plan: fewer stops and no steep climbs. Prefer early outings and an indoor midday break.':'Confirm access, transport and facilities directly before departure.'}}

const api={places,labels,buildPlan,validOptions,quoteTotal};if(typeof module==='object'&&module.exports)module.exports=api;else root.PuruliaTourism=api;
})(typeof globalThis!=='undefined'?globalThis:this);
