import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route(/^https:\/\//,route=>route.fulfill({status:200,contentType:'text/html',body:'External service stub'}));
});
test('search, map selector, mobility and weather planner work',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/tourism.html');
 await expect(page.locator('#places .place')).toHaveCount(12);
 await page.locator('#search').fill('charida');
 await expect(page.locator('#places .place')).toHaveCount(1);
 await page.getByRole('button',{name:'Explore map'}).click();
 await expect(page.locator('#map-place')).toHaveValue('charida');
 await expect(page.locator('#directions')).toHaveAttribute('href',/Charida/);
 await page.locator('#pace').selectOption('full');
 await page.locator('#days').selectOption('1');
 await page.locator('#plan-form button').click();
 await expect(page.locator('#plan-output .stop')).toHaveCount(3);
 await page.locator('#access').selectOption('gentle');
 await page.locator('#plan-form button').click();
 await expect(page.locator('#plan-output')).not.toContainText('Turga Falls');
 await page.locator('#access').selectOption('standard');
 await page.locator('#season').selectOption('rain');
 await page.locator('#plan-form button').click();
 await expect(page.locator('#plan-output')).not.toContainText('Turga Falls');
 expect(errors).toEqual([]);
});
test('enquiries, costs, private notes, checklist and reload',async({page})=>{
 await page.goto('/tourism.html');
 await page.locator('[data-request="driver"]').click();
 await expect(page.locator('#request-text')).toHaveValue(/vehicle type/);
 await page.locator('#quote-transport').fill('1200');
 await page.locator('#budget-form button').click();
 await expect(page.locator('#budget-output')).toContainText('1,200.00');
 await expect(page.locator('#budget-output')).toContainText('5 quotes missing');
 await page.locator('#checklist input').first().check();
 await page.locator('#issue-location').fill('<img src=x onerror=alert(1)>');
 await page.locator('#issue-detail').fill('A specific facility needs inspection.');
 await page.locator('#issue-form button').click();
 await expect(page.locator('#issues .issue')).toHaveCount(1);
 await expect(page.locator('#issues img')).toHaveCount(0);
 await page.reload();
 await expect(page.locator('#checklist input').first()).toBeChecked();
 await expect(page.locator('#issues .issue')).toHaveCount(1);
 await page.getByRole('button',{name:'Mark locally resolved'}).click();
 await expect(page.locator('#issues')).toContainText('Locally resolved');
 const download=page.waitForEvent('download');await page.locator('#export-issues').click();
 expect((await download).suggestedFilename()).toBe('purulia-issue-drafts.json');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('corrupt local data is ignored',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('parishkar-tourism-plan',JSON.stringify({circuit:'town',days:3,party:'wrong'}));
  localStorage.setItem('parishkar-tourism-checklist','{}');
  localStorage.setItem('parishkar-tourism-issues','[null,{"id":"bad"}]');
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/tourism.html');
 await expect(page.locator('#plan-output')).toContainText('Ajodhya & Charida');
 await expect(page.locator('#issues .issue')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('rejects impossible windows and keeps navigation usable',async({page})=>{
 await page.goto('/tourism.html');await page.locator('#days').selectOption('1');await page.locator('#arrival').fill('17:00');await page.locator('#departure').fill('18:00');await page.locator('#plan-form button').click();
 await expect(page.locator('#plan-output')).toContainText('No visits fit');
 await page.locator('#transport').selectOption('public');await page.locator('#plan-form button').click();await expect(page.locator('#plan-output')).toContainText('requires a car');
 await page.locator('#transport').selectOption('vehicle');await page.locator('#arrival').fill('08:00');await page.locator('#departure').fill('19:00');await page.locator('#plan-form button').click();
 await expect(page.getByRole('link',{name:'Navigate this day'})).toHaveAttribute('href',/maps\/dir/);
});

test('road routing is optional, reports real estimates and survives failure',async({page})=>{
 await page.route('https://router.project-osrm.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({code:'Ok',routes:[{distance:24000,duration:3600,geometry:{type:'LineString',coordinates:[[86.36,23.32],[86.1,23.2]]}}]})}));
 await page.goto('/tourism.html');await expect(page.locator('#route-stops')).toContainText('Start:');
 await page.locator('#road-route').click();await expect(page.locator('#route-status')).toContainText('24.0 km · 60 minutes');
 await page.route('https://router.project-osrm.org/**',r=>r.fulfill({status:503,body:'Unavailable'}));
 await page.locator('#plan-form button').click();await page.locator('#road-route').click();await expect(page.locator('#route-status')).toContainText('routing unavailable');
 await expect(page.getByRole('link',{name:'Navigate this day'}).first()).toBeVisible();
});

test('all submitted names are searchable; unresolved points cannot become pins',async({page})=>{
 await page.goto('/tourism.html');await expect(page.locator('#catalogue-summary')).toContainText('56 catalogue entries');
 await page.locator('#search').fill('Honpa Ban');await expect(page.locator('#places .place')).toHaveCount(1);await expect(page.locator('#places')).toContainText('Kumit Mukh');
 await page.evaluate(()=>{window.focusCalls=0;window.addEventListener('tourism-focus',()=>window.focusCalls++);});
 await page.getByRole('button',{name:'Find map candidates'}).click();await expect(page.locator('#location-status')).toContainText('No pin has been placed');
 expect(await page.evaluate(()=>focusCalls)).toBe(0);
 await page.locator('#search').fill('');await page.locator('#place-type').selectOption('forest');
 await expect(page.locator('#places')).toContainText('Matha Forest');await expect(page.locator('#places')).toContainText('Duarsini Jungle');
 await page.locator('#place-type').selectOption('');await page.locator('#place-status').selectOption('mapped');await expect(page.locator('#places .place')).toHaveCount(8);
 const download=page.waitForEvent('download');await page.locator('#export-catalogue').click();expect((await download).suggestedFilename()).toBe('purulia-special-locations.json');
});
test('source corrections open with the destination identity prefilled',async({page})=>{
 await page.goto('/tourism.html');await page.locator('#search').fill('Siningi');await page.locator('#places details').evaluate(e=>e.open=true);
 await page.getByRole('button',{name:'Suggest a source or exact location',exact:true}).click();await expect(page.locator('#sf-what')).toHaveValue(/siningi-pahar/);
 await expect(page.locator('#sf-fix')).toBeVisible();
});
