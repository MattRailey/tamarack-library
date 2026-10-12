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
/* camera upkeep: camWant = the scanner is open; camHold = the photo picker has the camera; tickAt = the last
   turn of the reading loop (a loop that stops, a paused video or an ended track is restarted by camCheck) */
let camWant=false, camHold=0, camStarting=false, camFail=false, camDog=0, tickAt=0;
/* "Scan a stack": every book scanned this time, in order */
let batch=[], batchSeen=new Set();
function loadZX(){
  if(window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    s.onload=()=>window.ZXing?res(window.ZXing):rej(new Error('reader failed to load')); s.onerror=()=>rej(new Error('reader failed to load')); document.head.appendChild(s); });
}
function syncScanMode(){
  const k=scanMode.kind;
  $('sc-modes').classList.toggle('hide', k==='fill');
  document.querySelectorAll('#sc-modes button').forEach(b=>b.classList.toggle('active', b.dataset.k===k));
  $('sc-title').textContent = k==='fill' ? 'Scan this book’s barcode' : k==='check' ? 'Do we own this?' : k==='many' ? 'Scan a stack of books' : 'Scan books to add';
  $('sc-hint').textContent = k==='check'
    ? 'Scan a book at the store or a sale — it only checks, nothing gets added. No barcode? Type the title below.'+(navigator.onLine===false?' (Offline: barcodes and titles are checked against the copy of the library on this phone.)':'')
    : k==='many' ? 'Scan one barcode after another: each book goes in by itself, no tapping. Books you already have are flagged, not added. No barcodes? Take one photo of the whole stack.'
    : 'Point the camera at the barcode on the back cover (the one starting 978 or 979).';
  $('sc-isbn').placeholder = k==='check' ? '…or type an ISBN or a title' : '…or type the ISBN';
  $('sc-isbn').setAttribute('inputmode', k==='check' ? 'text' : 'numeric');
  $('sc-go').textContent = k==='many' ? 'Add' : 'Look up';
  const shelf = k==='add' || k==='many';
  $('sc-loc').classList.toggle('hide', !shelf);
  $('sc-locnote').textContent = k==='many' ? 'Where they go (optional: leave it blank and they’re listed as “No shelf yet” to sort out later):' : 'New books go here (the spot counts up as you scan along a shelf):';
  $('sc-phrow').classList.toggle('hide', !shelf); $('sc-phstatus').classList.toggle('hide', !shelf);
  $('sc-shelfphoto').textContent = k==='many' ? '📷 One photo of the whole stack for Claude' : '📷 Photograph this shelf for Claude';
  $('sc-batch').classList.toggle('hide', k!=='many');
  batchRender();
}
document.querySelectorAll('#sc-modes button').forEach(b=>b.onclick=()=>{ scanMode={kind:b.dataset.k}; ui.scanMode=b.dataset.k; lsSet(UI_KEY, JSON.stringify(ui)); $('sc-result').innerHTML=''; scanBusy=false; lastCode=''; syncScanMode(); });
async function openScanner(mode){
  // mode: {kind:'many'} a stack, each scan added; {kind:'add'} one at a time; {kind:'check'}; {kind:'fill', onFound(fields)} hands the result back
  scanMode=mode||{kind: ['many','add','check'].includes(ui.scanMode) ? ui.scanMode : 'many'};
  $('sc-result').innerHTML=''; $('sc-isbn').value=''; $('sc-phstatus').textContent=''; lastCode='';
  batch=[]; batchSeen=new Set();
  syncScanMode();
  if(scanMode.kind!=='fill'){ const L=ui.scanLoc||{}; $('sc-room').value=L.room||$('f-room').value||''; $('sc-case').value=L.bookcase||$('f-case').value||''; $('sc-shelf').value=L.shelf||$('f-shelf').value||''; $('sc-pos').value=L.nextPos||''; }
  $('scan-bg').classList.add('open'); lockPage();
  beepInit();
  camWant=true; camHold=0; clearInterval(camDog); camDog=setInterval(camCheck, 1500);
  startCamera();
}
/* one start at a time (the photo picker, the watchdog and a return to the page can all ask at once) */
async function startCamera(){
  if(camStarting) return;
  camStarting=true; camFail=false;
  try{ await startCamera0(); }finally{ camStarting=false; }
}
async function startCamera0(){
  stopCamera(); scanBusy=false;
  const v=$('sc-video');
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ camFail=true; $('sc-hint').textContent='This browser can’t use the camera here — type the ISBN below instead.'; return; }
  let st;
  try{
    st = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }, audio:false });
  }catch(e){ camFail=true; $('sc-hint').textContent='No camera access (' + (e.name==='NotAllowedError'?'permission was denied':'no camera found') + ') — type the ISBN below instead.'; return; }
  /* closed (or the picker took over) while the camera was starting */
  if(!camWant || camHold){ st.getTracks().forEach(t=>t.stop()); return; }
  scanStream=st;
  v.srcObject=scanStream; v.setAttribute('playsinline',''); try{ await v.play(); }catch(e){}
  tickAt=Date.now();
  let native=null;
  if('BarcodeDetector' in window){ try{ const f=await BarcodeDetector.getSupportedFormats(); if(f.includes('ean_13')) native=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e'].filter(x=>f.includes(x))}); }catch(e){} }
  const mine=scanStream;
  if(native){
    const tick=async()=>{ if(scanStream!==mine) return; tickAt=Date.now();
      try{ if(!scanBusy && v.readyState>=2){ const r=await native.detect(v); if(r&&r.length) gotCode(r[0].rawValue); } }catch(e){}
      finally{ if(scanStream===mine) scanTimer=setTimeout(tick, 180); } };
    tick(); return;
  }
  try{
    const ZX=await loadZX(); if(scanStream!==mine) return;
    const hints=new Map(); hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS,[ZX.BarcodeFormat.EAN_13,ZX.BarcodeFormat.EAN_8,ZX.BarcodeFormat.UPC_A,ZX.BarcodeFormat.UPC_E]); hints.set(ZX.DecodeHintType.TRY_HARDER,true);
    zxReader=new ZX.MultiFormatReader(); zxReader.setHints(hints);
    const c=document.createElement('canvas'), g=c.getContext('2d',{willReadFrequently:true});
    /* every turn is in try / finally, so a frame that fails to draw or decode never stops the loop;
       decodeWithState keeps the hints (decode() would reset them on every frame) */
    const tick=()=>{ if(scanStream!==mine) return; tickAt=Date.now();
      try{
        if(!scanBusy && v.videoWidth){
          const W=v.videoWidth, H=v.videoHeight, cw=Math.round(W*0.8), ch=Math.round(H*0.5); c.width=cw; c.height=ch;
          g.drawImage(v,(W-cw)/2,(H-ch)/2,cw,ch,0,0,cw,ch);
          let r=null;
          try{ const lum=new ZX.HTMLCanvasElementLuminanceSource(c), bmp=new ZX.BinaryBitmap(new ZX.HybridBinarizer(lum)); r=zxReader.decodeWithState(bmp); }catch(e){}
          finally{ try{ zxReader.reset(); }catch(e){} }
          if(r) gotCode(r.getText());
        }
      }catch(e){}
      finally{ if(scanStream===mine) scanTimer=setTimeout(tick, 150); } };
    tick();
  }catch(e){ $('sc-hint').textContent='The barcode reader couldn’t load (no internet?) — type the ISBN below instead.'; }
}
function stopCamera(){ clearTimeout(scanTimer); if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; } const v=$('sc-video'); if(v) v.srcObject=null; }
/* the watchdog: the phone pauses the video or ends the camera (screen locked, another app, a call, the photo picker
   cancelled) and nothing tells the page; restart it whenever the scanner is open and it isn't running */
function camCheck(){
  if(!camWant || camStarting || camFail || document.hidden) return;
  if(camHold && Date.now()-camHold<120000) return;
  camHold=0;
  const v=$('sc-video'), t=scanStream && scanStream.getVideoTracks()[0];
  if(!scanStream || !t || t.readyState==='ended'){ startCamera(); return; }
  if(v.paused) v.play().catch(()=>{});
  if(Date.now()-tickAt>4000) startCamera();
}
document.addEventListener('visibilitychange', ()=>{
  if(!camWant) return;
  /* hidden: let the camera go (the phone takes it anyway); back: start again */
  if(document.hidden){ if(!camHold) stopCamera(); }
  else setTimeout(camCheck, 300);
});
/* the photo picker closed (a photo or Cancel): the camera comes back */
window.addEventListener('focus', ()=>{ if(camWant && camHold && Date.now()-camHold>800){ camHold=0; setTimeout(camCheck, 300); } });
function closeScanner(){
  camWant=false; camHold=0; clearInterval(camDog); stopCamera(); $('scan-bg').classList.remove('open');
  if(!$('modal-bg').classList.contains('open') && !$('walk-bg').classList.contains('open')) unlockPage();
  const n=batch.filter(r=>r.st==='added'||r.st==='pending').length;
  if(n) toast(n+' book'+(n===1?'':'s')+' added'+(batch.some(r=>r.l&&r.l.room)?'':' (no shelf yet: “No shelf yet” in the filters finds them)'));
}
/* a short beep and buzz on a good read (the sound is unlocked by the tap that opened the scanner) */
let beepCtx=null;
function beepInit(){ try{ if(!beepCtx){ const A=window.AudioContext||window.webkitAudioContext; if(A) beepCtx=new A(); } if(beepCtx && beepCtx.state==='suspended') beepCtx.resume(); }catch(e){} }
function beep(hi){
  try{ navigator.vibrate && navigator.vibrate(hi?60:[40,60,40]); }catch(e){}
  try{ if(!beepCtx) return; const o=beepCtx.createOscillator(), g=beepCtx.createGain(), t=beepCtx.currentTime;
    o.frequency.value=hi?1400:500; g.gain.setValueAtTime(0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.14);
    o.connect(g); g.connect(beepCtx.destination); o.start(t); o.stop(t+0.15); }catch(e){}
  const f=document.querySelector('.sc-frame'); if(f){ f.classList.remove('hit','dup'); void f.offsetWidth; f.classList.add(hi?'hit':'dup'); }
}
function gotCode(raw){
  let d=String(raw||'').replace(/\D/g,'');
  if(d.length===12) d='0'+d;                       // UPC-A → EAN-13
  if(!validEan13(d)) return;
  if(!/^97[89]/.test(d)){ $('sc-hint').textContent='That’s a price or store barcode — look for the one starting 978 or 979.'; return; }
  /* the same barcode still in view: ignored while it stays there (each sighting keeps it ignored for 4 s more) */
  if(d===lastCode && Date.now()-lastCodeAt<4000){ lastCodeAt=Date.now(); return; }
  lastCode=d; lastCodeAt=Date.now();
  if(scanMode.kind==='many'){ batchCode(d); return; }
  beep(true);
  handleIsbn(d);
}
$('sc-go').onclick=()=>{ const raw=$('sc-isbn').value.trim(); if(scanMode.kind==='check' && raw && !isbn13(raw) && /[a-z]/i.test(raw)){ checkTitle(raw); return; }
  if(scanMode.kind==='many'){ const d=isbn13(raw); if(!d){ toast('That doesn’t look like an ISBN (10 or 13 digits)'); return; } $('sc-isbn').value=''; batchCode(d); return; }
  const d=isbn13($('sc-isbn').value) || (!$('sc-isbn').value.trim() && lastCode) || ''; if(!d){ toast('That doesn’t look like an ISBN (10 or 13 digits)'); return; } handleIsbn(d); };
/* ---- "Scan a stack": each new barcode is looked up and added by itself, the scanner keeps reading ---- */
function scLoc(){ return { room:$('sc-room').value.trim(), bookcase:$('sc-case').value.trim(), shelf:$('sc-shelf').value.trim(), position:$('sc-pos').value.trim() }; }
function scRemember(l){ const n=parseInt(l.position); ui.scanLoc={room:l.room, bookcase:l.bookcase, shelf:l.shelf, nextPos: n?String(n+1):''}; lsSet(UI_KEY, JSON.stringify(ui)); $('sc-pos').value=ui.scanLoc.nextPos; }
function batchCode(code){
  if(batchSeen.has(code)){
    const r=batch.find(x=>x.code===code);
    beep(false); $('sc-hint').textContent='Already scanned: '+((r&&r.title)||'ISBN '+code)+'. Next book!';
    return;
  }
  batchSeen.add(code); beep(true);
  /* the spot is taken now, in scan order, even if the look-ups finish in another order */
  const l=scLoc(); if(l.room||l.position) scRemember(l);
  const r={ code, st:'looking', title:'', l };
  batch.push(r); batchRender();
  batchLookup(r);
}
async function batchLookup(r){
  const code=r.code, offline=navigator.onLine===false;
  let info=null;
  try{ const c=await idbGet('isbn:'+code); if(c && c.title) info=c; }catch(e){}
  if(!info && !offline){ try{ info=await Promise.race([isbnLookup(code), new Promise(res=>setTimeout(()=>res(null), 9000))]); }catch(e){}
    if(info && info.title){ try{ await idbPut('isbn:'+code, info); }catch(e){} } }
  if(r.st!=='looking') return;
  r.info=info && info.title ? info : null;
  const m=libMatches(findByIsbn(code), r.info, false);
  if(m.inL.length){ r.st='have'; r.have=m.inL[0]; r.title=(r.info&&r.info.title)||m.inL[0].title; r.author=(r.info&&r.info.author)||m.inL[0].author; batchRender(); return; }
  r.maybe=m.mb[0]||null;
  batchAdd(r);
}
function batchAdd(r){
  const now=Date.now(), l=r.l, code=r.code;
  const b = r.info
    ? Object.assign({ id:uid(), addedAt:now, updatedAt:now, source:'scan', status:'unread', lookupV:0 }, r.info, l)
    : Object.assign({ id:uid(), addedAt:now, updatedAt:now, source:'scan', status:'unread', title:'(ISBN '+code+' — details to fill in)', author:'', isbn:code, pendingIsbn:true, needsReview:true }, l);
  if(!b.coverUrl) delete b.coverUrl;
  store.books.push(b); commit();
  r.id=b.id; r.st=r.info?'added':'pending'; r.title=b.title; r.author=b.author;
  batchRender();
  if(!r.info && navigator.onLine!==false) setTimeout(()=>fillPendingIsbns().then(()=>{ const x=byId(r.id); if(x && !x.pendingIsbn){ r.title=x.title; r.author=x.author; batchRender(); } }), 50);
}
function batchRender(){
  const el=$('sc-batch'); if(!el) return;
  if(!scanMode || scanMode.kind!=='many'){ el.innerHTML=''; return; }
  const n=s=>batch.filter(r=>s.includes(r.st)).length, added=n(['added','pending']), had=n(['have']), look=n(['looking']);
  const where=r=>r.l&&r.l.room ? [r.l.room, r.l.bookcase, r.l.shelf?'Shelf '+r.l.shelf:'', r.l.position?'spot '+r.l.position:''].filter(Boolean).join(' · ') : 'No shelf yet';
  const row=(r,i)=>{
    const t=r.title||'ISBN '+r.code;
    const st = r.st==='looking' ? ['look','Looking up…']
      : r.st==='added' ? ['ok','✓ Added · '+where(r)]
      : r.st==='pending' ? ['ok','✓ Added · '+where(r)+' · title fills in when online']
      : r.st==='have' ? ['have','Already in the library · '+(r.have.room?locText(r.have):'No shelf yet')+' · not added']
      : ['undone','Taken out again'];
    const btn = r.st==='added'||r.st==='pending' ? '<button class="secondary" data-bu="'+i+'">Undo</button>'
      : r.st==='have' ? '<button class="secondary" data-bc="'+i+'">Add another copy</button>' : '';
    const maybe = r.maybe && (r.st==='added'||r.st==='pending') ? '<div class="note" style="margin:0">◐ Could also be <a href="#" data-open="'+r.maybe.id+'">'+esc(r.maybe.title)+'</a> already in the library</div>' : '';
    return '<div class="sc-m sc-b-'+st[0]+'"><div><b>'+(r.id?'<a href="#" data-open="'+r.id+'">'+esc(t)+'</a>':esc(t))+'</b>'+(r.author?' <span class="note" style="margin:0">'+esc(r.author)+'</span>':'')
      +'<div class="note" style="margin:0">'+esc(st[1])+'</div>'+maybe+'</div><div class="sc-mb">'+btn+'</div></div>';
  };
  el.innerHTML = '<div class="sc-bh"><span><b>'+added+' added</b>'+(had?' · '+had+' already had':'')+(look?' · '+look+' looking up…':'')+'</span>'
    +(batch.length?'<button id="sc-done">Done</button>':'')+'</div>'
    + (batch.length ? '<div class="sc-blist">'+batch.map(row).reverse().join('')+'</div>' : '<div class="note" style="margin:4px 0 0;">Scanned books show up here as they go in.</div>');
}
$('sc-batch').addEventListener('click', e=>{
  const a=e.target.closest('[data-open]'); if(a){ e.preventDefault(); const id=a.dataset.open; closeScanner(); openBook(id,[id]); return; }
  if(e.target.closest('#sc-done')){ closeScanner(); return; }
  const u=e.target.closest('[data-bu]'), c=e.target.closest('[data-bc]');
  if(u){ const r=batch[+u.dataset.bu]; if(!r||!r.id) return; const now=Date.now();
    store.books=store.books.map(x=>x.id===r.id?{id:x.id, deleted:true, updatedAt:now}:x); commit();
    r.st='undone'; batchSeen.delete(r.code); batchRender(); }
  if(c){ const r=batch[+c.dataset.bc]; if(!r) return; if(!r.info) r.info=r.have?{ title:r.have.title, author:r.have.author||'', isbn:r.code }:null; batchAdd(r); }
});
/* what in the library this book could be: same barcode or same title = have it; partly identified books = maybe */
function libMatches(have, info, chk, here){
  const partial=b=>isUnid(b) || !!b.needsReview;
  const L0=live(), inLib=new Map(), maybe=new Map();
  for(const b of have) ((partial(b) && !chk)?maybe:inLib).set(b.id,b);   // same barcode = same book
  if(info && info.title){
    const last=normKey(searchAuthor(info.author||'')).split(' ').filter(w=>w.length>=3).pop()||'';
    for(const b of L0){
      if(inLib.has(b.id)||maybe.has(b.id)) continue;
      const tOk = !String(b.title||'').startsWith('(') && titleMatch(info.title, b.title) && (!b.author || !info.author || authorMatch(b.author,[info.author]));
      if(tOk){ (partial(b)?maybe:inLib).set(b.id,b); continue; }
      if(partial(b) && last && normKey((b.title||'')+' '+(b.author||'')).split(' ').includes(last)) maybe.set(b.id,b);   // e.g. "(Hermann Hesse — title not visible)"
    }
  }
  // unreadable books on the very shelf being scanned could be this one too
  if(here && here.room && here.bookcase && here.shelf){
    const same=L0.filter(b=>isUnid(b) && !maybe.has(b.id) && b.room===here.room && b.bookcase===here.bookcase && String(b.shelf)===here.shelf).sort(posCmp);
    same.slice(0,8).forEach(b=>maybe.set(b.id,b));
  }
  return { inL:[...inLib.values()], mb:[...maybe.values()].slice(0,10) };
}
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
let hSeq=0;
async function handleIsbn(code){
  const my=++hSeq; scanBusy=true; lastCode=code; lastCodeAt=Date.now();
  const box=$('sc-result');
  const have = scanMode.kind!=='fill' ? findByIsbn(code) : [];
  const offline = navigator.onLine===false;
  box.innerHTML = (have.length ? '<div class="sc-st have">✓ Already in the library</div>'+have.map(b=>'<div class="sc-m"><div><b>'+esc(b.title)+'</b>'+(b.author?' <span class="note" style="margin:0">'+esc(b.author)+'</span>':'')+'<div class="note" style="margin:0">'+esc(b.room?locText(b):'No shelf yet')+'</div></div></div>').join('') : '')
    + '<div class="note">'+(offline?'Offline — checking this phone’s copy of the library…':have.length?'Checking online for details…':'Looking up '+code+'…')+'</div>';
  let info=null;
  try{ const c=await idbGet('isbn:'+code); if(c && c.title) info=c; }catch(e){}
  if(!info && !offline){ try{ info=await Promise.race([isbnLookup(code), new Promise(r=>setTimeout(()=>r(null), 9000))]); }catch(e){}
    if(info && info.title){ try{ await idbPut('isbn:'+code, info); }catch(e){} } }
  /* a newer scan (or a change of mode) took over while this one was looked up */
  if(my!==hSeq || scanMode.kind==='many') return;
  if(!info) info={ title:'', author:'', isbn:code };
  /* the card is up: the camera keeps reading, and a different barcode simply replaces this card */
  scanBusy=false;
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
  const chk = scanMode.kind==='check';
  const here = chk ? {} : loc();
  const { inL, mb } = libMatches(have, info, chk, here);
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
$('btn-scan').onclick=()=>openScanner();
// in the book form: scan to fill the blanks of this book
$('btn-form-scan').onclick=()=>openScanner({kind:'fill', onFound:info=>{
  ['title','author','isbn','year','publisher','pages','subjects','about'].forEach(k=>{ const el=$('e-'+k); if(el && info[k] && (!el.value.trim() || (k==='title' && el.value.trim().startsWith('(')))) el.value=info[k]; });
  if(info.author && $('e-author').value.trim()!==info.author && String($('e-title').value).startsWith('(')) $('e-author').value=info.author;
  if(info.coverUrl){ pendingCover=info.coverUrl; $('m-cover').innerHTML='<img src="'+esc(info.coverUrl)+'" alt="">'; }
  if(info.title) $('e-review').checked=false;
  toast(info.title?'Filled in from the barcode — tap Save to keep it':'ISBN filled in');
}});
