#!/usr/bin/env node
// Tamarack Library: put the recipes Claude read (recipe photos, and links waiting for Claude) into the library's
// recipes.json, the same way every time.
//
//   node tools/recipe-merge.mjs "<library folder>"                         status: recipe photos and links waiting
//   node tools/recipe-merge.mjs "<library folder>" recipes-in.json         dry run (nothing written)
//   node tools/recipe-merge.mjs "<library folder>" recipes-in.json --apply  write recipes.json, keep the original
//        photos in recipes/, log to imports/, ledger, delete the inbox photos   (--keep-photos: leave them in the inbox)
//
// recipes-in.json (Claude writes it while reading the photos / pages) is a list, one entry per recipe:
//   { "photos": ["2026-10-24 181500 Grandma Recipe-1 recipe 001.jpg", "… 002.jpg"],   pages in order (none for a link)
//     "fill": "r…",                       optional: the id of a recipe waiting for Claude (a link) — filled in place
//     "title": "Cinnamon Rolls", "from": "Grandma Railey", "source": "card|family|cookbook|web|magazine|other",
//     "book": "Joy of Cooking", "page": "42",           a cookbook in the library: matched to its book by title
//     "url": "", "author": "", "servings": "12 rolls", "prep": "20 min", "cook": "25 min", "total": "2 hr",
//     "category": "Bread", "cuisine": "", "tags": ["Christmas"], "about": "",
//     "ingredients": ["## For the dough", "1 1/2 cups warm milk", …],      "## " starts a section
//     "steps": ["Mix the milk and yeast; let stand 10 minutes.", …],
//     "notes": "", "needsReview": false, "unsure": "words Claude couldn't read, for the note" }
//
// Rules: never a blind overwrite (re-read and re-apply if recipes.json changes while working); a recipe with the
// same name (and source) as one already there is added flagged "Possible duplicate", never merged silently; the
// original photos are kept with the recipe (recipes/<id>-<n>.jpg) — the family card matters.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const FILE = 'recipes.json', CATALOG = 'tamarack-library.json';
const ORDER = ['id','title','from','source','bookId','bookTitle','page','url','author','servings','prep','cook','total','category','cuisine','tags',
  'about','ingredients','steps','notes','favorite','want','rating','made','photos','image','pending','needsReview','addedAt','updatedAt'];
const FIELDS = ['title','from','source','page','url','author','servings','prep','cook','total','category','cuisine','tags','about','ingredients','steps','notes'];
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const normKey = s => norm(s).replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const rid = () => 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex').slice(0, 5);
export const isRecipePhoto = f => / recipe( \d{2,3})?( redo)?\.jpe?g$/i.test(f);

export function readableRecipes(s) {
  const tidy = r => { if (r.deleted) return r; const o = {}; for (const k of ORDER) if (k in r && r[k] !== '' && r[k] != null) o[k] = r[k]; for (const k in r) if (!(k in o) && r[k] !== '' && r[k] != null) o[k] = r[k]; return o; };
  return JSON.stringify({ format: 'tamarack-recipes', version: 1, updatedAt: s.updatedAt, recipes: s.recipes.map(tidy) }, null, 2);
}
function readRecipes(dir) {
  const p = path.join(dir, FILE);
  if (!fs.existsSync(p)) return { store: { format: 'tamarack-recipes', version: 1, updatedAt: 0, recipes: [] }, hash: null };
  const buf = fs.readFileSync(p); const s = JSON.parse(buf.toString('utf8'));
  if (!s || !Array.isArray(s.recipes)) throw new Error(p + ' is not a recipe file — not touching it');
  return { store: s, hash: sha1(buf) };
}
function books(dir) { try { const s = JSON.parse(fs.readFileSync(path.join(dir, CATALOG), 'utf8')); return (s.books || []).filter(b => !b.deleted); } catch (e) { return []; } }
function bookFor(list, title) {
  const k = normKey(title); if (!k) return null;
  const hits = list.filter(b => normKey(b.title) === k);
  return hits.find(b => /cook|recipe|food|baking/i.test([b.genre, b.subjects].join(' '))) || hits[0] || null;
}
function inbox(dir) { const d = path.join(dir, 'photos', 'inbox'); return fs.existsSync(d) ? fs.readdirSync(d).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []; }
const LEDGER = ['photos', 'inbox', '_processed.json'];
function readLedger(dir) { let raw = null; try { raw = JSON.parse(fs.readFileSync(path.join(dir, ...LEDGER), 'utf8')); } catch (e) {} return { about: (raw && raw.about) || 'Photo inbox for this library.', processed: (raw && Array.isArray(raw.processed)) ? raw.processed : [] }; }

// Pure: apply the entries to a recipe store → { store, log, copies:[{from, to}], batch }
export function applyRecipes(store, entries, opts = {}) {
  const now = opts.now || Date.now(), batch = opts.batch || 'rc' + now.toString(36), list = opts.books || [];
  const out = { format: 'tamarack-recipes', version: 1, updatedAt: now, recipes: store.recipes.map(r => Object.assign({}, r)) };
  const log = { added: [], filled: [], dups: [], problems: [] }, copies = [];
  entries.forEach((e, i) => {
    if (!e || !String(e.title || '').trim()) { log.problems.push('entry ' + (i + 1) + ': no title'); return; }
    const f = {}; for (const k of FIELDS) if (e[k] != null && e[k] !== '') f[k] = Array.isArray(e[k]) ? e[k].map(x => String(x).trim()).filter(Boolean) : String(e[k]).trim();
    if (f.url && !/^https?:\/\/\S+$/i.test(f.url)) { log.problems.push(f.title + ': link left out (not a web address): ' + f.url); delete f.url; }
    if (e.book) { const b = bookFor(list, e.book); if (b) { f.bookId = b.id; f.bookTitle = ''; } else f.bookTitle = String(e.book).trim(); f.source = f.source || 'cookbook'; }
    const unsure = String(e.unsure || '').trim();
    if (unsure) f.notes = [f.notes, 'Couldn’t read for sure: ' + unsure].filter(Boolean).join('\n');
    if (e.fill && out.recipes.some(x => x.id === e.fill && x.deleted)) { log.problems.push(e.title + ': skipped — that link (' + e.fill + ') was deleted in the app'); return; }
    let r = e.fill && out.recipes.find(x => x.id === e.fill && !x.deleted);
    if (e.fill && !r) { log.problems.push(e.title + ': no recipe ' + e.fill + ' to fill (added as new)'); }
    if (r) { Object.assign(r, f); delete r.pending; r.needsReview = !!(e.needsReview || unsure); r.updatedAt = now; log.filled.push(r.title); }
    else {
      const dup = out.recipes.find(x => !x.deleted && normKey(x.title) === normKey(f.title) && (x.bookId || x.from || '') === (f.bookId || f.from || ''));
      r = Object.assign({ id: rid() + i, addedAt: now, updatedAt: now }, f, { needsReview: !!(e.needsReview || unsure || dup) });
      if (dup) { r.notes = [r.notes, 'Possible duplicate of “' + dup.title + '” (' + dup.id + ')'].filter(Boolean).join('\n'); log.dups.push(r.title); }
      out.recipes.push(r); log.added.push(r.title + (f.from ? ' (from ' + f.from + ')' : '') + (f.bookId || f.bookTitle ? ' · ' + (e.book || '') + (f.page ? ' p. ' + f.page : '') : ''));
    }
    const photos = (e.photos || []).map(String);
    if (photos.length) { r.photos = (r.photos || []).slice(); photos.forEach((p, n) => { const to = 'recipes/' + r.id + '-' + (r.photos.length + 1) + path.extname(p).toLowerCase(); r.photos.push(to); copies.push({ from: p, to }); }); }
    r.importBatch = batch;
  });
  return { store: out, log, copies, batch };
}

export function run(dir, inFile, opts = {}) {
  const now = opts.now || Date.now(); const out = [];
  const waiting = inbox(dir).filter(isRecipePhoto), led = readLedger(dir), done = new Set(led.processed.map(x => x && x.file));
  const { store: cur } = readRecipes(dir);
  if (!inFile) {
    out.push(waiting.length + ' recipe photo(s) waiting:');
    for (const f of waiting) out.push('  ' + (done.has(f) ? '[done before] ' : '') + f);
    for (const n of inbox(dir).filter(f => / recipe-info NOTE\.txt$/.test(f))) out.push('  note: ' + n + ' → ' + fs.readFileSync(path.join(dir, 'photos', 'inbox', n), 'utf8').trim());
    const pend = cur.recipes.filter(r => !r.deleted && r.pending);
    out.push(pend.length + ' recipe(s) waiting for Claude (links):');
    for (const r of pend) out.push('  ' + r.id + '  ' + (r.url || r.title));
    return { text: out.join('\n') };
  }
  const entries = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('recipes-in.json must be a list');
  // only recipe photos from the inbox, by their plain names (never a shelf photo, never a path)
  const badNames = entries.flatMap(e => e.photos || []).filter(f => path.basename(String(f)) !== String(f) || !isRecipePhoto(String(f)));
  if (badNames.length) throw new Error('Not recipe photos in the inbox: ' + badNames.join(', '));
  const already = entries.flatMap(e => e.photos || []).filter(f => done.has(f) && !opts.force);
  if (already.length) throw new Error('Already processed (in the ledger): ' + already.join(', ') + ' — use --force to redo');
  const missing = entries.flatMap(e => e.photos || []).filter(f => !fs.existsSync(path.join(dir, 'photos', 'inbox', f)));
  if (missing.length) throw new Error('Not in the inbox: ' + missing.join(', '));
  for (let attempt = 0; attempt < 4; attempt++) {
    const { store, hash } = readRecipes(dir);
    const res = applyRecipes(store, entries, { now, books: books(dir) });
    const L = res.log, sec = (t, a) => a.length ? '\n## ' + t + ' (' + a.length + ')\n' + a.map(x => '- ' + x).join('\n') + '\n' : '';
    const text = '# Recipes read ' + new Date(now).toLocaleString() + '\n\nBatch `' + res.batch + '` · ' + entries.length + ' recipe(s) · library folder ' + path.basename(dir) + '\n'
      + sec('Added', L.added) + sec('Filled in (links that were waiting)', L.filled) + sec('Possible duplicates (added, flagged)', L.dups) + sec('Problems', L.problems);
    if (!opts.apply) return { text: '(dry run: nothing written)\n' + text, res };
    if (readRecipes(dir).hash !== hash) { out.push('recipes.json changed while working (a phone synced); reapplying.'); continue; }
    // originals first (so a recipe never points at a photo that isn't there), then the file
    fs.mkdirSync(path.join(dir, 'recipes'), { recursive: true });
    for (const c of res.copies) fs.copyFileSync(path.join(dir, 'photos', 'inbox', c.from), path.join(dir, c.to));
    fs.writeFileSync(path.join(dir, FILE), readableRecipes(res.store));
    const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    fs.mkdirSync(path.join(dir, 'imports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'imports', stamp + ' recipes ' + res.batch + '.md'), text);
    fs.writeFileSync(path.join(dir, 'imports', stamp + ' recipes ' + res.batch + '.json'), JSON.stringify(entries, null, 2));
    const photos = entries.flatMap(e => e.photos || []);
    for (const f of photos) led.processed.push({ file: f, at: now, batch: res.batch, sha1: sha1(fs.readFileSync(path.join(dir, 'photos', 'inbox', f))) });
    fs.writeFileSync(path.join(dir, ...LEDGER), JSON.stringify(led, null, 2));
    let deleted = 0;
    if (!opts.keepPhotos) {
      for (const f of photos) { const p = path.join(dir, 'photos', 'inbox', f); if (fs.existsSync(p)) { fs.unlinkSync(p); deleted++; } }
      // the "where these came from" notes go once no recipe photos are left
      if (!inbox(dir).some(isRecipePhoto)) for (const n of inbox(dir).filter(f => / recipe-info NOTE\.txt$/.test(f))) fs.unlinkSync(path.join(dir, 'photos', 'inbox', n));
    }
    out.push(text, 'Written: recipes.json, ' + res.copies.length + ' original photo(s) in recipes/, log in imports/, ledger' + (opts.keepPhotos ? '' : '; ' + deleted + ' inbox photo(s) deleted') + '.');
    return { text: out.join('\n'), res };
  }
  throw new Error('recipes.json kept changing while working; try again in a minute.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--'))), pos = args.filter(a => !a.startsWith('--'));
  if (!pos[0]) { console.log('Usage: node tools/recipe-merge.mjs "<library folder>" [recipes-in.json] [--apply] [--keep-photos] [--force]'); process.exit(1); }
  try { console.log(run(pos[0], pos[1], { apply: flags.has('--apply'), keepPhotos: flags.has('--keep-photos'), force: flags.has('--force') }).text); }
  catch (e) { console.error(e.message); process.exit(1); }
}
