// Run the real foreground controller in a minimal DOM to test consent/permission boundaries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const Journey = require('../journey-core.js');
function harness() {
  const elements = new Map(), documentEvents = {}, windowEvents = {}, calls = [], cleared = [], intervals = [];
  let gpsRequests = 0, callback;
  const get = id => { if (!elements.has(id)) elements.set(id, { textContent:'', value:'', checked:false, disabled:false, events:{}, addEventListener(k,f){this.events[k]=f;}, replaceChildren(){}, append(){} }); return elements.get(id); };
  const document = { hidden:false, getElementById:get, addEventListener(k,f){documentEvents[k]=f;} };
  const config = { SUPABASE_URL:'https://example.invalid', SUPABASE_ANON_KEY:'PUBLIC_TEST_KEY' };
  const context = { Journey, Date, Math, Number, JSON, Error, AbortController, console, crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}, sessionStorage:{getItem:()=>null,setItem(){}}, document,
    navigator:{geolocation:{watchPosition(f){gpsRequests++;callback=f;return 7;},clearWatch(id){cleared.push(id);}}},
    window:{KASA_CONFIG:config,addEventListener(k,f){windowEvents[k]=f;}},
    setTimeout:()=>1,clearTimeout(){},setInterval:f=>intervals.push(f),
    fetch:async (url,options)=>{calls.push({url,payload:JSON.parse(options.body)});return {ok:true,json:async()=>({available:true})};} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../journey.js'),'utf8'),context);
  return {get,document,documentEvents,windowEvents,calls,cleared,intervals,gpsRequests:()=>gpsRequests,fix:()=>callback({coords:{latitude:28.6,longitude:77.2,accuracy:10},timestamp:Date.now()})};
}
const settle = async () => { await new Promise(resolve=>setImmediate(resolve)); };
test('page load never requests GPS and availability probe contains no coordinates', async()=>{const h=harness();await settle();assert.equal(h.gpsRequests(),0);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].payload,{});});
test('GPS fixes never upload automatically, and stop clears the watch and share state', async()=>{const h=harness();await settle();h.get('journey-start').events.click();h.fix();assert.equal(h.calls.length,1);h.get('journey-stop').events.click();assert.deepEqual(h.cleared,[7]);assert.equal(h.get('journey-share').disabled,true);assert.match(h.get('journey-location').textContent,/off/);});
test('hidden tabs stop foreground tracking', async()=>{const h=harness();await settle();h.get('journey-start').events.click();h.document.hidden=true;h.documentEvents.visibilitychange();assert.deepEqual(h.cleared,[7]);});
test('sharing requires separate consent and route before transmitting a fix', async()=>{const h=harness();await settle();h.get('journey-start').events.click();h.fix();h.get('journey-route').value='TEST';await h.get('journey-share').events.click();assert.equal(h.calls.length,1);h.get('journey-consent').checked=true;await h.get('journey-share').events.click();assert.equal(h.calls.length,2);assert.match(h.calls[1].url,/kasa_transit_submit$/);assert.equal(h.calls[1].payload.p_lat,28.6);});
