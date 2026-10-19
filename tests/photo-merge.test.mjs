// tools/photo-merge.mjs on a made-up library folder: compact readings → catalog, never a second copy by accident,
// recheck only moves, ledger stops a second pass, photos deleted, the app's merge keeps a phone's edit.
// Run: node --test tests/photo-merge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, parseReadings, parsePhotoName, mergeStores } from '../tools/photo-merge.mjs';

const P1 = '2026-10-19 101500 Living-Room N1 shelf 001.jpg';
const P2 = '2026-10-19 101500 Living-Room N1 shelf 002.jpg';
function lib(books) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-merge-'));
  fs.mkdirSync(path.join(dir, 'photos', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'photos', 'identify'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tamarack-library.json'), JSON.stringify({ format: 'tamarack-library', version: 1, books, imports: [] }));
  return dir;
}
const photo = (dir, name) => fs.writeFileSync(path.join(dir, 'photos', name.startsWith('identify/') ? '' : 'inbox', name), 'jpeg');
const readings = (dir, text) => { const f = path.join(dir, 'readings.txt'); fs.writeFileSync(f, text); return f; };
const cat = dir => JSON.parse(fs.readFileSync(path.join(dir, 'tamarack-library.json'), 'utf8'));
const find = (dir, t) => cat(dir).books.filter(b => b.title === t && !b.deleted);

test('the compact format parses, and bad lines are reported', () => {
  const r = parseReadings('# x\n@ ' + P1 + ' | shelf=2\nThe Hobbit | Tolkien | 1 | h\n? | ? | 2 | low | blue cloth\nBad line\nX | Y | 3 | maybe\n');
  assert.equal(r.blocks.length, 1); assert.equal(r.blocks[0].over.shelf, '2');
  assert.deepEqual(r.blocks[0].books[0], { title: 'The Hobbit', author: 'Tolkien', position: '1', confidence: 'high', note: '' });
  assert.equal(r.blocks[0].books[1].title, ''); assert.equal(r.blocks[0].books[1].note, 'blue cloth');
  assert.equal(r.errors.length, 2);
});

test('photo names give room (as the catalog spells it), bookcase, shelf and kind', () => {
  const books = [{ room: 'Living Room', bookcase: 'N1' }];
  assert.deepEqual(parsePhotoName(P1, books), { room: 'Living Room', bookcase: 'N1', shelf: '', kind: 'shelf' });
  assert.deepEqual(parsePhotoName('2026-10-19 101500 Den Q9 shelf-3 recheck 004.jpg', []), { room: 'Den', bookcase: 'Q9', shelf: '3', kind: 'recheck' });
  assert.deepEqual(parsePhotoName('2026-10-19 101500 no-room no-bookcase new-books New-books 01.jpg', []), { room: '', bookcase: '', shelf: '', kind: 'new-books' });
  assert.equal(parsePhotoName('identify/Den N1 shelf-2 pos-4 bk123abc.jpg', []).id, 'bk123abc');
});

test('first pass adds books and mystery books; dry run writes nothing; a second pass is skipped by the ledger', () => {
  const dir = lib([{ id: 'x1', title: 'Heidi', author: 'Johanna Spyri', updatedAt: 1 }]);   // already owned, no shelf yet
  photo(dir, P1); photo(dir, P2);
  const f = readings(dir, '@ ' + P1 + ' | shelf=1\nThe Hobbit | J. R. R. Tolkien | 1 | high\n? | ? | 2 | low | red cloth\nHeidi | Johanna Spyri | 3 | high\n@ ' + P2 + ' | shelf=2\nLittle Women | Louisa May Alcott | 1 | low\n');
  const dry = run(dir, f, { now: 1000 });
  assert.match(dry.text, /dry run/); assert.equal(cat(dir).books.length, 1);
  const res = run(dir, f, { apply: true, now: 2000 });
  const c = cat(dir);
  assert.equal(c.books.length, 4, 'Heidi placed, not added twice');
  const heidi = find(dir, 'Heidi')[0];
  assert.deepEqual([heidi.room, heidi.bookcase, heidi.shelf, heidi.position], ['Living Room', 'N1', '1', '3']);
  assert.equal(heidi.ft.room, 2000); assert.equal(heidi.updatedAt, 2000);
  assert.equal(find(dir, '(red cloth)')[0].needsReview, true);
  const lw = find(dir, 'Little Women')[0];
  assert.equal(lw.needsReview, true); assert.match(lw.notes, /^Partly identified/);
  assert.equal(c.imports.at(-1).added, 3); assert.equal(c.imports.at(-1).label, 'Photos: Living Room N1');
  assert.ok(find(dir, 'The Hobbit')[0].importBatch === c.imports.at(-1).id, 'Undo last import in the app removes them');
  // photos deleted, ledger and log written
  assert.deepEqual(fs.readdirSync(path.join(dir, 'photos', 'inbox')), ['_processed.json']);
  const led = JSON.parse(fs.readFileSync(path.join(dir, 'photos', 'inbox', '_processed.json'), 'utf8'));
  assert.ok(led.processed.some(e => e.file === P1 && e.batch));
  assert.equal(fs.readdirSync(path.join(dir, 'imports')).filter(x => x.endsWith('.md')).length, 1);
  // the same readings again: nothing changes
  run(dir, f, { apply: true, now: 3000 });
  assert.equal(cat(dir).books.length, 4);
  assert.ok(res.text.includes('Added'));
});

test('a book already on another shelf is added only as a flagged possible second copy', () => {
  const dir = lib([{ id: 'x1', title: 'The Hobbit', author: 'J. R. R. Tolkien', room: 'Den', bookcase: 'D1', shelf: '1', position: '4', updatedAt: 1 }]);
  photo(dir, P1);
  run(dir, readings(dir, '@ ' + P1 + ' | shelf=1\nThe Hobbit | Tolkien | 2 | high\n'), { apply: true, now: 2000 });
  const h = find(dir, 'The Hobbit');
  assert.equal(h.length, 2);
  const copy = h.find(b => b.id !== 'x1');
  assert.equal(copy.needsReview, true); assert.match(copy.notes, /Possible second copy .*Den · D1/);
});

test('recheck only moves books, finds strays, flags books not seen, never deletes', () => {
  const dir = lib([
    { id: 'a', title: 'Moved Book', author: 'A Writer', room: 'Den', bookcase: 'Q9', shelf: '1', position: '5', updatedAt: 1 },
    { id: 'b', title: 'Wandered Off', author: 'B Writer', room: 'Attic', bookcase: 'Z1', shelf: '2', position: '1', updatedAt: 1 },
    { id: 'c', title: 'Gone Missing', author: 'C Writer', room: 'Den', bookcase: 'Q9', shelf: '2', position: '1', updatedAt: 1 },
    { id: 'd', title: 'Other Case', author: 'D Writer', room: 'Den', bookcase: 'Q8', shelf: '1', position: '1', updatedAt: 1 },
  ]);
  const R = '2026-10-19 120000 Den Q9 recheck 001.jpg'; photo(dir, R);
  run(dir, readings(dir, '@ ' + R + ' | shelf=1\nMoved Book | A Writer | 2 | high\nWandered Off | B Writer | 3 | high\nBrand New | E Writer | 4 | high\n'), { apply: true, now: Date.parse('2026-10-19T12:00:00Z') });
  const c = cat(dir), by = id => c.books.find(b => b.id === id);
  assert.equal(c.books.length, 5, 'only the truly new book was added');
  assert.deepEqual([by('a').shelf, by('a').position, by('a').checkedAt], ['1', '2', '2026-10-19']);
  assert.deepEqual([by('b').room, by('b').bookcase, by('b').position], ['Den', 'Q9', '3']);
  assert.equal(by('c').needsReview, true); assert.match(by('c').notes, /Not seen at recheck 2026-10-19/);
  assert.equal(by('c').room, 'Den', 'not moved, not deleted');
  assert.equal(by('d').needsReview, undefined, 'another bookcase is left alone');
  const nb = c.books.find(b => b.title === 'Brand New');
  assert.equal(nb.needsReview, true); assert.match(nb.notes, /Found at recheck/);
  // seen again later: the flag and note clear
  const R2 = '2026-11-01 120000 Den Q9 recheck 001.jpg'; photo(dir, R2);
  run(dir, readings(dir, '@ ' + R2 + ' | shelf=2\nGone Missing | C Writer | 1 | high\n'), { apply: true, now: Date.parse('2026-11-01T12:00:00Z') });
  const g = cat(dir).books.find(b => b.id === 'c');
  assert.equal(g.needsReview, undefined); assert.equal(g.notes, undefined);
});

test('title-page photos fill in the mystery book they belong to', () => {
  const dir = lib([{ id: 'bkm1', title: '(old red hardcover)', needsReview: true, idPhoto: true, room: 'Den', bookcase: 'N1', shelf: '2', position: '4', updatedAt: 1 }]);
  const I = 'identify/Den N1 shelf-2 pos-4 bkm1.jpg'; photo(dir, I);
  run(dir, readings(dir, '@ ' + I + '\nTreasure Island | Robert Louis Stevenson | - | high\n'), { apply: true, now: 2000 });
  const b = cat(dir).books[0];
  assert.equal(b.title, 'Treasure Island'); assert.equal(b.needsReview, undefined); assert.equal(b.idPhoto, undefined);
  assert.equal(fs.existsSync(path.join(dir, 'photos', 'identify', 'Den N1 shelf-2 pos-4 bkm1.jpg')), false);
});

test("a phone's edit made at the same time survives the app's merge", () => {
  const dir = lib([{ id: 'x1', title: 'Heidi', author: 'Johanna Spyri', updatedAt: 1 }]);
  photo(dir, P1);
  const before = cat(dir);
  run(dir, readings(dir, '@ ' + P1 + ' | shelf=1\nHeidi | Johanna Spyri | 3 | high\n'), { apply: true, now: 2000 });
  // meanwhile, on a phone: the book was marked read (newer), from the version before the photos
  const phone = JSON.parse(JSON.stringify(before)); Object.assign(phone.books[0], { status: 'read', updatedAt: 3000, ft: { status: 3000 } });
  const merged = mergeStores(phone, cat(dir)).books[0];
  assert.equal(merged.status, 'read'); assert.equal(merged.room, 'Living Room'); assert.equal(merged.position, '3');
});

test('a Dropbox conflicted copy of the catalog is merged in and set aside', () => {
  const dir = lib([{ id: 'x1', title: 'Heidi', author: 'Johanna Spyri', updatedAt: 1 }]);
  fs.writeFileSync(path.join(dir, "tamarack-library (Matt's conflicted copy 2026-10-19).json"),
    JSON.stringify({ books: [{ id: 'x2', title: 'Only In The Copy', updatedAt: 5 }], imports: [] }));
  photo(dir, P1);
  run(dir, readings(dir, '@ ' + P1 + ' | shelf=1\nHeidi | Johanna Spyri | 1 | high\n'), { apply: true, now: 2000 });
  assert.equal(find(dir, 'Only In The Copy').length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'imports', 'conflicts')));
  assert.equal(fs.readdirSync(dir).some(f => /conflicted copy/.test(f)), false);
});

test("an existing _processed.json (older format) is kept and added to, and its photos aren't read again", () => {
  const dir = lib([]);
  fs.writeFileSync(path.join(dir, 'photos', 'inbox', '_processed.json'), JSON.stringify({ about: 'Old note', processed: [{ file: P1, at: 1, batch: 'old' }, { note: 'a note line' }] }));
  photo(dir, P1); photo(dir, P2);
  run(dir, readings(dir, '@ ' + P1 + ' | shelf=1\nOld Book | X | 1 | high\n@ ' + P2 + ' | shelf=2\nNew Book | Y | 1 | high\n'), { apply: true, now: 2000 });
  assert.equal(find(dir, 'Old Book').length, 0, 'P1 was done before');
  assert.equal(find(dir, 'New Book').length, 1);
  const led = JSON.parse(fs.readFileSync(path.join(dir, 'photos', 'inbox', '_processed.json'), 'utf8'));
  assert.equal(led.about, 'Old note'); assert.equal(led.processed.length, 3); assert.ok(led.processed.some(e => e.note));
});
