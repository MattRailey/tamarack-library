/* Railey Library — import.js
   Importing pasted or uploaded lists (CSV / JSON), with a preview and undo.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Import
   ============================================================ */
let pending = null;   // parsed rows awaiting confirmation
const COLMAP = { title:['title','book','name'], author:['author','authors','by'], isbn:['isbn','isbn13','isbn10'], room:['room'], bookcase:['bookcase','case','bookshelf','shelf unit'],
  shelf:['shelf','shelf #','shelf number','row'], position:['position','pos','# from left','from left','order'], status:['status','read status','read'], rating:['rating','stars'],
  value:['value','price','$'], notes:['notes','note','comments'], loanedTo:['loaned to','loaned','lent to','loanedto'], genre:['genre','category','subject'], year:['year','published','pub year'],
  publisher:['publisher'], series:['series'], seriesNo:['series #','series number','seriesno','book #'], format:['format','binding'], pages:['pages','page count'], confidence:['confidence'], subjects:['keywords','subjects','tags','topics'] };
function parseCSV(text){
  const rows=[]; let row=[], f='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){ f+='"'; i++; } else q=false; } else f+=c; continue; }
    if(c==='"') q=true; else if(c===','){ row.push(f); f=''; } else if(c==='\n'){ row.push(f); rows.push(row); row=[]; f=''; } else if(c!=='\r') f+=c;
  }
  if(f!=='' || row.length){ row.push(f); rows.push(row); }
  const head = (rows.shift()||[]).map(h=>norm(h).trim());
  const idx = {}; for(const k in COLMAP){ const j = head.findIndex(h=>COLMAP[k].includes(h)); if(j>=0) idx[k]=j; }
  if(idx.title===undefined) throw new Error('CSV needs a "Title" column');
  return rows.filter(r=>r.some(x=>x.trim())).map(r=>{ const o={}; for(const k in idx) o[k]=(r[idx[k]]||'').trim(); return o; });
}
function parseImport(text){
  text = text.replace(/^﻿/,'').trim();
  if(!text) throw new Error('Nothing to import');
  if(text[0]==='{' || text[0]==='['){
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : (j.books || j.items || []);
    if(!Array.isArray(arr)) throw new Error('No "books" list in that file');
    return { rows: arr.filter(b=>b && !b.deleted), isStore: !!(j && j.format==='tamarack-library') };
  }
  return { rows: parseCSV(text), isStore:false };
}
function cleanRow(r){
  const s = v=> v==null ? '' : String(v).trim();
  let status = norm(s(r.status));
  status = /^(read|yes|y|true|done|finished)$/.test(status) ? 'read' : /reading|current/.test(status) ? 'reading' : 'unread';
  const low = /low|unsure|uncertain|guess/.test(norm(s(r.confidence))) || r.needsReview===true;
  return { title:s(r.title), author:s(r.author||(Array.isArray(r.authors)?r.authors.join(', '):r.authors)), series:s(r.series), seriesNo:s(r.seriesNo),
    genre:s(r.genre), subjects:Array.isArray(r.subjects)?r.subjects.join(', '):s(r.subjects||r.keywords), format:s(r.format), room:s(r.room), bookcase:s(r.bookcase), shelf:s(r.shelf), position:s(r.position),
    status, loanedTo:s(r.loanedTo), loanedDate:s(r.loanedDate), rating:Math.max(0,Math.min(5,parseInt(r.rating)||0)),
    value:s(r.value).replace(/[$,]/g,''), isbn:s(r.isbn).replace(/[^0-9Xx]/g,''), year:s(r.year), publisher:s(r.publisher), pages:s(r.pages),
    notes:s(r.notes), coverUrl:s(r.coverUrl), needsReview:low };
}
function dupKey(b){ return normKey(b.title)+'|'+normKey(String(b.author||'').split(/[,&;]| and /)[0]).split(' ').pop(); }
function showPreview(parsed){
  const rows = parsed.rows.map(cleanRow).filter(r=>r.title);
  if(!rows.length) throw new Error('No books with titles found');
  pending = { rows };
  const existing = new Map(live().map(b=>[dupKey(b), b]));
  const seen = new Set();
  pending.rows.forEach(r=>{ const k=dupKey(r); r._dup = existing.get(k) || null; r._dupInFile = seen.has(k); seen.add(k); });
  ['imp-room','imp-case','imp-shelf'].forEach(id=>$(id).value='');
  drawPreview();
  $('imp-preview').classList.remove('hide');
  $('imp-preview').scrollIntoView({behavior:'smooth', block:'start'});
}
function drawPreview(){
  const R=pending.rows, dups=R.filter(r=>r._dup).length, low=R.filter(r=>r.needsReview).length;
  $('imp-stats').innerHTML = '<b>'+R.length+'</b> books in file · <b>'+(R.length-dups)+'</b> new'
    + (dups?' · <span style="color:#8a5a00">'+dups+' already in library</span>':'') + (low?' · '+low+' flagged for review':'');
  $('imp-dup-row').classList.toggle('hide', !dups);
  const dr=$('imp-room').value.trim(), dc=$('imp-case').value.trim(), ds=$('imp-shelf').value.trim();
  $('imp-rows').innerHTML = R.slice(0,500).map((r,i)=>{
    const loc = locText({ room:r.room||dr, bookcase:r.bookcase||dc, shelf:r.shelf||ds, position:r.position });
    return '<tr class="'+(r._dup?'dup':'')+'"><td>'+(i+1)+'</td><td>'+esc(r.title)+'</td><td>'+esc(r.author)+'</td><td>'+esc(loc)+'</td><td>'+
      (r._dup?'<span class="chip review">In library</span>':'')+(r.needsReview?' <span class="chip review">Review</span>':'')+'</td></tr>';
  }).join('') + (R.length>500?'<tr><td colspan="5" class="note">…and '+(R.length-500)+' more</td></tr>':'');
  $('btn-do-import').textContent = 'Import ' + R.length + ' book' + (R.length===1?'':'s');
}
['imp-room','imp-case','imp-shelf'].forEach(id=>$(id).addEventListener('input', ()=>{ if(pending) drawPreview(); }));
function handleText(text){ try{ showPreview(parseImport(text)); }catch(e){ toast('Couldn\'t read that: '+e.message); } }
$('dropzone').onclick = ()=>$('imp-file').click();
$('imp-file').onchange = e=>{ const f=e.target.files[0]; if(!f) return; f.text().then(handleText); e.target.value=''; };
['dragover','dragenter'].forEach(ev=>$('dropzone').addEventListener(ev, e=>{ e.preventDefault(); $('dropzone').classList.add('dragover'); }));
['dragleave','drop'].forEach(ev=>$('dropzone').addEventListener(ev, e=>{ e.preventDefault(); $('dropzone').classList.remove('dragover'); }));
$('dropzone').addEventListener('drop', e=>{ const f=e.dataTransfer.files[0]; if(f) f.text().then(handleText); });
$('btn-parse').onclick = ()=>handleText($('imp-text').value);
$('btn-cancel-import').onclick = ()=>{ pending=null; $('imp-preview').classList.add('hide'); };
$('btn-do-import').onclick = ()=>{
  if(!pending) return;
  const dr=$('imp-room').value.trim(), dc=$('imp-case').value.trim(), ds=$('imp-shelf').value.trim();
  const mode = $('imp-dups').value, now=Date.now(), batch='imp'+now.toString(36);
  let added=0, moved=0, skipped=0;
  for(const r of pending.rows){
    const row = Object.assign({}, r); delete row._dup; delete row._dupInFile;
    if(!row.room) row.room=dr; if(!row.bookcase) row.bookcase=dc; if(!row.shelf) row.shelf=ds;
    if(r._dup && mode==='skip'){ skipped++; continue; }
    if(r._dup && mode==='move'){
      const b = byId(r._dup.id);
      if(b){ Object.assign(b, { room:row.room||b.room, bookcase:row.bookcase||b.bookcase, shelf:row.shelf||b.shelf, position:row.position||b.position, updatedAt:now }); moved++; }
      continue;
    }
    Object.keys(row).forEach(k=>{ if(row[k]==='' || row[k]===0 && k==='rating' || row[k]===false) delete row[k]; });
    store.books.push(Object.assign({ status:'unread' }, row, { id:uid(), addedAt:now, updatedAt:now, source:'import', importBatch:batch }));
    added++;
  }
  store.imports.push({ id:batch, at:now, added, label:(dr||dc||ds) ? [dr, dc&&'Case '+dc, ds&&'Shelf '+ds].filter(Boolean).join(' · ') : '' });
  pending=null; $('imp-preview').classList.add('hide'); $('imp-text').value='';
  commit();
  setTimeout(()=>autoLookup(false), 800);
  toast('Imported '+added+(moved?', moved '+moved:'')+(skipped?', skipped '+skipped+' already in library':''));
};
function renderUndo(){
  const last = [...store.imports].reverse().find(i=>!i.undone && i.added);
  $('btn-undo-import').disabled = !last;
  $('undo-text').textContent = last ? 'Last import: '+last.added+' books on '+new Date(last.at).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})+(last.label?' ('+last.label+')':'')+'. Undoing removes only the books that import added — edits you made to them since are lost too.' : 'No imports to undo.';
}
$('btn-undo-import').onclick = ()=>{
  const last = [...store.imports].reverse().find(i=>!i.undone && i.added); if(!last) return;
  const ids = live().filter(b=>b.importBatch===last.id).map(b=>b.id);
  if(!confirm('Remove the '+ids.length+' books added by that import?')) return;
  const now=Date.now(), set=new Set(ids);
  store.books = store.books.map(b=>set.has(b.id)?{id:b.id, deleted:true, updatedAt:now}:b);
  last.undone=true; commit(); toast('Removed '+ids.length+' books');
};
