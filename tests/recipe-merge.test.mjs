// node --test tests/recipe-merge.test.mjs — recipe photos and waiting links into recipes.json (tools/recipe-merge.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, applyRecipes, isRecipePhoto } from '../tools/recipe-merge.mjs';
import { run as photoRun } from '../tools/photo-merge.mjs';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
function lib() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcp-'));
  fs.mkdirSync(path.join(dir, 'photos', 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tamarack-library.json'), JSON.stringify({ format: 'tamarack-library', version: 1, books: [
    { id: 'bJoy', title: 'The Joy of Cooking', author: 'Irma Rombauer', genre: 'Cooking' }, { id: 'bH', title: 'The Hobbit' }] }));
  fs.writeFileSync(path.join(dir, 'recipes.json'), JSON.stringify({ format: 'tamarack-recipes', version: 1, recipes: [
    { id: 'rLink', title: 'example.com recipe', source: 'web', url: 'https://example.com/pie', pending: 'link', favorite: true, addedAt: 1, updatedAt: 1 },
    { id: 'rOld', title: 'Pie Crust', from: 'Grandma', addedAt: 1, updatedAt: 1 }] }));
  for (const f of ['2026-10-24 181500 Grandma Recipe-1 recipe 001.jpg', '2026-10-24 181500 Grandma Recipe-1 recipe 002.jpg', '2026-10-24 181530 Joy-of-Cooking Recipe-2 recipe 001.jpg', '2026-10-24 101500 Den N1 shelf 001.jpg'])
    fs.writeFileSync(path.join(dir, 'photos', 'inbox', f), JPG);
  fs.writeFileSync(path.join(dir, 'photos', 'inbox', '2026-10-24 181455 recipe-info NOTE.txt'), 'Recipe photos. {"from":"Grandma"}');
  return dir;
}
const entries = [
  { photos: ['2026-10-24 181500 Grandma Recipe-1 recipe 001.jpg', '2026-10-24 181500 Grandma Recipe-1 recipe 002.jpg'], title: 'Cinnamon Rolls', from: 'Grandma', source: 'card',
    ingredients: ['## Dough', '1 1/2 cups milk'], steps: ['Bake 25 minutes.'], unsure: 'the oven temperature' },
  { photos: ['2026-10-24 181530 Joy-of-Cooking Recipe-2 recipe 001.jpg'], title: 'Popovers', book: 'Joy of Cooking', page: '612', ingredients: ['2 eggs'], steps: ['Bake.'] },
  { fill: 'rLink', title: 'Apple Pie', url: 'https://example.com/pie', ingredients: ['6 apples'], steps: ['Bake 1 hour.'] },
  { title: 'Pie Crust', from: 'Grandma', ingredients: ['flour'], steps: ['Mix.'] },
];

test('recipe photos are told apart from shelf photos', () => {
  assert.ok(isRecipePhoto('2026-10-24 181500 Grandma Recipe-1 recipe 001.jpg'));
  assert.ok(isRecipePhoto('2026-10-24 181500 Card Recipe-3 recipe.jpg'));
  assert.ok(!isRecipePhoto('2026-10-24 101500 Den N1 shelf 001.jpg'));
  const dir = lib();
  assert.match(photoRun(dir).text, /^1 photo\(s\) waiting/);           // the book tool leaves recipe photos alone
  assert.match(photoRun(dir).text, /3 recipe photo\(s\) too/);
});

test('apply: adds, fills a waiting link, links the cookbook, keeps originals, flags a duplicate, never loses a field', () => {
  const dir = lib();
  assert.match(run(dir).text, /3 recipe photo\(s\) waiting[\s\S]*rLink  https:\/\/example\.com\/pie/);
  const inF = path.join(dir, 'in.json'); fs.writeFileSync(inF, JSON.stringify(entries));
  const dry = run(dir, inF); assert.match(dry.text, /dry run/); assert.ok(fs.existsSync(path.join(dir, 'photos', 'inbox', '2026-10-24 181500 Grandma Recipe-1 recipe 001.jpg')));
  const res = run(dir, inF, { apply: true, now: Date.UTC(2026, 9, 25, 1, 0) });
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'recipes.json'), 'utf8'));
  const by = t => s.recipes.filter(r => r.title === t);
  const rolls = by('Cinnamon Rolls')[0];
  assert.deepEqual(rolls.photos, ['recipes/' + rolls.id + '-1.jpg', 'recipes/' + rolls.id + '-2.jpg']);
  assert.ok(fs.existsSync(path.join(dir, rolls.photos[1])));
  assert.equal(rolls.needsReview, true); assert.match(rolls.notes, /oven temperature/);
  assert.equal(by('Popovers')[0].bookId, 'bJoy'); assert.equal(by('Popovers')[0].source, 'cookbook'); assert.equal(by('Popovers')[0].page, '612');
  const pie = s.recipes.find(r => r.id === 'rLink');
  assert.equal(pie.title, 'Apple Pie'); assert.equal(pie.pending, undefined); assert.equal(pie.favorite, true);   // filled in place, favorite kept
  assert.equal(by('Pie Crust').length, 2); assert.match(by('Pie Crust')[1].notes, /Possible duplicate/);
  // inbox: recipe photos and the recipe note gone, the shelf photo untouched; ledger and log written
  assert.deepEqual(fs.readdirSync(path.join(dir, 'photos', 'inbox')).sort(), ['2026-10-24 101500 Den N1 shelf 001.jpg', '_processed.json']);
  const led = JSON.parse(fs.readFileSync(path.join(dir, 'photos', 'inbox', '_processed.json'), 'utf8'));
  assert.equal(led.processed.length, 3);
  assert.ok(fs.readdirSync(path.join(dir, 'imports')).some(f => / recipes rc.*\.md$/.test(f)));
  // a second run with the same photos is refused
  fs.writeFileSync(path.join(dir, 'photos', 'inbox', '2026-10-24 181530 Joy-of-Cooking Recipe-2 recipe 001.jpg'), JPG);
  assert.throws(() => run(dir, inF, { apply: true }), /Already processed/);
  assert.ok(res.text.includes('Written'));
});

test('applyRecipes is pure and keeps tombstones', () => {
  const st = { recipes: [{ id: 'gone', deleted: true, updatedAt: 5 }] };
  const r = applyRecipes(st, [{ title: 'Soup', ingredients: ['water'], steps: ['Boil 10 minutes.'] }], { now: 9 });
  assert.equal(st.recipes.length, 1); assert.equal(r.store.recipes.length, 2); assert.equal(r.store.recipes[0].deleted, true);
});

test('only recipe photos, by plain name; a link deleted in the app is not brought back; only web links', () => {
  const dir = lib(); const inF = path.join(dir, 'in.json');
  fs.writeFileSync(inF, JSON.stringify([{ photos: ['2026-10-24 101500 Den N1 shelf 001.jpg'], title: 'X', ingredients: ['a'] }]));
  assert.throws(() => run(dir, inF, { apply: true }), /Not recipe photos/);
  fs.writeFileSync(inF, JSON.stringify([{ photos: ['../tamarack-library.json'], title: 'X' }]));
  assert.throws(() => run(dir, inF, { apply: true }), /Not recipe photos/);
  assert.ok(fs.existsSync(path.join(dir, 'photos', 'inbox', '2026-10-24 101500 Den N1 shelf 001.jpg')));
  const st = { recipes: [{ id: 'rGone', deleted: true, updatedAt: 5 }] };
  const r = applyRecipes(st, [{ fill: 'rGone', title: 'Pie', ingredients: ['x'] }, { title: 'Soup', url: 'javascript:alert(1)', ingredients: ['w'] }], { now: 9 });
  assert.equal(r.store.recipes.filter(x => !x.deleted).length, 1);
  assert.equal(r.store.recipes.find(x => x.title === 'Soup').url, undefined);
  assert.equal(r.log.problems.length, 2);
});
