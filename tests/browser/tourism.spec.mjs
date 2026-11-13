import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route(/^https:\/\//,route=>route.fulfill({status:200,contentType:'text/html',body:'External service stub'}));
});
test('search, map selector, mobility and weather planner work',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/tourism.html');
 await expect(page.locator('#places .place')).toHaveCount(7);
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
