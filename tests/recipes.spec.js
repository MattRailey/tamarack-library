// The Recipes tab: typed recipes, search (Anything / Name / Ingredient), sync of recipes.json (never a blind
// overwrite), scaling, timers, the cookbook link both ways, links (read by the friends service, or waiting for Claude),
// recipe photos (camera in recipe mode), grocery list, delete.
const { test, expect } = require('@playwright/test');
const { mockNet, openApp, click } = require('./helpers');

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });
const RFILE = '/Railey Library/recipes.json';
const BOOK = { id: 'b1a0e05963780106n2f', title: 'Driftwood Valley' };
const ROLLS = { id: 'rRolls', title: 'Cinnamon Rolls', from: 'Grandma', source: 'cookbook', bookId: BOOK.id, page: '42', servings: '12 rolls', total: '2 hr',
  ingredients: ['## For the dough', '1 1/2 cups warm milk', '2¼ tsp yeast', '4 cups flour'], steps: ['Mix milk and yeast; let stand 10 minutes.', 'Bake at 350°F for 20–25 minutes.'],
  addedAt: 1, updatedAt: 1 };
function seedRemote(net, recipes) {
  const raw = Buffer.from(JSON.stringify({ format: 'tamarack-recipes', version: 1, updatedAt: 1, recipes }));
  net.uploads.push({ path: RFILE, mode: 'add', raw, body: raw.toString('utf8'), seeded: true });
}
const recipeUploads = net => net.uploads.filter(u => u.path === RFILE && !u.seeded);
async function openRecipes(page) { await page.click('nav [data-panel="recipes"]'); await expect(page.locator('#recipes')).toHaveClass(/active/); }

test('type in a recipe; search by name or ingredient; it syncs as recipes.json', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await openRecipes(page);
  await expect(page.locator('#r-results')).toContainText('No recipes yet');
  await page.click('#rq-type');
  await page.fill('#rf-title', 'Chicken and Rice'); await page.fill('#rf-from', 'Aunt Jo');
  await page.fill('#rf-ing', 'For the chicken:\n2 chicken breasts\n1 cup rice\n- 2 cups broth');
  await page.fill('#rf-steps', '1. Brown the chicken, 5 minutes a side.\n2) Add rice and broth; simmer 20 minutes.');
  await page.click('#rf-save');
  await expect(page.locator('#rc-title')).toHaveText('Chicken and Rice');
  await expect(page.locator('#rc-ing .rc-sec')).toHaveText('For the chicken');            // "For the chicken:" became a heading
  await expect(page.locator('#rc-ing li')).toHaveText(['2 chicken breasts', '1 cup rice', '2 cups broth']);
  await expect(page.locator('#rc-steps li').first()).toContainText('Brown the chicken, 5 minutes a side.');
  await expect(page.locator('#rc-steps .tm-btn')).toHaveText(['⏱ 5 min', '⏱ 20 min']);
  await page.click('#rc-close');
  // ingredient search: "what's in the fridge"
  await page.click('#r-scope [data-scope="ing"]'); await page.fill('#r-q', 'rice broth'); await page.waitForTimeout(250);
  await expect(page.locator('#r-results .rc-item')).toHaveCount(1);
  await expect(page.locator('#r-filter-bar')).toContainText('Ingredient: “rice broth”');
  await page.fill('#r-q', 'aunt'); await page.waitForTimeout(250);
  await expect(page.locator('#r-results .rc-item')).toHaveCount(0);                          // "Aunt Jo" isn't an ingredient
  await page.click('#r-scope [data-scope="all"]');
  await expect(page.locator('#r-results .rc-item')).toHaveCount(1);
  await click(page, '#r-filter-bar [data-rclear]');
  await expect(page.locator('#r-filter-bar')).toBeHidden();
  // synced: added with "add" (no file yet), readable JSON
  await expect.poll(() => recipeUploads(net).length, { timeout: 8000 }).toBeGreaterThan(0);
  const up = recipeUploads(net)[0];
  expect(up.mode).toBe('add');
  const s = JSON.parse(up.body);
  expect(s.format).toBe('tamarack-recipes'); expect(s.recipes[0].title).toBe('Chicken and Rice'); expect(up.body).toContain('\n  "recipes": [');
});

test('recipes from Dropbox: scale servings, timers, favorite, and the cookbook link both ways', async ({ page }) => {
  const net = await mockNet(page); seedRemote(net, [ROLLS]); await openApp(page, { dropbox: true });
  await openRecipes(page);
  await expect(page.locator('#r-results .rc-item')).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('#r-results')).toContainText('Driftwood Valley, p. 42');
  await page.click('#r-results .rc-item');
  await page.click('#rc-scale [data-k="2"]');
  await expect(page.locator('#rc-ing li')).toHaveText(['3 cups warm milk', '4 ½ tsp yeast', '8 cups flour']);
  await page.click('#rc-scale [data-k="0.5"]');
  await expect(page.locator('#rc-ing li').first()).toHaveText('¾ cups warm milk');
  // a range starts at the low end, with +5 for the rest
  await page.click('#rc-steps .tm-btn:has-text("20–25 min")');
  await expect(page.locator('#tm-dock .tm')).toHaveCount(1);
  await expect(page.locator('#tm-dock')).toContainText('Cinnamon Rolls · step 2');
  await expect(page.locator('#tm-dock .tm-clock')).toHaveText(/^(20:00|19:5\d)$/);
  await expect(page.locator('#tm-dock [data-tact="more"]')).toHaveText('+5');
  await page.click('#tm-dock [data-tact="x"]');
  await expect(page.locator('#tm-dock')).toBeHidden();
  // favorite → shows under ♥ Favorites, and the change is uploaded over the Dropbox copy's revision
  await page.click('#rc-fav'); await expect(page.locator('#rc-fav')).toHaveText('♥ Favorite');
  await expect.poll(() => recipeUploads(net).length, { timeout: 8000 }).toBeGreaterThan(0);
  expect(recipeUploads(net).pop().mode['.tag']).toBe('update');
  // the cookbook: recipe → book window → "1 recipe from this book" → back to the recipes, filtered
  await page.click('#rc-sub [data-openbook]');
  await expect(page.locator('#modal-bg')).toHaveClass(/open/);
  await expect(page.locator('#m-title')).toHaveText(BOOK.title);
  await expect(page.locator('#m-view .rc-booknote')).toContainText('1 recipe from this book');
  await page.click('#m-view [data-bookrecipes]');
  await expect(page.locator('#recipes')).toHaveClass(/active/);
  await expect(page.locator('#r-filter-bar')).toContainText('Cookbook: Driftwood Valley');
  await page.click('#r-show [data-show="fav"]');
  await expect(page.locator('#r-results .rc-item')).toHaveCount(1);
});

test('times in steps, and quantities, are read right', async ({ page }) => {
  await mockNet(page); await openApp(page);
  const t = await page.evaluate(() => [
    'Let rise 1 hour 15 minutes.', 'Bake 25 to 30 minutes, or until golden.', 'Simmer for an hour.', 'Cook a few minutes, stirring.',
    'Boil 1½ hours.', 'Wait 45 seconds.', 'Chill overnight.', 'Bake at 350°F for 12 mins; cool 5 min.',
    'Bake 1 1/2 hours.', 'Roast 1-1/2 to 2 hours.', 'Rest ½ hour.', 'Chill half an hour.', 'Braise one and a half hours.', 'Use half a cup.'].map(s => findTimes(s).map(x => [x.secs, x.hi, x.label])));
  expect(t).toEqual([[[4500, 0, '1 hr 15 min']], [[1500, 1800, '25–30 min']], [[3600, 0, '1 hr']], [], [[5400, 0, '1 hr 30 min']], [[45, 0, '45 sec']], [], [[720, 0, '12 min'], [300, 0, '5 min']],
    [[5400, 0, '1 hr 30 min']], [[5400, 7200, '1 hr 30 min–2 hr']], [[1800, 0, '30 min']], [[1800, 0, '30 min']], [[5400, 0, '1 hr 30 min']], []]);
  const q = await page.evaluate(() => [['1 1/2 cups milk', 2], ['½ cup sugar', 3], ['2-3 cloves garlic', 2], ['1 (14 oz) can tomatoes', 2], ['Salt to taste', 2], ['3 eggs', 0.5], ['0.25 tsp salt', 4]]
    .map(([l, k]) => scaleLine(l, k)));
  expect(q).toEqual(['3 cups milk', '1 ½ cup sugar', '4-6 cloves garlic', '2 (14 oz) can tomatoes', 'Salt to taste', '1 ½ eggs', '1 tsp salt']);
});

test('a timer that runs out rings until OK, even if it ran out while away', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await page.evaluate(() => startTimer(1, 'Eggs · step 1'));
  await expect(page.locator('#tm-dock .tm.done')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('#tm-dock')).toContainText('Done!');
  // kept on the phone: a reload still shows it done
  await page.reload(); await page.waitForFunction(() => /Showing/.test(document.getElementById('summary').textContent));
  await expect(page.locator('#tm-dock .tm.done')).toBeVisible();
  await page.click('#tm-dock .tm-ok');
  await expect(page.locator('#tm-dock')).toBeHidden();
});

test('cooking view: one step at a time, ingredients to tick, timers', async ({ page }) => {
  const net = await mockNet(page); seedRemote(net, [ROLLS]); await openApp(page, { dropbox: true });
  await openRecipes(page); await page.click('#r-results .rc-item'); await page.click('#rc-cook');
  await expect(page.locator('#ck-bg')).toHaveClass(/open/);
  await expect(page.locator('#ck-step')).toContainText('Step 1 of 2');
  await expect(page.locator('#ck-step .tm-btn')).toHaveText('⏱ 10 min');
  await page.click('#ck-next'); await expect(page.locator('#ck-step')).toContainText('Bake at 350°F');
  await expect(page.locator('#ck-next')).toBeDisabled();
  await page.click('#ck-tabs [data-ck="ing"]');
  await page.click('#ck-ing .ck-li >> nth=0');
  await expect(page.locator('#ck-ing .ck-li.done')).toHaveCount(1);
  await page.click('#ck-close'); await expect(page.locator('#ck-bg')).not.toHaveClass(/open/);
});

test('a link: read by the friends service when the page has a recipe; otherwise it waits for Claude', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  let answer = { recipe: { title: 'Lemon Bars', ingredients: ['1 cup flour', '2 lemons'], steps: ['Bake 20 minutes.'], total: '45 min', image: 'https://img.example.com/x.jpg' } };
  const asked = [];
  await page.route('**/recipe/fetch', route => { asked.push(JSON.parse(route.request().postData()).url); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }); });
  await openRecipes(page);
  await page.click('#rq-link');
  await page.fill('#ra-url', 'cooking.example.org/lemon-bars'); await page.click('#ra-link-go');
  await expect(page.locator('#rc-title')).toHaveText('Lemon Bars');
  expect(asked).toEqual(['https://cooking.example.org/lemon-bars']);
  await expect(page.locator('#rc-sub')).toContainText('cooking.example.org');
  await page.click('#rc-close');
  answer = { none: true };
  await page.click('#rq-link');
  await page.fill('#ra-url', 'https://www.socialsite.example.com/p/123'); await page.click('#ra-link-go');
  await expect(page.locator('#rc-pending')).toBeVisible();
  await page.click('#rc-close');
  await expect(page.locator('#r-results')).toContainText('Waiting for Claude');
  await expect(page.locator('#r-waiting')).toContainText('1 waiting for Claude');
  await expect.poll(() => { const u = recipeUploads(net).pop(); return u ? JSON.parse(u.body).recipes.filter(r => r.pending === 'link').length : 0; }, { timeout: 8000 }).toBe(1);
});

test('photograph recipes: pages of one recipe share a name; "Next recipe" starts the next; a note says where they came from', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await openRecipes(page);
  await page.click('#rq-book'); await page.selectOption('#ra-scan-src', 'card');
  await page.fill('#ra-from', 'Grandma Railey');
  await click(page, '#ra-cam');
  await page.waitForSelector('#cam-bg.open');
  await page.waitForFunction(() => document.getElementById('cam-video').videoWidth > 0, null, { timeout: 15000 });
  await expect(page.locator('#cam-ask')).toBeHidden();
  await expect(page.locator('#cam-where-txt')).toHaveText('Recipe 1 · Grandma Railey');
  await expect(page.locator('#cam-change')).toBeHidden();
  const inbox = () => net.uploads.filter(u => u.path.includes('/photos/inbox/') && u.path.endsWith('.jpg'));
  await page.click('#cam-shutter'); await page.waitForTimeout(150); await page.click('#cam-shutter');
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(2);
  await expect(page.locator('#cam-count')).toContainText('2 pages of Recipe 1');
  await expect(page.locator('#cam-next')).toHaveText('Next recipe →');
  await page.click('#cam-next');
  await expect(page.locator('#cam-ask')).toBeHidden();
  await expect(page.locator('#cam-where-txt')).toHaveText('Recipe 2 · Grandma Railey');
  await page.click('#cam-shutter');
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(3);
  const names = inbox().map(u => u.path.split('/').pop());
  expect(names[0]).toMatch(/^\d{4}-\d\d-\d\d \d{6} Grandma-Railey Recipe-1 recipe 001\.jpg$/);
  expect(names[1]).toMatch(/ Grandma-Railey Recipe-1 recipe 002\.jpg$/);
  expect(names[2]).toMatch(/ Grandma-Railey Recipe-2 recipe 001\.jpg$/);
  const note = net.uploads.find(u => / recipe-info NOTE\.txt$/.test(u.path));
  expect(note && note.body).toContain('"from":"Grandma Railey"');
  await page.click('#cam-finish');
});

test('grocery list from a recipe; delete reaches other phones as a tombstone', async ({ page }) => {
  const net = await mockNet(page); seedRemote(net, [ROLLS]); await openApp(page, { dropbox: true });
  await openRecipes(page); await page.click('#r-results .rc-item');
  await page.click('#rc-scale [data-k="2"]'); await page.click('#rc-groc');
  await expect(page.locator('#r-groc-n')).toHaveText('3');
  await page.click('#rc-close'); await page.click('#r-grocery');
  await expect(page.locator('#gr-list .gr-item')).toHaveText(['3 cups warm milk', '4 ½ tsp yeast', '8 cups flour']);
  await page.click('#gr-list .gr-item >> nth=0'); await page.click('#gr-clear-done');
  await expect(page.locator('#gr-list .gr-item')).toHaveCount(2);
  await page.click('#gr-close');
  await page.click('#r-results .rc-item');
  page.once('dialog', d => d.accept());
  await page.click('#rc-del');
  await expect(page.locator('#r-results')).toContainText('No recipes yet');
  await expect.poll(() => { const u = recipeUploads(net).pop(); return u ? JSON.stringify(JSON.parse(u.body).recipes) : ''; }, { timeout: 8000 })
    .toMatch(/"id":"rRolls","deleted":true/);
});

test('quick: + opens the camera right away (no questions), and a link pasted in the search box adds in one tap', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await page.route('**/recipe/fetch', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recipe: { title: 'Banana Bread', ingredients: ['3 bananas'], steps: ['Bake 1 hour.'] } }) }));
  await openRecipes(page);
  await page.click('#r-add');
  await page.waitForSelector('#cam-bg.open');
  await page.waitForFunction(() => document.getElementById('cam-video').videoWidth > 0, null, { timeout: 15000 });
  await expect(page.locator('#cam-ask')).toBeHidden();
  await expect(page.locator('#cam-where-txt')).toHaveText('Recipe 1');
  await page.click('#cam-shutter');
  const inbox = () => net.uploads.filter(u => u.path.includes('/photos/inbox/') && u.path.endsWith('.jpg'));
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(1);
  expect(inbox()[0].path).toMatch(/ no-room Recipe-1 recipe 001\.jpg$/);
  await page.click('#cam-finish');
  // a link in the search box
  await page.fill('#r-q', 'https://cooking.example.org/banana-bread'); await page.waitForTimeout(250);
  await expect(page.locator('#r-urladd')).toBeVisible();
  await page.click('#r-urladd-go');
  await expect(page.locator('#rc-title')).toHaveText('Banana Bread');
  await expect(page.locator('#rc-steps .tm-btn')).toHaveText('⏱ 1 hr');
  await page.click('#rc-close');
  await expect(page.locator('#r-q')).toHaveValue('');
  // ordinary words never look like a link
  await page.fill('#r-q', 'banana bread'); await page.waitForTimeout(250);
  await expect(page.locator('#r-urladd')).toBeHidden();
});

test('only web links are links (a javascript: address is never clickable)', async ({ page }) => {
  const net = await mockNet(page); seedRemote(net, [Object.assign({}, ROLLS, { id: 'rBad', bookId: '', source: 'web', url: 'javascript:alert(1)', photos: ['../../tamarack-library.json'] })]);
  await openApp(page, { dropbox: true }); await openRecipes(page);
  await expect(page.locator('#r-results .rc-item')).toHaveCount(1, { timeout: 8000 });
  await page.click('#r-results .rc-item');
  await expect(page.locator('#rc-sub a')).toHaveCount(0);
  await page.click('#rc-edit'); await page.selectOption('#rf-source', 'web'); await page.fill('#rf-url', 'javascript:alert(2)'); await page.click('#rf-save');
  await expect(page.locator('#rc-sub a')).toHaveCount(0);
});

test('recipe camera: "← Previous recipe" adds a missed page to the recipe before; Next then goes on past the last one', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await openRecipes(page); await page.click('#r-add');
  await page.waitForSelector('#cam-bg.open');
  await page.waitForFunction(() => document.getElementById('cam-video').videoWidth > 0, null, { timeout: 15000 });
  const inbox = () => net.uploads.filter(u => u.path.includes('/photos/inbox/') && u.path.endsWith('.jpg')).map(u => u.path.split('/').pop());
  await expect(page.locator('#cam-prevrec')).toBeHidden();                       // nothing before Recipe 1
  await page.click('#cam-shutter'); await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(1);
  await page.click('#cam-next'); await expect(page.locator('#cam-where-txt')).toHaveText('Recipe 2');
  await page.click('#cam-shutter'); await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(2);
  await page.click('#cam-next'); await page.click('#cam-shutter'); await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(3);
  // missed a page of Recipe 2: go back one
  await expect(page.locator('#cam-prevrec')).toBeVisible();
  await page.click('#cam-prevrec');
  await expect(page.locator('#cam-where-txt')).toHaveText('Recipe 2');
  await expect(page.locator('#cam-msg')).toContainText('Back to Recipe 2 (1 page so far)');
  await page.click('#cam-shutter'); await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(4);
  const names = inbox();
  expect(names[3].replace(/ \d{3}\.jpg$/, '')).toBe(names[1].replace(/ \d{3}\.jpg$/, ''));   // same name as Recipe 2's first page…
  expect(names[3]).toMatch(/ Recipe-2 recipe 002\.jpg$/);                                         // …and the next number
  await expect(page.locator('#cam-count')).toContainText('2 pages of Recipe 2');
  // Next from there: a new recipe after Recipe 3, not Recipe 3 again
  await page.click('#cam-next'); await expect(page.locator('#cam-where-txt')).toHaveText('Recipe 4');
  await page.click('#cam-finish');
});
