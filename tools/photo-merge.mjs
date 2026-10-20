#!/usr/bin/env node
// Tamarack Library: put what Claude read from the photo inbox into the catalog, the same way every time.
//
//   node tools/photo-merge.mjs "<library folder>"                      status: photos waiting, already processed
//   node tools/photo-merge.mjs "<library folder>" readings.txt         dry run: what would change (nothing written)
//   node tools/photo-merge.mjs "<library folder>" readings.txt --apply   write the catalog, log, ledger; delete photos
//        --keep-photos  don't delete the photos after applying
//        --force        process photos even if the ledger says they were done before
//
// <library folder> is the library's folder on this PC, e.g. "D:\Dropbox\Railey Library" or
// "D:\Dropbox\Apps\Tamarack Friends\Smith Library". Dropbox syncs it; the app merges the result book by book.
//
// The readings file (Claude writes it while looking at the photos) is the compact format, one book per line:
//
//   @ 2026-10-19 101500 Den N1 shelf 001.jpg | shelf=1
//   The Hobbit | J. R. R. Tolkien | 1 | high
//   ? | ? | 2 | low | brown cloth, gilt lettering
//   Little Women | Louisa May Alcott | 3 | medium
//
//   "@ <photo file name>" starts a block; the room, bookcase, shelf and kind come from the name. After a "|":
//   shelf=, room=, bookcase= override them (a photo of several shelves = one "@" line per shelf).
//   A book line: title | author | spot from the left | confidence (high / medium / low) | note (optional).
//   "?" for a title = a spine that can't be read (a mystery book; the note describes it). "?" author = unknown.
//   "@ identify/<file>.jpg" (title-page photos from the walk-through): one line, title | author | - | confidence;
//   it fills in the book whose id ends the file name.
//
// Rules (DEVELOPER.md, "Photo inbox"): never a second copy by accident, never a blind overwrite, never delete a book.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

/* ---------------- catalog helpers (same as the app: js/core.js, js/series.js, js/dropbox.js) ---------------- */
export const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const normKey = s => norm(s).replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const uid = () => 'b' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex').slice(0, 6);
const slug = s => String(s || '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export function bookKey(title, author) {
  const t = normKey(String(title || '').replace(/\s*\((?:nancy drew|hardy boys|boxcar children|dana girls)[^)]*\)/i, ''));
  const a = normKey(String(author || '').split(/[,&;(]| and /)[0]).split(' ').pop() || '';
  return t ? t + '|' + a : '';
}
const isUnid = b => String(b.title || '').startsWith('(') || (b.needsReview && /^Partly identified/.test(b.notes || ''));
const hasPlace = b => !!(b.room || b.bookcase);
const KEY_ORDER = ['id','title','author','series','seriesNo','genre','room','bookcase','shelf','position','status','rating','loanedTo','loanedDate','loanNote','collections','isbn','year','publisher','pages','format','about','subjects','notes','needsReview','coverUrl'];
export function readableJSON(s) {
  const tidy = b => { if (b.deleted) return b; const o = {}; for (const k of KEY_ORDER) if (k in b) o[k] = b[k]; for (const k in b) if (!(k in o)) o[k] = b[k]; return o; };
  return JSON.stringify(Object.assign({}, s, { books: s.books.map(tidy) }), null, 2);
}
const blankish = v => v == null || v === '' || v === false || v === 0 || (Array.isArray(v) && !v.length);
const sameVal = (a, b) => (blankish(a) && blankish(b)) || JSON.stringify(a) === JSON.stringify(b);
// newer copy wins, except fields the older copy changed more recently (ft) — as mergeBook / mergeStores in core.js
function mergeBook(nw, old) {
  if (nw.deleted || old.deleted || !old.ft) return nw;
  let out = null;
  for (const k in old.ft) {
    if (old.ft[k] > ((nw.ft || {})[k] || 0) && !sameVal(old[k], nw[k])) {
      if (!out) out = Object.assign({}, nw, { ft: Object.assign({}, nw.ft), updatedAt: Math.max(nw.updatedAt || 0, old.updatedAt || 0) + 1 });
      if (old[k] === undefined) delete out[k]; else out[k] = old[k];
      out.ft[k] = old.ft[k];
    }
  }
  return out || nw;
}
export function mergeStores(a, b) {
  const map = new Map();
  for (const bk of a.books) map.set(bk.id, bk);
  for (const bk of b.books) {
    const cur = map.get(bk.id);
    if (!cur) { map.set(bk.id, bk); continue; }
    if ((bk.updatedAt || 0) === (cur.updatedAt || 0)) continue;
    const [nw, old] = (bk.updatedAt || 0) > (cur.updatedAt || 0) ? [bk, cur] : [cur, bk];
    map.set(bk.id, mergeBook(nw, old));
  }
  const imp = new Map();
  for (const i of (a.imports || []).concat(b.imports || [])) if (i && i.id) imp.set(i.id, Object.assign({}, imp.get(i.id) || {}, i));
  const imports = [...imp.values()].sort((x, y) => (x.at || 0) - (y.at || 0)).slice(-20);
  const settings = ((b.settings || {}).updatedAt || 0) > ((a.settings || {}).updatedAt || 0) ? b.settings : (a.settings || b.settings);
  return { format: 'tamarack-library', version: 1, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0), books: [...map.values()], imports, settings };
}

/* ---------------- photo names (js/photos.js, js/shelfcam.js, js/mystery.js) ---------------- */
const KINDS = ['shelf', 'spines', 'recheck', 'new-books', 'book', 'other'];
// "2026-10-19 101500 Den N1 shelf-2 shelf left-half 001.jpg" → { room:'Den', bookcase:'N1', shelf:'2', kind:'shelf' }
export function parsePhotoName(name, books) {
  const base = path.basename(String(name)).replace(/\.jpe?g$/i, '');
  if (/^identify\//i.test(String(name).replace(/\\/g, '/'))) {
    const id = (base.match(/(\S+)$/) || [])[1];
    return { kind: 'identify', id };
  }
  const t = base.split(' ');
  if (t.length < 5 || !/^\d{4}-\d\d-\d\d$/.test(t[0])) return null;
  const unslug = (s, field) => {
    if (!s || s === 'no-room' || s === 'no-bookcase') return '';
    const hit = books.map(b => b[field]).find(v => v && slug(v) === s);   // the name as the catalog spells it
    return hit || s.replace(/-/g, ' ');
  };
  let i = 4, shelf = '';
  if (/^shelf-/.test(t[4])) { shelf = t[4].slice(6).replace(/-/g, ' '); i = 5; }
  const kind = KINDS.includes(t[i]) ? t[i] : 'other';
  return { room: unslug(t[2], 'room'), bookcase: unslug(t[3], 'bookcase'), shelf, kind };
}

/* ---------------- the compact readings format → JSON ---------------- */
const CONF = { h: 'high', high: 'high', m: 'medium', med: 'medium', medium: 'medium', l: 'low', low: 'low' };
export function parseReadings(text) {
  const blocks = []; let cur = null; const errors = [];
  String(text).split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trim(); if (!line || line.startsWith('#')) return;
    if (line.startsWith('@')) {
      const [photo, ...opts] = line.slice(1).split('|').map(s => s.trim());
      cur = { photo, over: {}, books: [] };
      for (const o of opts) { const m = o.match(/^(shelf|room|bookcase)\s*=\s*(.*)$/i); if (m) cur.over[m[1].toLowerCase()] = m[2].trim(); else if (o) errors.push('line ' + (n + 1) + ': "' + o + '" is not shelf=, room= or bookcase='); }
      blocks.push(cur); return;
    }
    if (!cur) { errors.push('line ' + (n + 1) + ': a book line before any "@ photo" line'); return; }
    const f = line.split('|').map(s => s.trim());
    if (f.length < 4) { errors.push('line ' + (n + 1) + ': needs title | author | spot | confidence'); return; }
    const conf = CONF[f[3].toLowerCase()];
    if (!conf) { errors.push('line ' + (n + 1) + ': confidence "' + f[3] + '" is not high / medium / low'); return; }
    cur.books.push({ title: f[0] === '?' ? '' : f[0], author: f[1] === '?' ? '' : f[1], position: f[2] === '-' ? '' : f[2], confidence: conf, note: f.slice(4).join(' | ') });
  });
  return { blocks, errors };
}

/* ---------------- the merge ---------------- */
export function applyReadings(store, readings, opts = {}) {
  const now = opts.now || Date.now(), today = new Date(now).toISOString().slice(0, 10);
  const batch = 'ph' + now.toString(36);
  const books = store.books, live = () => books.filter(b => !b.deleted && b.saleStatus !== 'sold');
  const log = { added: [], moved: [], same: [], copies: [], mysteries: [], identified: [], notSeen: [], found: [], skipped: [], problems: [] };
  const used = new Set();                         // a book is matched once per run
  const touch = (b, fields) => {                  // change fields the way the app does: updatedAt + ft per field
    let changed = false;
    for (const [k, v] of Object.entries(fields)) {
      if (sameVal(b[k], v)) continue;
      if (v === undefined || v === '' || v === false) delete b[k]; else b[k] = v;
      b.ft = Object.assign({}, b.ft); b.ft[k] = now; changed = true;
    }
    if (changed) b.updatedAt = now;
    return changed;
  };
  const add = (row) => { const b = Object.assign({ status: 'unread' }, row, { id: uid(), addedAt: now, updatedAt: now, source: 'photos', importBatch: batch }); books.push(b); used.add(b.id); return b; };
  const where = b => [b.room, b.bookcase, b.shelf ? 'shelf ' + b.shelf : '', b.position ? '#' + b.position : ''].filter(Boolean).join(' · ') || 'no shelf yet';
  const lowNote = r => 'Partly identified — check the title (photo reading was ' + r.confidence + ' confidence)' + (r.note ? '. ' + r.note : '');
  const rechecked = new Map();                    // "room|bookcase|shelf?" → true, for "not seen"

  for (const blk of readings.blocks) {
    const p = parsePhotoName(blk.photo, books);
    if (!p) { log.problems.push(blk.photo + ': not a photo name from the app; block skipped'); continue; }

    if (p.kind === 'identify') {
      const b = books.find(x => x.id === p.id && !x.deleted), r = blk.books[0];
      if (!b) { log.problems.push(blk.photo + ': no book with id ' + p.id); continue; }
      if (!r || !r.title) { log.problems.push(blk.photo + ': title page still unreadable; left as is'); touch(b, { idPhoto: undefined }); continue; }
      const sure = r.confidence !== 'low';
      touch(b, { title: r.title, author: r.author || b.author, idPhoto: undefined, needsReview: sure ? undefined : true,
        notes: sure ? String(b.notes || '').replace(/^Partly identified[^\n]*\n?/, '') || undefined : lowNote(r) });
      log.identified.push(r.title + (r.author ? ' — ' + r.author : '') + ' (' + where(b) + ')');
      continue;
    }

    const place = { room: blk.over.room ?? p.room, bookcase: blk.over.bookcase ?? p.bookcase, shelf: blk.over.shelf ?? p.shelf };
    if (p.kind === 'new-books' && !place.room && !place.bookcase) place.shelf = '';
    const recheck = p.kind === 'recheck';
    // "not seen" covers what the photo was taken for (its name): the whole bookcase, or the one shelf typed in the app
    if (recheck) { const sc = { room: place.room, bookcase: place.bookcase, shelf: p.shelf }; rechecked.set([sc.room, sc.bookcase, sc.shelf].join('|'), sc); }

    for (const r of blk.books) {
      const at = Object.assign({}, place, { position: r.position });
      if (!r.title) {                                             // a spine that can't be read
        const here = live().find(b => isUnid(b) && !used.has(b.id) && b.room === at.room && b.bookcase === at.bookcase && String(b.shelf || '') === String(at.shelf || '')
          && (recheck || String(b.position || '') === String(at.position || '')));
        if (here) { used.add(here.id); if (touch(here, { shelf: at.shelf, position: at.position, checkedAt: recheck ? today : here.checkedAt })) log.moved.push(here.title + ' → ' + where(here)); else log.same.push(here.title); continue; }
        const m = add(Object.assign({ title: '(' + (r.note || 'spine couldn’t be read') + ')', needsReview: true, notes: 'Unidentified from a ' + (recheck ? 'recheck' : 'shelf') + ' photo ' + today }, at.room || at.bookcase ? at : {}, recheck ? { checkedAt: today } : {}));
        log.mysteries.push(m.title + ' (' + where(m) + ')');
        continue;
      }
      const key = bookKey(r.title, r.author);
      const cands = live().filter(b => !used.has(b.id) && bookKey(b.title, b.author) === key);
      const sameCase = cands.filter(b => b.room === at.room && b.bookcase === at.bookcase);
      const sameRoom = cands.filter(b => b.room === at.room);
      const noPlace = cands.filter(b => !hasPlace(b));
      // which copy is this? the one already here, else one with no place yet; a recheck also takes one from elsewhere
      const pick = sameCase[0] || noPlace[0] || (recheck ? (sameRoom[0] || cands[0]) : null);
      const fields = r.confidence === 'low' ? { needsReview: true, notes: lowNote(r) } : {};
      if (pick) {
        used.add(pick.id);
        const from = where(pick);
        const ch = touch(pick, Object.assign({ room: at.room, bookcase: at.bookcase, shelf: at.shelf, position: at.position },
          recheck ? { checkedAt: today } : {},
          recheck && /not seen at recheck/i.test(pick.notes || '') ? { notes: String(pick.notes).replace(/\s*Not seen at recheck \d{4}-\d\d-\d\d\.?/gi, '').trim() || undefined, needsReview: undefined } : {}));
        if (ch && from !== where(pick)) log.moved.push(pick.title + ': ' + from + ' → ' + where(pick)); else log.same.push(pick.title);
        continue;
      }
      if (cands.length) {                                          // another copy lives elsewhere: add, but say so
        const b = add(Object.assign({ title: r.title, author: r.author }, at, { needsReview: true, notes: 'Possible second copy — another copy is at ' + where(cands[0]) + '. Delete this one if it’s the same book.' }));
        log.copies.push(b.title + ' (' + where(b) + '; other copy ' + where(cands[0]) + ')');
        continue;
      }
      const b = add(Object.assign({ title: r.title, author: r.author }, at.room || at.bookcase ? at : {}, fields,
        recheck ? { checkedAt: today, needsReview: true, notes: (fields.notes ? fields.notes + '. ' : '') + 'Found at recheck ' + today + ' (not in the library before).' } : {}));
      (recheck ? log.found : log.added).push(b.title + (b.author ? ' — ' + b.author : '') + ' (' + where(b) + ')');
    }
  }
  // a recheck: books the library places on that bookcase (or shelf) that no photo showed — flagged, never deleted
  for (const pl of rechecked.values()) {
    for (const b of live()) {
      if (used.has(b.id) || b.room !== pl.room || b.bookcase !== pl.bookcase || (pl.shelf && String(b.shelf || '') !== String(pl.shelf))) continue;
      if (/not seen at recheck/i.test(b.notes || '')) { touch(b, { notes: String(b.notes).replace(/Not seen at recheck \d{4}-\d\d-\d\d/i, 'Not seen at recheck ' + today) }); log.notSeen.push(b.title + ' (' + where(b) + ', again)'); continue; }
      touch(b, { needsReview: true, notes: ((b.notes ? b.notes + ' ' : '') + 'Not seen at recheck ' + today + '.').trim() });
      log.notSeen.push(b.title + ' (' + where(b) + ')');
    }
  }
  const added = log.added.length + log.mysteries.length + log.copies.length + log.found.length;
  const places = [...new Set(readings.blocks.map(b => { const p = parsePhotoName(b.photo, books); return p && p.kind !== 'identify' ? [p.room, p.bookcase].filter(Boolean).join(' ') : ''; }).filter(Boolean))];
  if (added || log.moved.length || log.identified.length || log.notSeen.length) {
    store.imports = (store.imports || []).concat([{ id: batch, at: now, added, label: 'Photos' + (places.length ? ': ' + places.join(', ') : '') }]).slice(-20);
    store.updatedAt = now;
  }
  return { batch, log, added };
}

/* ---------------- files: catalog, ledger, log, photos ---------------- */
const CATALOG = 'tamarack-library.json';
const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');
function readCatalog(dir) {
  const p = path.join(dir, CATALOG);
  if (!fs.existsSync(p)) return { store: { format: 'tamarack-library', version: 1, books: [], imports: [] }, hash: null };
  const buf = fs.readFileSync(p); const store = JSON.parse(buf.toString('utf8'));
  if (!store || !Array.isArray(store.books)) throw new Error(p + ' is not a library file — not touching it');
  if (!Array.isArray(store.imports)) store.imports = [];
  return { store, hash: sha1(buf) };
}
// Dropbox keeps both versions when two devices save at once: "tamarack-library (Matt's conflicted copy 2026-10-19).json"
function conflictedCopies(dir) { return fs.readdirSync(dir).filter(f => /^tamarack-library .*conflicted copy.*\.json$/i.test(f)); }
// The ledger is the library's existing photos/inbox/_processed.json: { about, processed:[{ file, at, batch, sha1? }] }
const LEDGER = ['photos', 'inbox', '_processed.json'];
const LEDGER_ABOUT = "Photo inbox for this library. Photos are read by Claude, merged with tools/photo-merge.mjs, logged in imports/, then deleted. Every photo processed is listed here so it is never read twice.";
function readLedger(dir) {
  let raw = null; try { raw = JSON.parse(fs.readFileSync(path.join(dir, ...LEDGER), 'utf8')); } catch (e) {}
  const led = { about: (raw && raw.about) || LEDGER_ABOUT, processed: (raw && Array.isArray(raw.processed)) ? raw.processed : [], photos: {} };
  for (const e of led.processed) if (e && e.file) led.photos[e.file] = e;
  return led;
}
function writeLedger(dir, led) {
  fs.mkdirSync(path.join(dir, 'photos', 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, ...LEDGER), JSON.stringify({ about: led.about, processed: led.processed }, null, 2));
}
function photoPath(dir, name) { return /^identify\//i.test(name.replace(/\\/g, '/')) ? path.join(dir, 'photos', name) : path.join(dir, 'photos', 'inbox', name); }
function listInbox(dir) {
  const out = [];
  for (const sub of ['inbox', 'identify']) {
    const d = path.join(dir, 'photos', sub); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) if (/\.jpe?g$/i.test(f)) out.push(sub === 'identify' ? 'identify/' + f : f);
  }
  return out;
}
function logText(res, readings, dir, opts) {
  const L = res.log, sec = (t, a) => a.length ? '\n## ' + t + ' (' + a.length + ')\n' + a.map(x => '- ' + x).join('\n') + '\n' : '';
  return '# Photos read ' + new Date(opts.now).toLocaleString() + '\n\nBatch `' + res.batch + '` · ' + readings.blocks.length + ' photo block(s) · library folder ' + path.basename(dir) + '\n'
    + sec('Added', L.added) + sec('Mystery books (spine unreadable)', L.mysteries) + sec('Possible second copies (added, flagged)', L.copies)
    + sec('Found at recheck (not in the library before)', L.found) + sec('Moved', L.moved) + sec('Already in place', L.same)
    + sec('Identified from title pages', L.identified) + sec('Not seen at recheck (flagged, not deleted)', L.notSeen)
    + sec('Skipped (already processed)', L.skipped) + sec('Problems', L.problems);
}

export function run(dir, readingsFile, opts = {}) {
  const now = opts.now || Date.now(); const out = [];
  if (!fs.existsSync(path.join(dir))) throw new Error('No folder ' + dir);
  const ledger = readLedger(dir), waiting = listInbox(dir);
  const conflicts = conflictedCopies(dir);
  if (!readingsFile) {
    out.push(waiting.length + ' photo(s) waiting in ' + path.join(dir, 'photos'));
    for (const f of waiting) out.push('  ' + (ledger.photos[f] ? '[done before] ' : '') + f);
    if (conflicts.length) out.push('Conflicted copies of the catalog (merged on the next --apply): ' + conflicts.join(', '));
    return { text: out.join('\n') };
  }
  const readings = parseReadings(fs.readFileSync(readingsFile, 'utf8'));
  if (readings.errors.length) throw new Error('The readings file has problems:\n  ' + readings.errors.join('\n  '));
  const skipped = [];
  readings.blocks = readings.blocks.filter(b => { if (ledger.photos[b.photo] && !opts.force) { skipped.push(b.photo); return false; } return true; });
  const missing = readings.blocks.map(b => b.photo).filter((f, i, a) => a.indexOf(f) === i && !fs.existsSync(photoPath(dir, f)));
  // reload-and-reapply: if the catalog changes while we work (a phone synced), start again on the new one
  for (let attempt = 0; attempt < 4; attempt++) {
    const { store: base, hash } = readCatalog(dir);
    let store = base;
    for (const c of conflicts) { try { const o = JSON.parse(fs.readFileSync(path.join(dir, c), 'utf8')); if (o && Array.isArray(o.books)) store = mergeStores(store, o); } catch (e) {} }
    const res = applyReadings(store, readings, { now });
    res.log.skipped = skipped;
    if (missing.length) res.log.problems.push(...missing.map(f => f + ': not in the inbox (read from a copy?)'));
    const text = logText(res, readings, dir, { now });
    if (!opts.apply) return { text: '(dry run: nothing written)\n' + text, res };
    const again = readCatalog(dir).hash;
    if (again !== hash) { out.push('The catalog changed while working (a phone synced); reapplying on the new version.'); continue; }
    fs.writeFileSync(path.join(dir, CATALOG), readableJSON(store));
    // the compact readings as JSON, and the log, beside the earlier imports
    const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    fs.mkdirSync(path.join(dir, 'imports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'imports', stamp + ' photos ' + res.batch + '.md'), text);
    fs.writeFileSync(path.join(dir, 'imports', stamp + ' photos ' + res.batch + '.json'), JSON.stringify(readings.blocks, null, 2));
    for (const c of conflicts) { fs.mkdirSync(path.join(dir, 'imports', 'conflicts'), { recursive: true }); fs.renameSync(path.join(dir, c), path.join(dir, 'imports', 'conflicts', c)); }
    // the ledger: every photo processed, with its checksum, so it's never read twice
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    for (const f of new Set(readings.blocks.map(b => b.photo))) { const p = photoPath(dir, f);
      const e = { file: f, at: now, batch: res.batch, sha1: fs.existsSync(p) ? sha1(fs.readFileSync(p)) : null }; ledger.processed.push(e); ledger.photos[f] = e; }
    writeLedger(dir, ledger);
    let deleted = 0;
    if (!opts.keepPhotos) {
      for (const f of new Set(readings.blocks.map(b => b.photo))) {
        const p = photoPath(dir, f);
        if (fs.existsSync(p)) { fs.unlinkSync(p); deleted++; }
        // the batch's note goes once none of its photos are left
        const base = p.replace(/( \d{2,3})?( redo)?\.jpe?g$/i, ''), note = base + ' NOTE.txt';
        if (fs.existsSync(note) && !listInbox(dir).some(x => photoPath(dir, x).startsWith(base + ' ') || photoPath(dir, x) === base + '.jpg')) fs.unlinkSync(note);
      }
    }
    out.push(text, 'Written: catalog, log in imports/, ledger photos/inbox/_processed.json' + (opts.keepPhotos ? '' : '; ' + deleted + ' photo(s) deleted') + '.');
    return { text: out.join('\n'), res };
  }
  throw new Error('The catalog kept changing while working; try again in a minute.');
}

// command line
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--'))), pos = args.filter(a => !a.startsWith('--'));
  if (!pos[0]) { console.log('Usage: node tools/photo-merge.mjs "<library folder>" [readings.txt] [--apply] [--keep-photos] [--force]'); process.exit(1); }
  try { console.log(run(pos[0], pos[1], { apply: flags.has('--apply'), keepPhotos: flags.has('--keep-photos'), force: flags.has('--force') }).text); }
  catch (e) { console.error(e.message); process.exit(1); }
}
