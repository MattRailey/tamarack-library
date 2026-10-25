// Meal plan: a week of meals, recipes picked in for a number of people, amounts scaled, the week's ingredients added
// up with a tick for what you need, shared through recipes.json.
const { test, expect } = require('@playwright/test');
const { mockNet, openApp, click } = require('./helpers');
const RFILE = '/Railey Library/recipes.json';
const R = [
  { id: 'rPan', title: 'Pancakes', servings: '4', ingredients: ['2 cups flour', '1 1/2 cups milk', '2 eggs'], steps: ['Cook 3 minutes a side.'], favorite: true, addedAt: 1, updatedAt: 1 },
  { id: 'rBread', title: 'Bread', ingredients: ['3 cups flour', '1 tbsp yeast'], steps: ['Bake 30 minutes.'], addedAt: 1, updatedAt: 1 },
];
function seed(net, extra = {}) {
  const raw = Buffer.from(JSON.stringify(Object.assign({ format: 'tamarack-recipes', version: 1, updatedAt: 1, recipes: R }, extra)));
  net.uploads.push({ path: RFILE, mode: 'add', raw, body: raw.toString('utf8'), seeded: true });
}
const lastFile = net => { const u = net.uploads.filter(x => x.path === RFILE && !x.seeded).pop(); return u ? JSON.parse(u.body) : null; };
async function openPlan(page) { await page.click('nav [data-panel="recipes"]'); await page.click('#r-view [data-rv="plan"]'); await expect(page.locator('#r-plan-view')).toBeVisible(); }

test('plan a week: pick recipes for a number of people, open one scaled, add a note, ingredients added up', async ({ page }) => {
  const net = await mockNet(page); seed(net); await openApp(page, { dropbox: true });
  await openPlan(page);
  await expect(page.locator('#mp-days .mp-day')).toHaveCount(7);
  await expect(page.locator('#mp-days .mp-day.today')).toHaveCount(1);
  await expect(page.locator('#mp-people')).toHaveText('4');
  await page.click('#mp-ppl-plus'); await page.click('#mp-ppl-plus');
  await expect(page.locator('#mp-people')).toHaveText('6');
  // breakfast today: Pancakes (favorites come first in the picker)
  await page.click('#mp-days .mp-day.today [data-meal="breakfast"]');
  await expect(page.locator('#mpk-people')).toHaveValue('6');
  await expect(page.locator('#mpk-list .mpk-item').first()).toContainText('Pancakes');
  await page.click('#mpk-list [data-rid="rPan"]');
  await expect(page.locator('#mp-days .mp-day.today .mp-item')).toContainText(['Pancakes👤 6']);
  // dinner today: Bread; lunch: a note
  await page.click('#mp-days .mp-day.today [data-meal="dinner"]'); await page.fill('#mpk-q', 'bread'); await page.click('#mpk-list [data-rid="rBread"]');
  await page.click('#mp-days .mp-day.today [data-meal="lunch"]'); await page.fill('#mpk-q', 'Leftovers'); await page.click('#mpk-list [data-note]');
  await expect(page.locator('#mp-days .mp-day.today .mp-item.note')).toHaveText(/Leftovers/);
  // open the planned pancakes: amounts for 6 (recipe serves 4)
  await page.click('#mp-days .mp-day.today .mp-open:has-text("Pancakes")');
  await expect(page.locator('#rc-scaled')).toHaveText('Amounts for 6 people (recipe serves 4)');
  await expect(page.locator('#rc-ing li')).toHaveText(['3 cups flour', '2 ¼ cups milk', '3 eggs']);
  await page.click('#rc-close');
  // the week's ingredients: flour added up (3 for pancakes ×1.5 + 3 for bread, which says no servings so isn't scaled)
  await expect(page.locator('#mp-ing')).toContainText('(2 recipes)');
  await page.click('#mp-ing');
  await expect(page.locator('#mi-note')).toContainText('Not scaled');
  await expect(page.locator('#mi-note')).toContainText('Bread');
  const items = page.locator('#mi-list .gr-item');
  await expect(items.first()).toContainText('6 cups flour');
  await expect(items.first()).toContainText('Pancakes, Bread');
  await expect(page.locator('#mi-list input:checked')).toHaveCount(0);           // nothing ticked to start
  await expect(page.locator('#mi-add')).toBeDisabled();
  await page.click('#mi-list .gr-item >> nth=0'); await page.click('#mi-list .gr-item >> nth=2');
  await expect(page.locator('#mi-add')).toHaveText('Add 2 to the shopping list');
  await page.click('#mi-add');
  await expect(page.locator('#r-groc-n')).toHaveText('2');
  // shared through recipes.json: the plan and the household's number
  await expect.poll(() => { const f = lastFile(net); return f ? (f.plan || []).filter(p => !p.deleted).length + '|' + (f.settings || {}).people : ''; }, { timeout: 8000 }).toBe('3|6');
  // today's plan shows above the recipe list
  await page.click('#r-view [data-rv="recipes"]');
  await expect(page.locator('#r-today')).toContainText('Breakfast — Pancakes');
});

test('take a meal off, change its people, move between weeks, and "Plan it" from a recipe', async ({ page }) => {
  const net = await mockNet(page);
  const today = await page.evaluate(() => 0).then(() => null);
  seed(net); await openApp(page, { dropbox: true });
  await openPlan(page);
  const rng = await page.textContent('#mp-range');
  await page.click('#mp-next');
  await expect(page.locator('#mp-range')).not.toHaveText(rng);
  await expect(page.locator('#mp-thisweek')).toBeVisible();
  await expect(page.locator('#mp-days .mp-day.today')).toHaveCount(0);
  await page.click('#mp-thisweek');
  await expect(page.locator('#mp-range')).toHaveText(rng);
  // Plan it, from the recipe window
  await page.click('#r-view [data-rv="recipes"]'); await page.click('#r-results [data-rid="rPan"]');
  await page.click('#rc-plan');
  await page.selectOption('#mpq-meal', 'dinner'); await page.fill('#mpq-people', '2');
  await page.click('#mpq-save'); await page.click('#rc-close');
  await page.click('#r-view [data-rv="plan"]');
  const item = page.locator('#mp-days .mp-day.today .mp-item');
  await expect(item).toContainText(['Pancakes👤 2']);
  page.once('dialog', d => d.accept('8'));
  await page.click('#mp-days .mp-day.today .mp-ppl');
  await expect(item).toContainText(['Pancakes👤 8']);
  await page.click('#mp-days .mp-day.today .mp-x');
  await expect(item).toHaveCount(0);
  await expect.poll(() => { const f = lastFile(net); return f ? JSON.stringify(f.plan) : ''; }, { timeout: 8000 }).toMatch(/"deleted":true/);
});

test('plans from two phones merge; amounts add up sensibly', async ({ page }) => {
  await mockNet(page); await openApp(page);
  const r = await page.evaluate(() => {
    const a = { recipes: [], plan: [{ id: 'p1', date: '2026-10-26', meal: 'dinner', recipeId: 'x', updatedAt: 5 }, { id: 'p2', date: '2026-10-27', meal: 'lunch', text: 'Soup', updatedAt: 5 }], settings: { people: 3, updatedAt: 1 } };
    const b = { recipes: [], plan: [{ id: 'p2', deleted: true, updatedAt: 9 }, { id: 'p3', date: '2026-10-28', meal: 'breakfast', text: 'Eggs', updatedAt: 2 }], settings: { people: 5, updatedAt: 7 } };
    const m = mergeRecipes(a, b);
    return { plan: m.plan.map(p => p.id + (p.deleted ? 'x' : '')).sort(), people: m.settings.people, sigDiffers: rsig(a) !== rsig(m),
      comb: combineIngredients([{ line: '1 cup flour', from: 'A' }, { line: '2 cups flour', from: 'B' }, { line: '2 eggs', from: 'A' }, { line: '1 egg', from: 'B' },
        { line: '1 tbsp butter', from: 'A' }, { line: '2 tablespoons butter', from: 'B' }, { line: 'Salt to taste', from: 'A' }, { line: 'Salt to taste', from: 'B' }, { line: '2-3 cloves garlic', from: 'A' }]).map(x => x.text + ' [' + x.from.join(',') + ']'),
      serv: ['12 rolls', '4-6', '2 dozen', 'makes 8', '', 'serves six'].map(servingsNum) };
  });
  expect(r.plan).toEqual(['p1', 'p2x', 'p3']);
  expect(r.people).toBe(5);
  expect(r.sigDiffers).toBe(true);
  expect(r.comb).toEqual(['3 cups flour [A,B]', '3 eggs [A,B]', '3 tablespoons butter [A,B]', 'Salt to taste [A,B]', '2-3 cloves garlic [A]']);
  const shop = await page.evaluate(() => combineIngredients([{ line: '2 ½ eggs', from: 'A' }, { line: '0.83 cup rice', from: 'A' }, { line: '1 ⅔ chicken breasts', from: 'A' }, { line: '1 ⅞ cups milk', from: 'A' }]).map(x => x.text));
  expect(shop).toEqual(['3 eggs', '1 cup rice', '2 chicken breasts', '2 cups milk']);
  expect(r.serv).toEqual([12, 4, 24, 8, 0, 0]);
});

test('trips: plan a camping trip, add meals by day, get the trip ingredients and the menu', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await page.click('nav [data-panel="recipes"]');
  await page.click('#r-view [data-rv="trips"]');
  await page.click('#tr-new');
  await page.fill('#trm-name', 'Wallowa camping'); await page.fill('#trm-start', '2026-11-06'); await page.fill('#trm-days', '3'); await page.fill('#trm-people', '5');
  await page.click('#trm-save');
  await expect(page.locator('#tr-title')).toHaveText('Wallowa camping');
  await expect(page.locator('#tr-days .mp-day')).toHaveCount(3);
  await page.click('#tr-days .mp-day:first-child [data-meal="dinner"]');
  await expect(page.locator('#mpk-people')).toHaveValue('5');
  await page.fill('#mpk-q', 'Foil packets'); await page.click('#mpk-list [data-note]');
  await expect(page.locator('#tr-days .mp-item')).toContainText(['Foil packets×']);
  // trip meals do not show up in the weekly plan
  await page.click('#r-view [data-rv="plan"]');
  await expect(page.locator('#mp-days .mp-item')).toHaveCount(0);
  await page.click('#r-view [data-rv="trips"]');
  await page.click('#tr-meals');
  await expect(page.locator('#trmenu-text')).toContainText('Day 1');
  await expect(page.locator('#trmenu-text')).toContainText('Dinner: Foil packets');
});
