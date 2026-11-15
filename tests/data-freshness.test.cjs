const {test}=require('node:test');const assert=require('node:assert/strict');
const {freshness}=require('../data-freshness.js');const now=Date.parse('2026-11-15');
test('source checks distinguish missing, stale, future and invalid dates',()=>{
 assert.equal(freshness({},now).read,null);assert.equal(freshness({read:'2026-02-30'},now).read,null);
 assert.match(freshness({read:'2026-11-16'},now).state,/future/);
 assert.match(freshness({name:'Jal Jeevan Mission dashboard',read:'2026-09-01'},now).state,/rechecking/);
 assert.match(freshness({name:'NFHS-5 (2019–21)',read:'2026-09-01'},now).state,/within/);
 assert.match(freshness({name:'Census 2011',read:'2025-09-01'},now).state,/rechecking/);
});
