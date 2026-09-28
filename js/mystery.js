/* Railey Library — mystery.js
   Mystery (unidentified) books: the list, and the shelf-by-shelf walk-through.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

function isUnid(b){ return String(b.title||'').startsWith('(') || (b.needsReview && /^Partly identified/.test(b.notes||'')); }
function shelfLabel(b){ return /^\d/.test(String(b.shelf||'')) ? 'Shelf '+b.shelf : (b.shelf||''); }
function unidRows(){
  const room=$('un-room').value, withRev=$('un-review').checked;
  return live().filter(b=>(isUnid(b) || (withRev && b.needsReview)) && (!room || b.room===room))
    .sort((x,y)=>natCmp(x.room,y.room)||natCmp(x.bookcase,y.bookcase)||natCmp(x.shelf,y.shelf)||posCmp(x,y));
}
function renderUnid(){
  const cur=$('un-room').value; fillSelect($('un-room'), uniq(live().filter(isUnid).map(b=>b.room)), 'All rooms'); if(cur) $('un-room').value=cur;
  const L=unidRows(), all=live().filter(isUnid).length;
  const photos=live().filter(b=>isUnid(b)&&b.idPhoto).length;   // title-page photos waiting for Claude
  $('un-summary').textContent = all+' unidentified'+(L.length!==all?' · showing '+L.length:'')+(photos?' · '+photos+' photo'+(photos===1?'':'s')+' waiting for Claude':'');
  let html='', lastRoom=null, lastCase=null;
  for(const b of L){
    if(b.room!==lastRoom){ if(lastRoom!==null) html+='</div></div>'; html+='<div class="card un-room"><h3>'+esc(b.room||'(no room)')+'</h3><div>'; lastRoom=b.room; lastCase=null; }
    if(b.bookcase!==lastCase){ html+='<div class="case-h">'+esc(b.bookcase||'')+' <button type="button" class="secondary walk-here" data-walk="'+b.id+'">Walk it</button></div>'; lastCase=b.bookcase; }
    html+='<div class="sp un-row" data-id="'+b.id+'"><span class="n">'+(b.idPhoto?'📷 ':'')+esc(shelfLabel(b)+' · '+(b.position?sideText(b):'–'))+'</span><span>'+esc(b.title)+(b.author?' — <i>'+esc(b.author)+'</i>':'')+(b.notes?'<span class="note" style="display:block;margin:2px 0 0;">'+esc(b.notes)+'</span>':'')+'</span></div>';
  }
  if(lastRoom!==null) html+='</div></div>';
  $('un-list').innerHTML = html || '<div class="card empty">Nothing unidentified — nice work.</div>';
}
$('un-list').addEventListener('click', e=>{ const w=e.target.closest('[data-walk]'); if(w){ openWalk(w.dataset.walk); return; } const r=e.target.closest('.un-row'); if(!r) return; const ids=[...document.querySelectorAll('#un-list .un-row')].map(x=>x.dataset.id); openBook(r.dataset.id, ids); $('modal').classList.remove('viewing'); });
$('un-room').addEventListener('change', renderUnid); $('un-review').addEventListener('change', renderUnid);
$('un-print').onclick=()=>{
  const L=unidRows(); const w=window.open('','_blank'); if(!w){ toast('Allow pop-ups to print'); return; }
  let rows='', last='';
  for(const b of L){ const loc=(b.room||'')+' — '+(b.bookcase||''); if(loc!==last){ rows+='<tr><th colspan="3">'+esc(loc)+'</th></tr>'; last=loc; }
    rows+='<tr><td>'+esc(shelfLabel(b))+'</td><td>'+esc(b.position?sideText(b):'')+'</td><td>'+esc(b.title)+(b.author?' — '+esc(b.author):'')+'</td></tr>'; }
  w.document.write('<!doctype html><meta charset="utf-8"><title>Unidentified books</title><style>body{font:13px Georgia,serif;margin:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f3ece0;font-size:14px;padding-top:12px}td:nth-child(1){width:90px}td:nth-child(2){width:40px}<\/style><h1>Unidentified books ('+L.length+')</h1><table>'+rows+'</table><script>print()<\/script>');
  w.document.close();
};

/* ============================================================
   Walk-through for unidentified books: one book at a time, with
   where to find it and what's on either side. Scan it, type it,
   or snap the title page — the photo goes to Dropbox for Claude.
   ============================================================ */
let walkIds=[], walkI=0, walkSkipped=new Set(), walkPhoto=null;
function shelfMates(b){ return live().filter(x=>x.room===b.room && x.bookcase===b.bookcase && String(x.shelf)===String(b.shelf)).sort(posCmp); }
const skeyOf=x=>x?[x.room||'',x.bookcase||'',x.shelf||''].join('|'):'';
let walkScope=null;           // null = whole house; otherwise one shelf key
function walkShelves(){       // every shelf with mystery books, in walking order
  const out=[], seen=new Map();
  for(const b of unidRows().filter(isUnid)){ const k=skeyOf(b); if(!seen.has(k)){ seen.set(k,{key:k, b, n:0}); out.push(seen.get(k)); } seen.get(k).n++; }
  return out;
}
function openWalk(startId){
  $('walk-bg').classList.add('open'); lockPage();
  if(!unidRows().some(isUnid)){ walkIds=[]; walkI=0; walkScope=null; openAddMissed(true); return; }
  if(typeof startId==='string'){ const b=byId(startId); startWalk(b?skeyOf(b):null); return; }
  drawPicker();
}
function startWalk(scope){
  walkScope=scope;
  // walking order: room → bookcase → shelf → spot, so a shelf is finished before moving on
  walkIds=unidRows().filter(b=>isUnid(b) && (!scope || skeyOf(b)===scope)).map(b=>b.id); walkI=0; walkSkipped=new Set();
  drawWalk();
}
function drawPicker(){
  const S=walkShelves(); $('wk-count').textContent='';
  let html='<p class="note" style="margin-top:6px;">Pick the shelf you’re standing at — or go through the whole house, one shelf at a time.</p>'
    +'<button id="wk-all" style="width:100%;margin-bottom:10px;">Whole house, in order ('+S.reduce((s,x)=>s+x.n,0)+' books)</button>'
    +'<button class="secondary wk-addbtn" id="wk-add" style="margin:0 0 10px;">＋ Add a book we missed (any shelf)</button>';
  let lastRoom=null, lastCase=null;
  for(const s of S){
    if(s.b.room!==lastRoom){ html+='<div class="wk-pr">'+esc(s.b.room||'(no room)')+'</div>'; lastRoom=s.b.room; lastCase=null; }
    if(s.b.bookcase!==lastCase){ html+='<div class="wk-pc">'+esc(s.b.bookcase||'')+'</div>'; lastCase=s.b.bookcase; }
    html+='<button type="button" class="wk-ps" data-scope="'+esc(s.key)+'"><span>'+esc(shelfLabel(s.b)||'(no shelf)')+'</span><span class="n">'+s.n+'</span></button>';
  }
  $('wk-body').innerHTML=html;
  $('wk-all').onclick=()=>startWalk(null);
  $('wk-add').onclick=()=>openAddMissed(true);
  $('wk-body').querySelectorAll('[data-scope]').forEach(x=>x.onclick=()=>startWalk(x.dataset.scope));
}
function closeWalk(){ $('walk-bg').classList.remove('open'); unlockPage(); if($('import').classList.contains('active')) renderUnid(); }
function walkCur(){ return byId(walkIds[walkI]); }
function drawWalk(){
  // step past anything that's been identified meanwhile (e.g. on another device)
  while(walkI<walkIds.length){ const b=byId(walkIds[walkI]); if(b && !b.deleted && isUnid(b) && !walkSkipped.has(b.id)) break; walkI++; }
  const left = walkIds.filter(id=>{ const b=byId(id); return b && !b.deleted && isUnid(b); }).length;
  if(walkI>=walkIds.length && walkScope){
    const S=walkShelves(), i=S.findIndex(s=>s.key===walkScope), nxt=S[i+1] || S.find(s=>s.key!==walkScope);
    $('wk-count').textContent='';
    $('wk-body').innerHTML='<div class="wk-done"><h3>Shelf done</h3><p class="note">'+(left?left+' left on this shelf (skipped or waiting on a photo).':'Every mystery book on this shelf is taken care of.')+'</p>'
      +(nxt?'<button id="wk-nxt" style="margin:4px;">Next shelf: '+esc([nxt.b.bookcase, shelfLabel(nxt.b)].filter(Boolean).join(' · '))+'</button>':'')
      +'<button class="secondary" id="wk-pick" style="margin:4px;">Pick another shelf</button>'
      +(left?'<button class="secondary" id="wk-again" style="margin:4px;">Redo the skipped ones here</button>':'')
      +'<button class="secondary wk-addbtn" id="wk-add">＋ Found a book we missed on this shelf</button></div>';
    if($('wk-nxt')) $('wk-nxt').onclick=()=>startWalk(nxt.key);
    $('wk-pick').onclick=drawPicker;
    if($('wk-again')) $('wk-again').onclick=()=>startWalk(walkScope);
    $('wk-add').onclick=()=>openAddMissed();
    return;
  }
  if(walkI>=walkIds.length){
    $('wk-body').innerHTML='<div class="wk-done"><h3>That’s the end of the list</h3><p class="note">'+(left?left+' still unidentified (skipped or waiting on a photo).':'Everything here is identified — nice work.')+'</p>'
      +(left?'<button class="secondary" id="wk-restart">Go through the skipped ones</button>':'')
      +'<button class="secondary wk-addbtn" id="wk-add">＋ Found a book we missed</button></div>';
    $('wk-count').textContent='';
    $('wk-add').onclick=()=>openAddMissed();
    if($('wk-restart')) $('wk-restart').onclick=()=>{ walkIds=unidRows().filter(isUnid).map(b=>b.id); walkI=0; walkSkipped=new Set(); drawWalk(); };
    return;
  }
  const b=walkCur(), mates=shelfMates(b), k=mates.findIndex(x=>x.id===b.id);
  const L=mates[k-1], R=mates[k+1];
  const nb=x=>x?'<b>'+esc(x.title)+'</b>'+(x.author&&!String(x.title).startsWith('(')?' <span class="note" style="margin:0">'+esc(x.author)+'</span>':''):'<i>the end of the shelf</i>';
  const skey=x=>x?[x.room,x.bookcase,x.shelf].join('|'):'';
  const onShelf=walkIds.map(byId).filter(x=>x && !x.deleted && skey(x)===skey(b));
  const nOn=onShelf.findIndex(x=>x.id===b.id)+1, prev=walkI>0?byId(walkIds[walkI-1]):null;
  const moved = walkI>0 && prev && skey(prev)!==skey(b);
  $('wk-count').textContent=(walkI+1)+' of '+walkIds.length;
  walkPhoto=null;
  $('wk-body').innerHTML=
    (moved?'<div class="wk-next">That shelf’s done — on to '+(prev.room!==b.room?'<b>'+esc(b.room||'')+'</b>, ':'')+(prev.bookcase!==b.bookcase||prev.room!==b.room?'<b>'+esc(b.bookcase||'')+'</b>, ':'')+'<b>'+esc(shelfLabel(b))+'</b></div>':'')
    +'<div class="wk-where"><div class="wk-room">'+esc(b.room||'')+'</div><div class="wk-case">'+esc(b.bookcase||'')+'</div>'
    +'<div class="wk-spot">'+esc(shelfLabel(b))+(b.position?' · '+esc(sideText(b)):'')+'</div><div class="wk-shelfn">'+nOn+' of '+onShelf.length+' mystery book'+(onShelf.length===1?'':'s')+' on this shelf</div></div>'
    +'<div class="wk-nb"><div><span>Left of it</span>'+nb(L)+'</div><div><span>Right of it</span>'+nb(R)+'</div></div>'
    +'<div class="wk-what"><span>We have it down as</span><b>'+esc(b.title)+'</b>'+(b.author?' — '+esc(b.author):'')+(b.notes?'<div class="note" style="margin:4px 0 0">'+esc(b.notes)+'</div>':'')
    +(b.idPhoto?'<div class="wk-sent">📷 Title-page photo already sent to Claude</div>':'')+'</div>'
    +'<div class="wk-acts">'
    +'<button id="wk-scan">Scan barcode</button>'
    +'<button id="wk-photo">Photo of title page</button>'
    +'<button class="secondary" id="wk-type">Type title</button>'
    +'</div>'
    +'<div id="wk-form" class="hide"><div class="grid"><div style="grid-column:1/-1"><label>Title</label><input id="wk-title"></div><div style="grid-column:1/-1"><label>Author</label><input id="wk-author" list="dl-author"></div></div>'
    +'<div class="row" style="margin-top:10px;"><button id="wk-save">Save &amp; next</button><button class="secondary" id="wk-look">Look up cover &amp; details</button></div><div class="lookup-res" id="wk-look-res"></div></div>'
    +'<button class="secondary wk-addbtn" id="wk-add">＋ Found a book we missed on this shelf</button>'
    +'<div class="row wk-foot"><button class="secondary" id="wk-back"'+(walkI?'':' disabled')+'>&larr; Back</button><button class="secondary" id="wk-skip">Skip</button><button class="secondary" id="wk-change">Change shelf</button><span style="flex:1"></span><button class="danger" id="wk-gone">Not here / not a book</button></div>';
  $('wk-scan').onclick=()=>openScanner({kind:'fill', onFound:info=>{
    if(!info.title){ showWalkForm(); $('wk-title').focus(); walkPending={isbn:info.isbn}; toast('Not found online — type the title'); return; }
    identify(b, info); }});
  $('wk-type').onclick=()=>{ showWalkForm(); $('wk-title').focus(); };
  $('wk-photo').onclick=()=>$('wk-file').click();
  $('wk-skip').onclick=()=>{ walkSkipped.add(b.id); walkI++; drawWalk(); };
  $('wk-change').onclick=drawPicker;
  $('wk-add').onclick=()=>openAddMissed();
  $('wk-back').onclick=()=>{ if(walkI>0){ walkI--; walkSkipped.delete(walkIds[walkI]); drawWalk(); } };
  $('wk-gone').onclick=()=>{
    if(!confirm('Remove this entry from the library? (Use this if there’s no book there, or it isn’t a book.)')) return;
    const now=Date.now(); store.books=store.books.map(x=>x.id===b.id?{id:x.id, deleted:true, updatedAt:now}:x); commit(); walkI++; drawWalk(); };
  $('wk-save').onclick=()=>{ const t=$('wk-title').value.trim(); if(!t){ toast('Type the title first'); return; } identify(b, Object.assign({ title:t, author:$('wk-author').value.trim() }, walkPending||{})); };
  $('wk-look').onclick=async()=>{
    const box=$('wk-look-res'); const t=$('wk-title').value.trim(); if(!t){ toast('Type the title first'); return; }
    box.innerHTML='<div class="note">Searching…</div>';
    const docs=await bookSearch(cleanTitle(t), searchAuthor($('wk-author').value.trim()), '');
    if(!docs.length){ box.innerHTML='<div class="note">No matches — just tap Save &amp; next.</div>'; return; }
    box.innerHTML=docs.slice(0,6).map((d,i)=>'<div class="lk">'+(d.cover?'<img src="'+esc(d.cover)+'" alt="">':'<img alt="">')+'<div class="x"><b>'+esc(d.title)+'</b><br>'+esc(d.authors.join(', '))+(d.year?' · '+esc(d.year):'')+'</div><button type="button" data-i="'+i+'">Use</button></div>').join('');
    box.onclick=e=>{ const i=e.target.dataset.i; if(i===undefined) return; const d=docs[+i], f=docFill(d);
      identify(b, Object.assign({ title:$('wk-title').value.trim()||d.title, author:$('wk-author').value.trim()||d.authors.join(', ') }, f, d.about?{about:d.about}:{})); };
  };
  walkPending=null;
}
let walkPending=null;
function showWalkForm(){ $('wk-form').classList.remove('hide'); }
function identify(b, info){
  const now=Date.now();
  const ch={ title:info.title, needsReview:false, updatedAt:now, lookupV:0 };
  if(info.author) ch.author=info.author;
  ['isbn','year','publisher','pages','subjects','about'].forEach(k=>{ if(info[k] && !b[k]) ch[k]=info[k]; });
  if(info.coverUrl) ch.coverUrl=info.coverUrl;
  const was=b.title;
  store.books=store.books.map(x=>x.id===b.id?Object.assign({}, x, ch):x);
  commit(); toast('Saved — '+info.title); walkI++; drawWalk();
}
// title-page photo → Dropbox <library folder>/photos/identify/ for Claude to read later
$('wk-file').onchange=async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const b=walkCur(); if(!b) return;
  const t=await dbxToken(); if(!t){ toast('Connect Dropbox first (Epilogue → Data & Sync) so the photo can reach Claude'); return; }
  toast('Sending photo…');
  try{
    const blob=await shrinkPhoto(f, 1600);
    const slug=s=>String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
    const path=dbxFolder()+'/photos/identify/'+[slug(b.room),slug(b.bookcase),'shelf-'+slug(b.shelf),'pos-'+slug(b.position),b.id].join(' ')+'.jpg';
    const r=await fetch('https://content.dropboxapi.com/2/files/upload',{ method:'POST', headers:{ 'Authorization':'Bearer '+t.access_token, 'Content-Type':'application/octet-stream',
      'Dropbox-API-Arg':dbxArg({ path, mode:'add', autorename:true, mute:true }).replace(/[\u007f-￿]/g,c=>'\\u'+('000'+c.charCodeAt(0).toString(16)).slice(-4)) }, body:blob });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const now=Date.now();
    store.books=store.books.map(x=>x.id===b.id?Object.assign({}, x, { idPhoto:path, idPhotoAt:now, updatedAt:now }):x);
    commit(); toast('Photo sent — Claude will read it next time you ask'); walkSkipped.add(b.id); walkI++; drawWalk();
  }catch(err){ toast('Couldn’t send the photo ('+err.message+') — try again'); }
};
function shrinkPhoto(file, max){
  return new Promise((res,rej)=>{ const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{ const s=Math.min(1, max/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url); c.toBlob(bl=>bl?res(bl):rej(new Error('photo failed')),'image/jpeg',0.82); };
    img.onerror=()=>rej(new Error('couldn’t read the photo')); img.src=url; });
}

/* ============================================================
   Walk-through: add a book we missed. Pick where it sits (left or
   right of the book you're looking at, or any spot on the shelf);
   the books after it on that shelf shift over one. Scan, type, or
   snap the title page (photo goes to Claude, like mystery books).
   ============================================================ */
let addCtx=null, addPending=null, addFromPicker=false;
function posNum(p){ const m=String(p||'').trim().match(/^(\d+)\s*([a-z]*)$/i); return m?{n:+m[1], suf:m[2]}:null; }
function openAddMissed(fromPicker){
  addFromPicker=!!fromPicker;
  let ref=null, l={room:'',bookcase:'',shelf:''};
  if(!fromPicker){
    if(walkI<walkIds.length) ref=walkCur();
    else if(walkScope){ const p=walkScope.split('|'); l={room:p[0],bookcase:p[1],shelf:p[2]}; const m=live().filter(x=>skeyOf(x)===walkScope).sort(posCmp); ref=m[m.length-1]||null; }
    else { const last=byId(walkIds[walkIds.length-1]); if(last) l={room:last.room||'',bookcase:last.bookcase||'',shelf:last.shelf||''}; }
  } else if(ui.walkAddLoc){ l=Object.assign(l, ui.walkAddLoc); }
  if(ref) l={room:ref.room||'',bookcase:ref.bookcase||'',shelf:String(ref.shelf||'')};
  addCtx={ l, ref, side: ref?'right':'other' };
  drawAddMissed();
}
function addLoc(){ return { room:$('wa-room').value.trim(), bookcase:$('wa-case').value.trim(), shelf:$('wa-shelf').value.trim() }; }
function refOnShelf(l){ const r=addCtx.ref; return r && !r.deleted && r.room===l.room && r.bookcase===l.bookcase && String(r.shelf)===l.shelf && posNum(r.position); }
function drawAddMissed(){
  const {l, ref, side}=addCtx;
  $('wk-count').textContent='';
  const rt=ref?'<b>'+esc(ref.title)+'</b>':'';
  $('wk-body').innerHTML=
    '<div class="wa-h">Add a book we missed</div>'
    +'<p class="note" style="margin:0 0 4px;">It goes into the catalog at the spot you pick — the books after it on the shelf move over one.</p>'
    +'<div class="wa-grid"><div><label>Room</label><input id="wa-room" list="dl-room" value="'+esc(l.room)+'"></div>'
    +'<div><label>Bookcase</label><input id="wa-case" list="dl-case" value="'+esc(l.bookcase)+'"></div>'
    +'<div><label>Shelf</label><input id="wa-shelf" list="dl-shelf" value="'+esc(l.shelf)+'"></div></div>'
    +'<label>Where on the shelf</label>'
    +'<div class="wa-side" id="wa-sides">'
      +(ref?'<button type="button" class="secondary'+(side==='left'?' on':'')+'" data-side="left">Just left of '+rt+'</button>'
           +'<button type="button" class="secondary'+(side==='right'?' on':'')+'" data-side="right">Just right of '+rt+'</button>':'')
      +'<button type="button" class="secondary'+(side==='other'?' on':'')+'" data-side="other">'+(ref?'Somewhere else':'Pick a spot')+'</button></div>'
    +'<div id="wa-posbox" class="'+(side==='other'?'':'hide')+'"><input id="wa-pos" inputmode="numeric" placeholder="Spot from the left (e.g. 7) — leave blank if not sure" style="width:100%"></div>'
    +'<div id="wa-ok"></div>'
    +'<div class="wk-acts" style="margin-top:12px;"><button id="wa-scan">Scan barcode</button><button id="wa-photo">Photo of title page</button><button class="secondary" id="wa-type">Type title</button></div>'
    +'<div id="wa-form" class="hide"><div class="grid"><div style="grid-column:1/-1"><label>Title</label><input id="wa-title"></div><div style="grid-column:1/-1"><label>Author</label><input id="wa-author" list="dl-author"></div></div>'
    +'<div class="row" style="margin-top:10px;"><button id="wa-save">Add it</button><button class="secondary" id="wa-look">Look up cover &amp; details</button></div><div class="lookup-res" id="wa-look-res"></div></div>'
    +'<div id="wa-res"></div>'
    +'<div class="row wk-foot"><button class="secondary" id="wa-back">&larr; '+(addFromPicker&&!walkIds.length?'Pick a shelf':'Back to the walk-through')+'</button></div>';
  $('wa-sides').onclick=e=>{ const t=e.target.closest('[data-side]'); if(!t) return; addCtx.side=t.dataset.side;
    $('wa-sides').querySelectorAll('[data-side]').forEach(x=>x.classList.toggle('on', x===t)); $('wa-posbox').classList.toggle('hide', addCtx.side!=='other'); };
  // typing a different shelf means "left/right of" no longer applies
  ['wa-room','wa-case','wa-shelf'].forEach(id=>$(id).addEventListener('input',()=>{ const on=!!refOnShelf(addLoc());
    $('wa-sides').querySelectorAll('[data-side="left"],[data-side="right"]').forEach(x=>x.classList.toggle('hide',!on));
    if(!on && addCtx.side!=='other'){ addCtx.side='other'; $('wa-sides').querySelectorAll('[data-side]').forEach(x=>x.classList.toggle('on', x.dataset.side==='other')); $('wa-posbox').classList.remove('hide'); } }));
  $('wa-back').onclick=()=>{ if(!walkIds.length || addFromPicker) drawPicker(); else drawWalk(); };
  $('wa-type').onclick=()=>{ $('wa-form').classList.remove('hide'); $('wa-title').focus(); };
  $('wa-photo').onclick=async()=>{ if(!checkLoc()) return; if(!(await dbxToken())){ toast('Connect Dropbox first (Epilogue → Data & Sync) so the photo can reach Claude'); return; } $('wa-file').click(); };
  $('wa-scan').onclick=()=>{ if(!checkLoc()) return; openScanner({kind:'fill', onFound:info=>{
    if(!info.title){ $('wa-form').classList.remove('hide'); addPending={isbn:info.isbn}; $('wa-title').focus(); toast('Not found online — type the title'); return; }
    checkThenAdd(info); }}); };
  $('wa-save').onclick=()=>{ const t=$('wa-title').value.trim(); if(!t){ toast('Type the title first'); return; }
    checkThenAdd(Object.assign({ title:t, author:$('wa-author').value.trim() }, addPending||{})); };
  $('wa-look').onclick=async()=>{
    const box=$('wa-look-res'); const t=$('wa-title').value.trim(); if(!t){ toast('Type the title first'); return; }
    box.innerHTML='<div class="note">Searching…</div>';
    const docs=await bookSearch(cleanTitle(t), searchAuthor($('wa-author').value.trim()), '');
    if(!docs.length){ box.innerHTML='<div class="note">No matches — just tap Add it.</div>'; return; }
    box.innerHTML=docs.slice(0,6).map((d,i)=>'<div class="lk">'+(d.cover?'<img src="'+esc(d.cover)+'" alt="">':'<img alt="">')+'<div class="x"><b>'+esc(d.title)+'</b><br>'+esc(d.authors.join(', '))+(d.year?' · '+esc(d.year):'')+'</div><button type="button" data-i="'+i+'">Use</button></div>').join('');
    box.onclick=e=>{ const i=e.target.dataset.i; if(i===undefined) return; const d=docs[+i], f=docFill(d);
      checkThenAdd(Object.assign({ title:$('wa-title').value.trim()||d.title, author:$('wa-author').value.trim()||d.authors.join(', ') }, f, d.about?{about:d.about}:{})); };
  };
  addPending=null;
}
function checkLoc(){ const l=addLoc(); if(!l.room||!l.bookcase||!l.shelf){ toast('Fill in the room, bookcase and shelf first'); return false; } return true; }
// the spot (number from the left) the new book takes, or null if unknown
function addTarget(l){
  if(addCtx.side!=='other' && refOnShelf(l)){ const p=posNum(addCtx.ref.position); return addCtx.side==='left'?p.n:p.n+1; }
  const v=parseInt(($('wa-pos')||{}).value); return v>0?v:null;
}
// make room at spot n: every book at n or later on that shelf moves one to the right (stacked 5a/5b keep their letters)
function makeRoom(l, n, now, skipId){
  store.books=store.books.map(x=>{
    if(x.deleted || x.id===skipId || x.room!==l.room || x.bookcase!==l.bookcase || String(x.shelf)!==l.shelf) return x;
    const p=posNum(x.position); if(!p || p.n<n) return x;
    return Object.assign({}, x, { position:String(p.n+1)+p.suf, updatedAt:now });
  });
}
function placeBook(fields, l, moveId){
  const n=addTarget(l), now=Date.now();
  if(n!=null) makeRoom(l, n, now, moveId);
  const spot={ room:l.room, bookcase:l.bookcase, shelf:l.shelf, position:n!=null?String(n):'' };
  let b;
  if(moveId){ store.books=store.books.map(x=>x.id===moveId?(b=Object.assign({}, x, fields, spot, { updatedAt:now })):x); }
  else { b=Object.assign({ id:uid(), addedAt:now, updatedAt:now, source:'walk', status:'unread', lookupV:0 }, fields, spot); if(!b.coverUrl) delete b.coverUrl; store.books.push(b); }
  commit();
  ui.walkAddLoc={room:l.room, bookcase:l.bookcase, shelf:l.shelf}; lsSet(UI_KEY, JSON.stringify(ui));
  // the next book found goes just right of this one, so a run of missed books lands in order
  addCtx={ l:{room:l.room, bookcase:l.bookcase, shelf:l.shelf}, ref:b, side:n!=null?'right':'other' };
  drawAddMissed();
  $('wa-ok').innerHTML='<div class="wa-ok">✓ '+(moveId?'Moved':'Added')+' <b>'+esc(b.title)+'</b>'+(b.author&&!String(b.title).startsWith('(')?' — '+esc(b.author):'')+' · '+esc(locText(b))+'. Found another? Add it the same way.</div>';
  toast((moveId?'Moved — ':'Added — ')+b.title);
  return b;
}
function checkThenAdd(info){
  if(!checkLoc()) return;
  const l=addLoc();
  const m=new Map();
  if(info.isbn) findByIsbn(info.isbn).forEach(b=>m.set(b.id,b));
  for(const b of live()){ if(m.size>=6) break; if(!String(b.title||'').startsWith('(') && titleMatch(info.title, b.title) && (!b.author || !info.author || authorMatch(b.author,[info.author]))) m.set(b.id,b); }
  const clean={}; ['title','author','isbn','year','publisher','pages','subjects','about','coverUrl'].forEach(k=>{ if(info[k]) clean[k]=info[k]; });
  if(!m.size){ placeBook(clean, l); return; }
  const box=$('wa-res');
  box.innerHTML='<div class="wa-dup"><b>This might already be in the library:</b>'
    +[...m.values()].map(b=>'<div class="sc-m"><div><b>'+esc(b.title)+'</b>'+(b.author?' <span class="note" style="margin:0">'+esc(b.author)+'</span>':'')+'<div class="note" style="margin:0">'+esc(b.room?locText(b):'No shelf yet')+'</div></div>'
      +'<button class="secondary" data-mv="'+b.id+'">'+(b.room?'It moved here':'That’s it — shelve it here')+'</button></div>').join('')
    +'<div class="row" style="margin-top:8px;"><button id="wa-new">No — add it as '+( [...m.values()].some(b=>b.room)?'another copy':'a new book')+'</button></div></div>';
  box.querySelectorAll('[data-mv]').forEach(x=>x.onclick=()=>{ const id=x.dataset.mv, keep={}; const old=byId(id);
    ['isbn','year','publisher','pages','subjects','about','coverUrl'].forEach(k=>{ if(clean[k] && !old[k]) keep[k]=clean[k]; });
    box.innerHTML=''; placeBook(keep, l, id); });
  $('wa-new').onclick=()=>{ box.innerHTML=''; placeBook(clean, l); };
}
$('wa-file').onchange=async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f || !addCtx) return;
  const t=await dbxToken(); if(!t){ toast('Connect Dropbox first (Epilogue → Data & Sync) so the photo can reach Claude'); return; }
  const l=addLoc(); toast('Sending photo…');
  try{
    const blob=await shrinkPhoto(f, 1600), id=uid();
    const slug=s=>String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
    const path=dbxFolder()+'/photos/identify/'+['found',slug(l.room),slug(l.bookcase),'shelf-'+slug(l.shelf),id].join(' ')+'.jpg';
    const r=await fetch('https://content.dropboxapi.com/2/files/upload',{ method:'POST', headers:{ 'Authorization':'Bearer '+t.access_token, 'Content-Type':'application/octet-stream',
      'Dropbox-API-Arg':dbxArg({ path, mode:'add', autorename:true, mute:true }).replace(/[\u007f-￿]/g,c=>'\\u'+('000'+c.charCodeAt(0).toString(16)).slice(-4)) }, body:blob });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const now=Date.now();
    placeBook({ id, title:'(Found on walk-through — title-page photo sent)', needsReview:true, idPhoto:path, idPhotoAt:now, notes:'Added during a walk-through; title-page photo is in photos/identify for Claude to read.' }, l);
  }catch(err){ toast('Couldn’t send the photo ('+err.message+') — try again'); }
};
$('un-walk').onclick=()=>openWalk();
$('wk-close').onclick=closeWalk;
