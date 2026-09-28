/* Railey Library — book.js
   The book window: view, page-turning between books, edit form, save/delete.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Book modal
   ============================================================ */
const FIELDS = ['title','author','about','series','seriesNo','genre','subjects','format','room','bookcase','shelf','position','status','loanedTo','loanedDate','isbn','year','publisher','pages','notes'];
let editId=null, navList=[], editRating=0, pendingCover=null, isNew=false;

function starButtons(){
  $('e-stars').innerHTML = [1,2,3,4,5].map(n=>'<button type="button" data-n="'+n+'" class="'+(n<=editRating?'on':'')+'" aria-label="'+n+' stars">★</button>').join('');
}
$('e-stars').addEventListener('click', e=>{ const n=+(e.target.dataset.n||0); if(!n) return; editRating = (editRating===n?0:n); starButtons(); });

function fillForm(b){
  FIELDS.forEach(f=>{ $('e-'+f).value = b[f]==null ? '' : b[f]; });
  if(!$('e-status').value) $('e-status').value='unread';
  editRating = +b.rating||0; starButtons();
  $('e-review').checked = !!b.needsReview;
  pendingCover = b.coverUrl || null;
  viewFill({cover:$('m-cover'), title:$('m-title'), sub:$('m-sub'), about:$('m-about'), view:$('m-view')}, b);
  $('modal').classList.toggle('viewing', !isNew);
  $('lookup-res').innerHTML = '';
  $('btn-returned').classList.toggle('hide', !b.loanedTo);
  $('btn-delete').classList.toggle('hide', isNew);
  editColls=collsOf(b).slice(); drawCollEditor(); $('e-coll-in').value='';
}
function viewFill(el, b){
  el.title.textContent = b.title || (isNew?'New book':'(untitled)');
  const bits=[]; if(b.author) bits.push(esc(b.author)); bits.push(esc(locText(b)));
  if(b.loanedTo) bits.push('<span style="color:#a33b17;font-weight:600;">Loaned to '+esc(b.loanedTo)+(b.loanedDate?' on '+esc(fmtLocalDate(b.loanedDate)):'')+'</span>');
  if(b.addedAt) bits.push('Added '+new Date(b.addedAt).toLocaleDateString());
  el.sub.innerHTML = bits.join('<br>');
  el.about.textContent = b.about || '';
  const facts=[];
  const cs=collsOf(b);
  if(cs.length) facts.push('<div style="grid-column:1/-1"><dt>Collections</dt><dd>'+cs.map(c=>'<span class="coll-chip view">'+esc(c)+'</span>').join(' ')+'</dd></div>');
  const f=(k,v,w)=>{ if(v) facts.push('<div'+(w?' style="grid-column:1/-1"':'')+'><dt>'+k+'</dt><dd>'+v+'</dd></div>'); };
  f('Genre', esc(b.genre||'')); f('Series', b.series?esc(b.series)+(b.seriesNo?' #'+esc(b.seriesNo):''):'');
  f('First published', esc(b.year||'')); f('Status', b.status==='read'?'Read':b.status==='reading'?'Reading':'');
  f('Rating', +b.rating?'<span style="color:var(--gold)">'+'★'.repeat(+b.rating)+'</span>':'');
  f('Loaned to', b.loanedTo?esc(b.loanedTo)+(b.loanedDate?' ('+esc(fmtLocalDate(b.loanedDate))+')':''):'');
  f('Publisher', esc(b.publisher||'')); f('Pages', esc(b.pages||''));
  f('Keywords', esc(b.subjects||''), 1); f('Notes', esc(b.notes||''), 1);
  el.view.innerHTML = facts.length ? '<dl>'+facts.join('')+'</dl>' : '';
  el.cover.innerHTML = coverHTML(b, 'M');
}
function formData(){
  const o={};
  FIELDS.forEach(f=>{ o[f] = $('e-'+f).value.trim(); });
  o.rating = editRating;
  o.needsReview = $('e-review').checked;
  if(pendingCover) o.coverUrl = pendingCover;
  if(o.loanedTo && !o.loanedDate) o.loanedDate = todayLocal();
  if(!o.loanedTo) o.loanedDate = '';
  if($('e-coll-in').value.trim()) addEditColl($('e-coll-in').value);   // a collection typed but not yet added still counts
  o.collections = editColls.slice();
  return o;
}
function isDirty(){
  if(isNew) return FIELDS.some(f=>$('e-'+f).value.trim() && f!=='status') || editColls.length>0;
  const b = byId(editId); if(!b) return false;
  const d = formData();
  return FIELDS.some(f=>String(b[f]==null?'':b[f]) !== String(d[f]) && !(f==='loanedDate' && !b.loanedDate))
    || (+b.rating||0)!==d.rating || !!b.needsReview!==d.needsReview || (d.coverUrl||'')!==(b.coverUrl||'')
    || collsOf(b).join('|')!==d.collections.join('|');
}
function openBook(id, list){
  isNew=false; editId=id; navList=list||[id];
  const b=byId(id); if(!b) return;
  fillForm(b);
  updateArrows();
  $('modal-bg').classList.add('open'); lockPage();
  $('modal').scrollTop=0;
  if(!flipping) preparePeeks();
}
function openNew(prefill){
  isNew=true; editId=null; navList=[];
  fillForm(Object.assign({status:'unread'}, prefill||{}));
  updateArrows();
  $('modal-bg').classList.add('open'); lockPage();
  $('modal').scrollTop=0;
  setTimeout(()=>$('e-title').focus(), 50);
}
function updateArrows(){
  const i = navList.indexOf(editId);
  $('m-prev').style.visibility = (!isNew && i>0) ? 'visible':'hidden';
  $('m-next').style.visibility = (!isNew && i>=0 && i<navList.length-1) ? 'visible':'hidden';
}
let lockY=0;
function lockPage(){ if(document.body.classList.contains('locked')) return; lockY=window.scrollY; document.body.style.top=(-lockY)+'px'; document.body.classList.add('locked'); }
function unlockPage(){ if(!document.body.classList.contains('locked')) return; document.body.classList.remove('locked'); document.body.style.top=''; window.scrollTo(0,lockY); }
function closeModal(){ dropPeek && dropPeek(); $('modal').style.transform=''; $('modal').style.opacity=''; $('modal-bg').classList.remove('open'); editId=null; isNew=false; unlockPage(); }
function saveBook(silent){
  const d = formData();
  if(!d.title){ toast('A title is needed'); $('e-title').focus(); return false; }
  const now = Date.now();
  if(isNew){
    const b = Object.assign({ id:uid(), addedAt:now, updatedAt:now, source:'manual' }, d);
    store.books.push(b); editId=b.id; isNew=false;
  } else {
    store.books = store.books.map(b=>b.id===editId ? Object.assign({}, b, d, {updatedAt:now}) : b);
  }
  commit();
  if(!silent) toast('Saved');
  return true;
}
// ---- flipping between books: a page turn. The book on screen is a page hinged at its left edge.
// Swipe left and it lifts, curls over and lands face-down on the left, revealing the next book
// beneath; swipe right and the previous page swings back over. Neighbours are built ahead of time. ----
let peeks={}, flipping=false, peekTimer=0, turn=null;
function neighbor(dir){ const i=navList.indexOf(editId); return (!isNew && i>=0) ? navList[i+dir] : undefined; }
function buildPeek(dir){
  const id=neighbor(dir), b=id && byId(id); if(!b) return null;
  const m=$('modal'), c=m.cloneNode(true);
  viewFill({cover:c.querySelector('#m-cover'), title:c.querySelector('#m-title'), sub:c.querySelector('#m-sub'), about:c.querySelector('#m-about'), view:c.querySelector('#m-view')}, b);
  c.querySelectorAll('[id]').forEach(x=>x.removeAttribute('id')); c.removeAttribute('id');
  c.querySelectorAll('img').forEach(img=>{ img.loading='eager'; img.decoding='async'; });
  c.classList.add('viewing','peek');
  c.style.cssText='position:fixed;margin:0;transition:none;visibility:hidden;';
  $('modal-bg').appendChild(c);
  return {el:c, dir, id};
}
function dropPeek(){ clearTimeout(peekTimer); endTurn(); for(const k in peeks){ peeks[k] && peeks[k].el.remove(); } peeks={}; }
function preparePeeks(){
  dropPeek();
  if(isNew || !$('modal').classList.contains('viewing')) return;
  peekTimer=setTimeout(()=>{ if(flipping) return; peeks[1]=buildPeek(1); peeks[-1]=buildPeek(-1); }, 60);
}
function ensurePeeks(){ if(!(1 in peeks)){ clearTimeout(peekTimer); peeks[1]=buildPeek(1); peeks[-1]=buildPeek(-1); } }
function boxOf(el, r){ Object.assign(el.style,{position:'fixed', left:r.left+'px', top:r.top+'px', width:r.width+'px', height:r.height+'px', margin:'0'}); }
function layer(cls, r, z){ const d=document.createElement('div'); d.className='pt-layer '+cls; boxOf(d,r); d.style.zIndex=z; $('modal-bg').appendChild(d); return d; }
function startTurn(dir){
  endTurn();
  const m=$('modal'), p=peeks[dir]; if(!p) return null;
  const r=m.getBoundingClientRect();
  for(const k in peeks){ const q=peeks[k]; if(q){ boxOf(q.el, r); q.el.style.visibility = q===p ? 'visible' : 'hidden'; q.el.style.transform=''; q.el.style.zIndex=''; } }
  m.style.position='relative';
  const t={dir, p:0, w:r.width, peek:p, under: dir>0 ? p.el : m, leafEl: dir>0 ? m : p.el};
  if(dir>0){ m.style.zIndex='3'; p.el.style.zIndex='1'; }       // next book waits underneath
  else     { m.style.zIndex='1'; p.el.style.zIndex='3'; }       // previous page comes back over the top
  t.leafEl.style.transformOrigin='left center'; t.leafEl.style.backfaceVisibility='hidden';
  t.underShade=layer('pt-under', r, 2);
  t.gloss=layer('pt-gloss', r, 4);  t.gloss.style.transformOrigin='left center';
  t.back=layer('pt-back', r, 5);    t.back.style.transformOrigin='left center';
  turn=t; renderTurn(0); return t;
}
function endTurn(){
  if(!turn) return;
  const m=$('modal');
  [turn.underShade, turn.gloss, turn.back].forEach(e=>e&&e.remove());
  Object.assign(m.style,{position:'', zIndex:'', transform:'', transformOrigin:'', backfaceVisibility:'', transition:''});
  if(turn.peek && turn.peek.el.isConnected) Object.assign(turn.peek.el.style,{transform:'', zIndex:'', transformOrigin:'', visibility:'hidden'});
  turn=null;
}
function renderTurn(p){
  const t=turn; if(!t) return; t.p=p;
  // the free edge follows the finger: its position is cos(angle), so angle = acos(1-2p)
  const lift = Math.acos(1-2*p)*180/Math.PI;                    // 0 → 180 as the page goes over
  const a = t.dir>0 ? -lift : -180+lift;                        // current rotation of the moving leaf
  const s = Math.sin(-a*Math.PI/180);                           // 0 flat, 1 standing straight up
  const T = 'perspective('+Math.round(t.w*2.6)+'px) rotateY('+a.toFixed(2)+'deg)';
  const showFront = a > -90;
  t.leafEl.style.transform=T; t.leafEl.style.visibility = showFront ? 'visible' : 'hidden';
  t.gloss.style.transform=T;  t.gloss.style.opacity = showFront ? (s*0.9).toFixed(3) : '0';
  t.back.style.transform=T; t.back.style.visibility = showFront ? 'hidden' : 'visible';
  t.back.style.setProperty('--sh', (0.15+0.55*s).toFixed(3));
  const covered = t.dir>0 ? 1-p : p;                            // how much of the lower page is still under the leaf
  t.underShade.style.opacity = (0.55*covered*(0.35+0.65*s)).toFixed(3);
  t.underShade.style.setProperty('--edge', Math.max(0,Math.min(100, (Math.cos(-a*Math.PI/180)*100))).toFixed(1)+'%');
}
function tweenTurn(to, ms, done){
  const t=turn; if(!t){ done&&done(); return; }
  const from=t.p, t0=performance.now(), ease=x=>1-Math.pow(1-x,3);
  const f=now=>{ if(turn!==t) return; const k=Math.min(1,(now-t0)/ms); renderTurn(from+(to-from)*ease(k));
    if(k<1) requestAnimationFrame(f); else done&&done(); };
  requestAnimationFrame(f);
}
function completeTurn(ms){
  const t=turn; if(!t) return; flipping=true;
  tweenTurn(1, ms, ()=>{
    const p=t.peek, m=$('modal');
    // the new book now lies flat exactly where the panel is: load it behind, then lift the copy away
    Object.assign(p.el.style,{transform:'', zIndex:'6', visibility:'visible'});
    [t.underShade, t.gloss, t.back].forEach(e=>e.remove()); turn=null;
    Object.assign(m.style,{position:'', zIndex:'', transform:'', transformOrigin:'', backfaceVisibility:'', visibility:''});
    openBook(p.id, navList); m.scrollTop=0;
    const img=m.querySelector('#m-cover img');
    const ready = img && img.decode ? img.decode().catch(()=>{}) : Promise.resolve();
    Promise.race([ready, new Promise(r=>setTimeout(r,250))]).then(()=>requestAnimationFrame(()=>{
      for(const k in peeks) if(peeks[k]) peeks[k].el.remove(); peeks={};
      flipping=false; preparePeeks();
    }));
  });
}
function cancelTurn(ms){ tweenTurn(0, ms, ()=>endTurn()); }
function nudge(dx){ const m=$('modal'); m.style.transition='none'; m.style.transform = dx ? 'translate3d('+dx+'px,0,0)' : ''; }
function step(dir){
  if(flipping) return;
  const id=neighbor(dir); if(id===undefined) return;
  const m=$('modal');
  if(!m.classList.contains('viewing')){
    if(isDirty()){ if(confirm('Save your changes to this book first?')){ if(!saveBook(true)) return; } }
    openBook(id, navList); return;
  }
  ensurePeeks(); if(!startTurn(dir)){ openBook(id, navList); return; }
  requestAnimationFrame(()=>completeTurn(560));
}
$('m-prev').onclick=()=>step(-1); $('m-next').onclick=()=>step(1);
(function(){
  let x0=null, y0=null, drag=false, lastX=0, lastT=0, vel=0, raf=0, curDx=0;
  const m=$('modal');
  const paint=()=>{ raf=0;
    const dir=curDx<0?1:-1;
    if(!peeks[dir]){ if(turn) endTurn(); nudge(curDx/(1+Math.abs(curDx)/60)); return; }   // at the ends: a little give
    nudge(0);
    if(!turn || turn.dir!==dir) startTurn(dir);
    renderTurn(Math.min(1, Math.abs(curDx)/(turn.w*0.9)));
  };
  m.addEventListener('touchstart', e=>{
    const tg=(e.target.tagName||'').toLowerCase();
    if(flipping || !m.classList.contains('viewing') || tg==='input'||tg==='textarea'||tg==='select'||e.touches.length>1){ x0=null; return; }
    x0=lastX=e.touches[0].clientX; y0=e.touches[0].clientY; lastT=performance.now(); vel=0; drag=false; curDx=0;
  }, {passive:true});
  m.addEventListener('touchmove', e=>{
    if(x0===null) return;
    const x=e.touches[0].clientX, dx=x-x0, dy=e.touches[0].clientY-y0;
    if(!drag){
      if(Math.abs(dx)>6 && Math.abs(dx)>Math.abs(dy)*1.1){ drag=true; ensurePeeks(); x0=x-(dx>0?1:-1); }
      else if(Math.abs(dy)>10){ x0=null; return; } else return;
    }
    e.preventDefault();
    const now=performance.now(), dt=Math.max(1,now-lastT);
    vel = 0.7*vel + 0.3*((x-lastX)/dt); lastX=x; lastT=now;
    curDx=x-x0; if(!raf) raf=requestAnimationFrame(paint);
  }, {passive:false});
  const end=()=>{
    if(x0===null) return;
    x0=null; if(!drag) return; drag=false;
    if(raf){ cancelAnimationFrame(raf); raf=0; paint(); }
    if(!turn){ m.style.transition='transform 280ms cubic-bezier(.22,.75,.3,1)'; m.style.transform=''; return; }
    if(performance.now()-lastT>80) vel=0;
    const want = turn.dir>0 ? -1 : 1, fling = Math.abs(vel)>0.35 && Math.sign(vel)===want;
    const back = Math.abs(vel)>0.35 && Math.sign(vel)===-want;
    if(!back && (turn.p>0.3 || fling)){
      const remaining=(1-turn.p)*turn.w*0.9, speed=Math.max(Math.abs(vel), 1.1);
      completeTurn(Math.round(Math.min(520, Math.max(220, remaining/speed*1.6))));
    } else cancelTurn(Math.round(260+turn.p*200));
  };
  m.addEventListener('touchend', end); m.addEventListener('touchcancel', end);
})();
$('m-close').onclick=()=>{ if(isDirty() && !confirm('Discard unsaved changes?')) return; closeModal(); };
$('btn-cancel').onclick=$('m-close').onclick;
$('modal-bg').addEventListener('click', e=>{ if(e.target===$('modal-bg')) $('m-close').onclick(); });
$('btn-save').onclick=()=>{ if(saveBook()) closeModal(); };
$('btn-edit').onclick=()=>{ dropPeek(); $('modal').classList.remove('viewing'); $('modal').scrollTop=0; };
$('btn-view-close').onclick=()=>closeModal();
$('btn-delete').onclick=()=>{
  const b=byId(editId); if(!b) return;
  if(!confirm('Delete "'+(b.title||'this book')+'"?')) return;
  store.books = store.books.map(x=>x.id===editId?{id:x.id, deleted:true, updatedAt:Date.now()}:x);
  commit(); closeModal(); toast('Deleted');
};
$('btn-returned').onclick=()=>{ $('e-loanedTo').value=''; $('e-loanedDate').value=''; $('btn-returned').classList.add('hide'); };
$('e-loanedTo').addEventListener('input', ()=>{ if($('e-loanedTo').value.trim() && !$('e-loanedDate').value) $('e-loanedDate').value=todayLocal(); });
$('btn-add').onclick=()=>openNew({ room:$('f-room').value, bookcase:$('f-case').value, shelf:$('f-shelf').value });
document.addEventListener('keydown', e=>{
  if(!$('modal-bg').classList.contains('open')) return;
  if(e.key==='Escape') $('m-close').onclick();
  const tag=(e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select') return;
  if(e.key==='ArrowLeft') step(-1);
  if(e.key==='ArrowRight') step(1);
});
