/* Railey Library — library.js
   The library list: feed / cards / list views, paging, selection, and the lists behind the drop-downs.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Derived lists (rooms, bookcases, …)
   ============================================================ */
function uniq(arr){ return [...new Set(arr.filter(v=>v!==undefined && v!==null && String(v).trim()!=='').map(v=>String(v).trim()))].sort(natCmp); }
function fillSelect(sel, values, anyLabel){
  const cur = sel.value;
  sel.innerHTML = '<option value="">'+esc(anyLabel)+'</option>' + values.map(v=>'<option>'+esc(v)+'</option>').join('');
  sel.value = values.includes(cur) ? cur : '';
}
function fillDatalist(id, values){ $(id).innerHTML = values.map(v=>'<option value="'+esc(v)+'">').join(''); }
function refreshLists(){
  const L = live();
  const room = $('f-room').value, bc = $('f-case').value;
  fillSelect($('f-room'), uniq(L.map(b=>b.room)), 'Room — any');
  fillSelect($('f-case'), uniq(L.filter(b=>!$('f-room').value || b.room===$('f-room').value).map(b=>b.bookcase)), 'Bookcase — any');
  fillSelect($('f-shelf'), uniq(L.filter(b=>(!$('f-room').value || b.room===$('f-room').value) && (!$('f-case').value || b.bookcase===$('f-case').value)).map(b=>b.shelf)), 'Shelf — any');
  fillSelect($('f-genre'), uniq(L.map(b=>b.genre)), 'All genres');
  fillSelect($('s-room'), uniq(L.map(b=>b.room)), 'All rooms');
  fillDatalist('dl-room', uniq(L.map(b=>b.room)));
  fillDatalist('dl-case', uniq(L.map(b=>b.bookcase)));
  fillDatalist('dl-shelf', uniq(L.map(b=>b.shelf)));
  fillDatalist('dl-author', uniq(L.map(b=>b.author)));
  fillDatalist('dl-series', uniq(L.map(b=>b.series)));
  fillDatalist('dl-genre', uniq(L.map(b=>b.genre)));
  fillDatalist('dl-loan', uniq(L.map(b=>b.loanedTo)));
  fillDatalist('dl-coll', allColls().map(c=>c[0]));
  $('b-coll-rm').innerHTML='<option value="">(none)</option>'+allColls().map(([c])=>'<option>'+esc(c)+'</option>').join('');
}


/* ============================================================
   Library render
   ============================================================ */
const ui = Object.assign({ view: (window.matchMedia && matchMedia('(max-width:700px)').matches) ? 'feed' : 'grid' }, (()=>{ try{ return JSON.parse(lsGet(UI_KEY)||'{}'); }catch(e){ return {}; } })());
let shown = PAGE, current = [], selectMode = false;
const selected = new Set();

function chipsHTML(b){
  const c=[];
  const st=b.status||'unread';
  if(st==='read') c.push('<span class="chip read">Read</span>');
  else if(st==='reading') c.push('<span class="chip reading">Reading</span>');
  if(b.loanedTo) c.push('<span class="chip loan">Loaned: '+esc(b.loanedTo)+'</span>');
  if(+b.rating) c.push('<span class="chip stars">'+'★'.repeat(+b.rating)+'</span>');
  if(b.needsReview) c.push('<span class="chip review">'+(String(b.title||'').startsWith('(')?'Unidentified':'Partly identified')+'</span>');
  if(b.genre) c.push('<span class="chip">'+esc(b.genre)+'</span>');
  return c.join('');
}
function renderLibrary(resetPaging){
  renderCollBar();
  if(resetPaging) shown = PAGE;
  current = filtered();
  const all = live();
  const slice = current.slice(0, shown);
  const box = $('results');
  if(!all.length){
    box.innerHTML = '<div class="card empty">No books yet. Head to <b>Import</b> to load the file from your shelf photos, or tap <b>+ Add book</b>.</div>';
  } else if(!current.length){
    box.innerHTML = '<div class="card empty">No books match. Try fewer words or clear the filters.</div>';
  } else if(ui.view==='feed'){
    box.innerHTML = '<div class="feed">' + slice.map(b=>{
      const ser = b.series ? esc(b.series)+(b.seriesNo?' #'+esc(b.seriesNo):'') : '';
      return '<article class="post'+(selected.has(b.id)?' selected':'')+'" data-id="'+b.id+'">'+
        '<div class="post-art" style="--bg:'+CLOTH[hue(b.title)%CLOTH.length]+'"><div class="cover big">'+coverHTML(b,'L')+'</div></div>'+
        '<div class="post-body"><h4>'+esc(b.title||'(untitled)')+'</h4>'+
        '<div class="au">'+esc(b.author||'Unknown author')+(b.year?' · '+esc(b.year):'')+'</div>'+
        (ser?'<div class="ser">'+ser+'</div>':'')+
        (b.about?'<p class="ab">'+esc(b.about)+'</p>':'')+
        '<div class="chips">'+chipsHTML(b)+'</div>'+
        '<div class="loc">📍 '+esc(locText(b))+'</div></div></article>'; }).join('') + '</div>';
  } else if(ui.view==='list'){
    box.innerHTML = '<div class="lb-list">' + slice.map(b=>
      '<div class="lr'+(selected.has(b.id)?' selected':'')+'" data-id="'+b.id+'"><div class="cover" style="width:30px;height:44px;">'+coverHTML(b)+'</div><div class="t"><b>'+esc(b.title||'(untitled)')+'</b><span>'+esc(b.author||'')+(b.loanedTo?' · <span style="color:#a33b17">loaned to '+esc(b.loanedTo)+'</span>':'')+(b.needsReview?' · <span style="color:#8a5a00">'+(String(b.title||'').startsWith('(')?'unidentified':'partly identified')+'</span>':'')+'</span></div><div class="l">'+esc(locText(b))+'</div></div>'
    ).join('') + '</div>';
  } else {
    box.innerHTML = '<div class="lb-grid">' + slice.map(b=>
      '<div class="bk'+(selected.has(b.id)?' selected':'')+'" data-id="'+b.id+'">'+(selectMode?'<div class="selbox">'+(selected.has(b.id)?'✓':'')+'</div>':'')+
      '<div class="cover">'+coverHTML(b)+'</div><div class="bk-body"><h4>'+esc(b.title||'(untitled)')+'</h4><div class="au">'+esc(b.author||'Unknown author')+'</div><div class="loc">'+esc(locText(b))+'</div><div class="chips">'+chipsHTML(b)+'</div></div></div>'
    ).join('') + '</div>';
  }
  $('more-wrap').classList.toggle('hide', current.length <= shown);
  $('more-wrap').classList.toggle('auto', true);
  $('btn-more').textContent = 'Show more ('+(current.length-shown).toLocaleString()+' left)';
  const loaned = current.filter(b=>b.loanedTo).length, read = current.filter(b=>b.status==='read').length;
  const rev = current.filter(b=>b.needsReview).length;
  $('summary').innerHTML = (ui.coll?'<span class="coll-now">'+esc(ui.coll)+'</span> ':'') + (lastFuzzy?'<span style="color:#8a5a00">No exact matches for “'+esc($('f-q').value.trim())+'” — these are close spellings.</span> ':'') + 'Showing <b>'+current.length.toLocaleString()+'</b> of '+all.length.toLocaleString()+' books'
    + (read?' · '+read.toLocaleString()+' read':'') + (loaned?' · <span style="color:#a33b17">'+loaned+' loaned out</span>':'')
;
  $('hdr-count').textContent = all.length.toLocaleString() + ' book' + (all.length===1?'':'s');
  updateBatchBar();
  syncMoreBtn();
}
$('results').addEventListener('click', e=>{
  const el = e.target.closest('[data-id]'); if(!el) return;
  const id = el.dataset.id;
  if(selectMode){ selected.has(id)?selected.delete(id):selected.add(id); renderLibrary(false); return; }
  openBook(id, current.map(b=>b.id));
});
$('btn-more').onclick = ()=>{ shown += PAGE*2; renderLibrary(false); };
// endless scrolling: load the next batch automatically as you near the bottom
if('IntersectionObserver' in window){
  new IntersectionObserver(es=>{ if(es.some(e=>e.isIntersecting) && current.length>shown && $('library').classList.contains('active')){ const y=window.scrollY; shown += PAGE; renderLibrary(false); window.scrollTo(0,y); } }, {rootMargin:'1200px 0px'}).observe($('more-wrap'));
}
function syncClearBtn(){ $('btn-clear-q').classList.toggle('hide', !$('f-q').value); }
$('btn-clear-q').onclick = ()=>{ $('f-q').value=''; syncClearBtn(); renderLibrary(true); $('f-q').focus(); };
$('f-q').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); $('f-q').blur(); } if(e.key==='Escape'){ $('btn-clear-q').onclick(); } });
['f-q'].forEach(id=>$(id).addEventListener('input', ()=>{ syncClearBtn(); clearTimeout(renderLibrary._t); renderLibrary._t=setTimeout(()=>renderLibrary(true),120); }));
['f-room','f-case','f-shelf','f-status','f-genre','f-loan','f-rating','f-sort','f-review'].forEach(id=>$(id).addEventListener('change', ()=>{
  if(id==='f-room'){ $('f-case').value=''; $('f-shelf').value=''; }
  if(id==='f-case'){ $('f-shelf').value=''; }
  if(id==='f-room'||id==='f-case') refreshLists();
  ui.sort=$('f-sort').value; lsSet(UI_KEY, JSON.stringify(ui));
  renderLibrary(true);
}));
$('btn-reset').onclick = ()=>{ ui.coll=''; lsSet(UI_KEY, JSON.stringify(ui)); syncClearBtn && setTimeout(syncClearBtn); ['f-q','f-room','f-case','f-shelf','f-status','f-genre','f-loan','f-rating'].forEach(id=>$(id).value=''); $('f-review').checked=false; refreshLists(); renderLibrary(true); };
document.querySelectorAll('#view-seg button').forEach(b=>b.onclick=()=>{ ui.view=b.dataset.view; lsSet(UI_KEY, JSON.stringify(ui)); syncViewSeg(); renderLibrary(false); });
const SCOPE_PH = { all:'Search title, author, keyword…', title:'Search titles (and series)…', author:'Search authors…' };
function syncScope(){ document.querySelectorAll('#scope-seg button').forEach(b=>b.classList.toggle('active', b.dataset.scope===(ui.scope||'all'))); $('f-q').placeholder = SCOPE_PH[ui.scope||'all']; }
document.querySelectorAll('#scope-seg button').forEach(b=>b.onclick=()=>{ ui.scope=b.dataset.scope; lsSet(UI_KEY, JSON.stringify(ui)); syncScope(); renderLibrary(true); $('f-q').focus(); });
function activeFilterCount(){ return ['f-room','f-case','f-shelf','f-status','f-loan','f-rating'].filter(id=>$(id).value).length + ($('f-review').checked?1:0); }
function syncMoreBtn(){ const n=activeFilterCount(); $('btn-more-filters').textContent = (ui.moreOpen?'Fewer':'Filters') + (n?' ('+n+')':''); $('more-filters').classList.toggle('hide', !ui.moreOpen); }
$('btn-more-filters').onclick = ()=>{ ui.moreOpen=!ui.moreOpen; lsSet(UI_KEY, JSON.stringify(ui)); syncMoreBtn(); };
function syncViewSeg(){ document.querySelectorAll('#view-seg button').forEach(b=>b.classList.toggle('active', b.dataset.view===ui.view)); }

/* batch select */
function updateBatchBar(){ $('batchbar').classList.toggle('hide', !selectMode); $('batch-count').textContent = selected.size + ' selected'; $('btn-select').classList.toggle('hide', selectMode); }
$('btn-select').onclick = ()=>{ selectMode=true; renderLibrary(false); };
$('btn-batch-done').onclick = ()=>{ selectMode=false; selected.clear(); renderLibrary(false); };
$('btn-batch-clear').onclick = ()=>{ selected.clear(); renderLibrary(false); };
$('btn-batch-all').onclick = ()=>{ current.forEach(b=>selected.add(b.id)); renderLibrary(false); };
$('btn-batch-del').onclick = ()=>{
  if(!selected.size) return;
  if(!confirm('Delete '+selected.size+' book'+(selected.size===1?'':'s')+'? This can\'t be undone (except from a backup).')) return;
  const now=Date.now();
  store.books = store.books.map(b=>selected.has(b.id)?{id:b.id, deleted:true, updatedAt:now}:b);
  selected.clear(); commit(); toast('Deleted');
};
$('btn-batch-edit').onclick = ()=>{
  if(!selected.size){ toast('Select some books first'); return; }
  ['b-room','b-bookcase','b-shelf','b-genre','b-coll-add','b-coll-rm'].forEach(id=>$(id).value=''); $('b-status').value=''; $('b-review').value='';
  $('b-title').textContent = 'Edit '+selected.size+' book'+(selected.size===1?'':'s');
  $('batch-bg').classList.add('open');
};
function closeBatch(){ $('batch-bg').classList.remove('open'); }
$('b-close').onclick = closeBatch; $('b-cancel').onclick = closeBatch;
$('b-apply').onclick = ()=>{
  const ch = {};
  const v = id=>$(id).value.trim();
  if(v('b-room')) ch.room=v('b-room'); if(v('b-bookcase')) ch.bookcase=v('b-bookcase'); if(v('b-shelf')) ch.shelf=v('b-shelf');
  if(v('b-status')) ch.status=v('b-status'); if(v('b-genre')) ch.genre=v('b-genre');
  if(v('b-review')) ch.needsReview = v('b-review')==='yes';
  const add=v('b-coll-add'), rm=$('b-coll-rm').value;          // add to / remove from a collection
  if(!Object.keys(ch).length && !add && !rm){ closeBatch(); return; }
  const now=Date.now();
  store.books = store.books.map(b=>{
    if(!selected.has(b.id) || b.deleted) return b;
    let cs=collsOf(b); const before=cs.join('|');
    if(add && !cs.includes(add)) cs=cs.concat(add);
    if(rm) cs=cs.filter(c=>c!==rm);
    const collCh = cs.join('|')!==before ? { collections:cs } : {};
    if(!Object.keys(ch).length && !collCh.collections) return b;
    return Object.assign({}, b, ch, collCh, {updatedAt:now});
  });
  closeBatch(); commit();
  toast(Object.keys(ch).length ? 'Updated '+selected.size+' books' : add ? 'Added to “'+add+'”' : 'Removed from “'+rm+'”');
};
