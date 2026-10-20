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
  if(L.some(b=>!b.room)){ $('f-room').insertAdjacentHTML('beforeend','<option value="'+NO_SHELF+'">No shelf yet</option>'); if(room===NO_SHELF) $('f-room').value=NO_SHELF; }
  const ca=cataloguedAt(), on=$('f-added').querySelector('option[value="new"]');
  if(on) on.textContent = 'New since the library was catalogued'+(ca?' ('+new Date(ca).toLocaleDateString(undefined,{day:'numeric',month:'short'})+' on)':'');
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
/* the date a book went in, shown while looking at recent additions */
function addedTag(b){ if(!b.addedAt || !($('f-added').value || $('f-sort').value==='added')) return ''; return ' · added '+esc(new Date(b.addedAt).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})); }
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
    const on=activeFilters();
    box.innerHTML = '<div class="card empty">No books match.'+(on.length?' A filter is on: <b>'+esc(on.map(f=>f.label).join(' · '))+'</b>.<div style="margin-top:10px;"><button class="filter-clear-btn" data-clear-filters>Clear filters</button></div>':' Try fewer words.')+'</div>';
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
        '<div class="loc">📍 '+esc(locText(b))+addedTag(b)+'</div></div></article>'; }).join('') + '</div>';
  } else if(ui.view==='list'){
    box.innerHTML = '<div class="lb-list">' + slice.map(b=>
      '<div class="lr'+(selected.has(b.id)?' selected':'')+'" data-id="'+b.id+'"><div class="cover" style="width:30px;height:44px;">'+coverHTML(b)+'</div><div class="t"><b>'+esc(b.title||'(untitled)')+'</b><span>'+esc(b.author||'')+(b.loanedTo?' · <span style="color:#a33b17">loaned to '+esc(b.loanedTo)+'</span>':'')+(b.needsReview?' · <span style="color:#8a5a00">'+(String(b.title||'').startsWith('(')?'unidentified':'partly identified')+'</span>':'')+'</span></div><div class="l">'+esc(locText(b))+addedTag(b)+'</div></div>'
    ).join('') + '</div>';
  } else {
    box.innerHTML = '<div class="lb-grid">' + slice.map(b=>
      '<div class="bk'+(selected.has(b.id)?' selected':'')+'" data-id="'+b.id+'">'+(selectMode?'<div class="selbox">'+(selected.has(b.id)?'✓':'')+'</div>':'')+
      '<div class="cover">'+coverHTML(b)+'</div><div class="bk-body"><h4>'+esc(b.title||'(untitled)')+'</h4><div class="au">'+esc(b.author||'Unknown author')+'</div><div class="loc">'+esc(locText(b))+addedTag(b)+'</div><div class="chips">'+chipsHTML(b)+'</div></div></div>'
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
  syncFilterFlags();
  // the newest batch Claude added (photos or an import), for a month
  const li=[...(store.imports||[])].reverse().find(i=>i.added && !i.undone);
  const showLi=li && Date.now()-li.at < 30*864e5;
  $('latest-import').classList.toggle('hide', !showLi);
  if(showLi) $('latest-import').textContent='Latest: '+li.added+' book'+(li.added===1?'':'s')+' added '+new Date(li.at).toLocaleDateString(undefined,{ month:'short', day:'numeric' })+(li.label?' ('+li.label+')':'')+'.';
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
['f-room','f-case','f-shelf','f-status','f-genre','f-loan','f-rating','f-added','f-sort','f-review'].forEach(id=>$(id).addEventListener('change', ()=>{
  /* looking at recent additions: newest first */
  if(id==='f-added' && $('f-added').value) $('f-sort').value='added';
  if(id==='f-room'){ $('f-case').value=''; $('f-shelf').value=''; }
  if(id==='f-case'){ $('f-shelf').value=''; }
  if(id==='f-room'||id==='f-case') refreshLists();
  ui.sort=$('f-sort').value; lsSet(UI_KEY, JSON.stringify(ui));
  renderLibrary(true);
}));
$('btn-reset').onclick = ()=>{ ui.coll=''; lsSet(UI_KEY, JSON.stringify(ui)); syncClearBtn && setTimeout(syncClearBtn); ['f-q','f-room','f-case','f-shelf','f-status','f-genre','f-loan','f-rating','f-added'].forEach(id=>$(id).value=''); $('f-review').checked=false; refreshLists(); renderLibrary(true); };
document.querySelectorAll('#view-seg button').forEach(b=>b.onclick=()=>{ ui.view=b.dataset.view; lsSet(UI_KEY, JSON.stringify(ui)); syncViewSeg(); renderLibrary(false); });
const SCOPE_PH = { all:'Search books…', title:'Search titles…', author:'Search authors…' };
function syncScope(){ document.querySelectorAll('#scope-seg button').forEach(b=>b.classList.toggle('active', b.dataset.scope===(ui.scope||'all'))); $('f-q').placeholder = SCOPE_PH[ui.scope||'all']; }
document.querySelectorAll('#scope-seg button').forEach(b=>b.onclick=()=>{ ui.scope=b.dataset.scope; lsSet(UI_KEY, JSON.stringify(ui)); syncScope(); renderLibrary(true); $('f-q').focus(); });
/* Filters that are on, so a forgotten one is easy to see: highlighted on the page, listed above the books. */
const FILTER_NAMES={ 'f-genre':'Genre', 'f-room':'Room', 'f-case':'Bookcase', 'f-shelf':'Shelf', 'f-status':'Read status', 'f-loan':'Loaned', 'f-rating':'Rating', 'f-added':'Added' };
function activeFilters(){
  const out=[];
  for(const [id,name] of Object.entries(FILTER_NAMES)){ const el=$(id); if(el.value) out.push({ id, label:name+': '+(el.selectedOptions[0]?el.selectedOptions[0].textContent.replace(/^.*?—\s*/,'').trim():el.value) }); }
  if($('f-review').checked) out.push({ id:'f-review', label:'Needs review only' });
  return out;
}
function syncFilterFlags(){
  const on=activeFilters(), ids=new Set(on.map(f=>f.id));
  Object.keys(FILTER_NAMES).forEach(id=>$(id).classList.toggle('filter-on', ids.has(id)));
  $('btn-more-filters').classList.toggle('filter-on', on.some(f=>f.id!=='f-genre'));
  const bar=$('filter-bar'); bar.classList.toggle('hide', !on.length);
  if(on.length) bar.innerHTML='<span class="fb-label">Showing only</span>'+on.map(f=>'<button class="fb-chip" data-off="'+f.id+'" title="Turn this filter off">'+esc(f.label)+' <span aria-hidden="true">×</span></button>').join('')
    +'<button class="fb-clear" data-clear-filters>Clear filters</button>';
}
// one filter off (its chip), or all of them (search text stays)
function clearFilters(){ ['f-room','f-case','f-shelf','f-status','f-genre','f-loan','f-rating','f-added'].forEach(id=>$(id).value=''); $('f-review').checked=false; refreshLists(); renderLibrary(true); }
document.addEventListener('click', e=>{
  if(e.target.closest('[data-clear-filters]')){ clearFilters(); return; }
  const chip=e.target.closest('[data-off]'); if(!chip) return;
  const id=chip.dataset.off;
  if(id==='f-review') $('f-review').checked=false; else $(id).value='';
  if(id==='f-room'){ $('f-case').value=''; $('f-shelf').value=''; } if(id==='f-case') $('f-shelf').value='';
  refreshLists(); renderLibrary(true);
});
function activeFilterCount(){ return ['f-room','f-case','f-shelf','f-status','f-loan','f-rating','f-added'].filter(id=>$(id).value).length + ($('f-review').checked?1:0); }
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
