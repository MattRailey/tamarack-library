// Dairy-free / corn-free / gluten-free: the automatic check, the filter (free, or with swaps), "Show options", and
// "fine as it is" in the edit form. Uses three real recipes (tests/fixtures/recipes.json).
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const { mockNet, openApp } = require('./helpers');
const RF = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'recipes.json'), 'utf8'));
function seed(net, recipes) { const raw = Buffer.from(JSON.stringify(Object.assign({}, RF, recipes ? { recipes } : {}))); net.uploads.push({ path: '/Railey Library/recipes.json', mode: 'add', raw, body: raw.toString(), seeded: true }); }
const titles = page => page.locator('#r-results .rc-item b').allTextContents();

test('the automatic check reads ingredients sensibly', async ({ page }) => {
  await mockNet(page); await openApp(page);
  const r = await page.evaluate(() => {
    const st = lines => { const x = { id: 'x' + Math.random(), ingredients: lines }; return ['dairy', 'corn', 'gluten'].map(d => dietStatus(x, d)).join(' '); };
    return {
      milk: st(['1 cup milk']), coconut: st(['⅔ cup lite canned coconut milk', '1 tbsp unsweetened dairy-free milk alternative']),
      pb: st(['½ cup peanut butter']), tartar: st(['½ tsp cream of tartar']), butter: st(['2 tbsp butter']),
      parm: st(['1 ounce Parmesan cheese, grated (½ cup)']), olive: st(['1 tablespoon olive oil']), oil: st(['⅓ cup oil']),
      starch: st(['2 tbsp cornstarch']), meal: st(['1 cup cornmeal']), pepper: st(['¼ teaspoon pepper', '1 tsp black peppercorns']),
      flour: st(['1 ½ cups all-purpose flour']), gfflour: st(['1 ½ cups gluten-free flour blend']), almond: st(['1 cup almond flour']),
      soy: st(['2 tbsp soy sauce']), tamari: st(['2 tbsp tamari']), oats: st(['1 cup rolled oats']), icecream: st(['1 pint vanilla ice cream']),
      cider: st(['1 tbsp apple cider vinegar']), white: st(['1 tbsp white vinegar']), bp: st(['1 tsp baking powder']),
    };
  });
  expect(r).toEqual({
    milk: 'swap free free', coconut: 'free free free', pb: 'free free free', tartar: 'free free free', butter: 'swap free free',
    parm: 'swap free free', olive: 'free free free', oil: 'free check free', starch: 'free swap free', meal: 'free no free', pepper: 'free free free',
    flour: 'free free swap', gfflour: 'free free free', almond: 'free free free', soy: 'free free swap', tamari: 'free free free', oats: 'free free check',
    icecream: 'swap free free', cider: 'free free free', white: 'free check free', bp: 'free check free',
  });
});

test('filter: free or with swaps; "only already free"; badges; Show options; marking a recipe fine as it is', async ({ page }) => {
  const net = await mockNet(page); seed(net); await openApp(page, { dropbox: true });
  await page.click('nav [data-panel="recipes"]');
  await expect(page.locator('#r-results .rc-item')).toHaveCount(3, { timeout: 8000 });
  // dairy-free: the lemon loaf is free; frittata (parmesan) and ice cream (cream) can be made so with swaps
  await page.click('#r-diet [data-diet="dairy"]');
  await expect(page.locator('#r-filter-bar')).toContainText('Dairy-free');
  await expect(page.locator('#r-results .rc-item')).toHaveCount(3);
  await expect(page.locator('#r-results .rc-item:has-text("Lemon Loaf") .diet-ok')).toHaveText('✓ Dairy-free');
  await expect(page.locator('#r-results .rc-item:has-text("Frittata") .diet-swap')).toHaveText('Dairy-free with 1 swap');
  await page.check('#r-diet-strict');
  expect(await titles(page)).toEqual(['Dairy-Free Iced Lemon Loaf (Starbucks Copycat)']);
  await page.uncheck('#r-diet-strict');
  // gluten-free too: frittata and ice cream are; the loaf has flour (a swap)
  await page.click('#r-diet [data-diet="gluten"]'); await page.check('#r-diet-strict');
  expect(await titles(page)).toEqual([]);                                            // nothing is both already
  await page.uncheck('#r-diet-strict');
  await expect(page.locator('#r-results .rc-item')).toHaveCount(3);
  // the loaf's window: summary and the swaps
  await page.click('#r-results .rc-item:has-text("Lemon Loaf")');
  await expect(page.locator('#rc-diet .diet-sum')).toContainText('✓ Dairy-free');
  await expect(page.locator('#rc-diet .diet-sum')).toContainText('Gluten-free with 1 swap');
  await expect(page.locator('#rc-diet .diet-sum')).toContainText('Corn-free? 4 to check');      // baking powder, oil, powdered sugar, vanilla
  await expect(page.locator('#rc-diet-opts')).toBeHidden();
  await page.click('#rc-diet-toggle');
  await expect(page.locator('#rc-diet-opts')).toContainText('1 ½ cups all-purpose flour');
  await expect(page.locator('#rc-diet-opts')).toContainText('1:1 gluten-free baking flour');
  await expect(page.locator('#rc-diet-opts')).toContainText('arrowroot');
  await expect(page.locator('#rc-diet-opts')).toContainText('without cornstarch');
  // mark it corn-free (they checked the labels): the summary says so, and it's saved
  await page.click('#rc-edit'); await page.check('#rf-diet-corn'); await page.click('#rf-save');
  await expect(page.locator('#rc-diet .diet-sum')).toContainText('✓ Corn-free (marked)');
  await page.click('#rc-close');
  await expect.poll(() => { const u = net.uploads.filter(x => x.path.endsWith('recipes.json') && !x.seeded).pop(); return u ? JSON.stringify(JSON.parse(u.body).recipes.find(r => /Lemon/.test(r.title)).diet) : ''; }, { timeout: 8000 }).toBe('["corn"]');
  // a chip in "Filters on" turns one diet off; Clear filters turns them all off
  await page.click('#r-filter-bar [data-roff="diet:gluten"]');
  await expect(page.locator('#r-diet [data-diet="gluten"]')).not.toHaveClass(/(^| )on( |$)/);
  await page.click('#r-filter-bar [data-rclear]');
  await expect(page.locator('#r-diet .on')).toHaveCount(0);
  await expect(page.locator('#r-results .diet-ok')).toHaveCount(0);
});

test('a recipe with no easy swap is left out of that diet', async ({ page }) => {
  const net = await mockNet(page);
  seed(net, [{ id: 'rP', title: 'Polenta', ingredients: ['1 cup cornmeal', '4 cups water'], steps: ['Simmer 30 minutes.'], addedAt: 1, updatedAt: 1 },
    { id: 'rS', title: 'Soup', ingredients: ['4 cups broth'], steps: ['Heat.'], addedAt: 1, updatedAt: 1 }]);
  await openApp(page, { dropbox: true }); await page.click('nav [data-panel="recipes"]');
  await expect(page.locator('#r-results .rc-item')).toHaveCount(2, { timeout: 8000 });
  await page.click('#r-diet [data-diet="corn"]');
  expect(await titles(page)).toEqual(['Soup']);
});
