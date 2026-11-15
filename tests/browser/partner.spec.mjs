import {test,expect} from '@playwright/test';
async function setup(page,admin=false){
 await page.addInitScript(({admin})=>{
  window.partnerCalls=[];window.partnerState=location.pathname.endsWith('/case.html')?'verified':'in_progress';
  const order=()=>({order_id:1,report_id:'11111111-1111-4111-8111-111111111111',office:'Test office',state:window.partnerState,order_no:'TEST-1'});
  window.partnerClient={auth:{getSession:async()=>({data:{session:{user:{id:'worker'}}}}),signOut:async()=>({})},
   rpc:async(name,body)=>{window.partnerCalls.push({name,body});if(name==='kasa_admin_queue')return admin?{data:[]}:{error:{message:'workers only'}};
    if(name==='kasa_partner_my_orders')return {data:[order()]};if(name==='kasa_partner_board')return {data:{orders:[order()],counts:{}}};
    if(name==='kasa_partner_order_photos')return {data:[{id:3,path:'partner/test.jpg',current:true,taken_at:new Date().toISOString()}]};
    if(name==='kasa_partner_worker_step'&&body.p_action==='complete')return {error:{message:'Take a work photo first'}};
    if(name==='kasa_partner_reopen'){window.partnerState='reopened';return {data:{ok:true}};}
    if(name==='kasa_issue_capture_token')return {data:'11111111-1111-4111-8111-111111111111'};return {data:{ok:true}};
   },from:()=>({select(){return this},neq(){return this},order(){return this},limit:async()=>({data:[]})}),
   storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'data:image/gif;base64,R0lGODlhAQABAAAAACw='}}),upload:async(path)=>{window.partnerCalls.push({name:'upload',path});return {};}})}};
 },{admin});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.partnerClient}'}));
}
test('worker sees only their jobs, completion errors remain actionable',async({page})=>{
 await setup(page);await page.goto('/partner.html');await expect(page.locator('#worker')).toBeVisible();await expect(page.locator('#app')).toBeHidden();
 await page.getByRole('button',{name:'Work photos',exact:true}).click();await expect(page.locator('.photo-panel')).toContainText('Awaiting review');
 page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Mark complete',exact:true}).click();await expect(page.locator('#werr')).toContainText('Take a work photo');
});
test('officer can review photos and send reopened work back',async({page})=>{
 await setup(page,true);await page.goto('/partner.html');await page.getByRole('button',{name:'Review work photos'}).click();await page.getByRole('button',{name:'Approve photo',exact:true}).click();
 expect(await page.evaluate(()=>partnerCalls.some(c=>c.name==='kasa_admin_partner_photo_review'&&c.body.p_decision==='approve'))).toBe(true);
});
test('public case offers reopen without exposing work photos',async({page})=>{
 await setup(page);await page.route('**/case.js',r=>r.fulfill({contentType:'application/javascript',body:''}));
 await page.addInitScript(()=>{window.addEventListener('DOMContentLoaded',()=>{window.partnerState='verified';});});
 await page.goto('/case.html?id=11111111-1111-4111-8111-111111111111');
 await expect(page.locator('#case-work-orders')).toContainText('Test office');page.on('dialog',d=>d.accept('The repaired area has failed again.'));
 await page.getByRole('button',{name:'Reopen disputed work'}).click();await expect(page.locator('#case-work-orders')).toContainText('Reopened for officer review');
 expect(await page.evaluate(()=>partnerCalls.some(c=>c.name==='kasa_partner_order_photos'))).toBe(false);
});
test('worker captures live GPS evidence and retries without replacing the photo',async({page})=>{
 await setup(page);await page.goto('/partner.html');
 await page.evaluate(()=>{
  const original=partnerClient.storage.from;
  let attempts=0;partnerClient.storage.from=(bucket)=>({...original(bucket),upload:async(path)=>{partnerCalls.push({name:'upload',path});return ++attempts===1?{error:{message:'Temporary upload failure'}}:{};}});
 });
 await page.getByRole('button',{name:'Take work photo',exact:true}).click();
 await expect(page.locator('#work-shutter')).toBeEnabled();await page.locator('#work-shutter').click();
 await expect(page.locator('#camera-status')).toContainText('Temporary upload failure');
 await page.getByRole('button',{name:'Retry photo upload',exact:true}).click();await expect(page.locator('#camera-status')).toContainText('Work photo recorded');
 const calls=await page.evaluate(()=>partnerCalls);const uploads=calls.filter(c=>c.name==='upload');expect(uploads).toHaveLength(2);expect(uploads[0].path).toBe(uploads[1].path);
 const meta=calls.find(c=>c.name==='kasa_partner_add_work_photo').body.p_meta;expect(meta.capture).toBe('live');expect(meta.lat).toBeCloseTo(23.3321);expect(meta.accuracy).toBe(10);
 expect(calls.filter(c=>c.name==='kasa_issue_capture_token')).toHaveLength(1);
 await page.getByRole('button',{name:'Close camera',exact:true}).click();await expect(page.locator('#work-camera')).not.toBeVisible();
});
