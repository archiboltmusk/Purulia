import {test,expect,stubBackend} from './fixtures.mjs';
test.beforeEach(async({page})=>{await stubBackend(page,{rpc:{kasa_tourism_providers:[]}})});
test('catalogue, source confidence, search and circuit diagram',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('tourism.html?lang=en');
 await expect(page.locator('#places .place')).toHaveCount(23);
 await page.locator('#search').fill('charida');await expect(page.locator('#places .place')).toHaveCount(1);
 await page.locator('[data-place="charida"]').click();await expect(page.locator('#place-guide')).toContainText('mask-making');
 await expect(page.locator('#place-guide')).toContainText('entrance unverified');
 await page.locator('#search').fill('');await page.locator('#map-circuit').selectOption('central');
 await expect(page.locator('#places .place')).toHaveCount(2);await expect(page.locator('#map-count')).toContainText('2 locations pending');
 await expect(page.locator('#circuit-schematic .route-order li')).toHaveCount(2);
 expect(errors).toEqual([]);
});
test('planner handles mobility, rain, late arrival and public-transport uncertainty',async({page})=>{
 await page.goto('tourism.html?lang=en');await page.locator('#season').selectOption('rain');await page.locator('#access').selectOption('gentle');await page.locator('#transport').selectOption('public');await page.locator('#plan-form button').click();
 await expect(page.locator('#plan-output .stop').filter({hasText:'Bamni Falls'})).toHaveCount(0);await expect(page.locator('#plan-output .stop').filter({hasText:'Turga Falls'})).toHaveCount(0);
 await expect(page.locator('#plan-output')).toContainText('public connections are unconfirmed');
 await page.locator('#days').selectOption('1');await page.locator('#arrival').fill('20:00');await page.locator('#plan-form button').click();
 await expect(page.locator('#plan-output .stop')).toHaveCount(0);await expect(page.locator('#plan-output')).toContainText('No additional stop fits');
});
test('languages, trip sharing, offline pack and storage persistence',async({page})=>{
 await page.goto('tourism.html');await expect(page.locator('html')).toHaveAttribute('lang','bn');
 await page.locator('#language').selectOption('hi');await expect(page.locator('h1')).toContainText('पुरुलिया');
 await page.locator('#language').selectOption('en');await page.locator('#party').fill('5');await page.locator('#plan-form button').click();
 const trip=await page.locator('#trip-link').inputValue();await page.goto(trip);await expect(page.locator('#party')).toHaveValue('5');
 const pack=page.waitForEvent('download');await page.locator('#download-trip').click();expect((await pack).suggestedFilename()).toBe('purulia-trip-pack.html');
 await page.locator('#checklist input').first().check();await page.reload();await expect(page.locator('#checklist input').first()).toBeChecked();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('quotes, private notes and request templates work without an active backend',async({page})=>{
 await page.goto('tourism.html?lang=en');await page.locator('#quote-transport').fill('1200');await page.locator('#budget-form button').click();await expect(page.locator('#budget-output')).toContainText('5 quotes missing');
 await page.locator('#issue-location').fill('<img src=x onerror=alert(1)>');await page.locator('#issue-detail').fill('Inspect this facility.');await page.locator('#issue-form button').click();
 await expect(page.locator('#issues .issue')).toHaveCount(1);await expect(page.locator('#issues img')).toHaveCount(0);
 await page.reload();await expect(page.locator('#issues .issue')).toHaveCount(1);
 await page.locator('#services details summary').click();await page.locator('#request-type').selectOption('artisan');await expect(page.locator('#request-text')).toHaveValue(/photography permission/);
 await expect(page.locator('#provider-list .service')).toHaveCount(0);await expect(page.locator('#provider-status')).toContainText('No current provider records');
});
test('corrupt storage and malformed links cannot break the page',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('parishkar-tourism-plan','{"party":"wrong"}');localStorage.setItem('parishkar-tourism-checklist','{}');localStorage.setItem('parishkar-tourism-issues','[null,{"id":"bad"}]')});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('tourism.html?lang=en&trip=%7Bbad');await expect(page.locator('#places .place')).toHaveCount(23);await expect(page.locator('#issues .issue')).toHaveCount(0);expect(errors).toEqual([]);
});
test('provider data needs dated evidence and safe public links',async({page})=>{
 const now=Date.now(),valid={id:'00000000-0000-4000-8000-000000000001',name:'TEST fixture guide',kind:'guide',contact_url:'https://example.org/contact',evidence_url:'https://example.org/evidence',verified_at:new Date(now-60000).toISOString(),verified_until:new Date(now+3600000).toISOString()};
 await page.route('**/rest/v1/rpc/kasa_tourism_providers',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify([valid,{...valid,id:'expired',verified_until:new Date(now-1).toISOString()},{...valid,id:'unsafe',contact_url:'javascript:alert(1)'}])}));
 await page.goto('tourism.html?lang=en');await expect(page.locator('#provider-list .service')).toHaveCount(1);await page.locator('#provider-list button').click();await expect(page.locator('#enquiry-box')).toBeVisible();await expect(page.locator('#enquiry-box')).toContainText('not a booking');
});
test('operator board requires a moderator session',async({page})=>{await page.goto('tourism-operator.html');await page.locator('#operator-refresh').click();await expect(page.locator('#operator-status')).toContainText('Sign in');});
