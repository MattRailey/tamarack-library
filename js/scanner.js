/* Railey Library — scanner.js
   Barcode scanner: add books, "Do I own this?", offline save-for-later.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Barcode scanning — ISBN from the camera (or typed in).
   Uses the phone's built-in barcode reader where there is one
   (Chrome/Android), otherwise loads the ZXing reader on demand.
   ============================================================ */
function isbn13(raw){
  let d=String(raw||'').replace(/[^0-9Xx]/g,'').toUpperCase();
  if(d.length===10){ const core='978'+d.slice(0,9); let s=0; for(let i=0;i<12;i++) s+=(+core[i])*(i%2?3:1); return core+((10-s%10)%10); }
  if(d.length===13 && /^\d+$/.test(d)) return d;
  return '';
}
function validEan13(d){ if(!/^\d{13}$/.test(d)) return false; let s=0; for(let i=0;i<12;i++) s+=(+d[i])*(i%2?3:1); return (10-s%10)%10===+d[12]; }
function findByIsbn(code){ const k=isbn13(code); if(!k) return []; return live().filter(b=>isbn13(b.isbn)===k); }
let scanStream=null, scanTimer=0, zxReader=null, scanMode=null, scanBusy=false, lastCode='', lastCodeAt=0;
function loadZX(){
  if(window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    s.onload=()=>window.ZXing?res(window.ZXing):rej(new Error('reader failed to load')); s.onerror=()=>rej(new Error('reader failed to load')); document.head.appendChild(s); });
}
function syncScanMode(){
  const k=scanMode.kind;
  $('sc-modes').classList.toggle('hide', k==='fill');
  document.querySelectorAll('#sc-modes button').forEach(b=>b.classList.toggle('active', b.dataset.k===k));
  $('sc-title').textContent = k==='fill' ? 'Scan this book’s barcode' : k==='check' ? 'Do we own this?' : 'Scan books to add';
  $('sc-hint').textContent = k==='check'
    ? 'Scan a book at the store or a sale — it only checks, nothing gets added. No barcode? Type the title below.'+(navigator.onLine===false?' (Offline: barcodes and titles are checked against the copy of the library on this phone.)':'')
    : 'Point the camera at the barcode on the back cover (the one starting 978 or 979).';
  $('sc-isbn').placeholder = k==='check' ? '…or type an ISBN or a title' : '…or type the ISBN';
  $('sc-isbn').setAttribute('inputmode', k==='check' ? 'text' : 'numeric');
  $('sc-loc').classList.toggle('hide', k!=='add');
  $('sc-phrow').classList.toggle('hide', k!=='add'); $('sc-phstatus').classList.toggle('hide', k!=='add');
}
document.querySelectorAll('#sc-modes button').forEach(b=>b.onclick=()=>{ scanMode={kind:b.dataset.k}; ui.scanKind=b.dataset.k; lsSet(UI_KEY, JSON.stringify(ui)); $('sc-result').innerHTML=''; scanBusy=false; syncScanMode(); });
async function openScanner(mode){
  // mode: {kind:'add'} adds new books; {kind:'fill', onFound(fields)} hands the result back
  scanMode=mode||{kind: ui.scanKind==='check' ? 'check' : 'add'};
  $('sc-result').innerHTML=''; $('sc-isbn').value=''; $('sc-phstatus').textContent='';
  syncScanMode();
  if(scanMode.kind!=='fill'){ const L=ui.scanLoc||{}; $('sc-room').value=L.room||$('f-room').value||''; $('sc-case').value=L.bookcase||$('f-case').value||''; $('sc-shelf').value=L.shelf||$('f-shelf').value||''; $('sc-pos').value=L.nextPos||''; }
  $('scan-bg').classList.add('open'); lockPage();
  startCamera();
}
async function startCamera(){
  stopCamera(); scanBusy=false;
  const v=$('sc-video');
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ $('sc-hint').textContent='This browser can’t use the camera here — type the ISBN below instead.'; return; }
  try{
    scanStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }, audio:false });
  }catch(e){ $('sc-hint').textContent='No camera access (' + (e.name==='NotAllowedError'?'permission was denied':'no camera found') + ') — type the ISBN below instead.'; return; }
  v.srcObject=scanStream; v.setAttribute('playsinline',''); try{ await v.play(); }catch(e){}
  let native=null;
  if('BarcodeDetector' in window){ try{ const f=await BarcodeDetector.getSupportedFormats(); if(f.includes('ean_13')) native=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e'].filter(x=>f.includes(x))}); }catch(e){} }
  if(native){
    const tick=async()=>{ if(!scanStream) return; if(!scanBusy && v.readyState>=2){ try{ const r=await native.detect(v); if(r&&r.length) gotCode(r[0].rawValue); }catch(e){} } scanTimer=setTimeout(tick, 180); };
    tick(); return;
  }
  try{
    const ZX=await loadZX(); if(!scanStream) return;
    const hints=new Map(); hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS,[ZX.BarcodeFormat.EAN_13,ZX.BarcodeFormat.EAN_8,ZX.BarcodeFormat.UPC_A,ZX.BarcodeFormat.UPC_E]); hints.set(ZX.DecodeHintType.TRY_HARDER,true);
    zxReader=new ZX.MultiFormatReader(); zxReader.setHints(hints);
    const c=document.createElement('canvas'), g=c.getContext('2d',{willReadFrequently:true});
    const tick=()=>{ if(!scanStream) return;
      if(!scanBusy && v.videoWidth){
        const W=v.videoWidth, H=v.videoHeight, cw=Math.round(W*0.8), ch=Math.round(H*0.5); c.width=cw; c.height=ch;
        g.drawImage(v,(W-cw)/2,(H-ch)/2,cw,ch,0,0,cw,ch);
        try{ const lum=new ZX.HTMLCanvasElementLuminanceSource(c), bmp=new ZX.BinaryBitmap(new ZX.HybridBinarizer(lum)); const r=zxReader.decode(bmp); if(r) gotCode(r.getText()); }catch(e){}
      }
      scanTimer=setTimeout(tick, 150); };
    tick();
  }catch(e){ $('sc-hint').textContent='The barcode reader couldn’t load (no internet?) — type the ISBN below instead.'; }
}
function stopCamera(){ clearTimeout(scanTimer); if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; } const v=$('sc-video'); if(v) v.srcObject=null; }
function closeScanner(){ stopCamera(); $('scan-bg').classList.remove('open'); if(!$('modal-bg').classList.contains('open') && !$('walk-bg').classList.contains('open')) unlockPage(); }
function gotCode(raw){
  let d=String(raw||'').replace(/\D/g,'');
  if(d.length===12) d='0'+d;                       // UPC-A → EAN-13
  if(!validEan13(d)) return;
  if(!/^97[89]/.test(d)){ $('sc-hint').textContent='That’s a price or store barcode — look for the one starting 978 or 979.'; return; }
  if(d===lastCode && Date.now()-lastCodeAt<4000 && $('sc-result').innerHTML) return;
  lastCode=d; lastCodeAt=Date.now();
  try{ navigator.vibrate && navigator.vibrate(60); }catch(e){}
  handleIsbn(d);
}
$('sc-go').onclick=()=>{ const raw=$('sc-isbn').value.trim(); if(scanMode.kind==='check' && raw && !isbn13(raw) && /[a-z]/i.test(raw)){ checkTitle(raw); return; } const d=isbn13($('sc-isbn').value) || (!$('sc-isbn').value.trim() && lastCode) || ''; if(!d){ toast('That doesn’t look like an ISBN (10 or 13 digits)'); return; } handleIsbn(d); };
$('sc-isbn').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); $('sc-go').onclick(); } });
async function isbnLookup(code){
  const docs = await bookSearch('', '', code);
  if(!docs.some(x=>x.title)){ try{ const r=await fetch('https://openlibrary.org/isbn/'+code+'.json'); if(r.ok){ const j=await r.json(); let au=[];
      for(const a of (j.authors||[]).slice(0,3)){ try{ const ra=await fetch('https://openlibrary.org'+a.key+'.json'); if(ra.ok) au.push((await ra.json()).name); }catch(e){} }
      docs.push({ src:'Open Library', title:j.title+(j.subtitle?': '+j.subtitle:''), authors:au, year:(String(j.publish_date||'').match(/\d{4}/)||[''])[0], isbn:[code], publisher:(j.publishers||[])[0]||'',
        pages:j.number_of_pages?String(j.number_of_pages):'', subjects:j.subjects||[], cover:(j.covers&&j.covers[0]>0)?'https://covers.openlibrary.org/b/id/'+j.covers[0]+'-M.jpg':'' }); } }catch(e){} }
  const d = docs.find(x=>x.title) || null;
  if(!d) return null;
  const f=docFill(d);
  const about = (docs.find(x=>x.about)||{}).about || '';
  return { title:d.title||'', author:(d.authors||[]).join(', '), isbn:code, year:f.year, publisher:f.publisher, pages:f.pages, subjects:f.subjects,
    about, coverUrl: f.coverUrl || (docs.find(x=>x.cover)||{}).cover || '' };
}
async function handleIsbn(code){
  scanBusy=true; lastCode=code; lastCodeAt=Date.now();
  const box=$('sc-result');
  const have = scanMode.kind!=='fill' ? findByIsbn(code) : [];
  const offline = navigator.onLine===false;
  box.innerHTML = (have.length ? '<div class="sc-st have">✓ Already in the library</div>'+have.map(b=>'<div class="sc-m"><div><b>'+esc(b.title)+'</b>'+(b.author?' <span class="note" style="margin:0">'+esc(b.author)+'</span>':'')+'<div class="note" style="margin:0">'+esc(b.room?locText(b):'No shelf yet')+'</div></div></div>').join('') : '')
    + '<div class="note">'+(offline?'Offline — checking this phone’s copy of the library…':have.length?'Checking online for details…':'Looking up '+code+'…')+'</div>';
  let info=null;
  try{ const c=await idbGet('isbn:'+code); if(c && c.title) info=c; }catch(e){}
  if(!info && !offline){ try{ info=await Promise.race([isbnLookup(code), new Promise(r=>setTimeout(()=>r(null), 9000))]); }catch(e){}
    if(info && info.title){ try{ await idbPut('isbn:'+code, info); }catch(e){} } }
  if(!info) info={ title:'', author:'', isbn:code };
  if(scanMode.kind==='fill'){
    box.innerHTML = info.title
      ? scanCard(info)+'<div class="row" style="margin-top:10px;"><button id="sc-use">Use this</button><button class="secondary" id="sc-again">Scan again</button></div>'
      : '<div class="note">Couldn’t find ISBN '+code+' online. You can still keep the ISBN and type the title.</div><div class="row" style="margin-top:10px;"><button id="sc-use">Keep the ISBN</button><button class="secondary" id="sc-again">Scan again</button></div>';
    $('sc-use').onclick=()=>{ const cb=scanMode.onFound; closeScanner(); cb && cb(info); };
    $('sc-again').onclick=()=>{ box.innerHTML=''; scanBusy=false; };
    return;
  }
  // ---- where does this book stand in the library? ----
  const loc=()=>({ room:$('sc-room').value.trim(), bookcase:$('sc-case').value.trim(), shelf:$('sc-shelf').value.trim(), position:$('sc-pos').value.trim() });
  const remember=l=>{ const n=parseInt(l.position); ui.scanLoc={room:l.room, bookcase:l.bookcase, shelf:l.shelf, nextPos: n?String(n+1):''}; lsSet(UI_KEY, JSON.stringify(ui)); $('sc-pos').value=ui.scanLoc.nextPos; };
  const partial=b=>isUnid(b) || !!b.needsReview;
  const chk = scanMode.kind==='check';
  const L0=live(), here = chk ? {} : loc();
  const inLib=new Map(), maybe=new Map();
  for(const b of have) ((partial(b) && !chk)?maybe:inLib).set(b.id,b);   // same barcode = same book
  if(info.title){
    const last=normKey(searchAuthor(info.author||'')).split(' ').filter(w=>w.length>=3).pop()||'';
    for(const b of L0){
      if(inLib.has(b.id)||maybe.has(b.id)) continue;
      const tOk = !String(b.title||'').startsWith('(') && titleMatch(info.title, b.title) && (!b.author || !info.author || authorMatch(b.author,[info.author]));
      if(tOk){ (partial(b)?maybe:inLib).set(b.id,b); continue; }
      if(partial(b) && last && normKey((b.title||'')+' '+(b.author||'')).split(' ').includes(last)) maybe.set(b.id,b);   // e.g. "(Hermann Hesse — title not visible)"
    }
  }
  // unreadable books on the very shelf being scanned could be this one too
  if(here.room && here.bookcase && here.shelf){
    const same=L0.filter(b=>isUnid(b) && !maybe.has(b.id) && b.room===here.room && b.bookcase===here.bookcase && String(b.shelf)===here.shelf).sort(posCmp);
    same.slice(0,8).forEach(b=>maybe.set(b.id,b));
  }
  const inL=[...inLib.values()], mb=[...maybe.values()].slice(0,10);
  const status = inL.length ? 'have' : mb.length ? 'partial' : 'new';
  const badge = chk
    ? { have:['sc-st have','✓ Yes — you own this'+(inL.length>1?' ('+inL.length+' copies)':'')], partial:['sc-st partial','◐ Maybe — could be one of your partly identified books'], new:['sc-st new','✗ Not in the library'] }[status]
    : { have:['sc-st have','✓ Already in the library'], partial:['sc-st partial','◐ Possibly a partly identified book'], new:['sc-st new','＋ Not in the library yet'] }[status];
  const row=(b,kind)=>'<div class="sc-m"><div><a href="#" data-open="'+b.id+'"><b>'+esc(b.title)+'</b></a>'+(b.author?' <span class="note" style="margin:0">'+esc(b.author)+'</span>':'')
      +'<div class="note" style="margin:0">'+esc(b.room?locText(b):'No shelf yet')+'</div></div>'
      +(chk?'<div class="sc-mb">':'<div class="sc-mb"><button class="secondary" data-this="'+b.id+'" data-kind="'+kind+'">That’s it</button>')
      +(kind==='have' && here.room && b.room && (b.room!==here.room||b.bookcase!==here.bookcase||String(b.shelf)!==here.shelf)?'<button class="secondary" data-move="'+b.id+'">Move here</button>':'')+'</div></div>';
  let html='<div class="'+badge[0]+'">'+badge[1]+'</div>';
  html += info.title ? scanCard(info) : chk ? '<div class="note">'+(offline?'Offline, so no title lookup — ':'')+'No book with barcode '+code+' is in the library. Books added from shelf photos usually have no barcode on file, so <b>type the title above</b> to double-check.</div>'
    : offline ? '<div class="sc-have">You’re offline, so the title can’t be looked up yet. Tap <b>Save for later</b> — it goes in with this ISBN and shelf spot, and the title, author and cover fill in by themselves next time the app is online.</div>'
    : '<div class="sc-have">The barcode read fine (ISBN '+code+'), but the free book databases don’t have this one — common for self-published, print-on-demand'+(/^9798/.test(code)?' (ISBNs starting 979-8 are usually Amazon self-published)':'')+' and very new books. Tap <b>Add by hand</b>: the ISBN and shelf spot are filled in, and you can snap the cover there.</div>';
  if(inL.length) html+='<div class="sc-grp"><div class="sc-gh">You have it'+(inL.length>1?' ('+inL.length+' copies)':'')+'</div>'+inL.map(b=>row(b,'have')).join('')+'</div>';
  if(mb.length) html+='<div class="sc-grp"><div class="sc-gh">'+(inL.length?'Also possibly one of these partly identified books':'Is it one of these partly identified books?')+'</div>'+mb.map(b=>row(b,'partial')).join('')+'</div>';
  html += chk
    ? '<div class="row" style="margin-top:10px;"><button id="sc-again">Check another</button></div>'
    : '<div class="row" style="margin-top:10px;">'+(info.title?'<button id="sc-add">'+(inL.length?'Add another copy':mb.length?'Add as a new book':'Add to library')+'</button>':offline?'<button id="sc-later">Save for later</button>':'')
    +'<button class="secondary" id="sc-edit">'+(info.title?'Edit first':'Add by hand')+'</button><button class="secondary" id="sc-again">Next book</button></div>';
  box.innerHTML=html;
  box.querySelectorAll('[data-open]').forEach(a=>a.onclick=ev=>{ ev.preventDefault(); closeScanner(); openBook(a.dataset.open,[a.dataset.open]); });
  const done=msg=>{ box.innerHTML='<div class="sc-ok">'+msg+'</div>'; scanBusy=false; };
  box.querySelectorAll('[data-this]').forEach(btn=>btn.onclick=()=>{
    const id=btn.dataset.this, kind=btn.dataset.kind, now=Date.now(), l=loc();
    let msg='';
    store.books=store.books.map(x=>{ if(x.id!==id) return x;
      const ch={ updatedAt:now };
      ['isbn','year','publisher','pages','subjects','about'].forEach(k=>{ if(info[k] && !x[k]) ch[k]=info[k]; });
      if(info.coverUrl && !x.coverUrl) ch.coverUrl=info.coverUrl;
      if(kind==='partial' && info.title){ ch.title=info.title; if(info.author) ch.author=info.author; ch.needsReview=false; ch.lookupV=0; if(info.coverUrl) ch.coverUrl=info.coverUrl; }
      if(!x.room && l.room){ ch.room=l.room; ch.bookcase=l.bookcase; ch.shelf=l.shelf; if(l.position) ch.position=l.position; }
      const y=Object.assign({}, x, ch);
      msg = (kind==='partial'?'✓ Identified <b>'+esc(y.title)+'</b> (was “'+esc(x.title)+'”)':'✓ Updated <b>'+esc(y.title)+'</b> with the barcode details')+(!x.room&&ch.room?' and gave it a spot: '+esc(locText(y)):'')+'.';
      return y; });
    commit(); done(msg);
  });
  box.querySelectorAll('[data-move]').forEach(btn=>btn.onclick=()=>{
    const id=btn.dataset.move, l=loc(), now=Date.now(), was=locText(byId(id));
    store.books=store.books.map(x=>x.id===id?Object.assign({}, x, { room:l.room, bookcase:l.bookcase, shelf:l.shelf, position:l.position||x.position, updatedAt:now }):x);
    commit(); remember(l); done('✓ Moved <b>'+esc(byId(id).title)+'</b> from '+esc(was)+' to '+esc(locText(byId(id)))+'.');
  });
  if($('sc-add')) $('sc-add').onclick=()=>{
    const l=loc(), now=Date.now();
    const b=Object.assign({ id:uid(), addedAt:now, updatedAt:now, source:'scan', status:'unread', lookupV:0 }, info, l);
    if(!b.coverUrl) delete b.coverUrl;
    store.books.push(b); commit(); remember(l);
    done('✓ Added <b>'+esc(b.title)+'</b>'+(inL.length?' as another copy':'')+(l.room?' — '+esc(locText(b)):' (no shelf yet)'));
  };
  if($('sc-later')) $('sc-later').onclick=()=>{
    const l=loc(), now=Date.now();
    const b=Object.assign({ id:uid(), addedAt:now, updatedAt:now, source:'scan', status:'unread', title:'(ISBN '+code+' — details to fill in)', author:'', isbn:code, pendingIsbn:true, needsReview:true }, l);
    store.books.push(b); commit(); remember(l);
    done('✓ Saved ISBN '+code+(l.room?' at '+esc(locText(b)):'')+' — the details fill in when you’re back online.');
  };
  if($('sc-edit')) $('sc-edit').onclick=()=>{ const l=loc(); remember(l); closeScanner(); openNew(Object.assign({status:'unread'}, info, l)); };
  $('sc-again').onclick=()=>{ box.innerHTML=''; scanBusy=false; };
}
function checkTitle(text){
  const box=$('sc-result'); lastCode='';
  const toks=words(text).split(' ').filter(t=>t && !STOP.has(t));
  if(!toks.length){ box.innerHTML=''; return; }
  const hits=[];
  for(const b of live()){ const ix=bookIndex(b); let sc=0, ok=true; for(const t of toks){ const s=tokScore(ix.all,t,false); if(!s){ ok=false; break; } sc+=s; } if(ok) hits.push([sc,b]); }
  hits.sort((a,b)=>b[0]-a[0]);
  const top=hits.slice(0,8).map(x=>x[1]);
  box.innerHTML = (top.length ? '<div class="sc-st have">✓ '+(top.length===1?'Found one':'Found '+hits.length)+' in the library</div>' : '<div class="sc-st new">✗ Nothing in the library matches “'+esc(text)+'”</div>')
    + top.map(b=>'<div class="sc-m"><div><a href="#" data-open="'+b.id+'"><b>'+esc(b.title)+'</b></a>'+(b.author?' <span class="note" style="margin:0">'+esc(b.author)+'</span>':'')+'<div class="note" style="margin:0">'+esc(b.room?locText(b):'No shelf yet')+'</div></div></div>').join('')
    + (hits.length>8?'<div class="note">…and '+(hits.length-8)+' more — add a word to narrow it.</div>':'')
    + '<div class="row" style="margin-top:10px;"><button id="sc-again">Check another</button></div>';
  box.querySelectorAll('[data-open]').forEach(a=>a.onclick=ev=>{ ev.preventDefault(); closeScanner(); openBook(a.dataset.open,[a.dataset.open]); });
  $('sc-again').onclick=()=>{ box.innerHTML=''; $('sc-isbn').value=''; scanBusy=false; };
}
// books saved offline by barcode: fill in title, author and cover once we're online
let _filling=false;
async function fillPendingIsbns(){
  if(_filling || navigator.onLine===false) return; _filling=true;
  try{
    for(const b of live().filter(x=>x.pendingIsbn).slice(0,15)){
      let info=null; try{ info=await Promise.race([isbnLookup(b.isbn), new Promise(r=>setTimeout(()=>r(null), 9000))]); }catch(e){}
      const cur=byId(b.id); if(!cur || !cur.pendingIsbn) continue;
      const now=Date.now();
      if(info && info.title){
        const ch={ title:info.title, author:info.author||'', needsReview:false, updatedAt:now };
        ['year','publisher','pages','subjects','about','coverUrl'].forEach(k=>{ if(info[k] && !cur[k]) ch[k]=info[k]; });
        store.books=store.books.map(x=>x.id===b.id?Object.assign({}, x, ch, {pendingIsbn:false}):x);
      } else {
        store.books=store.books.map(x=>x.id===b.id?Object.assign({}, x, { pendingIsbn:false, title:'(ISBN '+b.isbn+' — not found online)', notes:((x.notes||'')+' Barcode not in the free book databases — add the title by hand.').trim(), updatedAt:now }):x);
      }
      commit();
    }
  }finally{ _filling=false; }
}
function scanCard(i){
  return '<div class="sc-card">'+(i.coverUrl?'<img src="'+esc(i.coverUrl)+'" alt="">':'<div class="sc-nocov">No cover</div>')+'<div><b>'+esc(i.title)+'</b><br>'+esc(i.author||'Unknown author')+(i.year?' · '+esc(i.year):'')+(i.publisher?'<br><span class="note" style="margin:0">'+esc(i.publisher)+'</span>':'')+'<br><span class="note" style="margin:0">ISBN '+esc(i.isbn)+'</span></div></div>';
}
$('sc-close').onclick=closeScanner;
$('btn-scan').onclick=()=>openScanner({kind:'add'});
// in the book form: scan to fill the blanks of this book
$('btn-form-scan').onclick=()=>openScanner({kind:'fill', onFound:info=>{
  ['title','author','isbn','year','publisher','pages','subjects','about'].forEach(k=>{ const el=$('e-'+k); if(el && info[k] && (!el.value.trim() || (k==='title' && el.value.trim().startsWith('(')))) el.value=info[k]; });
  if(info.author && $('e-author').value.trim()!==info.author && String($('e-title').value).startsWith('(')) $('e-author').value=info.author;
  if(info.coverUrl){ pendingCover=info.coverUrl; $('m-cover').innerHTML='<img src="'+esc(info.coverUrl)+'" alt="">'; }
  if(info.title) $('e-review').checked=false;
  toast(info.title?'Filled in from the barcode — tap Save to keep it':'ISBN filled in');
}});
