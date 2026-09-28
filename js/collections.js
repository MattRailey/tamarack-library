/* Railey Library — collections.js
   Collections — hand-picked groups of books.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Collections — hand-picked groups ("Read-alouds", "Christmas"…).
   Stored per book as b.collections = ['Read-alouds', …] so they
   merge across devices like every other field.
   ============================================================ */
function collsOf(b){ return Array.isArray(b.collections) ? b.collections.filter(Boolean) : []; }
function allColls(){ const m=new Map(); for(const b of live()) for(const c of collsOf(b)) m.set(c,(m.get(c)||0)+1); return [...m.entries()].sort((a,b)=>natCmp(a[0],b[0])); }
function renderCollBar(){
  const cs=allColls(), bar=$('coll-bar');
  if(ui.coll && !cs.some(c=>c[0]===ui.coll)) ui.coll='';
  if(!cs.length){ bar.classList.add('hide'); bar.innerHTML=''; return; }
  bar.classList.remove('hide');
  bar.innerHTML='<span class="coll-lbl">Collections</span>'+cs.map(([c,n])=>'<button type="button" class="coll-pill'+(ui.coll===c?' on':'')+'" data-coll="'+esc(c)+'">'+esc(c)+' <span>'+n+'</span></button>').join('')
    +(ui.coll?'<button type="button" class="coll-pill ghost" data-act="rename">Rename</button><button type="button" class="coll-pill ghost" data-act="remove">Remove collection</button>':'');
}
$('coll-bar').addEventListener('click', e=>{
  const p=e.target.closest('button'); if(!p) return;
  if(p.dataset.coll!==undefined){ ui.coll = ui.coll===p.dataset.coll ? '' : p.dataset.coll; lsSet(UI_KEY, JSON.stringify(ui)); renderLibrary(true); return; }
  const cur=ui.coll; if(!cur) return;
  const now=Date.now();
  if(p.dataset.act==='rename'){
    const nn=(prompt('Rename “'+cur+'” to:', cur)||'').trim(); if(!nn || nn===cur) return;
    store.books.forEach(b=>{ if(!b.deleted && collsOf(b).includes(cur)){ b.collections=[...new Set(collsOf(b).map(c=>c===cur?nn:c))]; b.updatedAt=now; } });
    ui.coll=nn; commit(); toast('Renamed');
  }
  if(p.dataset.act==='remove'){
    if(!confirm('Remove the “'+cur+'” collection? The books stay in the library — they just leave this collection.')) return;
    store.books.forEach(b=>{ if(!b.deleted && collsOf(b).includes(cur)){ b.collections=collsOf(b).filter(c=>c!==cur); b.updatedAt=now; } });
    ui.coll=''; commit(); toast('Collection removed');
  }
  lsSet(UI_KEY, JSON.stringify(ui));
});
// chip editor in the book form
let editColls=[];
function drawCollEditor(){
  $('e-colls').innerHTML = editColls.map((c,i)=>'<span class="coll-chip">'+esc(c)+'<button type="button" data-i="'+i+'" aria-label="Remove">&times;</button></span>').join('');
}
function addEditColl(v){ v=String(v||'').replace(/,$/,'').trim(); if(v && !editColls.includes(v)){ editColls.push(v); drawCollEditor(); } $('e-coll-in').value=''; }
$('e-colls').addEventListener('click', e=>{ const i=e.target.dataset.i; if(i===undefined) return; editColls.splice(+i,1); drawCollEditor(); });
$('e-coll-in').addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); addEditColl($('e-coll-in').value); } });
$('e-coll-in').addEventListener('change', ()=>addEditColl($('e-coll-in').value));
$('e-coll-add').onclick = ()=>addEditColl($('e-coll-in').value);
