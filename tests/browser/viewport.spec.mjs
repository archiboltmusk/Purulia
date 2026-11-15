import {test,expect,REPORTS} from './fixtures.mjs';
test('viewport replaces same-id updates, caps cache and normalises world bounds',async({page,backend})=>{
 let response=REPORTS.map(r=>({...r})),calls=[];
 await page.route('**/rest/v1/rpc/kasa_reports_in_bbox',async route=>{calls.push(route.request().postDataJSON());await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});});
 await page.goto('/kasa.html');await expect.poll(()=>page.evaluate(()=>typeof mainMap!=='undefined'&&!!mainMap?.getSource('reports'))).toBe(true);
 await page.evaluate(()=>loadReportsInView());
 response=response.map(r=>({...r,status:'resolved'}));await page.evaluate(()=>loadReportsInView());
 expect(await page.evaluate(()=>state.reports.find(r=>String(r.id)==='101').status)).toBe('resolved');
 response=Array.from({length:1000},(_,i)=>({...REPORTS[0],id:'viewport-'+i}));await page.evaluate(()=>loadReportsInView());
 await expect(page.locator('#k-viewport-note')).toContainText('1,000-report limit');
 response=[{...REPORTS[0],id:'different-area'}];await page.evaluate(()=>loadReportsInView());
 expect(await page.evaluate(()=>viewRows.size)).toBe(1);await expect(page.locator('#k-viewport-note')).toBeHidden();
 await page.evaluate(async()=>{const original=mainMap.getBounds.bind(mainMap);mainMap.getBounds=()=>({getWest:()=>170,getEast:()=>190,getSouth:()=>-20,getNorth:()=>20});try{await loadReportsInView()}finally{mainMap.getBounds=original;}});
 expect(calls.slice(-2).map(c=>[c.min_lng,c.max_lng])).toEqual([[170,180],[-180,-170]]);
});
